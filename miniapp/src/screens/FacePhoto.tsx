import { useEffect, useRef, useState } from 'react';

import { probeCamera, stopStream, type CameraProbeResult, type MediaDevicesLike } from '../camera';
import { Icon } from '../components/Icon';
import { captureJpeg, PREVIEW_TRANSFORM, type Captured } from '../logic/capture';
import { isActive } from '../logic/products';
import { isNotifySupported, requestNotifyAgreement } from '../notify';
import { savePhoto } from '../photoStore';
import {
  isNotifyPrompted,
  saveNotifyPrompted,
  todayKey,
  VERDICT_KO,
  VERDICTS,
  type Product,
  type Usage,
  type Verdict,
} from '../storage';
import { ui } from '../ui';
import { LOCAL_ONLY, useObjectUrl, usePhotos } from './usePhotos';

/**
 * 얼굴 촬영. **매일 같은 구도·같은 조명으로 찍는 것이 이 화면의 전부다.**
 *
 * 첫 촬영은 격자 + 얼굴 가이드로 기준 구도를 잡고, 이후에는 **기준 사진(남아 있는 가장 오래된
 * 것)**을 반투명 고스트로 겹쳐 사람이 스스로 맞춘다 — 얼굴 인식 AI는 없다(설계 §1-3).
 * 고스트를 직전 사진으로 두면 하루 1~2px의 어긋남이 누적돼 한 달 뒤 구도가 딴판이 되는데,
 * 얼굴은 전신보다 프레임 점유가 커서 그 드리프트가 더 빨리 눈에 띈다.
 *
 * ⚠️ **미러 일관성**: 프리뷰가 거울상이면 저장본도 같은 방향이어야 한다. 한쪽만 고치면
 * 다음날 고스트와 얼굴이 좌우로 어긋나 **영영 안 맞는다** — 변환은 `logic/capture.ts` 한 곳에서 나온다.
 *
 * ⚠️ 실패해도 **닫기로 멀쩡히 돌아간다.** 심사자는 권한을 거부부터 눌러 본다(설계 §6).
 */

/** 프로브가 감별해 둔 세 갈래를 사용자 문구로 옮긴다. 원문은 작은 글씨로 병기한다(문의 대응용). */
function cameraNotice(detail: string): string {
  if (detail === 'unsupported') return '이 환경에서는 카메라를 쓸 수 없어요';
  // 권한은 사용자가 고칠 수 있는 유일한 실패다 — 「다시 시도」로 뭉개면 영영 안 되는 재시도만 반복한다.
  if (detail.startsWith('NotAllowedError')) return '카메라 권한이 꺼져 있어요. 토스 앱 설정에서 허용해 주세요';
  return '카메라를 여는 데 실패했어요. 잠시 후 다시 시도해 주세요';
}

/**
 * 트랙이 아직 살아 있는가. **`mute`는 `readyState`를 'live'로 남긴다** — 그래서 둘 다 본다.
 * restfit 실기기 버그가 정확히 이 갈래였다(화면 녹화가 카메라를 물면 죽지 않고 얼어붙기만 한다).
 */
const alive = (stream: MediaStream) => stream.getTracks().some((t) => t.readyState === 'live' && !t.muted);

const DOWN_NOTICE = '카메라가 중단됐어요';
const QUOTA_NOTICE = '공간이 부족해요 — 오래된 사진을 지워 주세요';
const SAVE_NOTICE = '저장하지 못했어요. 다시 시도해 주세요';
const SHOT_NOTICE = '사진을 찍지 못했어요. 다시 시도해 주세요';

/** 사람이 프롬프트를 읽고 누를 시간은 주되, 웹뷰가 프롬프트를 삼켰을 때 화면이 굳지는 않게. */
const OPEN_TIMEOUT_MS = 10000;

/**
 * 흰 화면을 띄우고 **얼마나 기다렸다가** 찍는가.
 *
 * 조명이 이 앱의 최대 교란 변수인데, 웹뷰에서 화면 밝기 자체는 못 올린다(Screen Brightness
 * API가 없다) — **흰 픽셀이 낼 수 있는 최대 광량이 상한이고 그게 이 기법의 전부다.**
 * 0ms로 찍으면 흰 화면이 뜨기도 전의 어두운 프레임이 저장돼 플래시가 통째로 무의미해진다.
 * 이 지연은 **전면 카메라의 자동 노출 보정이 따라올 시간**이다.
 *
 * ⚠️ 500은 실기기 실측 전의 출발값이다(설계 §11) — 태스크 10에서 확정한다. 상수 하나라 싸다.
 * 1회성 정적 표시(점멸 아님)라 광과민성 규율과는 무관하다.
 */
