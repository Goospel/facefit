// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
