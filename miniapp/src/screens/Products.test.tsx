// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Product } from '../storage';
import { Products } from './Products';

/**
 * 제품 탭 — 수동 CRUD.
 *
 * 여기서 잠그는 것 셋: **지금 쓰는 것과 끝낸 것이 눈으로 갈린다**(그 구분이 이 탭에 오는
 * 이유다) · **「오늘까지 쓰고 종료」가 오늘을 포함한다**(경계 하루가 구간 바를 어긋나게 한다) ·
 * **삭제는 되돌릴 수 없어 한 번 묻는다.**
 *
 * ⚠️ 날짜는 고정값을 주입한다 — `todayKey()`를 그대로 쓰면 테스트가 자정에 깨진다.
 */
afterEach(cleanup);

const TODAY = '2026-08-29';

const p = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-01',
  ...over,
});

function setup(products: Product[] = []) {
  const onChange = vi.fn<(next: Product[]) => void>();
  const view = render(<Products products={products} onChange={onChange} date={TODAY} />);
  return { onChange, ...view };
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => vi.restoreAllMocks());

describe('제품 목록', () => {
  it('아무것도 없으면 등록을 권한다', () => {
    setup();
    expect(screen.getByText(/아직 등록한 제품이 없어요/)).toBeTruthy();
  });

  it('사용 중과 종료를 섹션으로 가른다 — 지금 뭘 쓰는지가 이 탭에 오는 이유다', () => {
    // ⚠️ 이름을 카테고리 한글명(「토너」)과 겹치지 않게 둔다 — 겹치면 칩까지 걸려서
    // 이 테스트가 「어느 섹션에 있나」가 아니라 「몇 개나 잡히나」를 재게 된다.
    setup([p({ id: 'a', name: '지금쓰는것' }), p({ id: 'b', name: '옛세럼', endDate: '2026-08-10' })]);

    const using = screen.getByTestId('section-active');
    const ended = screen.getByTestId('section-ended');
    expect(within(using).getByText('지금쓰는것')).toBeTruthy();
    expect(within(ended).getByText('옛세럼')).toBeTruthy();
  });

  it('종료 섹션은 종료한 제품이 있을 때만 뜬다', () => {
    setup([p()]);
    expect(screen.queryByTestId('section-ended')).toBeNull();
  });

  it('카테고리를 한글로 보여준다 — 화면에 영어 키가 뜨면 안 된다', () => {
    setup([p({ category: 'sunscreen' })]);
    expect(screen.getByText('선크림')).toBeTruthy();
  });

  it('시작일부터 며칠째인지 보여준다', () => {
    // 8/01 시작, 오늘 8/29 → 28일째.
    setup([p({ startDate: '2026-08-01' })]);
    expect(screen.getByText('D+28')).toBeTruthy();
  });

  it('종료한 제품은 쓴 기간을 보여준다 — 오늘까지 세면 끝난 제품이 계속 자란다', () => {
    setup([p({ startDate: '2026-08-01', endDate: '2026-08-11' })]);
    expect(screen.getByText('8월 1일 ~ 8월 11일')).toBeTruthy();
  });
});

describe('제품 추가', () => {
  function openForm() {
    const r = setup();
    fireEvent.click(btn('제품 추가'));
    return r;
  }

  it('시작일은 오늘이 기본이다 — 대부분 오늘 쓰기 시작한 것을 등록한다', () => {
    openForm();
    expect((screen.getByLabelText('시작일') as HTMLInputElement).value).toBe(TODAY);
  });

  it('이름과 카테고리를 넣으면 목록에 더한다', () => {
    const { onChange } = openForm();

    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '수분크림' } });
    fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: 'cream' } });
    fireEvent.click(btn('저장'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [next] = onChange.mock.calls[0];
    expect(next).toHaveLength(1);
    expect({ name: next[0].name, category: next[0].category, startDate: next[0].startDate }).toEqual({
      name: '수분크림',
      category: 'cream',
      startDate: TODAY,
    });
    // 목록 key이자 삭제·수정의 지목 대상이다. 비면 그 줄을 손댈 방법이 없다.
    expect(next[0].id).toMatch(/\S/);
  });

  it('이름이 비면 저장이 안 눌린다 — 이름 없는 줄은 목록에서 지울 수도 없다', () => {
    openForm();
    expect(btn('저장').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '   ' } });
    expect(btn('저장').disabled).toBe(true);
  });

  it('취소하면 아무 일도 안 일어난다', () => {
    const { onChange } = openForm();
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '수분크림' } });

    fireEvent.click(btn('취소'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('제품 이름')).toBeNull();
  });

  it('추가한 뒤 폼이 닫힌다 — 같은 제품을 두 번 넣는 사고를 막는다', () => {
    openForm();
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '수분크림' } });
    fireEvent.click(btn('저장'));

    expect(screen.queryByLabelText('제품 이름')).toBeNull();
  });
});

describe('제품 수정', () => {
  it('기존 값이 폼에 채워진다', () => {
    setup([p({ name: '토너', category: 'toner', startDate: '2026-08-01' })]);
    fireEvent.click(btn('토너 수정'));

    expect((screen.getByLabelText('제품 이름') as HTMLInputElement).value).toBe('토너');
    expect((screen.getByLabelText('카테고리') as HTMLSelectElement).value).toBe('toner');
    expect((screen.getByLabelText('시작일') as HTMLInputElement).value).toBe('2026-08-01');
  });

  it('수정은 그 제품만 바꾸고 나머지는 그대로 둔다', () => {
    const { onChange } = setup([p({ id: 'a', name: '토너' }), p({ id: 'b', name: '세럼' })]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '새 토너' } });
    fireEvent.click(btn('저장'));

    const [next] = onChange.mock.calls[0];
    expect(next.map((x: Product) => x.name)).toEqual(['새 토너', '세럼']);
    // 같은 레코드여야 한다 — id가 바뀌면 이전 기록과의 연결이 끊긴다.
    expect(next[0].id).toBe('a');
  });

  it('수정 폼에서만 종료일을 손댈 수 있다 — 추가할 때 끝난 제품을 넣을 일은 드물다', () => {
    setup([p()]);
    fireEvent.click(btn('토너 수정'));
    expect(screen.getByLabelText('종료일')).toBeTruthy();
  });
});

describe('오늘까지 쓰고 종료', () => {
  it('종료일을 오늘로 넣는다 — 오늘까지 쓴 것으로 센다', () => {
    // 어제로 넣으면 오늘 찍은 사진에 그 제품이 안 붙는다. 경계 하루가 구간 바를 어긋나게 한다.
    const { onChange } = setup([p()]);

    fireEvent.click(btn('토너 종료'));

    expect(onChange.mock.calls[0][0][0].endDate).toBe(TODAY);
  });

  it('이미 종료한 제품에는 그 버튼이 없다', () => {
    setup([p({ endDate: '2026-08-10' })]);
    expect(screen.queryByRole('button', { name: '토너 종료' })).toBeNull();
  });
});

describe('제품 삭제', () => {
  it('한 번 묻고 지운다 — 되돌릴 수 없다', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = setup([p({ id: 'a' }), p({ id: 'b', name: '세럼' })]);

    fireEvent.click(btn('토너 삭제'));

    expect(ask).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].map((x: Product) => x.id)).toEqual(['b']);
  });

  it('아니라고 하면 그대로 둔다', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onChange } = setup([p()]);

    fireEvent.click(btn('토너 삭제'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
