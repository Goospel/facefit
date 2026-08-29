/**
 * 촬영 파이프라인 중 **화면 없이 잴 수 있는 부분**. 비디오 한 프레임을 JPEG Blob으로 굳힌다.
 *
 * 화면(`BodyPhoto.tsx`)에서 떼어 낸 이유는 재사용이 아니라 **검증 가능성**이다 — 실제
 * `drawImage`/`toBlob`은 jsdom에 없어 화질은 실기기에서만 재지만, 어떤 변환을 어떤 순서로
 * 거는가는 여기서 가짜 캔버스로 잠글 수 있다.
 */

/**
 * 저장본 긴 변 상한. 폰 화면 비교(반쪽 폭 ~180px)에는 넘치도록 충분하고, 원본 해상도(4K급)를
 * 그대로 담으면 장당 수 MB로 쿼터를 30배 빨리 태운다(설계 §5.3).
 */
export const MAX_SIDE = 1280;

/** JPEG 품질. 0.8이면 장당 대략 100~200KB다. */
export const JPEG_QUALITY = 0.8;

/**
 * 프리뷰 `<video>`에 거는 CSS 변환. **전면 카메라는 거울처럼 보여야** 사람이 자기 몸을 맞춘다.
 *
 * ⚠️ **캡처가 같은 방향으로 뒤집는다**(`captureJpeg`). 한쪽만 고치면 프리뷰는 거울상인데
 * 저장본은 정방향이 되어, 다음 촬영에서 고스트와 몸이 좌우로 **영영 안 맞는다**(설계 §4.3).
 */
export const PREVIEW_TRANSFORM = 'scaleX(-1)';

export type Captured = { blob: Blob; width: number; height: number };

/**
 * 비율을 지켜 **긴 변**을 `max`에 맞춘다. 이미 작으면 그대로 둔다 — 늘려 봐야 용량만 커지고
 * 없던 화질이 생기지는 않는다.
 */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  // 어느 변이 긴지를 안 보고 폭만 줄이면 세로로 긴 전신 사진이 상한을 훌쩍 넘는다.
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * 지금 프레임을 JPEG로 굳힌다. **`null`은 「이 프레임으로는 사진을 못 만든다」**이고,
 * 화면이 그걸 받아 안내로 빠진다 — 던지지 않는다.
 *
 * 인자를 실제 DOM 타입으로 받는 대신 구조적 최소 형태로 좁히지 않았다 — `drawImage`의
 * 오버로드 때문에 그 좁힌 타입이 실제 컨텍스트와 안 맞아, 캐스트가 **구현 쪽**으로 새어
 * 들어온다. 캐스트는 테스트의 가짜가 지는 편이 낫다.
 */
export function captureJpeg(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Captured | null> {
  // 스트림을 붙인 직후 몇 프레임은 크기가 0이다. 그대로 그리면 **빈 사진**이 저장되는데,
  // 저장은 성공으로 보고되므로 사용자는 한참 뒤에야 안다 — 증발보다 나쁘다.
  if (!video.videoWidth || !video.videoHeight) return Promise.resolve(null);

  const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  // 좌우 반전 — 프리뷰(`PREVIEW_TRANSFORM`)와 **같은 방향**이어야 한다.
  // 다섯째 인자 `width`가 뒤집힌 그림을 캔버스 안으로 되민다(빼면 캔버스 밖으로 나가 까만 사진이 된다).
  ctx.setTransform(-1, 0, 0, 1, width, 0);
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? { blob, width, height } : null), 'image/jpeg', JPEG_QUALITY);
  });
}
