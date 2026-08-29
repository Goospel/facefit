// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { listPhotos } from './photoStore';
import { loadProducts, loadNotes } from './storage';

/**
 * 배선. 라우터도 컨텍스트도 없다 — 값 하나(`tab`)와 값 하나(`view`)가 「지금 무슨 화면인가」를
 * 다 말한다(설계 §1-4·§5-6).
 *
 * 여기서 잠그는 것: **온보딩이 가장 앞이다**(권한 고지를 못 본 채로 카메라를 여는 경로가
 * 없어야 한다) · **전체화면에서는 탭바가 사라진다**(카메라를 켜 놓고 딴 화면으로 샐 이유가
 * 없다) · **제품·관찰이 저장소까지 간다**(화면 state만 바뀌면 앱을 껐다 켤 때 사라진다).
 *
 * ⚠️ 카메라·저장소는 목이다 — 실물은 각 화면 테스트가 잰다.
 */
vi.mock('./photoStore', async (orig) => ({
  ...(await orig<typeof import('./photoStore')>()),
  openPhotoDb: vi.fn(async () => ({ close: () => {} }) as unknown as import('./photoStore').PhotoDb),
  listPhotos: vi.fn(),
}));

afterEach(cleanup);

const tab = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listPhotos).mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  // jsdom에는 카메라가 없다. 촬영 화면은 「쓸 수 없어요」로 뜨는데, 배선을 재기엔 그걸로 족하다.
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('온보딩이 가장 앞이다', () => {
  it('처음 열면 온보딩이다 — 탭바도 아직 없다', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: '시작하기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기록' })).toBeNull();
  });

  it('시작하면 오늘 탭으로 들어간다', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    expect(screen.queryByRole('button', { name: '시작하기' })).toBeNull();
    expect(tab('기록')).toBeTruthy();
  });

  it('다시 열면 안 뜬다 — 저장소까지 갔다는 뜻이다', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    unmount();

    render(<App />);

    expect(screen.queryByRole('button', { name: '시작하기' })).toBeNull();
  });
});

describe('탭 이동', () => {
  function start() {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
  }

  it('제품 탭으로 간다', () => {
    start();
    fireEvent.click(tab('제품'));
    expect(screen.getByRole('button', { name: '제품 추가' })).toBeTruthy();
  });

  it('기록 탭으로 간다', () => {
    start();
    fireEvent.click(tab('기록'));
    expect(screen.getByRole('button', { name: '지난달' })).toBeTruthy();
  });

  it('제품을 더하면 저장소까지 간다 — 화면 state만 바뀌면 앱을 껐다 켤 때 사라진다', () => {
    start();
    fireEvent.click(tab('제품'));
    fireEvent.click(screen.getByRole('button', { name: '제품 추가' }));

    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '수분크림' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(loadProducts(localStorage).map((p) => p.name)).toEqual(['수분크림']);
  });
});

describe('전체화면', () => {
  function start() {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
  }

  it('촬영을 열면 탭바가 사라진다 — 카메라를 켜 놓고 딴 화면으로 샐 이유가 없다', async () => {
    start();

    fireEvent.click(screen.getByRole('button', { name: '오늘 얼굴 찍기' }));

    expect(await screen.findByText('이 환경에서는 카메라를 쓸 수 없어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기록' })).toBeNull();
  });

  it('닫으면 보던 탭으로 돌아온다', async () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: '오늘 얼굴 찍기' }));
    await screen.findByText('이 환경에서는 카메라를 쓸 수 없어요');

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    expect(screen.getByRole('button', { name: '오늘 얼굴 찍기' })).toBeTruthy();
    expect(tab('기록')).toBeTruthy();
  });

  it('기록 탭에서 타임랩스를 열고 닫으면 기록 탭으로 돌아온다', async () => {
    // 사진 2장이 있어야 입구가 뜬다.
    vi.mocked(listPhotos).mockResolvedValue([
      { date: '2026-08-01', blob: new Blob(['a']), capturedAt: 1, width: 9, height: 9 },
      { date: '2026-08-02', blob: new Blob(['b']), capturedAt: 1, width: 9, height: 9 },
    ]);
    start();
    fireEvent.click(tab('기록'));

    fireEvent.click(await screen.findByRole('button', { name: '재생' }));

    // 타임랩스는 자기 DB를 새로 연다 — 사진이 도착하기 전에는 안내 화면이라 기다린다.
    expect(await screen.findByText('타임랩스')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '지난달' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    expect(screen.getByRole('button', { name: '지난달' })).toBeTruthy();
  });
});

describe('관찰 기록 배선', () => {
  it('저장소에 있던 관찰 답이 화면에 뜬다', () => {
    // 촬영 화면을 거치지 않고도 App이 관찰을 읽어 내려보내는지가 요점이다.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    localStorage.setItem('facefit.notes', JSON.stringify({ [today]: 'worse' }));
    localStorage.setItem('facefit.onboarded', '1');
    vi.mocked(listPhotos).mockResolvedValue([
      { date: today, blob: new Blob(['t']), capturedAt: 1, width: 9, height: 9 },
    ]);

    render(<App />);

    expect(loadNotes(localStorage)[today]).toBe('worse');
    expect(screen.getByRole('button', { name: '제품' })).toBeTruthy();
  });
});
