// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { monthOf } from '../logic/calendar';
import { clearPhotos, deletePhoto, listPhotos, type FacePhoto as Photo } from '../photoStore';
import { todayKey, type Notes } from '../storage';
import { History } from './History';

/**
 * 기록 탭 — 월간 캘린더.
 *
 * 화면의 주인이 리스트가 아니라 **달력**이다. 사람이 기록에서 실제로 찾는 것은 **빈 칸**
 * (며칠 걸렀나)이라 달력이 그걸 한눈에 답한다. 내용은 날짜를 눌렀을 때 뜨는 시트가 담당한다 —
 * 그래서 「눌러도 안 뜨는 날」과 「안 눌리는 날」의 구분이 기능의 절반이다.
 *
 * ⚠️ `listPhotos`가 목인 이유는 T-002(jsdom에서 Blob이 왕복하며 정체를 잃는다) —
 * `FacePhoto.test.tsx` 머리말과 같다.
 *
 * ⚠️ 날짜는 **오늘이 속한 달에서 만든다.** 달력은 이번 달로 열리므로 고정 날짜를 쓰면
 * 다음 달에 이 파일 전체가 빨간불이 된다.
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  listPhotos: vi.fn(),
  deletePhoto: vi.fn(),
  clearPhotos: vi.fn(),
}));

afterEach(cleanup);

const today = todayKey();
/** 이번 달의 n일. 오늘이 1일이어도 안전하게 앞자리를 쓴다. */
const day = (n: number) => `${today.slice(0, 8)}${String(n).padStart(2, '0')}`;

const photo = (date: string): Photo => ({ date, blob: new Blob([date]), capturedAt: 1, width: 960, height: 1280 });

function setup(over: { photos?: string[]; notes?: Notes } = {}) {
  vi.mocked(listPhotos).mockResolvedValue((over.photos ?? []).map(photo));
  const onOpenTimelapse = vi.fn();
  const view = render(
    <History
      notes={over.notes ?? {}}
      onOpenTimelapse={onOpenTimelapse}
      idb={new IDBFactory() as IDBFactory}
    />,
  );
  return { onOpenTimelapse, ...view };
}

const cell = (date: string) => document.querySelector(`[data-day="${date}"]`) as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deletePhoto).mockResolvedValue(undefined);
  vi.mocked(clearPhotos).mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => 'blob:pic');
  URL.revokeObjectURL = vi.fn();
});

describe('캘린더 격자', () => {
  it('이번 달로 열린다', async () => {
    setup();
    const [y, m] = today.split('-').map(Number);
    // 헤더 문구를 통째로 잡는다 — 「8월」만 찾으면 아래 요약 줄까지 걸린다.
    expect(await screen.findByText(`${y}년 ${m}월`)).toBeTruthy();
  });

  it('사진 찍은 날에 마커가 붙는다', async () => {
    setup({ photos: [day(3)] });

    await waitFor(() => expect(cell(day(3))!.querySelector('[data-mark="photo"]')).toBeTruthy());
    expect(cell(day(4))!.querySelector('[data-mark="photo"]')).toBeNull();
  });

  it('관찰 기록이 있는 날에는 뱃지가 하나 더 붙는다', async () => {
    setup({ photos: [day(3)], notes: { [day(3)]: 'better' } });

    await waitFor(() => expect(cell(day(3))!.querySelector('[data-mark="note"]')).toBeTruthy());
  });

  it('아무것도 없는 날은 버튼이 아니다 — 눌러도 아무 일 없는 버튼을 만들지 않는다', async () => {
    setup({ photos: [day(3)] });

    await waitFor(() => expect(cell(day(3))!.tagName).toBe('BUTTON'));
    expect(cell(day(4))!.tagName).not.toBe('BUTTON');
  });

  it('사진을 지워도 관찰이 남은 날은 여전히 열린다 — 관찰은 사진과 독립 저장이다', async () => {
    setup({ photos: [], notes: { [day(5)]: 'same' } });

    await waitFor(() => expect(cell(day(5))!.tagName).toBe('BUTTON'));
  });

  it('달을 넘길 수 있다 — 기록 이전 달도 막지 않는다(빈 달력을 보는 것도 답이다)', async () => {
    setup();
    const [y, m] = today.split('-').map(Number);
    await screen.findByRole('button', { name: '지난달' });

    fireEvent.click(screen.getByRole('button', { name: '지난달' }));

    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    expect(screen.getByText(`${prev.y}년 ${prev.m}월`)).toBeTruthy();
  });
});

describe('날짜 시트', () => {
  it('그날 사진과 관찰 답을 보여준다', async () => {
    setup({ photos: [day(3)], notes: { [day(3)]: 'better' } });
    await waitFor(() => expect(cell(day(3))!.tagName).toBe('BUTTON'));

    fireEvent.click(cell(day(3))!);

    // blob URL은 effect에서 만들어진다 — 한 틱 기다려야 `src`가 붙는다.
    expect(await screen.findByAltText(`${day(3)} 얼굴 사진`)).toBeTruthy();
    // 색점만으로는 색각 이상인 사람에게 아무 표시도 없는 것과 같다 — 시트에서 글자로 말한다.
    expect(screen.getByText('좋아졌어요')).toBeTruthy();
  });

  it('관찰 답이 없는 날은 그 줄이 아예 없다 — 「없음」을 적으면 안 한 것이 실패로 보인다', async () => {
    setup({ photos: [day(3)] });
    await waitFor(() => expect(cell(day(3))!.tagName).toBe('BUTTON'));

    fireEvent.click(cell(day(3))!);

    expect(screen.queryByTestId('sheet-note')).toBeNull();
  });

  it('닫으면 사라진다', async () => {
    setup({ photos: [day(3)] });
    await waitFor(() => expect(cell(day(3))!.tagName).toBe('BUTTON'));
    fireEvent.click(cell(day(3))!);

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    expect(screen.queryByAltText(`${day(3)} 얼굴 사진`)).toBeNull();
  });
});

