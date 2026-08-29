// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Suggestion } from '../logic/mfds';
import type { MfdsSnapshot, Product } from '../storage';
import { Products } from './Products';

/**
 * 검색은 **통째로 목이다** — 실네트워크에 매달리면 이 화면 테스트가 식약처 점검 시간에 빨개진다.
 * 여기서 재는 것은 응답의 내용이 아니라 **화면이 검색을 어떻게 다루는가**다.
 */
const { searchProducts } = vi.hoisted(() => ({ searchProducts: vi.fn() }));
vi.mock('../logic/mfds', () => ({ searchProducts }));

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

/**
 * 카드 메타 — **제품 표시 개선의 본체다**(설계 §4-2).
 *
 * ⚠️ 여기서 잠그는 것은 예쁨이 아니라 **표기 규율**이다(§3-4): 화면에 서는 것은 식약처가
 * 부여한 법정 분류의 **명사**뿐이고, 앱이 문장을 만들지 않는다. 「미백에 효과 있어요」로
 * 재해석하는 순간 화장품법 표시·광고 규제와 v1 §5-3 규율을 동시에 어긴다.
 */
describe('카드의 식약처 메타', () => {
  const meta = (over: Partial<MfdsSnapshot> = {}): MfdsSnapshot => ({
    reportSeq: '2026026858',
    entpName: '데이셀코스메틱(주)',
    effects: ['미백', '주름개선', '자외선차단'],
    spf: '50+',
    pa: '++++',
    fetchedAt: '2026-08-29',
    ...over,
  });

  it('업소명을 브랜드 줄로 보여준다 — 같은 이름의 타사 제품을 가르는 정보다', () => {
    setup([p({ mfds: meta() })]);
    expect(screen.getByText('데이셀코스메틱(주)')).toBeTruthy();
  });

  it('보고된 기능성 구분을 명사 뱃지로 보여준다', () => {
    setup([p({ mfds: meta() })]);
    for (const badge of ['미백', '주름개선', '자외선차단']) {
      expect(screen.getByText(badge), badge).toBeTruthy();
    }
  });

  it('SPF·PA는 수치 그대로 붙는다', () => {
    setup([p({ mfds: meta() })]);
    expect(screen.getByText('SPF50+ PA++++')).toBeTruthy();
  });

  it('PA 없는 제품은 SPF만 선다 — 빈 칩이 서면 안 된다', () => {
    setup([p({ mfds: meta({ pa: undefined }) })]);
    expect(screen.getByText('SPF50+')).toBeTruthy();
  });

  it('SPF·PA 둘 다 없으면 그 칩 자체가 없다', () => {
    const { container } = setup([p({ mfds: meta({ spf: undefined, pa: undefined, effects: ['미백'] }) })]);
    expect(container.textContent).not.toMatch(/SPF|PA/);
  });

  it('기능성 구분이 없으면 뱃지 없이 브랜드만 선다', () => {
    setup([p({ mfds: meta({ effects: [], spf: undefined, pa: undefined }) })]);
    expect(screen.getByText('데이셀코스메틱(주)')).toBeTruthy();
    expect(screen.queryByText('미백')).toBeNull();
  });

  it('수기 제품 카드는 지금과 똑같다 — 메타 줄 유무만 다르다', () => {
    setup([p({ name: '수기토너' })]);
    expect(screen.getByText('수기토너')).toBeTruthy();
    expect(screen.queryByText('데이셀코스메틱(주)')).toBeNull();
    expect(screen.queryByTestId('mfds-source')).toBeNull();
  });

  it('출처 캡션은 목록에 딱 한 줄이다 — 카드마다 반복하면 소음이다', () => {
    setup([p({ id: 'a', name: '선크림하나', mfds: meta() }), p({ id: 'b', name: '토너둘', mfds: meta() })]);

    expect(screen.getAllByTestId('mfds-source')).toHaveLength(1);
    expect(screen.getByTestId('mfds-source').textContent).toBe('기능성 표시는 식약처 기능성화장품 보고정보 기준이에요');
  });

  it('뱃지가 문장을 만들지 않는다 — 인용이지 앱의 목소리가 아니다', () => {
    // ⚠️ 카피 리뷰(§3-4). 고시 문구를 그대로 실으면 「도움을 준다」가 앱의 말로 읽히고,
    // 재해석은 규제 위반이다. 화면에 서는 것은 분류명(명사)뿐이어야 한다.
    const { container } = setup([p({ mfds: meta() })]);
    const textAll = container.textContent ?? '';
    for (const claim of ['도움을 준다', '도움을 줘요', '보호한다', '효과가 있', '효과 있', '좋아져요', '밝아져요']) {
      expect(textAll.includes(claim), claim).toBe(false);
    }
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

  it('종료일을 비우면 「사용 중」으로 되돌아간다 — 종료를 실수로 눌렀을 때의 유일한 출구다', () => {
    // ⚠️ 이 경로가 죽으면 되돌릴 방법이 **앱 안에 없다** — 제품을 지우고 다시 등록하는 수밖에
    // 없는데, 그러면 새 id가 생겨 그때까지의 기간 기록이 통째로 끊긴다.
    const { onChange } = setup([p({ endDate: '2026-08-20' })]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '' } });
    fireEvent.click(btn('저장'));

    const [next] = onChange.mock.calls[0];
    expect(next[0].endDate).toBeUndefined();
    // 저장소를 왕복해도 「사용 중」이어야 한다 — JSON에 `endDate: null`이 남으면 로더가 다르게 읽는다.
    expect(JSON.parse(JSON.stringify(next))[0].endDate).toBeUndefined();
  });

  it('대조군 — 종료일을 다른 날로 바꾸면 그 날짜가 들어간다', () => {
    // 위 테스트가 「endDate를 아예 안 넘긴다」로 통과하지 않게 잡아 둔다.
    const { onChange } = setup([p({ endDate: '2026-08-20' })]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-08-25' } });
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].endDate).toBe('2026-08-25');
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

/**
 * 이름 입력란 = 검색창(설계 §3-2). **검색과 수기 등록이 같은 칸이다** — 제안이 뜨면 고르고,
 * 안 뜨면(커버리지 밖·오프라인·쿼터 소진·API 장애) 그냥 계속 타이핑해 저장한다.
 *
 * 여기서 잠그는 것 넷: **디바운스**(매 타이핑마다 부르면 쿼터가 샌다) · **이전 요청 취소**
 * (늦게 온 응답이 새 검색을 덮는다) · **명시로 고른 것만 스냅샷이 붙는다**(타이핑 도중 스친
 * 제안이 조용히 붙으면 사용자는 자기가 뭘 저장했는지 모른다) · **실패는 무음**(에러 UI 없음).
 */
describe('제품 이름 자동완성', () => {
  const snap = (over: Partial<MfdsSnapshot> = {}): MfdsSnapshot => ({
    reportSeq: '2026026858',
    entpName: '데이셀코스메틱(주)',
    effects: ['자외선차단'],
    spf: '50+',
    pa: '++++',
    fetchedAt: '2026-08-29',
    ...over,
  });

  const suggestion = (itemName: string, over: Partial<MfdsSnapshot> = {}): Suggestion => ({ itemName, snapshot: snap(over) });

  beforeEach(() => {
    vi.useFakeTimers();
    // ⚠️ 모듈 목이라 호출 이력이 테스트를 건너 쌓인다 — 안 지우면 「몇 번 불렀나」가 전부 거짓말이 된다.
    searchProducts.mockReset();
    searchProducts.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  /** 디바운스가 익고 응답 프라미스까지 흐르게 둔다. */
  async function settle(ms = 300) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  function openForm(products: Product[] = []) {
    const r = setup(products);
    fireEvent.click(btn('제품 추가'));
    return r;
  }

  const type = (value: string) => fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value } });

  it('무엇으로 검색되는지 placeholder가 미리 알린다 — 브랜드명은 0건이 정상이다', () => {
    // 품목명에 브랜드 문자열이 대체로 없다(실측 §2-3). 기대치를 미리 맞춰 두는 한 줄이다.
    openForm();
    expect((screen.getByLabelText('제품 이름') as HTMLInputElement).placeholder).toMatch(/제품명으로 검색/);
  });

  it('한 자만 치면 안 부른다 — 20만 건에 한 글자는 검색이 아니다', async () => {
    openForm();
    type('토');
    await settle();

    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('타이핑이 멈춘 뒤에 한 번만 부른다 — 매 글자마다 부르면 쿼터가 샌다', async () => {
    openForm();

    type('토');
    type('토너');
    type('토너패');
    await settle(299);
    expect(searchProducts).not.toHaveBeenCalled();

    await settle(1);
    expect(searchProducts).toHaveBeenCalledTimes(1);
    expect(searchProducts.mock.calls[0][0]).toBe('토너패');
  });

  it('새로 치면 이전 요청을 취소한다 — 늦게 온 응답이 새 검색을 덮으면 안 된다', async () => {
    openForm();

    type('토너');
    await settle();
    const first = searchProducts.mock.calls[0][1] as AbortSignal;
    expect(first.aborted).toBe(false);

    type('토너패드');
    await settle();

    expect(first.aborted).toBe(true);
    expect(searchProducts).toHaveBeenCalledTimes(2);
  });

  it('제안에 품목명과 업소명이 같이 선다 — 같은 이름의 타사 제품을 가른다', async () => {
    searchProducts.mockResolvedValue([suggestion('데이셀디아트셀루미너스커버선크림')]);
    openForm();

    type('선크림');
    await settle();

    const list = screen.getByTestId('mfds-suggestions');
    expect(within(list).getByText('데이셀디아트셀루미너스커버선크림')).toBeTruthy();
    expect(within(list).getByText('데이셀코스메틱(주)')).toBeTruthy();
  });

  it('제안을 고르면 이름이 채워지고 목록이 닫힌다', async () => {
    searchProducts.mockResolvedValue([suggestion('데이셀디아트셀루미너스커버선크림')]);
    openForm();
    type('선크림');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /데이셀디아트셀루미너스커버선크림/ }));
    await settle();

    expect((screen.getByLabelText('제품 이름') as HTMLInputElement).value).toBe('데이셀디아트셀루미너스커버선크림');
    // 고른 이름으로 다시 검색해 목록이 도로 열리면, 저장 버튼이 목록에 가린다.
    expect(screen.queryByTestId('mfds-suggestions')).toBeNull();
  });

  it('고른 제안이 저장에 스냅샷으로 붙는다', async () => {
    searchProducts.mockResolvedValue([suggestion('선크림하나')]);
    const { onChange } = openForm();
    type('선크림');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /선크림하나/ }));
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].mfds).toEqual(snap());
  });

  it('고른 뒤 이름을 줄여 써도 스냅샷은 남는다 — 품목명이 길어 다듬는 건 정상 사용이다', async () => {
    searchProducts.mockResolvedValue([suggestion('데이셀디아트셀루미너스커버선크림')]);
    const { onChange } = openForm();
    type('선크림');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /데이셀디아트셀루미너스커버선크림/ }));

    type('데이셀 선크림');
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].name).toBe('데이셀 선크림');
    expect(onChange.mock.calls[0][0][0].mfds).toEqual(snap());
  });

  it('고르지 않고 저장하면 스냅샷이 없다 — 스친 제안이 조용히 붙으면 안 된다', async () => {
    searchProducts.mockResolvedValue([suggestion('데이셀디아트셀루미너스커버선크림')]);
    const { onChange } = openForm();

    type('선크림');
    await settle();
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].mfds).toBeUndefined();
    // 저장소를 왕복해도 수기 제품이어야 한다.
    expect(JSON.parse(JSON.stringify(onChange.mock.calls[0][0]))[0]).not.toHaveProperty('mfds');
  });

  it('제안이 0건이면 아무것도 안 뜬다 — 에러 배너를 만들지 않는다', async () => {
    searchProducts.mockResolvedValue([]);
    const { container } = openForm();

    type('토리든');
    await settle();

    expect(screen.queryByTestId('mfds-suggestions')).toBeNull();
    // ⚠️ 실패가 사용자에게 「실패」로 보이는 순간 등록 흐름을 검색이 방해한다(§3-2).
    for (const noise of ['검색 실패', '오류', '찾을 수 없', '다시 시도']) {
      expect(container.textContent?.includes(noise), noise).toBe(false);
    }
  });

  it('검색이 던져도 화면은 멀쩡하다', async () => {
    searchProducts.mockRejectedValue(new Error('boom'));
    openForm();

    type('토너');
    await settle();

    expect(screen.getByLabelText('제품 이름')).toBeTruthy();
    expect(screen.queryByTestId('mfds-suggestions')).toBeNull();
  });

  it('수정 폼을 열자마자 검색하지 않는다 — 이미 정한 이름이다', async () => {
    setup([p({ name: '오래된토너' })]);
    fireEvent.click(btn('오래된토너 수정'));

    await settle();

    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('수정하면서 이름을 고치면 그때는 검색한다 — 수기 제품을 스스로 연결하는 길이다', async () => {
    setup([p({ name: '오래된토너' })]);
    fireEvent.click(btn('오래된토너 수정'));

    type('세라마이드');
    await settle();

    expect(searchProducts).toHaveBeenCalledTimes(1);
  });

  it('수정해도 원래 스냅샷은 그대로 간다', async () => {
    const { onChange } = setup([p({ name: '선크림하나', mfds: snap() })]);
    fireEvent.click(btn('선크림하나 수정'));

    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-08-05' } });
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].mfds).toEqual(snap());
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
