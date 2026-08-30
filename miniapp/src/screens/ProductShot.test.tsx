// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureJpeg } from '../logic/capture';
import { ProductShot } from './ProductShot';

/**
 * 제품 촬영(임시 확인용) 화면.
 *
 * 화면 자체는 곧 걷거나 등록 폼 안으로 옮길 것이라 잔가지는 안 잰다. **이 화면이 존재하는
 * 이유 두 가지만** 잠근다:
 *
 * 1. **후면 카메라로 연다** — 전면으로 열리면 라벨이 안 보인다.
 * 2. **반전을 안 건다** — 얼굴 촬영의 기본값이 새어 들어오면 라벨이 **거울 글자**로 저장돼
 *    OS 텍스트 인식이 통째로 못 읽는다. 그러면 실기기까지 다녀와서야 헛걸음을 안다.
 *
 * 덤으로 「닫으면 카메라가 꺼진다」 — 미니앱에서 카메라가 켜진 채 남으면 다음 진입이 막힌다.
 */
vi.mock('../logic/capture', async (orig) => ({
  ...(await orig<typeof import('../logic/capture')>()),
  captureJpeg: vi.fn(),
}));

afterEach(cleanup);

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop, readyState: 'live', muted: false }] } as unknown as MediaStream, stop };
}

let seen: MediaStreamConstraints[];
let stopped: ReturnType<typeof vi.fn>;

function setup() {
  const { stream, stop } = fakeStream();
  seen = [];
  stopped = stop;
  const media = {
    getUserMedia: async (c: MediaStreamConstraints) => {
      seen.push(c);
      return stream;
    },
  };
  return render(<ProductShot onClose={vi.fn()} media={media} />);
}

beforeEach(() => {
  vi.mocked(captureJpeg).mockResolvedValue({ blob: new Blob(['jpeg']), width: 720, height: 1280 });
  URL.createObjectURL = vi.fn(() => 'blob:shot');
  URL.revokeObjectURL = vi.fn();
});

describe('제품 촬영 화면', () => {
  it('후면 카메라를 연다 — 전면으로 열리면 라벨이 안 보인다', async () => {
    setup();
    await screen.findByRole('button', { name: '촬영' });

    expect(seen).toEqual([{ video: { facingMode: 'environment' } }]);
  });

  it('반전 없이 찍는다 — 거울 글자는 OS 텍스트 인식이 못 읽는다', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '촬영' }));

    expect(vi.mocked(captureJpeg).mock.calls[0][2]).toEqual({ mirror: false });
    // 찍은 사진이 화면에 서야 사용자가 그걸 꾸욱 누를 수 있다 — 이 화면의 관측 대상 자체다.
    expect(await screen.findByAltText('방금 찍은 제품 사진')).toBeTruthy();
  });

  it('닫으면 카메라가 꺼진다 — 켜진 채 남으면 다음 진입이 막힌다', async () => {
    const { unmount } = setup();
    await screen.findByRole('button', { name: '촬영' });

    unmount();

    expect(stopped).toHaveBeenCalled();
  });
});
