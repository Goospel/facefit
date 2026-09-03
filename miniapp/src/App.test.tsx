// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { listPhotos } from './photoStore';
import { readInitialTab } from './logic/landing';
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

/**
 * 백업 모듈도 목이다 — 실물(무음 실패 규율)은 `logic/backup.test.ts`가 잰다.
 * 여기서 재는 것은 **배선**뿐이다: 언제 부르는가 · 실패를 어디에 남기는가 · 무엇을 숨기는가.
 *
 * ⚠️ 기본은 **미지원**으로 둔다. 그래야 기존 테스트들이 백업 UI 때문에 흔들리지 않고,
 * 지원 기기를 재는 쪽이 그걸 명시적으로 켠다.
 */
vi.mock('./logic/backup', async (orig) => ({
  ...(await orig<typeof import('./logic/backup')>()),
  isBackupSupported: vi.fn(() => false),
  getBackupKey: vi.fn(async () => null),
  uploadBackup: vi.fn(async () => true),
  fetchBackup: vi.fn(async () => null),
  deleteBackup: vi.fn(async () => true),
}));

/**
 * 푸시 랜딩도 목이다 — `Environment.initialURL`은 토스 웹뷰 전역이라 여기엔 없다.
 * 실물(스킴 파싱·토스 밖 예외)은 `logic/landing.test.ts`가 잰다.
 *
 * ⚠️ 기본은 **아무 말도 안 하는 진입**(`null`)이다 — 그래야 기존 테스트들이 시작 탭 때문에
 * 흔들리지 않고, 푸시로 들어온 경우를 재는 쪽이 그걸 명시적으로 켠다.
 */
vi.mock('./logic/landing', () => ({ readInitialTab: vi.fn(() => null) }));

afterEach(cleanup);

const tab = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listPhotos).mockResolvedValue([]);
  // 기본은 평소 진입이다 — 푸시로 들어온 경우를 재는 쪽이 명시적으로 켠다.
  vi.mocked(readInitialTab).mockReturnValue(null);
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

  it('시작하면 제품 탭으로 들어간다 — 얼굴은 부르기 전엔 안 보인다', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    expect(screen.queryByRole('button', { name: '시작하기' })).toBeNull();
    expect(tab('제품').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: '제품' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '오늘' })).toBeNull();
  });

  /*
    ⚠️ **푸시를 탭한 사람은 오늘 탭으로 들어와야 한다**(v5 설계 §3-5·§7-4). 기름종이 승인
    버튼은 오늘 탭에 있는데 시작 탭은 제품이라, 이 배선이 없으면 알림을 받고도 「그래서 어디로
    가라는 거지」가 된다. 반대로 **아무 값도 안 실린 평소 진입은 제품 탭 그대로**다 —
    부르지 않은 얼굴 사진이 앱을 열자마자 뜨는 것을 v4-1에서 고쳤다.
  */
  it('푸시 스킴으로 들어오면 오늘 탭에서 시작한다', () => {
    vi.mocked(readInitialTab).mockReturnValue('home');
    localStorage.setItem('facefit.onboarded', '1');

    render(<App />);

    expect(tab('오늘').getAttribute('aria-current')).toBe('page');
  });

  it('평소 진입은 제품 탭 그대로다 — 스킴이 말하지 않으면 아무것도 안 바꾼다', () => {
    localStorage.setItem('facefit.onboarded', '1');

    render(<App />);

    expect(tab('제품').getAttribute('aria-current')).toBe('page');
  });

  it('탭 순서는 제품 · 오늘 · 기록이다 — 첫 자리가 첫 화면이다', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['제품', '오늘', '기록']);
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

  it('오늘 탭으로 간다', () => {
    start();
    fireEvent.click(tab('오늘'));
    expect(screen.getByRole('heading', { name: '오늘' })).toBeTruthy();
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
    expect(tab('제품').getAttribute('aria-current')).toBe('page');
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
