// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BASE_FPS } from '../logic/timelapse';
import { listPhotos, type FacePhoto as Photo } from '../photoStore';
import type { Product } from '../storage';
import { Timelapse } from './Timelapse';

/**
 * 타임랩스 화면.
 *
 * 여기서 잠그는 것 넷: **2장 미만이면 재생 자체를 안 연다**(한 장짜리 정지 화면은 재생이
 * 아니다) · **자동으로 전진하고 끝에서 멈춘다**(루프는 「언제 시작했더라」를 지운다) ·
 * **2×가 실제로 두 배 빠르다** · **제품 구간 바가 이름을 달고 뜬다**(이 앱이 답하려는 질문이
 * 「무엇을 쓰는 동안」이라서 그렇다).
 *
 * ⚠️ `listPhotos`가 목인 이유는 T-002 — `FacePhoto.test.tsx` 머리말과 같다. **`openPhotoDb`까지
 *    목인 것은 이 화면과 다르다** — 촬영 화면은 「IDB가 없으면 안내로 빠진다」가 자기 분기라
 *    진짜를 썼지만, 타임랩스는 DB 유무로 갈리는 것이 없다. 여기서 fake-indexeddb를 태우면
 *    가짜 타이머가 그 라이브러리의 이벤트 루프까지 붙잡아 화면이 영영 안 뜬다(T-003).
 * ⚠️ 시간을 미는 테스트는 250ms씩 쪼갠다(restfit T-242) — 한 번에 길게 밀면 여러 틱이 한
 *    렌더로 합쳐져 중간 프레임이 아예 관측되지 않는다. 프레임 하나가 166ms라 특히 그렇다.
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  openPhotoDb: vi.fn(async () => ({ close: () => {} }) as unknown as import('../photoStore').PhotoDb),
  listPhotos: vi.fn(),
}));

afterEach(cleanup);
afterEach(() => vi.useRealTimers());

/** 한 프레임 시간 + 여유. 경계에 딱 맞추면 틱 하나 차이로 흔들린다. */
const FRAME = Math.ceil(1000 / BASE_FPS) + 10;

const photo = (date: string): Photo => ({ date, blob: new Blob([date]), capturedAt: 1, width: 960, height: 1280 });

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-01',
  ...over,
});

function setup(dates: string[], products: Product[] = []) {
  vi.mocked(listPhotos).mockResolvedValue(dates.map(photo));
  const onClose = vi.fn();
  const view = render(<Timelapse products={products} onClose={onClose} />);
  return { onClose, ...view };
}

async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) await vi.advanceTimersByTimeAsync(Math.min(250, left));
}

/**
 * 가짜 타이머를 **켜 놓고** 화면을 연다.
 *
 * ⚠️ 렌더 뒤에 `useFakeTimers()`를 부르면 **이미 걸려 있던 `setTimeout`은 진짜 시계에
 * 남는다** — 아무리 시간을 밀어도 전진이 안 일어나고, 「멈추는가」를 재는 테스트는
 * 그 사실 때문에 **거짓 초록**이 된다(실제로 이 파일에서 그렇게 통과했다).
 * 그래서 타이머를 먼저 켜고, 사진 로딩 promise만 `act`로 흘려보낸 뒤 시작한다.
 */
async function open(dates: string[], products: Product[] = []) {
  vi.useFakeTimers();
  const r = setup(dates, products);
  // 남은 비동기는 promise 마이크로태스크뿐이다(저장소는 전부 목이다) — `act`가 흘려보낸다.
  await act(async () => {});
  return r;
}

