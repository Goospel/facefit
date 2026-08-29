import { describe, expect, it, vi } from 'vitest';

import { JPEG_QUALITY, MAX_SIDE, PREVIEW_TRANSFORM, captureJpeg, fitWithin } from './capture';

/**
 * 촬영 파이프라인에서 **테스트할 수 있는 부분**만 떼어 낸 것이다. 실제 `drawImage`·`toBlob`은
 * jsdom에 없어서(2D 컨텍스트 자체가 없다) 화질 판정은 실기기 몫이지만, **어떤 변환을 어떤
 * 순서로 거는가**는 여기서 잠근다.
 *
 * 가장 비싼 실수가 **미러 불일치**다(설계 §4.3). 전면 프리뷰는 거울상으로 보여주는 것이
 * 자연스러운데 저장본이 정방향이면, 다음날 고스트와 내 몸이 좌우로 어긋나 **영영 안 맞는다** —
 * 그리고 그 사실은 사진이 여러 장 쌓인 뒤에야 드러나서, 그때는 이미 기준 사진이 오염돼 있다.
 */
describe('fitWithin', () => {
  it('긴 변이 상한을 넘으면 비율을 지켜 줄인다 — 가로가 긴 사진', () => {
    expect(fitWithin(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('긴 변이 상한을 넘으면 비율을 지켜 줄인다 — 세로가 긴 사진(전신 촬영의 실제 형태)', () => {
    // 어느 변이 긴지를 안 보고 폭만 기준으로 줄이면 세로 사진이 상한을 훌쩍 넘는다.
    expect(fitWithin(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it('이미 작은 사진은 그대로 둔다 — 늘리면 용량만 커지고 화질은 안 는다', () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 });
  });

  it('정확히 상한이면 손대지 않는다', () => {
    expect(fitWithin(1280, 960, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it('나눠떨어지지 않으면 반올림한다 — 캔버스 크기에 소수는 못 넣는다', () => {
    expect(fitWithin(1000, 333, 500)).toEqual({ width: 500, height: 167 });
  });

  it('기본 상한은 1280이다 — 설계가 정한 장당 100~200KB의 근거', () => {
    expect(MAX_SIDE).toBe(1280);
    expect(fitWithin(2560, 1440)).toEqual({ width: 1280, height: 720 });
  });
});

describe('captureJpeg', () => {
  /** 호출을 순서대로 받아 적는 가짜 캔버스. 실제 2D 컨텍스트는 jsdom에 없다. */
  function fakeCanvas(blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) {
    const calls: string[] = [];
    const setTransform = vi.fn((...a: number[]) => void calls.push(`setTransform(${a.join(',')})`));
    const drawImage = vi.fn((_src: unknown, ...a: number[]) => void calls.push(`drawImage(${a.join(',')})`));
    const toBlob = vi.fn((cb: (b: Blob | null) => void, type?: string, quality?: number) => {
      calls.push(`toBlob(${type},${quality})`);
      cb(blob);
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ setTransform, drawImage }),
      toBlob,
    } as unknown as HTMLCanvasElement;
    return { canvas, calls, setTransform, drawImage, toBlob };
  }

  /** 크기만 아는 가짜 프레임. 실제 `<video>`는 이 두 값 말고는 `drawImage`만 쓴다. */
  const video = (videoWidth: number, videoHeight: number) =>
    ({ videoWidth, videoHeight }) as unknown as HTMLVideoElement;

  it('축소 치수로 캔버스를 맞추고 그 크기를 되돌려준다', async () => {
    const { canvas } = fakeCanvas();

    const got = await captureJpeg(video(1080, 1920), canvas);

    // 되돌려준 치수는 그대로 `savePhoto`의 width/height가 된다 — 비교 화면이 이 값으로 자리를 잡는다.
    expect(got).toMatchObject({ width: 720, height: 1280 });
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 720, h: 1280 });
  });

  it('좌우를 뒤집어 그린다 — 프리뷰가 거울상이라 저장본도 거울상이어야 한다', async () => {
    const { canvas, calls } = fakeCanvas();

    await captureJpeg(video(720, 1280), canvas);

    // `-1`이 좌우 반전이고, 다섯째 인자(width)가 뒤집힌 그림을 캔버스 안으로 되민다.
    // 되밀지 않으면 그림이 캔버스 왼쪽 밖으로 나가 **까만 사진**이 저장된다.
    expect(calls).toEqual(['setTransform(-1,0,0,1,720,0)', 'drawImage(0,0,720,1280)', 'toBlob(image/jpeg,0.8)']);
  });

  it('프리뷰 변환과 캡처 변환이 같은 방향이다 — 갈리면 고스트가 영영 안 맞는다', async () => {
    const { canvas, setTransform } = fakeCanvas();
    await captureJpeg(video(720, 1280), canvas);

    // 한쪽만 고치는 순간 깨지는 것이 이 테스트의 전부다(설계 §4.3의 함정).
    const previewFlipped = PREVIEW_TRANSFORM.replace(/\s/g, '').includes('scaleX(-1)');
    const captureFlipped = setTransform.mock.calls[0][0] === -1;
    expect(captureFlipped).toBe(previewFlipped);
  });

  it('JPEG 0.8로 인코딩한다 — PNG면 장당 수 MB라 쿼터를 30배 빨리 태운다', async () => {
    const { canvas, toBlob } = fakeCanvas();

    await captureJpeg(video(720, 1280), canvas);

    expect(toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', JPEG_QUALITY]);
    expect(JPEG_QUALITY).toBe(0.8);
  });

  it('아직 프레임이 없으면(0×0) 그리지 않고 null이다', async () => {
    // 스트림을 붙인 직후 몇 프레임은 크기가 0이다. 그냥 그리면 **0×0 캔버스**가 저장돼
    // 「저장은 됐는데 빈 사진」이 남는다 — 증발보다 나쁘다(사용자가 눈치를 못 챈다).
    const { canvas, drawImage } = fakeCanvas();

    await expect(captureJpeg(video(0, 0), canvas)).resolves.toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('2D 컨텍스트가 없는 환경이면 null이다 — 던지지 않는다', async () => {
    const canvas = { width: 0, height: 0, getContext: () => null, toBlob: vi.fn() } as unknown as HTMLCanvasElement;

    await expect(captureJpeg(video(720, 1280), canvas)).resolves.toBeNull();
  });

  it('인코딩이 실패하면 null이다 — 화면이 "저장하지 못했어요"로 빠지는 근거', async () => {
    const { canvas } = fakeCanvas(null);

    await expect(captureJpeg(video(720, 1280), canvas)).resolves.toBeNull();
  });
});