describe('사진 삭제', () => {
  it('한 장 지우면 저장소를 다시 읽는다 — 로컬 배열에서 빼면 실패해도 지워진 것처럼 보인다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup({ photos: [day(3), day(4)] });
    await waitFor(() => expect(cell(day(3))!.tagName).toBe('BUTTON'));
    fireEvent.click(cell(day(3))!);
    // 다음 읽기에는 한 장만 남는다.
    vi.mocked(listPhotos).mockResolvedValue([photo(day(4))]);

    fireEvent.click(screen.getByRole('button', { name: '이 사진 삭제' }));

    await waitFor(() => expect(deletePhoto).toHaveBeenCalledWith(expect.anything(), day(3)));
    await waitFor(() => expect(cell(day(3))!.querySelector('[data-mark="photo"]')).toBeNull());
    // 지운 날의 시트를 열어 둔 채로 두면 방금 사라진 사진의 자리가 빈 채로 남는다.
    expect(screen.queryByAltText(`${day(3)} 얼굴 사진`)).toBeNull();
  });

  it('아니라고 하면 안 지운다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup({ photos: [day(3)] });
    await waitFor(() => expect(cell(day(3))!.tagName).toBe('BUTTON'));
    fireEvent.click(cell(day(3))!);

    fireEvent.click(screen.getByRole('button', { name: '이 사진 삭제' }));

    expect(deletePhoto).not.toHaveBeenCalled();
  });
});

/** 프라이버시 기능이라 v1에서 뺄 수 없다(설계 §1-6 — restfit 비교 화면에서 옮겨 왔다). */
describe('사진 모두 삭제', () => {
  it('한 번 묻고 전부 지운다', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup({ photos: [day(3), day(4)] });
    await screen.findByRole('button', { name: '사진 모두 삭제' });
    vi.mocked(listPhotos).mockResolvedValue([]);

    fireEvent.click(screen.getByRole('button', { name: '사진 모두 삭제' }));

    expect(ask).toHaveBeenCalled();
    await waitFor(() => expect(clearPhotos).toHaveBeenCalled());
    await waitFor(() => expect(cell(day(3))!.querySelector('[data-mark="photo"]')).toBeNull());
  });

  it('아니라고 하면 안 지운다 — 되돌릴 수 없는 일이다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup({ photos: [day(3)] });
    await screen.findByRole('button', { name: '사진 모두 삭제' });

    fireEvent.click(screen.getByRole('button', { name: '사진 모두 삭제' }));

    expect(clearPhotos).not.toHaveBeenCalled();
  });

  it('사진이 없으면 그 버튼도 없다', async () => {
    setup();
    await screen.findByText(/사진은 이 기기에만 저장되며/);
    expect(screen.queryByRole('button', { name: '사진 모두 삭제' })).toBeNull();
  });

  it('구분선으로 격리한다 — 보상(재생)과 파괴(삭제)가 한 덩어리로 읽히면 안 된다', async () => {
    setup({ photos: [day(3)] });
    const remove = await screen.findByRole('button', { name: '사진 모두 삭제' });

    expect(remove.previousElementSibling?.tagName).toBe('HR');
  });
});

describe('타임랩스 입구', () => {
  it('사진이 2장 이상이면 카드로 연다', async () => {
    const { onOpenTimelapse } = setup({ photos: [day(3), day(4)] });

    fireEvent.click(await screen.findByRole('button', { name: '재생' }));

    expect(onOpenTimelapse).toHaveBeenCalled();
  });

  it('몇 장인지와 **기간**을 적는다 — 타임랩스가 보여 주는 것이 기간이다', async () => {
    const { month } = monthOf(today);
    setup({ photos: [day(3), day(4)] });
    expect(await screen.findByText(`2장 · ${month}월 3일 ~ ${month}월 4일`)).toBeTruthy();
  });

  it('변화 보기 카드가 달력 **앞**에 선다 — 이 앱의 보상이 달력 밑에 묻혀 있었다', async () => {
    setup({ photos: [day(3), day(4)] });
    const play = await screen.findByRole('button', { name: '재생' });

    const calendar = screen.getByRole('button', { name: '지난달' });
    expect(play.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('「재생」이 이 화면의 파란 버튼이다', async () => {
    setup({ photos: [day(3), day(4)] });
    const play = await screen.findByRole('button', { name: '재생' });

    expect(play.style.background).toBe('var(--blue)');
  });

  it('사진이 0장이면 카드가 없다 — 빈 화면으로 보내는 버튼을 안 만든다', async () => {
    setup();
    await screen.findByText(/사진은 이 기기에만 저장되며/);
    expect(screen.queryByRole('button', { name: '재생' })).toBeNull();
  });

  it('사진이 1장이면 아직 재생할 게 없다고 말한다', async () => {
    // 「재생」을 눌렀더니 한 장짜리 정지 화면이 뜨는 것보다, 왜 아직인지 말하는 편이 낫다.
    setup({ photos: [day(3)] });
    expect(await screen.findByText(/사진이 2장 모이면/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '재생' })).toBeNull();
  });
});

describe('기기 전용 고지', () => {
  it('사진이 보이는 화면이라 상시 붙는다', async () => {
    setup({ photos: [day(3)] });
    expect(await screen.findByText('사진은 이 기기에만 저장되며 어디로도 전송되지 않습니다.')).toBeTruthy();
  });
});
