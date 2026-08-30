/** `navigator.mediaDevices`의 필요한 만큼만. 테스트가 가짜를 주입할 수 있어야 해서 좁게 받는다. */
export type MediaDevicesLike = { getUserMedia(c: MediaStreamConstraints): Promise<MediaStream> } | undefined;

export type CameraProbeResult =
  | { ok: true; stream: MediaStream }
  /** `unsupported`(API 없음) · `timeout`(무응답) · 그 외는 `에러이름: 메시지` 원문 */
  | { ok: false; detail: string };

/**
 * 눈바디는 매일 **같은 구도**로 찍는 것이 전부라 전면 고정이다. 후면으로 돌리면 화면이 안 보여
 * 고스트 정렬이 성립하지 않는다 — 전/후면 토글은 v2로 미룬 것이 아니라 이 UX에서 **성립하지 않는다**.
 */
const CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: 'user' } };

/** 트랙을 끄지 않으면 카메라가 켜진 채로 남는다. 화면과 프로브가 같은 함수를 쓴다. */
export function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}

/**
 * 카메라를 열어 라이브 스트림을 받아 온다. **눈바디 촬영 화면이 프리뷰를 붙이는 유일한 입구다.**
 *
 * 원래는 「이 웹뷰에서 프리뷰가 되는가」를 판정하는 임시 프로브였고(PR #49에서 **성공**으로
 * 판정됐다), 로직이 그대로 본 기능의 진입 경로가 됐다 — 이름만 `camera.ts`로 옮겼다.
 *
 * `adProbe`와 같은 문제의식이다 — 한 번만 끝난다 · 어떤 경로로 끝나든 정리한다 · 무응답이면
 * 타임아웃으로 끝난다. 특히 **토스 웹뷰가 권한 프롬프트를 삼켜 영영 pending인** 실패 모드가
 * 실제로 있어서, 타임아웃이 없으면 화면이 「카메라 켜는 중」에서 굳는다.
 */
export function probeCamera(md: MediaDevicesLike, opts: { timeoutMs: number }): Promise<CameraProbeResult> {
  // 권한 문제가 아니라 API 자체가 없는 경우다. 여기가 첫 번째 감별 대상이라 따로 이름을 준다.
  if (!md) return Promise.resolve({ ok: false, detail: 'unsupported' });

  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish({ ok: false, detail: 'timeout' }), opts.timeoutMs);

    function finish(result: CameraProbeResult) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    }

    md.getUserMedia(CONSTRAINTS).then(
      (stream) => {
        // 타임아웃으로 이미 끝났다면 이 스트림을 화면에 붙일 사람이 없다 —
        // 그냥 두면 **판정이 끝난 뒤에도 카메라가 켜진 채**로 남는다.
        if (done) return stopStream(stream);
        finish({ ok: true, stream });
      },
      (err: { name?: string; message?: string }) => finish({ ok: false, detail: `${err.name}: ${err.message}` }),
    );
  });
}