const stage = () => document.querySelector('[data-stage]') as HTMLElement;
const slider = () => screen.getByRole('slider') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:${n++}`);
  URL.revokeObjectURL = vi.fn();
});

describe('사진이 모자랄 때', () => {
  it('0장이면 재생 대신 안내다', async () => {
    setup([]);
    expect(await screen.findByText(/사진이 2장 모이면/)).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('1장이어도 마찬가지다 — 정지 화면 하나는 재생이 아니다', async () => {
    setup(['2026-08-01']);
    expect(await screen.findByText(/사진이 2장 모이면/)).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('안내 화면에서도 닫기로 돌아간다', async () => {
    const { onClose } = setup([]);
    fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('재생', () => {
  const DATES = ['2026-08-01', '2026-08-02', '2026-08-03'];

  it('들어가면 첫 장부터 자동으로 전진한다', async () => {
    await open(DATES);
    expect(slider().value).toBe('0');

    await advance(FRAME);
    expect(slider().value).toBe('1');
    await advance(FRAME);
    expect(slider().value).toBe('2');
  });

  it('끝에 닿으면 멈춘다 — 루프는 「언제 시작했더라」를 지운다', async () => {
    await open(DATES);

    await advance(FRAME * 5);

    expect(slider().value).toBe('2');
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
  });

  it('화면을 탭하면 멈춘다', async () => {
    await open(DATES);

    fireEvent.click(stage());
    await advance(FRAME * 3);

    expect(slider().value).toBe('0');
  });

  it('멈춘 뒤 다시 탭하면 이어서 간다', async () => {
    await open(DATES);

    fireEvent.click(stage());
    await advance(FRAME * 2);
    fireEvent.click(stage());
    await advance(FRAME);

    expect(slider().value).toBe('1');
  });

  it('끝에서 다시 재생하면 처음부터 간다 — 안 그러면 그 버튼이 아무 일도 안 한다', async () => {
    await open(DATES);

    await advance(FRAME * 5);
    fireEvent.click(stage());
    await advance(10);

    expect(slider().value).toBe('0');
  });

  it('2×는 같은 시간에 두 배로 간다', async () => {
    await open(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']);
    fireEvent.click(screen.getByRole('button', { name: '2×' }));

    await advance(FRAME);

    // 1× 였다면 1장. 딜레이가 절반이라 같은 시간에 두 장을 넘긴다.
    expect(Number(slider().value)).toBeGreaterThanOrEqual(2);
  });

  it('그 프레임의 날짜를 적는다 — 언제 찍은 얼굴인지 모르면 변화도 못 읽는다', async () => {
    setup(DATES);
    await screen.findByRole('slider');

    expect(screen.getByText('8월 1일')).toBeTruthy();
  });

  it('화면을 닫으면 만든 blob URL을 전부 놓아준다', async () => {
    const { unmount } = setup(DATES);
    await screen.findByRole('slider');

    unmount();

    // 세 장을 다 만들었으면 세 장을 다 놓아줘야 한다 — 한 장이라도 남으면 조용히 샌다.
    await waitFor(() => expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(3));
  });
});

describe('스크럽', () => {
  const DATES = ['2026-08-01', '2026-08-02', '2026-08-03'];

  it('슬라이더 범위가 사진 수를 따라간다', async () => {
    setup(DATES);
    await screen.findByRole('slider');

    expect({ min: slider().min, max: slider().max }).toEqual({ min: '0', max: '2' });
  });

  it('끌면 그 프레임으로 간다', async () => {
    setup(DATES);
    await screen.findByRole('slider');

    fireEvent.change(slider(), { target: { value: '2' } });

    expect(screen.getByText('8월 3일')).toBeTruthy();
  });

  it('끌면 재생이 멈춘다 — 손으로 잡은 프레임이 곧바로 흘러가면 못 본다', async () => {
    await open(DATES);

    fireEvent.change(slider(), { target: { value: '1' } });

    await advance(FRAME * 3);

    expect(slider().value).toBe('1');
  });
});

/** 이 앱이 답하려는 질문이 「**무엇을 쓰는 동안** 얼굴이 어떻게 달라졌나」라 바가 있다. */
describe('제품 구간 바', () => {
  const DATES = ['2026-08-01', '2026-08-06', '2026-08-11'];

  it('제품 이름을 막대에 단다', async () => {
    setup(DATES, [product({ name: '세라마이드 토너' })]);
    await screen.findByRole('slider');

    expect(screen.getByText('세라마이드 토너')).toBeTruthy();
  });

  it('구간 밖 제품은 안 그린다', async () => {
    setup(DATES, [product({ name: '옛날크림', startDate: '2026-01-01', endDate: '2026-02-01' })]);
    await screen.findByRole('slider');

    expect(screen.queryByText('옛날크림')).toBeNull();
  });

  it('제품이 없으면 바 자체가 없다 — 빈 띠가 자리만 먹는다', async () => {
    setup(DATES);
    await screen.findByRole('slider');

    expect(screen.queryByTestId('segment-bar')).toBeNull();
  });

  it('현재 프레임 자리에 세로선이 선다', async () => {
    setup(DATES, [product()]);
    await screen.findByRole('slider');

    // 첫 프레임은 왼쪽 끝(0%)이다.
    expect((screen.getByTestId('playhead') as HTMLElement).style.left).toBe('0%');

    fireEvent.change(slider(), { target: { value: '2' } });

    // 마지막 프레임은 오른쪽 끝이다 — 안 그러면 막대와 사진이 딴 이야기를 한다.
    expect((screen.getByTestId('playhead') as HTMLElement).style.left).toBe('100%');
  });
});
