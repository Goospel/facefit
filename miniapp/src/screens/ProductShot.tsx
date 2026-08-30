import { useEffect, useRef, useState } from 'react';

import { probeCamera, stopStream, type CameraProbeResult, type MediaDevicesLike } from '../camera';
import { captureJpeg, type Captured } from '../logic/capture';
import { ui } from '../ui';
import { useObjectUrl } from './usePhotos';

/**
 * 제품 라벨 촬영 — **지금은 임시 확인용 화면이다.**
 *
 * 재려는 것 하나: **토스 웹뷰의 `<img>`에서 OS 텍스트 인식(iOS 라이브 텍스트 등)이 열리는가.**
 * 열리면 사용자가 긴 제품명을 한 글자도 안 치고 뽑아 검색창에 넣을 수 있고, 안 열리면
 * 그 계단은 서버 1대(클라우드 OCR) 없이는 성립하지 않는다.
 *
 * ⚠️ **반전을 끈다**(`mirror: false`). 얼굴 촬영은 전면 프리뷰와 짝을 맞추려고 좌우를 뒤집는데,
 * 그대로 두면 라벨이 **거울 글자**로 저장돼 어떤 텍스트 인식도 못 읽는다 — 이 화면이 존재하는
 * 이유가 통째로 사라진다. 후면 카메라라 프리뷰에도 변환을 안 건다.
 *
 * ⚠️ **저장하지 않는다.** 사진은 화면을 닫는 순간 사라진다 — 확인이 끝나면 이 화면째 걷어내거나
 * 제품 등록 폼 안으로 옮길 것이라, 지금 IndexedDB에 자리를 만들면 그게 그대로 잔재가 된다.
 */

/** 사람이 권한 프롬프트를 읽고 누를 시간은 주되, 웹뷰가 프롬프트를 삼켰을 때 화면이 굳지는 않게. */
const OPEN_TIMEOUT_MS = 10000;

/** 촬영 화면과 같은 감별을 같은 문구로 옮긴다 — 갈라 두면 한쪽만 고쳐진다. */
function cameraNotice(detail: string): string {
  if (detail === 'unsupported') return '이 환경에서는 카메라를 쓸 수 없어요';
  if (detail.startsWith('NotAllowedError')) return '카메라 권한이 꺼져 있어요. 토스 앱 설정에서 허용해 주세요';
  return '카메라를 여는 데 실패했어요. 잠시 후 다시 시도해 주세요';
}

export function ProductShot({
  onClose,
  media = navigator.mediaDevices,
}: {
  onClose: () => void;
  /** 테스트가 가짜 카메라를 넣는 자리. 실사용에서는 `navigator.mediaDevices`다. */
  media?: MediaDevicesLike;
}) {
  /** `null`은 「아직 여는 중」이다 — 실패와 구별돼야 「켜는 중」과 안내가 갈린다. */
  const [cam, setCam] = useState<CameraProbeResult | null>(null);
  const [shot, setShot] = useState<Captured | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const shotUrl = useObjectUrl(shot?.blob);

  /** 스트림 수명을 이 effect에 가둔다 — 화면을 닫으면 반드시 꺼진다(늦게 도착한 것까지). */
  useEffect(() => {
    let dead = false;
    let live: MediaStream | null = null;
    void probeCamera(media, { timeoutMs: OPEN_TIMEOUT_MS, facing: 'environment' }).then((r) => {
      if (dead) return void (r.ok && stopStream(r.stream));
      if (r.ok) live = r.stream;
      setCam(r);
    });
    return () => {
      dead = true;
      if (live) stopStream(live);
    };
  }, [media]);

  /** ⚠️ `shot`이 deps에 있어야 한다 — 「다시 찍기」에서 `<video>`가 **새 노드로** 돌아온다. */
  useEffect(() => {
    if (cam?.ok && video.current) video.current.srcObject = cam.stream;
  }, [cam, shot]);

  async function take() {
    if (!video.current || !canvas.current) return;
    const got = await captureJpeg(video.current, canvas.current, { mirror: false });
    if (!got) return setNotice('사진을 찍지 못했어요. 다시 시도해 주세요');
    setNotice(null);
    setShot(got);
  }

  const close = (
    <button style={{ ...ui.ghost, color: '#fff' }} onClick={onClose}>
      닫기
    </button>
  );

  return (
    <main style={{ ...ui.pageFull, background: '#000', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>제품 촬영 (테스트)</span>
        <span style={ui.spacer} />
        {close}
      </div>

      <div style={frameStyle}>
        {shot ? (
          <img src={shotUrl ?? undefined} alt="방금 찍은 제품 사진" style={fillStyle} />
        ) : cam && !cam.ok ? (
          <p style={{ ...ui.sub, color: '#b0b8c1', textAlign: 'center', padding: 20 }}>{cameraNotice(cam.detail)}</p>
        ) : (
          // 후면이라 **변환을 안 건다** — 거울 글자로 저장되면 텍스트 인식이 못 읽는다.
          <video ref={video} autoPlay playsInline muted style={fillStyle} />
        )}
      </div>

      {notice && <p style={{ ...ui.sub, color: 'var(--red)', textAlign: 'center', margin: '10px 0 0' }}>{notice}</p>}

      {shot ? (
        <>
          <p style={{ ...ui.sub, color: '#fff', textAlign: 'center', margin: '12px 0 0' }}>
            사진 속 제품 이름을 <b>꾸욱</b> 눌러 보세요.
          </p>
          <p style={{ ...ui.sub, color: '#8b95a1', textAlign: 'center', margin: '4px 0 0' }}>
            글자가 선택되고 「복사」가 뜨면 성공이에요.
          </p>
          <div style={{ ...ui.row, marginTop: 12 }}>
            <button style={{ ...ui.secondary, flex: 1 }} onClick={() => setShot(null)}>
              다시 찍기
            </button>
            <button style={{ ...ui.primary, flex: 1 }} onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ ...ui.sub, color: '#b0b8c1', textAlign: 'center', margin: '12px 0 0' }}>
            제품 이름이 크고 또렷하게 보이도록 가까이서 찍어요.
          </p>
          <button
            style={{ ...ui.primary, marginTop: 12, ...(cam?.ok ? null : ui.disabled) }}
            disabled={!cam?.ok}
            onClick={take}
          >
            촬영
          </button>
        </>
      )}

      <p style={{ ...ui.sub, color: '#6b7684', textAlign: 'center', margin: '10px 0 0' }}>
        확인용 화면이라 사진은 저장되지 않아요.
      </p>

      <canvas ref={canvas} style={{ display: 'none' }} />
    </main>
  );
}

/** 프리뷰와 촬영본이 **같은 자리·같은 크기**여야 「다시 찍기」에서 화면이 안 튄다. */
const frameStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  marginTop: 12,
  borderRadius: 14,
  overflow: 'hidden',
  background: '#111',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const fillStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