export const FLASH_MS = 500;

/**
 * 관찰 1문항의 선택지. 어휘·문구는 `storage.ts` 한 벌(`VERDICTS`·`VERDICT_KO`)에서 온다 —
 * 순서까지 그대로다. 여기 사본을 두면 셋 중 하나만 바뀐다(v4-1 리뷰).
 */
const VERDICT_OPTIONS = VERDICTS.map((v) => ({ verdict: v, label: VERDICT_KO[v] }));

/** 사용 로그 질문의 id. 칩 묶음이 이걸로 그 질문을 자기 이름으로 삼는다(§4-4 접근성). */
const USED_ASK_ID = 'used-ask';

export function FacePhoto({
  products,
  usage,
  onClose,
  onNote,
  onUsage,
  media = navigator.mediaDevices,
  idb,
}: {
  /** 칩에 세울 후보. **가끔(`occasional`) + 오늘 사용 중**인 것만 물어본다(§4-4). */
  products: Product[];
  /** 오늘 로그가 이미 있으면 칩이 켜진 채로 뜬다 — 같은 날 다시 찍기가 정정 경로다(§4-9). */
  usage: Usage;
  onClose: () => void;
  /** 관찰 1문항의 답. **안 부르는 것이 「건너뛰기」다** — 기본값을 대신 채우지 않는다. */
  onNote: (date: string, verdict: Verdict) => void;
  /**
   * 이 사진 직전 루틴에 쓴 제품. **빈 배열도 부른다**(「물어봤고 안 썼다」) — 대신 물어볼
   * 제품이 하나도 없으면 **아예 안 부른다**(키 없음 = 안 물어봄. 3상 — §3-4).
   */
  onUsage: (date: string, ids: string[]) => void;
  /** 테스트가 가짜 카메라를 넣는 자리. 실사용에서는 `navigator.mediaDevices`다. */
  media?: MediaDevicesLike;
  /** 테스트가 fake-indexeddb를 넣는 자리. 없으면 `globalThis.indexedDB`. */
  idb?: IDBFactory;
}) {
  /** `null`은 「아직 여는 중」이다 — 실패와 구별돼야 화면이 「켜는 중」과 안내로 갈린다. */
  const [cam, setCam] = useState<CameraProbeResult | null>(null);
  // 기준 사진은 목록의 **첫 장**(가장 오래된 것)이다 — `listPhotos`가 날짜 오름차순이라 그렇다.
  const { db, photos } = usePhotos(idb);
  const [ghostOn, setGhostOn] = useState(true);
  /**
   * 셔터를 3초 뒤로 미룰까. **세션 안에서만 산다** — 저장해 두면 다음에 화면을 연 사람이
   * 셔터를 눌러 놓고 「왜 안 찍히지」를 3초 동안 겪는다. 기본은 즉시 촬영이다.
   */
  const [timerOn, setTimerOn] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  /** 흰 오버레이가 떠 있다. 이게 켜져 있는 동안 셔터는 잠긴다. */
  const [flash, setFlash] = useState(false);
  const [shot, setShot] = useState<Captured | null>(null);
  const [saving, setSaving] = useState(false);
  /** 저장에 성공했다 — 관찰 1문항 단계. **실패하면 절대 여기 안 온다**(설계 §5-1). */
  const [asking, setAsking] = useState(false);
  /** 관찰까지 끝낸 뒤의 알림 제안 단계. **자동으로는 평생 한 번만 켜진다**(설계 §3-2). */
  const [suggesting, setSuggesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 스트림이 끊겼다. restfit 실기기(iOS 화면 녹화)에서 실제로 터진 상태다. */
  const [down, setDown] = useState(false);
  /** 재취득 세대. 늘리면 여는 effect가 다시 도는데, **cleanup이 옛 스트림을 놓아주는 것도 그대로다.** */
  const [gen, setGen] = useState(0);
  /**
   * 이번 사진 직전에 쓴 제품(§4-4). **오늘 로그로 미리 채운다** — 같은 날 「다시 찍기」가
   * 곧 정정 경로라, 빈손으로 열면 방금 적은 것이 조용히 지워진다.
   */
  const [used, setUsed] = useState<string[]>(() => usage[todayKey()] ?? []);

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** 자동 재연결을 이미 한 번 썼는가. 살아 있는 스트림을 다시 잡으면 도로 풀린다. */
  const autoTried = useRef(false);

  /**
   * 카메라를 연다. **스트림의 수명이 이 effect 하나에 갇힌다** — 화면을 닫으면 반드시 꺼진다.
   *
   * 늦게 도착한 스트림(이미 언마운트된 뒤)도 끈다. 붙일 화면이 없는데 그냥 두면
   * **카메라가 켜진 채로 남아** 다음 진입이 막힌다.
   *
   * ⚠️ `asking`이 deps에 있는 이유: 관찰 1문항 단계에서는 프리뷰가 사라지므로 **카메라를
   * 놓아준다.** 답을 고르는 동안 카메라가 켜져 있을 이유가 없고, 그동안 다른 앱이 못 쓴다.
   */
  useEffect(() => {
    if (asking) return;
    let dead = false;
    let live: MediaStream | null = null;
    void probeCamera(media, { timeoutMs: OPEN_TIMEOUT_MS }).then((r) => {
      if (dead) {
        if (r.ok) stopStream(r.stream);
        return;
      }
      if (r.ok) {
        live = r.stream;
        setDown(false);
      }
      setCam(r);
    });
    return () => {
      dead = true;
      if (live) stopStream(live);
    };
  }, [media, gen, asking]);

  /**
   * 끊김 감지. 다른 앱이 카메라를 가져가면(화면 녹화의 셀피 오버레이 등) 트랙이 `ended`거나
   * `mute`가 되는데, **`<video>`는 붙어 있어서 마지막 프레임이 그대로 얼어붙는다** — 사용자
   * 눈에는 살아 있는 프리뷰다. 그 거짓말을 여기서 끊는다.
   */
  useEffect(() => {
    if (!cam?.ok) return;
    const tracks = cam.stream.getTracks();
    tracks.forEach((t) => {
      t.addEventListener('ended', interrupt);
      t.addEventListener('mute', interrupt);
    });
    return () =>
      tracks.forEach((t) => {
        t.removeEventListener('ended', interrupt);
        t.removeEventListener('mute', interrupt);
      });
  }, [cam]);

  /**
   * 자동 재연결. 앱을 벗어난 사이에 끊기면 **이벤트를 못 받고 지나갈 수 있어**, 돌아온 시점에
   * 트랙 상태를 직접 본다(`alive`를 핸들러 안에서 재는 이유 — 등록 시점 값은 이미 낡았다).
   *
   * ⚠️ 확인·관찰 화면에서는 손대지 않는다. 사진은 이미 손에 있고, 저장을 방해할 이유가 없다 —
   * **프리뷰로 돌아갈 때**(`shot`이 비는 순간) 비로소 다시 연다.
   */
  useEffect(() => {
    if (shot || asking) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      // 첫 취득 실패(권한 거부 등)는 여기서 안 건드린다 — 안 그러면 영영 도는 재시도가 된다.
      if (!cam?.ok) return;
      if (alive(cam.stream)) return void (autoTried.current = false);
      /*
        ⚠️ **자동 재연결은 한 번뿐이다.** `reconnect()`가 `cam`을 바꾸고 이 effect의 deps가
        `cam`이라, 다시 취득한 스트림**마저 죽어 있으면** 판정 → 재취득 → 판정으로 영영 돈다
        (restfit 리뷰 실측: 5초에 `getUserMedia` 463회, `down`이 진동해 「다시 연결」 버튼조차
        못 누른다). iOS 녹화 중에는 재취득이 실제로 muted 트랙을 돌려주므로 **가정이 아니라
        그 상황이다.** 두 번째부터는 사람에게 넘긴다 — 녹화를 끄는 것은 우리가 못 하는 일이다.
      */
      if (autoTried.current) return setDown(true);
      autoTried.current = true;
      reconnect();
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [cam, shot, asking]);

  /** 카운트다운·플래시는 여기서 죽는다 — 얼어붙은 마지막 프레임을 셔터가 찍어 저장하는 사고를 막는다. */
  function interrupt() {
    setDown(true);
    setCount(null);
    setFlash(false);
  }

  /** 재연결. **같은 취득 경로를 다시 탄다** — 옛 스트림 정리는 여는 effect의 cleanup 몫이다. */
  function reconnect() {
    interrupt();
    setCam(null);
    setGen((g) => g + 1);
  }

  /**
   * ⚠️ **`shot`이 deps에 있어야 한다.** 확인 화면으로 갈 때 `<video>`가 통째로 사라졌다가
   * 「다시 찍기」에서 **새 노드로** 돌아온다 — 스트림을 처음 한 번만 붙이면 돌아온 프리뷰는
   * 영영 까맣고, 사용자는 카메라가 고장 난 줄 안다.
   */
  useEffect(() => {
    if (cam?.ok && video.current) video.current.srcObject = cam.stream;
  }, [cam, shot]);

  const baseline = photos[0];

  const ghostUrl = useObjectUrl(ghostOn ? baseline?.blob : undefined);
  const shotUrl = useObjectUrl(shot?.blob);

  // 카운트다운. 0에 닿는 순간이 셔터다 — 폰을 세우고 물러선 사람에게는 이것이 유일한 촬영 경로다.
  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      setCount(null);
      // 카운트 0 → **플래시 on** → FLASH_MS → 캡처. 여기서 바로 찍으면 플래시가 없는 것과 같다.
      setFlash(true);
      return;
    }
    const t = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(t);
  }, [count]);

  /**
   * 플래시가 켜지면 `FLASH_MS` 뒤에 찍는다.
   *
   * ⚠️ **effect로 두는 것이 요점이다.** `shoot()` 안에서 `await sleep()` 하면 화면을 닫은
   * 뒤에도 타이머가 살아남아 사라진 프리뷰에 대고 캡처를 시도한다 — cleanup이 그걸 끊는다.
   */
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => void shoot(), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  async function shoot() {
    if (!video.current || !canvas.current) return setFlash(false);
    const got = await captureJpeg(video.current, canvas.current);
    setFlash(false);
    /*
      캡처가 빈손인 경로는 셋이고 **셋 중 둘은 카메라가 멀쩡하다**: 프레임이 아직 0×0(진입
      직후·다시 찍기 직후의 좁은 창) · 2D 컨텍스트 없음 · `toBlob` 실패. 그래서 **트랙이
      죽었을 때만** 중단으로 넘긴다 — 무조건 중단으로 보내면 한 번 삐끗한 캡처가 멀쩡한
      카메라 세션을 통째로 철거하고 「다른 앱이 카메라를…」이라는 **틀린 안내**까지 띄운다.
      죽은 트랙이면 반대로 「다시 시도해 주세요」가 거짓말이다(영영 안 되는 셔터를 권한다).
    */
    if (!got) return cam?.ok && !alive(cam.stream) ? interrupt() : setNotice(SHOT_NOTICE);
    setNotice(null);
    setShot(got);
  }

  async function save() {
    if (!shot || !db) return;
    setSaving(true);
    const result = await savePhoto(db, {
      // 날짜가 키다 — 같은 날 다시 찍으면 교체된다(「하루 1장」).
      date: todayKey(),
      blob: shot.blob,
      capturedAt: Date.now(),
      width: shot.width,
      height: shot.height,
    });
    setSaving(false);
    // ⚠️ **저장에 성공해야만** 관찰 단계로 넘어간다 — 사진 없는 관찰만 남는 상태를 안 만든다.
    if (result === 'ok') return setAsking(true);
    // 원인을 갈라 말한다 — 쿼터에 「다시 시도」는 영영 안 되는 일을 권하는 것이다.
    setNotice(result === 'quota' ? QUOTA_NOTICE : SAVE_NOTICE);
  }

  const close = (
    <button style={ui.ghost} onClick={onClose}>
      닫기
    </button>
  );

  /**
   * 관찰 단계의 출구. 답을 골랐든 건너뛰었든 여기로 온다.
   *
   * **딱 한 번, 물어볼 수 있을 때만** 알림 제안이 낀다 — 이미 물어봤거나 이 기기가 알림을
   * 못 받으면 예전 그대로 곧장 닫힌다. 알림이 촬영 흐름의 문턱이 되면 주객전도다(설계 §3-2).
   */
  function endShoot() {
    if (!isNotifyPrompted() && isNotifySupported()) return setSuggesting(true);
    onClose();
  }

  const today = todayKey();
  /**
   * 오늘 물어볼 제품. **매일 제품은 여기 안 선다** — 구간 안에 대조군이 없어 로그가 관찰에
   * 보태는 것이 없고, 매일 n개 체크는 촬영 루프를 죽인다(§3-5). 비면 칩 블록 자체가 없다.
   */
  const askable = products.filter((p) => p.frequency === 'occasional' && isActive(p, today));

  /**
   * 관찰 스텝의 유일한 출구. **칩 블록이 떠 있었으면 어느 버튼으로 나가든 로그를 남긴다** —
   * 체크 없이 나간 것이 곧 「안 썼다」다(§3-4). 관찰 답은 안 고르면 여전히 안 남는다.
   *
   * ⚠️ 순서가 로그 → 관찰이다. 반대로 두면 관찰 저장이 화면을 닫는 경로에서 로그가 유실될 수 있다.
   */
  function leaveAsking(verdict?: Verdict) {
    if (askable.length > 0) onUsage(today, used);
    if (verdict) onNote(today, verdict);
    endShoot();
  }

  const toggleUsed = (id: string) => setUsed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 제안 스텝의 두 버튼이 공유하는 것: **어느 쪽을 눌러도 「물어봤다」로 남는다**(재요청 규율). */
  function answerSuggestion(accepted: boolean) {
    saveNotifyPrompted();
    // 동의 화면은 토스가 띄운다 — 결과가 오면(거절·오류 포함) 그때 촬영 흐름을 닫는다.
    if (accepted) return requestNotifyAgreement(() => onClose());
    onClose();
  }

  /**
   * 알림 제안. **방금 찍은 직후가 「내일도」가 가장 와닿는 순간이다**(설계 §3-2).
   * 문구는 질문형이고, 거절도 한 번의 탭으로 끝난다 — 그리고 다시는 자동으로 묻지 않는다.
   */
  if (suggesting) {
    return (
      <main style={{ ...ui.pageFull, justifyContent: 'center' }}>
        <h2 style={{ ...ui.h2, fontSize: 20, textAlign: 'center' }}>내일도 이 시간에 알려드릴까요?</h2>
        <p style={{ ...ui.sub, textAlign: 'center' }}>매일 아침 8시에 촬영 알림을 보내드려요.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <button style={ui.primary} onClick={() => answerSuggestion(true)}>
            알림 받기
          </button>
          <button style={ui.ghost} onClick={() => answerSuggestion(false)}>
            괜찮아요
          </button>
        </div>
      </main>
    );
  }

  /**
   * 관찰 1문항. **사진을 방금 찍은 순간이 이 질문에 답할 수 있는 유일한 순간이다**(설계 §1-1).
   * 문구는 질문형이다 — 이 앱은 어디서도 「좋아졌다」를 단정하지 않는다(§6 문구 규율).
   */
  if (asking) {
    return (
      <main style={{ ...ui.pageFull, justifyContent: 'center' }}>
        {/*
          사용 로그 칩(§4-4). **가끔 제품이 오늘 하나도 없으면 이 블록이 통째로 없다** —
          지금 사용자 대부분의 화면은 한 글자도 안 바뀐다. 제출 버튼도 안 늘린다: 아래 관찰
          버튼과 건너뛰기가 이미 「이 화면을 나간다」라서, 안 쓴 날의 탭 수는 **0 증가**다.
        */}
        {askable.length > 0 && (
          <>
            <h2 id={USED_ASK_ID} style={{ ...ui.h2, fontSize: 20, textAlign: 'center' }}>
              어제부터 지금까지 쓴 게 있나요?
            </h2>
            <p style={{ ...ui.sub, textAlign: 'center' }}>쓴 것만 눌러 주세요</p>
            {/*
              ⚠️ 묶음에 **질문을 이름으로 단다**. 칩 하나의 접근성 이름은 제품 이름 한 마디뿐이라
              (체크 상태는 `aria-checked`가 말한다), 묶지 않으면 스크린리더 사용자는 「팩」이
              무엇을 묻는 체크박스인지 들을 방법이 없다 — 질문이 바로 위에 있다는 것은 **눈으로만** 참이다.
            */}
            <div
              role="group"
              aria-labelledby={USED_ASK_ID}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 }}
            >
              {askable.map((p) => {
                const on = used.includes(p.id);
                return (
                  <button
                    key={p.id}
                    // 접근성 이름은 **이름 한 마디**다 — 켜짐·꺼짐은 `aria-checked`가 말한다.
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleUsed(p.id)}
                    // 테두리는 shorthand로 안 쓴다(`ui.ts` 머리말 — 리렌더에서 색이 풀린다).
                    style={{
                      ...ui.chip,
                      padding: '9px 14px',
                      fontSize: 14,
                      ...(on ? { color: '#fff', background: 'var(--blue)', borderColor: 'var(--blue)' } : null),
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '0 0 20px', width: '100%' }} />
          </>
        )}

        <h2 style={{ ...ui.h2, fontSize: 20, textAlign: 'center' }}>오늘 피부, 어때 보였나요?</h2>
        <p style={{ ...ui.sub, textAlign: 'center' }}>답은 이 기기에만 남고, 나중에 무엇이 달랐는지 볼 때 쓰여요.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {VERDICT_OPTIONS.map((o) => (
            <button key={o.verdict} style={ui.secondary} onClick={() => leaveAsking(o.verdict)}>
              {o.label}
            </button>
          ))}
        </div>
        {/*
          건너뛰기 = **관찰을 기록하지 않는다.** 기본값을 대신 채우면 아무 말도 안 한 사람의 답이 섞인다.
          ⚠️ 다만 **칩 상태는 저장된다** — 칩이 눈앞에 있었던 날의 「체크 없음」은 「안 썼다」라는
          사실이고, 그게 안 남으면 팩을 안 한 날의 사진이 대조군 노릇을 못 한다(§3-4).
        */}
        <button style={{ ...ui.ghost, width: '100%', marginTop: 8 }} onClick={() => leaveAsking()}>
          건너뛰기
        </button>
      </main>
    );
  }

  /**
   * 중단 화면. **확인 화면(`shot`)에서는 안 낀다** — 방금 찍은 사진을 밀어내고 안내를 띄우면
   * 그 사진이 그대로 증발한다. 재취득이 도는 동안(`cam`이 다시 `null`)에는 버튼을 안 그린다.
   */
  if (down && !shot) {
    return (
      <Center>
        <p style={{ ...ui.h2, margin: '0 0 6px' }}>{cam ? DOWN_NOTICE : '카메라를 다시 여는 중이에요…'}</p>
        {cam && (
          <>
            {/*
              재취득이 **왜** 실패했는지 아는 경우가 있다(세션 중에 권한이 회수되거나 웹뷰가
              카메라를 아예 못 여는 상태). 그때까지 「다른 앱이 쓰고 있나 봐요」로 뭉개면
              사용자는 고칠 수 있는 일(설정에서 허용)을 영영 모른 채 재시도만 반복한다.
            */}
            <p style={ui.sub}>
              {cam.ok ? '다른 앱이 카메라를 쓰고 있으면 그 앱을 닫고 다시 연결해 주세요.' : cameraNotice(cam.detail)}
            </p>
            <button style={ui.primary} onClick={reconnect}>
              다시 연결
            </button>
          </>
        )}
        {close}
      </Center>
    );
  }

  if (!cam) return <Center>카메라를 켜는 중이에요…{close}</Center>;

  if (!cam.ok) {
    return (
      <Center>
        <p style={{ ...ui.h2, margin: '0 0 6px' }}>{cameraNotice(cam.detail)}</p>
        {/* 원문 병기. 「실패했습니다」로 뭉개면 문의가 와도 무엇이 막혔는지 알 길이 없다. */}
        <p style={{ ...ui.sub, wordBreak: 'break-all' }}>{cam.detail}</p>
        {close}
      </Center>
    );
  }

  /**
   * ⚠️ **저장소가 준비되기 전에는 셔터를 안 연다.** 안 그러면 방금 찍은 사진을 들고 저장을
   * 눌렀는데 **아무 일도 안 일어나는** 순간이 생긴다(DB가 아직 `undefined`라 저장 함수가
   * 조용히 되돌아간다). restfit 실측으로 잡힌 경합이고, 기다리는 편이 그 침묵보다 낫다.
   *
   * 기준 사진도 이때 같이 온다 — 프리뷰가 먼저 뜨고 고스트가 뒤늦게 얹히는 깜빡임도 없어진다.
   */
  if (db === undefined) return <Center>사진을 불러오는 중이에요…{close}</Center>;

  // 찍고 나서 못 넣는 것보다 찍기 전에 아는 것이 낫다(프라이빗 모드·구형 웹뷰).
  if (db === null) {
    return (
      <Center>
        <p style={{ ...ui.h2, margin: '0 0 6px' }}>이 기기에서는 사진을 저장할 수 없어요</p>
        {close}
      </Center>
    );
  }

  /** 셔터가 잠기는 조건은 하나로 모은다 — 카운트다운 중이거나 플래시가 도는 중. */
  const busy = count !== null || flash;

  return (
    <main style={{ ...ui.pageFull, background: '#000', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>오늘 얼굴</span>
        <span style={ui.spacer} />
        <button style={{ ...ui.ghost, color: '#fff' }} onClick={onClose}>
          닫기
        </button>
      </div>

      <div style={frameStyle}>
        {shot ? (
          <img src={shotUrl ?? undefined} alt="방금 찍은 사진" style={fillStyle} />
        ) : (
          <>
            <video ref={video} autoPlay playsInline muted style={{ ...fillStyle, transform: PREVIEW_TRANSFORM }} />
            {/* 격자는 첫 촬영에도 이후에도 항상 그린다 — 수평·중앙 맞추기의 최소 도구다. */}
            <div data-grid style={gridStyle} aria-hidden />
            {ghostUrl && <img src={ghostUrl} alt="기준 사진" style={{ ...fillStyle, opacity: 0.4 }} />}
            {/* 사진이 한 장이라도 생기면 가이드는 안 그린다 — 고스트가 그 일을 더 잘한다. */}
            {!baseline && <FaceGuide />}
            {count !== null && <div style={countStyle}>{count}</div>}
            {/* ⚠️ 최상단이어야 한다. 프리뷰·고스트 아래에 깔리면 화면이 안 밝아진다. */}
            {flash && <div data-flash style={flashStyle} aria-hidden />}
          </>
        )}
      </div>

      {notice && <p style={{ ...ui.sub, color: 'var(--red)', textAlign: 'center', margin: '10px 0 0' }}>{notice}</p>}

      {shot ? (
        <div style={{ ...ui.row, marginTop: 12 }}>
          {/*
            ⚠️ **저장 중에는 같이 잠근다.** 여기만 살아 있으면 저장이 도는 사이에 프리뷰로
            돌아갈 수 있는데, 그 클릭은 이미 날아간 저장을 되돌리지 못한다 — 사용자의 의도가
            조용히 무시되는 창이다. 실패 문구도 여기서 걷는다.
          */}
          <button
            style={{ ...ui.secondary, flex: 1, ...(saving ? ui.disabled : null) }}
            disabled={saving}
            onClick={() => {
              setShot(null);
              setNotice(null);
            }}
          >
            다시 찍기
          </button>
          <button style={{ ...ui.primary, flex: 1, ...(saving ? ui.disabled : null) }} disabled={saving} onClick={save}>
            저장
          </button>
        </div>
      ) : (
        <>
          <p style={{ ...ui.sub, color: '#b0b8c1', textAlign: 'center', margin: '12px 0 0' }}>
            {baseline
              ? '기준 사진에 얼굴을 맞춰 같은 구도로 찍어요.'
              : '이 구도가 기준이 됩니다. 벽·조명·거리를 기억해 두세요.'}
          </p>
          <p style={{ ...ui.sub, color: '#8b95a1', textAlign: 'center', margin: '4px 0 0' }}>
            아침 세안 직후, 같은 자리에서 찍으면 비교가 정확해져요.
          </p>
          {/*
            컨트롤 한 줄(UX 1차 §4). 예전에는 「촬영」·「3초 후 촬영」 두 버튼이 나란히 서서
            **파란 버튼이 둘**이었다 — 어느 쪽이 셔터인지 매번 읽어야 했다. 셔터는 하나로 모으고,
            「3초 뒤에 찍을까」와 「겹쳐 볼까」는 셔터가 아니라 **셔터의 설정**이라 칩으로 내렸다.
          */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            {/* 폰을 기대 세우고 물러서면 버튼에 손이 안 닿는다 — 그때 켜는 스위치다. */}
            <button
              role="switch"
              aria-checked={timerOn}
              aria-label="3초 타이머"
              // ⚠️ 칩은 `busy` 중에도 살아 있다 — 상태를 바꾸는 것은 촬영을 방해하지 않는다.
              onClick={() => setTimerOn(!timerOn)}
              style={chipStyle(timerOn)}
            >
              <Icon name="timer" size={16} />
              {timerOn ? '3초 켜짐' : '3초 꺼짐'}
            </button>
            {/* **화면에서 유일하게 큰 버튼**이다. 카메라 앱의 그 원이라 설명이 필요 없다. */}
            <button
              aria-label="촬영"
              disabled={busy}
              onClick={() => (timerOn ? setCount(3) : setFlash(true))}
              style={shutterStyle}
            >
              <span aria-hidden style={{ flex: 1, borderRadius: 999, background: '#fff' }} />
            </button>
            {/*
              ⚠️ 겹칠 사진이 없으면 **숨기되 자리는 지킨다** — 통째로 빼면 셔터가 가운데를
              잃고 화면이 눌린 것처럼 기운다.
            */}
            <button
              role="switch"
              aria-checked={ghostOn}
              aria-label="겹쳐 보기"
              onClick={() => setGhostOn(!ghostOn)}
              style={{ ...chipStyle(ghostOn), ...(baseline ? null : { visibility: 'hidden' as const }) }}
            >
              <Icon name="layers" size={16} />
              {ghostOn ? '겹치기 켜짐' : '겹치기 꺼짐'}
            </button>
          </div>
        </>
      )}

      {/* 검수·사용자 양쪽에 같은 문장으로 답한다. 사실이다 — 서버는 0대다(설계 §6). */}
      <p style={{ ...ui.sub, color: '#8b95a1', textAlign: 'center', margin: '14px 0 0' }}>{LOCAL_ONLY}</p>

      {/* 캡처용. 화면에는 안 보인다. */}
      <canvas ref={canvas} style={{ display: 'none' }} />
    </main>
  );
}

/**
 * 실패·로딩·관찰 화면. 문구만 다르고 형태는 같다.
 *
 * ⚠️ **고지가 여기 있어야 어느 화면에나 있다**(설계 §6은 화면 안 상시 고지를 요구한다).
 * 정상 프리뷰에만 달면, 심사자가 가장 먼저 눌러 보는 **권한 거부 화면**에는 카메라를 왜 쓰는지
 * 답하는 문장이 없다.
 */
function Center({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ ...ui.pageFull, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      {children}
      <p style={{ ...ui.sub, margin: '16px 0 0' }}>{LOCAL_ONLY}</p>
    </main>
  );
}

/**
 * 얼굴 타원 + 어깨선. **정밀할 필요가 없다** — 「화면 세로 2/3을 얼굴로 채우고 중앙에」를
 * 말하는 그림이면 족하다(설계 §5-1). 사진이 한 장이라도 있으면 고스트가 이 일을 대신한다.
 */
function FaceGuide() {
  return (
    <svg
      role="img"
      aria-label="얼굴 가이드"
      viewBox="0 0 100 150"
      preserveAspectRatio="xMidYMid meet"
      style={{ ...fillStyle, opacity: 0.35 }}
      fill="none"
      stroke="#fff"
      strokeWidth={1.5}
    >
      {/* 세로로 긴 타원 하나가 얼굴이다. 이목구비를 그리면 20px 밖에서 뭉개지기만 한다. */}
      <ellipse cx="50" cy="58" rx="27" ry="36" />
      {/* 어깨선이 없으면 타원이 얼굴인지 머리 전체인지 알 수 없어 거리를 못 맞춘다. */}
      <path d="M18 132c4-16 15-24 32-24s28 8 32 24" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 셔터. 카메라 앱의 흰 테 두른 원을 그대로 쓴다 — 사용자가 이미 아는 형태라 라벨이 없어도
 * 무엇인지 안다(접근성 이름은 `aria-label`이 준다). **이 화면에서 유일하게 큰 버튼**이다.
 *
 * 테두리는 분리 속성으로 쓴다(`ui.ts` 머리말).
 */
const shutterStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  flexShrink: 0,
  display: 'flex',
  width: 76,
  height: 76,
  padding: 4,
  borderRadius: 999,
  borderWidth: 4,
  borderStyle: 'solid',
  borderColor: '#fff',
  background: 'transparent',
};

/**
 * 셔터 양옆의 칩. 켜짐은 파랑 채움 + 「켜짐」 글자 + 아이콘 셋으로 말한다 —
 * 어두운 화면이라 색 하나에 기대면 꺼짐과 잘 안 갈린다.
 */
const chipStyle = (on: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '8px 11px',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  borderRadius: 999,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: on ? 'var(--blue)' : '#3a3f47',
  background: on ? 'var(--blue)' : 'transparent',
  color: on ? '#fff' : '#b0b8c1',
});

/** 프리뷰·고스트·가이드가 정확히 포개지는 자리. 하나라도 어긋나면 정렬 자체가 거짓말이 된다. */
const frameStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  marginTop: 12,
  borderRadius: 14,
  overflow: 'hidden',
  background: '#111',
};

const fillStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

/** 3×3. 선 4개를 그라디언트로 그린다 — 라이브러리도 요소도 안 늘린다. */
const gridStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundImage:
    'linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px),' +
    'linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)',
  backgroundSize: '33.333% 33.333%',
};

/** 순백. 흰 픽셀이 낼 수 있는 최대 광량이 이 기법의 상한이라 회색으로 타협하지 않는다. */
const flashStyle: React.CSSProperties = { position: 'absolute', inset: 0, background: '#fff' };

const countStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontSize: 96,
  fontWeight: 800,
  color: '#fff',
  textShadow: '0 2px 12px rgba(0,0,0,0.6)',
};
