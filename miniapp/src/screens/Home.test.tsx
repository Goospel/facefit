// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isNotifySupported, requestNotifyAgreement } from '../notify';
import { listPhotos, type FacePhoto as Photo } from '../photoStore';
import type { Notes, Product } from '../storage';
import { Home } from './Home';

/**
 * 오늘 탭.
 *
 * **오늘 찍었는가**가 이 화면이 답하는 유일한 질문이다 — 나머지(제품 요약·관찰 답)는
 * 그 답에 딸린 맥락이다.
 *
 * ⚠️ 저장소는 목이다 — 사유는 [T-002]·[T-003]. 타이머를 안 쓰므로 `openPhotoDb`만 목이면 된다.
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  openPhotoDb: vi.fn(async () => ({ close: () => {} }) as unknown as import('../photoStore').PhotoDb),
  listPhotos: vi.fn(),
}));

/** 알림 동의는 토스 웹뷰 브릿지다 — 여기엔 없다. 래퍼 자체는 `notify.test.ts`가 잰다. */
vi.mock('../notify', () => ({ isNotifySupported: vi.fn(), requestNotifyAgreement: vi.fn() }));

afterEach(cleanup);

const TODAY = '2026-08-29';

const photo = (date: string): Photo => ({ date, blob: new Blob([date]), capturedAt: 1, width: 960, height: 1280 });

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-01',
  ...over,
});

function setup(over: { photos?: string[]; products?: Product[]; notes?: Notes } = {}) {
  vi.mocked(listPhotos).mockResolvedValue((over.photos ?? []).map(photo));
  const onShoot = vi.fn();
  const view = render(
    <Home products={over.products ?? []} notes={over.notes ?? {}} date={TODAY} onShoot={onShoot} />,
  );
  return { onShoot, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:today');
  URL.revokeObjectURL = vi.fn();
  // 기본은 알림을 받을 수 있는 기기다 — 못 받는 기기는 아래에서 따로 잰다.
  vi.mocked(isNotifySupported).mockReturnValue(true);
});

describe('촬영 입구', () => {
  it('아직 안 찍었으면 찍자고 한다', async () => {
    setup();
    expect(await screen.findByRole('button', { name: '오늘 얼굴 찍기' })).toBeTruthy();
  });

  it('누르면 촬영 화면을 연다', async () => {
    const { onShoot } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '오늘 얼굴 찍기' }));
    expect(onShoot).toHaveBeenCalled();
  });

  it('오늘 찍었으면 그 사진을 보여주고 다시 찍기를 연다', async () => {
    setup({ photos: [TODAY] });

    expect(await screen.findByAltText('오늘 찍은 사진')).toBeTruthy();
    // 하루 1장이라 다시 찍으면 덮어쓴다 — 버튼 문구가 그걸 미리 말한다.
    expect(screen.getByRole('button', { name: '다시 찍기' })).toBeTruthy();
  });

  it('어제 사진은 「오늘 찍었다」로 안 센다', async () => {
    setup({ photos: ['2026-08-28'] });
    expect(await screen.findByRole('button', { name: '오늘 얼굴 찍기' })).toBeTruthy();
  });
});

describe('오늘의 관찰 답', () => {
  it('답한 날은 그 답을 보여준다', async () => {
    setup({ photos: [TODAY], notes: { [TODAY]: 'better' } });
    expect(await screen.findByText('좋아졌어요')).toBeTruthy();
  });

  it('건너뛴 날은 아무 말도 안 한다 — 「미응답」을 적으면 안 한 것이 실패로 보인다', async () => {
    setup({ photos: [TODAY] });
    await screen.findByAltText('오늘 찍은 사진');
    expect(screen.queryByTestId('today-note')).toBeNull();
  });
});

