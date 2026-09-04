import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Icon } from '../components/Icon';
import { getBackupKey, isBackupSupported } from '../logic/backup';
import { cancelOilReminder, formatHm, oilState, scheduleOilReminder, type OilState } from '../logic/reminder';
import { isNotifySupported, OIL_TEMPLATE_CODE, requestNotifyAgreement, type NotifyResult } from '../notify';
import { loadOilNextAt, saveOilNextAt } from '../storage';
import { ui } from '../ui';

/**
 * 기름종이 알림 카드(v5 설계 §3-5). 오늘 탭의 「아침 알림」 행 바로 아래 — 같은 카드 가족이다.
 *
 * **승인 게이트 하나가 이 기능의 전부다**: 체크 1회 = 알림 1회. 알림이 온 뒤 여기서 다시
 * 누르지 않으면 다음은 없고, 날짜가 바뀌면 저절로 처음으로 돌아간다. 야간 상한을 안 두는
 * 근거가 이 게이트다(설계 §3-3) — 밤에 울릴지는 사용자가 체크할 때 스스로 정한다.
 *
 * ⚠️⚠️ **탭 한 번은 한 가지 일만 한다**(사용자 지적 2026-09-04). 원래 알약 하나가
 * 「썼어요 · 다음 알림」이라 **한 번의 탭이 둘을 겸했다** — 기름종이를 썼다고 표시하는 것과
 * 알림을 받겠다는 것. 그래서 ⓐ 사용을 알리려던 사람에게 **동의 시트부터** 들이밀었고
 * ⓑ 눌러도 무슨 일이 일어났는지가 흐렸다. 이제 둘로 나눈다:
 *
 * 1. **「썼어요」** — 화면만 다음 칸으로 옮긴다. **서버도 동의 시트도 안 건드린다.**
 * 2. **「알림 받기」** — 여기서 처음 동의를 묻고, 통과하면 서버에 예약한다.
 *
 * 어느 칸에서 시작하든(미예약·예약 중·알림 뒤) **같은 두 걸음**을 걷는다 — 규칙이 하나라야
 * 외울 것이 없다.
 *
 * ⚠️ **어느 상태에서도 primary(채운 파랑)를 쓰지 않는다.** 오늘 탭의 파란 자리는 「오늘 얼굴
 * 찍기」이고 찍은 뒤엔 0개다(UX 2차 §1). 기름종이 체크는 하루에 여러 번 반복되는 부수 행동이라,
 * 그때마다 파란 버튼이 생기면 「지금 할 일」의 신호가 흐려진다. 행동은 알림 행과 같은 **알약**,
 * 상태는 **check + 글자**로 가른다.
 */

/**
 * 화면의 칸. 저장된 시각이 가르는 셋({@link OilState})에 **세션 한정 `asking`**을 얹는다.
 *
 * ⚠️ `asking`을 저장하지 않는 이유: 「방금 썼다」는 **그 순간의 맥락**이라, 앱을 껐다 켜서까지
 * 질문이 남아 있으면 언제 무엇에 답하는지 모르게 된다. 앱을 다시 열면 1단계부터가 맞다.
 */
type Step = OilState | 'asking';

/** 오른쪽에 설 말. `scheduled`만 행동이 아니라 **사실**이라 알약을 안 쓴다. */
const RIGHT: Record<Step, string> = {
  idle: '썼어요',
  asking: '알림 받기',
  scheduled: '예약됨',
  awaiting: '썼어요',
};

/**
 * 행동 버튼의 접근성 이름. **한 마디로 고정한다** — 본문을 이어 붙이면 스크린리더가 설명까지
 * 버튼 이름으로 읽는다(알림 행과 같은 규율).
 *
 * ⚠️ 넷이 **서로 다른 말**이라야 한다. 「처음 켠다」·「또 썼다」·「알림을 받겠다」는 사용자가
 * 하는 일이 다르고, 같은 이름을 돌려쓰면 스크린리더만 쓰는 사람에게 지금이 어느 칸인지가 안 보인다.
 * `idle`과 `awaiting`만 같은 이름인 것은 **하는 일이 실제로 같아서다**(썼다고 알리기).
 *
 * ⚠️ `role="switch"`는 **안 쓴다**(설계 §3-5) — 켜짐의 반대가 「꺼짐」이 아니라 「오늘은 없음」이라
 * 스위치 은유가 틀리다. 「꺼짐」이라 읽히면 내일도 안 온다는 뜻이 되는데, 실제로는 하루짜리 상태다.
 */
const ACTION_LABEL: Record<Step, string> = {
  idle: '기름종이 썼어요',
  asking: '3시간 뒤 알림 받기',
  scheduled: '기름종이 또 썼어요',
  awaiting: '기름종이 썼어요',
};

/**
 * 그만두는 줄. 셋이 **다른 일을 한다** — `asking`은 질문에서 물러날 뿐이라 서버를 안 건드리고,
 * 나머지 둘은 예약을 지운다(남은 것이 다르니 말도 다르다).
 */
const STOP_LABEL: Partial<Record<Step, string>> = { asking: '괜찮아요', scheduled: '그만 받기', awaiting: '오늘은 그만' };

const TONE_COLOR = { on: 'var(--blue-dark)', off: 'var(--text-sub)', warn: 'var(--amber)' } as const;

/** 알약·표식은 알림 행과 **한 벌**을 쓴다(`ui.pill`·`ui.doneMark`) — 같은 카드 가족이다. */

/** 카드 안에서 행 노릇만 한다 — 배경·테두리는 감싼 카드가 이미 그렸다. */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: 0,
  textAlign: 'left',
  background: 'none',
  border: 0,
  color: 'inherit',
};

export function OilReminder() {
  /**
   * 상태의 단일 출처(설계 §3-2). **서버를 조회하지 않는다** — 서버는 「보낼 행」만 갖고 보내면
   * 지우므로, 물어봐야 알 수 있는 것이 없다.
   */
  const [nextAt, setNextAt] = useState(loadOilNextAt);
  /** 2단계에 서 있는가. 세션 한정인 이유는 {@link Step} 주석에 있다. */
  const [asking, setAsking] = useState(false);
  /**
   * 방금 누른 결과. **이 세션 안에서만 산다**(알림 행과 같은 절단) — 거절도 실패도 다음에
   * 다시 누르면 되는 일이라, 저장해 두면 지난 실패가 오늘의 사실인 척한다.
   */
  const [session, setSession] = useState<'rejected' | 'failed' | null>(null);
  /**
   * 진행 중인 「알림 받기」가 있는가.
   *
   * ⚠️ 동의 시트가 뜨는 동안에도 아래 버튼은 살아 있다 — 연타하면 **동의 시트가 두 번 뜨고
   * 예약이 두 번 나간다**(서버는 키당 1행이라 덮어써 마지막 것만 남지만, 사용자는 시트를
   * 두 번 닫아야 하고 레이트리밋도 그만큼 먹는다). `state`가 아니라 `ref`인 것은 이 값이
   * 화면에 그릴 것이 없어서다 — state로 두면 의미 없는 리렌더만 는다.
   */
  const pending = useRef(false);
  /**
   * **시각을 다시 보게 만드는 계기다 — 값이 아니다.** 상태는 그리는 순간의 `new Date()`로
   * 정해지므로, 이 값이 바뀌었다는 사실만으로 충분하다(값으로 들면 다른 이유로 리렌더될 때
   * 그 값만 낡아, 오히려 지금 아닌 시각으로 상태를 판정한다).
   */
  const [, recheck] = useState(0);
  /** 예약이 **방금** 확정된 횟수. 값 자체는 안 쓰고 「또 한 번 됐다」는 신호로만 읽는다. */
  const [justSet, setJustSet] = useState(0);
  const markRef = useRef<HTMLSpanElement>(null);

  /**
   * ⚠️⚠️ **시간이 흐르는 것은 리렌더를 일으키지 않는다**(T-021 · 2026-09-04 실기기 보고).
   * 이 배선이 없으면 알림이 실제로 도착해도 카드는 마운트 당시의 「예약됨」에 **고착**하고,
   * 그 상태에서는 다음 알림을 켤 방법이 사라진다.
   *
   * 계기가 **둘**인 이유: 타이머는 앱을 열어 둔 채 시각을 넘길 때를, 복귀 감지는 백그라운드에서
   * 타이머가 스로틀될 때를 잡는다 — 어느 하나로는 구멍이 남는다(둘 다 그저 「다시 세라」는
   * 신호라 두 번 울려도 해가 없다).
   *
   * 1초를 더해 재는 것은 경계에서 되레 `scheduled`로 읽혀 한 번 더 기다리는 일을 막는다.
   */
  useEffect(() => {
    const wake = () => recheck((n) => n + 1);
    document.addEventListener('visibilitychange', wake);
    const left = nextAt ? new Date(nextAt).getTime() - Date.now() : NaN;
    // NaN(미예약·손상값)이면 비교가 거짓이라 타이머를 안 건다 — 기다릴 시각이 없다.
    const timer = left > 0 ? setTimeout(wake, left + 1000) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', wake);
      clearTimeout(timer);
    };
  }, [nextAt]);

  /**
   * 「방금 예약됐다」는 신호(사용자 지적 2026-09-04 — 이 카드 개편의 출발점).
   *
   * 알약이 체크 표식으로 바뀌는 것만으로는 **눈을 떼고 있던 사람이 놓친다.** 확정된 그 순간에만
   * 짧게 한 번 움직인다 — 상시 애니메이션이 아니라 1회성 신호라, 다음에 같은 자리를 봐도 조용하다.
   *
   * ⚠️ CSS 애니메이션이 아니라 Web Animations API인 것은 **이 앱이 `className`을 안 쓰기 때문이다**
   * (스타일은 전부 인라인). `@keyframes`는 인라인으로 못 적는다.
   * ⚠️ `?.`가 둘 다 장식이 아니다 — `animate`가 없는 환경(구형 웹뷰·jsdom)에서 여기서 던지면
   * **예약은 됐는데 카드가 죽는다.** 움직임은 있으면 좋은 것이지 기능이 아니다.
   */
  useEffect(() => {
    if (!justSet) return;
    // 접근성 기본 — 줄이라고 설정한 사람에게는 안 준다(문구·표식은 그대로 바뀐다).
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    markRef.current?.animate?.(
      [
        { transform: 'scale(0.82)', opacity: 0 },
        { transform: 'scale(1.06)', opacity: 1, offset: 0.6 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 280, easing: 'ease-out' },
    );
  }, [justSet]);

  /**
   * ⚠️ 숨기는 조건은 **동의 여부가 아니라 지원 여부**다(기존 규율). 둘 다 필요하다 —
   * 시트를 못 열면 동의를 받을 수 없고, 익명 키를 못 얻으면 서버에 예약할 수 없다.
   * 어느 쪽이든 눌러도 아무 일 없는 카드가 되므로 아예 안 그린다.
   */
  if (!isNotifySupported() || !isBackupSupported()) return null;

  const state = oilState(nextAt, new Date());
  const step: Step = asking ? 'asking' : state;

  async function schedule() {
    const key = await getBackupKey();
    const res = key ? await scheduleOilReminder(key) : null;
    /*
      ⚠️ **서버가 확인해 줘야 저장한다**(설계 §3-2). 예약이 안 됐는데 「18:20에 알려드릴게요」라
      그리면 사용자는 오지 않을 알림을 기다린다 — 백업의 `dirty` 규율과 같은 결이다.

      실패해도 **2단계에 그대로 선다** — 다시 누르는 것이 곧 재시도라, 1단계로 되돌리면
      같은 일을 두 번 눌러야 한다.
    */
    if (!res) return setSession('failed');

    saveOilNextAt(res.dueAt);
    setNextAt(res.dueAt);
    setAsking(false);
    setSession(null);
    setJustSet((n) => n + 1);
  }

  /**
   * 2단계의 결말. **매번 동의를 거친다**(멱등 — `alreadyAgreed`면 시트 없이 즉시 통과).
   * 앱은 동의 사본을 안 둔다 — 단일 출처는 토스이고, 사본을 두면 철회한 순간 거짓말이 된다.
   */
  async function settle(result: NotifyResult) {
    // 거절이면 서버를 아예 안 부른다 — 안 켠 사람의 시각을 서버에 올릴 이유가 없다.
    if (result === 'agreementRejected') return setSession('rejected');
    // 못 물어본 것과 서버 실패는 사용자가 할 일이 같다(다시 누르기) — 같은 말을 한다.
    if (result === 'unavailable') return setSession('failed');
    await schedule();
  }

  function tap() {
    /*
      1단계. **여기서는 아무것도 나가지 않는다** — 화면만 2단계로 옮긴다. 지난 실패·거절 문구를
      같이 지우는 것은, 새로 묻는 자리에 지난 대답이 붙어 있으면 무엇에 답하는지 흐려져서다.
    */
    if (step !== 'asking') {
      setSession(null);
      return setAsking(true);
    }

    // 2단계. 시트가 떠 있는 동안의 연타는 무시한다 — 시트가 두 번 뜨고 예약이 두 번 나간다.
    if (pending.current) return;
    pending.current = true;
    requestNotifyAgreement((result) => {
      void settle(result).finally(() => {
        pending.current = false;
      });
    }, OIL_TEMPLATE_CODE);
  }

  /** 2단계에서 물러난다. **아무것도 남기지 않는다** — 질문에 아니라고 답한 결과가 곧 그것이다. */
  function skip() {
    setAsking(false);
    setSession(null);
  }

  /**
   * 「그만 받기」·「오늘은 그만」. **로컬을 먼저 지우고 서버 결과는 안 기다린다**(무음 폴백) —
   * 실패해도 남은 행은 예약대로 1회 가고 끝이지만, 눌렀는데 화면이 「예약됨」이면
   * 사용자에게는 빠져나갈 길이 없다.
   */
  function stop() {
    saveOilNextAt('');
    setNextAt(null);
    setAsking(false);
    setSession(null);
    void getBackupKey().then((key) => {
      if (key) void cancelOilReminder(key);
    });
  }

  const [sub, tone] =
    session === 'rejected'
      ? (['알림을 켜지 않았어요 · 눌러서 언제든 켤 수 있어요', 'off'] as const)
      : session === 'failed'
        ? (['지금은 예약할 수 없어요 · 잠시 뒤 다시 눌러 주세요', 'warn'] as const)
        : step === 'asking'
          ? (['3시간 뒤에 알려드릴까요?', 'on'] as const)
          : step === 'scheduled'
            ? ([`${formatHm(nextAt!)}에 알려드릴게요`, 'on'] as const)
            : step === 'awaiting'
              ? (['알림을 보냈어요 · 또 썼으면 눌러 주세요', 'on'] as const)
              : (['쓰고 나서 눌러 주세요', 'off'] as const);

  return (
    <div style={{ ...ui.card, marginTop: 8 }}>
      {/*
        ⚠️ **어느 칸에서도 누를 수 있다.** 예약된 동안에는 눌러도 소용없게 두었었는데 — 오른쪽이
        사실이지 행동이 아니라는 이유였다 — 기름종이는 하루에 여러 번 쓰는 물건이라 3시간을 다
        기다리지 않고 또 쓰는 것이 정상이다. 서버는 원래 키당 한 줄을 **덮어쓴다**
        (`ReminderRepository.upsert`) — 막고 있던 것은 화면뿐이었다.
      */}
      <button aria-label={ACTION_LABEL[step]} style={rowStyle} onClick={tap}>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>기름종이 알림</span>
          {/* `textWrap: 'balance'`는 알림 행과 **같은 이유·같은 값**이다(Home의 `notify-sub` 주석이 단일 출처). */}
          <span
            data-testid="oil-sub"
            style={{ display: 'block', fontSize: 13, marginTop: 2, fontWeight: tone === 'off' ? 400 : 600, color: TONE_COLOR[tone], textWrap: 'balance' }}
          >
            {sub}
          </span>
        </span>
        {/* 장식이라 `aria-hidden` — 이름은 버튼의 `aria-label`이다(알림 행과 같은 규율). */}
        <span
          aria-hidden
          ref={markRef}
          data-testid="oil-right"
          style={step === 'scheduled' ? ui.doneMark : ui.pill}
        >
          {step === 'scheduled' && <Icon name="check" size={16} />}
          {RIGHT[step]}
        </span>
      </button>

      {STOP_LABEL[step] && (
        <button
          aria-label={step === 'asking' ? '알림 없이 넘어가기' : '기름종이 알림 그만 받기'}
          style={{ ...ui.ghost, marginTop: 4, marginLeft: -12 }}
          onClick={step === 'asking' ? skip : stop}
        >
          {STOP_LABEL[step]}
        </button>
      )}

      {/*
        상시 고지(설계 §3-6 · T-014 교훈). 서버에 **새 종류의 데이터**가 놓이는 기능이라,
        콘솔 상세 설명과 같은 말을 앱 안에서도 한다 — 켜기 전에 무엇이 올라가는지 알고 눌러야 한다.
        상태와 무관하게 늘 보인다: 예약에 성공해야 고지를 보여주는 건 앞뒤가 안 맞는다.
      */}
      <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '8px 0 0' }}>
        알림 시각만 서버에 잠시 저장되고 알림이 가면 지워져요
      </p>
    </div>
  );
}