/**
 * 아침 알림 상시 진입점(설계 §3-2).
 *
 * **동의 상태를 앱이 추적하지 않는다** — 단일 출처는 토스다. 그래서 버튼은 늘 같은 자리에
 * 있고, 이미 동의한 사람이 눌러도 `alreadyAgreed`로 무해하게 끝나며(멱등), 토스 설정에서
 * **철회한 사람의 재동의 경로를 그대로 겸한다**(철회 감지 기능 없이).
 */
describe('아침 알림 진입점', () => {
  const ASK = '아침 알림 받기';
  const DONE = '알림 신청됨';

  it('오늘 찍었든 안 찍었든 늘 같은 자리에 있다 — 재동의 경로를 겸한다', async () => {
    setup();
    expect(await screen.findByRole('button', { name: ASK })).toBeTruthy();

    cleanup();
    setup({ photos: [TODAY] });
    expect(await screen.findByRole('button', { name: ASK })).toBeTruthy();
  });

  it('알림을 못 받는 기기(구버전 토스·토스 밖)에서는 버튼 자체가 없다', async () => {
    // 눌러도 열 수 없는 시트다 — 죽은 버튼을 남기면 사용자는 「눌렀는데 아무 일도 없다」를 본다(설계 §3-2).
    vi.mocked(isNotifySupported).mockReturnValue(false);
    setup();
    await screen.findByRole('button', { name: '오늘 얼굴 찍기' });

    expect(screen.queryByRole('button', { name: ASK })).toBeNull();
  });

  it('누르면 토스 동의 화면을 연다', async () => {
    setup();

    fireEvent.click(await screen.findByRole('button', { name: ASK }));

    expect(requestNotifyAgreement).toHaveBeenCalledTimes(1);
  });

  it('동의 결과가 오면 신청됐다고 말한다', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: ASK }));

    const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls[0];
    act(() => onDone(true));

    expect(screen.getByRole('button', { name: DONE })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ASK })).toBeNull();
  });

  it('동의 없이 끝나면(거절·오류) 문구가 그대로다 — 신청되지도 않은 것을 신청됐다고 하지 않는다', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: ASK }));

    const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls[0];
    act(() => onDone(false));

    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    expect(screen.queryByRole('button', { name: DONE })).toBeNull();
  });

  it('언제 오는지 말한다 — 「받겠다」를 고르는 데 필요한 유일한 정보다', async () => {
    setup();

    expect((await screen.findByTestId('notify-sub')).textContent).toContain('아침 8시');
  });

  /*
    ⚠️ **스위치로 그리지 않는 이유가 이 줄에 있다.** 동의의 단일 출처는 토스이고 철회는
    앱이 감지할 수 없다(설계 §3-5) — 상태를 그리면 동의한 사람에게도 매번 「꺼짐」으로
    보인다. 그래서 오른쪽은 상태가 아니라 **행동**이고, 끄는 곳이 앱 밖이라는 사실을
    신청 직후에 말해 준다. 안 말하면 사용자는 앱에서 끄는 법을 찾다 못 찾는다.
  */
  it('신청한 뒤에는 끄는 곳이 앱 밖이라고 말한다 — 앱에는 끌 방법이 없다', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: ASK }));

    const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls[0];
    act(() => onDone(true));

    expect(screen.getByTestId('notify-sub').textContent).toContain('토스 알림 설정');
  });
});

describe('사용 중 제품 요약', () => {
  it('오늘 쓰고 있는 제품만 센다', async () => {
    setup({
      products: [product({ id: 'a' }), product({ id: 'b', name: '옛세럼', endDate: '2026-08-10' })],
      photos: [],
    });

    expect(await screen.findByText('토너')).toBeTruthy();
    expect(screen.queryByText('옛세럼')).toBeNull();
  });

  it('제품이 없으면 등록을 권한다 — 제품이 없으면 이 앱의 절반이 빈다', async () => {
    setup();
    expect(await screen.findByText(/제품 탭에서 등록/)).toBeTruthy();
  });
});
