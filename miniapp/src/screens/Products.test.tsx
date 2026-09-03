// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Suggestion } from '../logic/mfds';
import { listPhotos, openPhotoDb, type FacePhoto as Photo } from '../photoStore';
import type { MfdsSnapshot, Notes, Product, Usage } from '../storage';
import { Products } from './Products';

/**
 * 검색은 **통째로 목이다** — 실네트워크에 매달리면 이 화면 테스트가 식약처 점검 시간에 빨개진다.
 * 여기서 재는 것은 응답의 내용이 아니라 **화면이 검색을 어떻게 다루는가**다.
 */
const { searchProducts } = vi.hoisted(() => ({ searchProducts: vi.fn() }));
// ⚠️ **네트워크만 목이다.** 같은 모듈의 `keepsSnapshot`은 진짜를 쓴다 — 규제 민감한 표시축의
// 판정을 목으로 갈아 끼우면 화면 테스트가 그 규칙을 아예 안 재게 된다.
vi.mock('../logic/mfds', async (orig) => ({ ...(await orig<typeof import('../logic/mfds')>()), searchProducts }));

/**
 * 사진 저장소도 목이다 — 이 화면은 「오늘 찍었나」만 묻고 사진 자체는 **그리지 않는다.**
 * `openPhotoDb`·`listPhotos`를 setup에서 매번 세운다(`restoreAllMocks`가 구현을 지워도 안전하게).
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  openPhotoDb: vi.fn(),
  listPhotos: vi.fn(),
}));

const photo = (date: string): Photo => ({ date, blob: new Blob([date]), capturedAt: 1, width: 960, height: 1280 });

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

function setup(products: Product[] = [], over: { photos?: string[]; notes?: Notes; usage?: Usage } = {}) {
  vi.mocked(openPhotoDb).mockResolvedValue({ close: () => {} } as unknown as import('../photoStore').PhotoDb);
  vi.mocked(listPhotos).mockResolvedValue((over.photos ?? []).map(photo));
  const onChange = vi.fn<(next: Product[]) => void>();
  const onShoot = vi.fn();
  const view = render(
    <Products
      products={products}
      onChange={onChange}
      date={TODAY}
      notes={over.notes ?? {}}
      usage={over.usage ?? {}}
      onShoot={onShoot}
    />,
  );
  return { onChange, onShoot, ...view };
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => vi.restoreAllMocks());

/** 비동기 DB 목이 끝까지 돌게 한 틱 기다린다 — 안 기다리면 「안 찍었어요」가 초기 렌더로 늘 통과한다. */
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

/**
 * 「파란 버튼은 하나」 계측기(UX 2차 설계 §6).
 *
 * 눈으로만 지키는 규칙은 다음 화면에서 조용히 깨진다 — `ui.primary` 톤(`background: var(--blue)`)인
 * 버튼을 **세어** 세 상태에서 1·1·0을 단언한다. 헤더 「추가」는 `ui.ghost`(배경 없음)라 안 걸린다.
 */
const blueButtons = () => screen.getAllByRole('button').filter((b) => b.style.background === 'var(--blue)');

/** 버튼의 접근성 이름 — `aria-label`이 있으면 그것, 없으면 보이는 글자. */
const nameOf = (b: HTMLElement) => b.getAttribute('aria-label') ?? b.textContent;

describe('찍기 CTA · 찍은 뒤 행 — 사진은 그리지 않는다', () => {
  it('안 찍었으면 찍기 버튼 하나뿐이고, 누르면 촬영을 연다', async () => {
    const { onShoot } = setup([p()]);
    await flush();

    fireEvent.click(btn('오늘 얼굴 찍기'));
    expect(onShoot).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '오늘 얼굴 다시 찍기' })).toBeNull();
  });

  it('찍었으면 관찰 답을 말하고, 행동은 「다시 찍기」뿐이다', async () => {
    const { onShoot } = setup([p()], { photos: [TODAY], notes: { [TODAY]: 'better' } });
    // ⚠️ `findByText`로 재면 **DB가 열리기 전 첫 프레임**에서도 해소돼 「안 찍었어요」를 통과시킨다.
    // 한 틱 흘린 뒤 `getByText`로 단정해야 `shot` 반전이 여기서 죽는다(리뷰 2026-09-02).
    await flush();

    expect(screen.getByText('오늘 찍었어요')).toBeTruthy();
    expect(screen.getByText('좋아졌어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '오늘 얼굴 찍기' })).toBeNull();
    fireEvent.click(btn('오늘 얼굴 다시 찍기'));
    expect(onShoot).toHaveBeenCalledTimes(1);
  });

  it('찍은 뒤 행 전체는 버튼이 아니다 — 상태 보고를 누르게 하면 「또 눌러야 하나」로 읽힌다', async () => {
    setup([p()], { photos: [TODAY] });
    await flush();

    expect(screen.getByText('오늘 찍었어요').closest('button')).toBeNull();
  });

  it('찍었는데 답이 없으면 오늘 탭을 가리킨다 — 「미응답」을 적으면 건너뛴 것이 실패로 보인다', async () => {
    setup([p()], { photos: [TODAY] });
    await flush();
    expect(screen.getByText("'오늘' 탭에서 볼 수 있어요")).toBeTruthy();
  });

  it('어제 사진은 오늘 사진이 아니다', async () => {
    setup([p()], { photos: ['2026-08-28'] });
    await flush();
    expect(btn('오늘 얼굴 찍기')).toBeTruthy();
  });

  it('어느 상태에도 <img>가 없다 — 얼굴은 부르기 전엔 안 보인다', async () => {
    const { container } = setup([p()], { photos: [TODAY], notes: { [TODAY]: 'same' } });
    await flush();
    // 「찍은 상태에 도달했다」를 먼저 못박는다 — 이게 없으면 사진이 안 실린 첫 프레임에서
    // `<img>`가 없는 것을 재고 끝나, 정작 재려던 상태를 안 밟는다.
    expect(screen.getByText('오늘 찍었어요')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('폼이 열려 있어도 찍기 CTA는 그대로 있다 — 사라졌다 나타나면 화면이 흔들린다', async () => {
    setup([p()]);
    await flush();
    fireEvent.click(btn('제품 추가'));
    expect(btn('오늘 얼굴 찍기')).toBeTruthy();
  });

  it('첫 진입 카드 안의 찍은 뒤 행은 카드가 아니다 — 카드 안 카드는 테두리가 겹쳐 보인다', async () => {
    setup([], { photos: [TODAY] });
    await flush();

    const row = screen.getByText('오늘 찍었어요').closest('div') as HTMLElement;
    expect(row.style.background).toBe('');
    expect(row.style.border).toBe('');
  });

  it('목록 상태의 찍은 뒤 행은 그대로 카드다', async () => {
    setup([p()], { photos: [TODAY] });
    await flush();

    const row = screen.getByText('오늘 찍었어요').closest('div') as HTMLElement;
    expect(row.style.background).toBe('var(--bg-sub)');
  });
});

describe('파란 버튼은 하나 — 지금 할 일을 따라간다', () => {
  it('제품 0개: 파란 것은 「제품 추가」 하나 · 찍기는 회색 톤이다', async () => {
    setup();
    await flush();

    expect(blueButtons().map(nameOf)).toEqual(['제품 추가']);
    expect(btn('오늘 얼굴 찍기').style.background).toBe('var(--bg-sub)');
  });

  it('제품 ≥1 · 안 찍음: 파란 것은 「오늘 얼굴 찍기」 하나 · 「제품 추가」는 헤더 글자 버튼이다', async () => {
    setup([p()]);
    await flush();

    expect(blueButtons().map(nameOf)).toEqual(['오늘 얼굴 찍기']);
    expect(btn('제품 추가').style.background).toBe('none');
  });

  it('찍은 날: 파란 버튼이 0개다 — 오늘 할 일이 끝났으면 화면에 재촉이 없다', async () => {
    setup([p()], { photos: [TODAY] });
    await flush();

    expect(blueButtons()).toEqual([]);
  });

  it('제품 0개인데 이미 찍었으면 카드 ② 자리가 「찍은 뒤 행」이다 — 화면이 거짓말을 안 한다', async () => {
    setup([], { photos: [TODAY] });
    await flush();

    expect(screen.getByText('시작은 두 가지면 돼요')).toBeTruthy();
    expect(screen.getByText('오늘 찍었어요')).toBeTruthy();
    expect(blueButtons().map(nameOf)).toEqual(['제품 추가']);
  });

  it('번호 원도 「지금 할 것」을 말한다 — ①만 파랗고 ②는 회색이다', async () => {
    setup();
    await flush();

    // 파란 버튼과 같은 신호를 원이 한 번 더 준다 — 버튼 색 하나에 기대면 흘끗 보는 사람이 놓친다.
    expect(screen.getByText('1').style.background).toBe('var(--blue)');
    expect(screen.getByText('2').style.background).toBe('var(--line)');
  });
});

describe('제품 목록', () => {
  it('아무것도 없으면 할 일 둘을 번호로 말한다', () => {
    setup();
    expect(screen.getByText('시작은 두 가지면 돼요')).toBeTruthy();
    // 첫 화면이 된 탭이라 기기 전용 고지가 여기에도 선다.
    expect(screen.getByText(/사진은 이 기기에만 저장되며/)).toBeTruthy();
  });

  it('첫 등록 폼을 열어도 기기 전용 고지는 남는다 — 카드에 딸려 사라지면 고지가 없는 화면이 된다', () => {
    setup();
    fireEvent.click(btn('제품 추가'));

    expect(screen.queryByText('시작은 두 가지면 돼요')).toBeNull();
    expect(screen.getByText(/사진은 이 기기에만 저장되며/)).toBeTruthy();
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

  it('시작일부터 며칠째인지 보여준다 — 시작 당일이 1일째다', () => {
    // 8/01 시작, 오늘 8/29 → daysBetween 28 + 1 = 29일째.
    setup([p({ startDate: '2026-08-01' })]);
    expect(screen.getByText('29')).toBeTruthy();
    expect(screen.getByText('일째')).toBeTruthy();
  });

  it('오늘 시작한 제품은 1일째다 — 0일째는 말이 안 된다', () => {
    setup([p({ startDate: TODAY })]);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('종료한 제품은 쓴 날수를 보여주고, 그 수는 오늘과 무관하다', () => {
    // 8/1 ~ 8/11 → 11일. 오늘까지 세면 끝난 제품이 계속 자란다.
    setup([p({ startDate: '2026-08-01', endDate: '2026-08-11' })]);
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('일')).toBeTruthy();
    expect(screen.queryByText('일째')).toBeNull();
  });

  it('종료한 제품은 쓴 기간을 보여준다 — 오늘까지 세면 끝난 제품이 계속 자란다', () => {
    setup([p({ startDate: '2026-08-01', endDate: '2026-08-11' })]);
    expect(screen.getByText('8월 1일 ~ 8월 11일')).toBeTruthy();
  });
});

/**
 * 가끔 쓰는 제품(v4-2 §4-5). 「n일째」는 **매일 쓴다는 전제**의 숫자라, 주 1~2회 쓰는 제품에
 * 붙으면 기록을 부풀려 읽게 한다. 그 자리에 **기록된 사진 날짜 수**가 선다.
 *
 * ⚠️ 「n회」는 실제 사용 횟수가 아니다 — 사진을 안 찍은 날의 사용은 정의상 없다(비목표).
 */
describe('사용 빈도 — 폼과 카드', () => {
  const GUIDE = '촬영할 때 이 제품을 썼는지 물어봐요';

  it('폼의 사용 빈도는 기본이 매일이고, 어휘는 둘뿐이다', () => {
    setup();
    fireEvent.click(btn('제품 추가'));

    const select = screen.getByLabelText('사용 빈도') as HTMLSelectElement;
    expect(select.value).toBe('daily');
    expect([...select.options].map((o) => o.textContent)).toEqual(['매일', '가끔']);
    // 매일이 기본이라 안내 줄도 없다 — 대부분의 등록이 한 글자도 안 바뀐다.
    expect(screen.queryByText(GUIDE)).toBeNull();
  });

  it('「가끔」을 고르면 무슨 일이 생기는지 한 줄로 말하고, 저장 객체에 실린다', () => {
    const { onChange } = setup();
    fireEvent.click(btn('제품 추가'));
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '팩' } });

    fireEvent.change(screen.getByLabelText('사용 빈도'), { target: { value: 'occasional' } });
    expect(screen.getByText(GUIDE)).toBeTruthy();

    fireEvent.click(btn('저장'));
    expect(onChange.mock.calls[0][0][0].frequency).toBe('occasional');
  });

  it('매일로 저장하면 daily가 명시로 실린다 — 어휘 밖 값이 조용히 새지 않는다', () => {
    const { onChange } = setup();
    fireEvent.click(btn('제품 추가'));
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '로션' } });

    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].frequency).toBe('daily');
  });

  it('수정 폼은 저장된 빈도로 열린다', () => {
    setup([p({ name: '팩', frequency: 'occasional' })]);
    fireEvent.click(btn('팩 수정'));

    expect((screen.getByLabelText('사용 빈도') as HTMLSelectElement).value).toBe('occasional');
  });

  it('안내 줄은 셀렉트의 설명으로 이어진다 — 이름은 안 건드리고 뜻만 더한다(T-015)', () => {
    // 안내를 <label> 안에 넣으면 이름이 오염된다(T-015). 밖으로 뺀 대신 describedby로 잇는다 —
    // 안 이으면 스크린리더 사용자에게는 그 줄이 아예 없는 것과 같다.
    setup([p({ name: '팩', frequency: 'occasional' })]);
    fireEvent.click(btn('팩 수정'));

    const select = screen.getByLabelText('사용 빈도');
    const describedBy = select.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(GUIDE);
  });

  it('매일이면 설명이 붙지 않는다 — 안 뜨는 줄을 가리키면 이름만 깨진 참조가 된다', () => {
    setup();
    fireEvent.click(btn('제품 추가'));

    expect(screen.getByLabelText('사용 빈도').getAttribute('aria-describedby')).toBeNull();
  });

  it('카드: 가끔 제품은 기록된 날 수를 「n회」로 센다 — 오늘 것만 세면 안 된다', () => {
    // ⚠️ 오늘(8/29)이 아닌 날이 섞여 있다 — `usage[date]` 하나만 보는 구현은 여기서 죽는다.
    setup([p({ name: '팩', frequency: 'occasional' })], {
      usage: { '2026-08-10': ['p1'], '2026-08-20': ['p1', 'p2'], '2026-08-25': ['p2'], '2026-08-28': [] },
    });

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('회')).toBeTruthy();
    // 「n일째」는 매일 쓴다는 전제의 숫자라 이 카드에는 서면 안 된다.
    expect(screen.queryByText('일째')).toBeNull();
    expect(screen.getByText('가끔')).toBeTruthy();
  });

  it('카드: 기록이 0건이면 「0회」다 — 아직 기록이 없다는 사실 그대로다', () => {
    setup([p({ name: '팩', frequency: 'occasional' })]);

    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('회')).toBeTruthy();
  });

  it('카드: 종료된 가끔 제품도 「n회」다 — 로그가 안 늘어 자연히 자라지 않는다', () => {
    setup([p({ name: '팩', frequency: 'occasional', endDate: '2026-08-20' })], {
      usage: { '2026-08-10': ['p1'], '2026-08-19': ['p1'] },
    });

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('회')).toBeTruthy();
    expect(screen.queryByText('일째')).toBeNull();
  });

  it('카드: 매일 제품과 필드 없는 옛 제품은 0 변경이다 — 「n일째」 그대로', () => {
    setup([p({ name: '로션', frequency: 'daily' }), p({ id: 'p2', name: '토너' })], {
      usage: { '2026-08-10': ['p1', 'p2'] },
    });

    // 8/01 시작, 오늘 8/29 → 29일째. 둘 다 같은 숫자라 하나면 족하다.
    expect(screen.getAllByText('29')).toHaveLength(2);
    expect(screen.getAllByText('일째')).toHaveLength(2);
    expect(screen.queryByText('회')).toBeNull();
    expect(screen.queryByText('가끔')).toBeNull();
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
    itemName: '데이셀디아트셀루미너스커버선크림',
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

  it('메타 줄 순서는 카테고리 → 업소명 → 기능성 → SPF/PA다', () => {
    // 설계 §3-3. 카테고리가 제일 왼쪽에 서야 「무슨 종류인가」가 먼저 읽힌다.
    setup([p({ category: 'sunscreen', mfds: meta() })]);
    const text = within(screen.getByTestId('section-active')).getByText('선크림').parentElement?.textContent ?? '';
    const order = ['선크림', '데이셀코스메틱(주)', '미백', 'SPF50+ PA++++'].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('「제품 추가」 버튼은 늘 0개 또는 1개다', () => {
  it('제품이 있으면 제목 줄의 글자 버튼 하나다', () => {
    setup([p()]);
    const all = screen.getAllByRole('button', { name: '제품 추가' });
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toBe('추가');
  });

  it('비어 있으면 빈 상태 블록의 큰 버튼 하나다 — 첫 사용자가 놓칠 수 없어야 한다', () => {
    setup();
    const all = screen.getAllByRole('button', { name: '제품 추가' });
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toBe('제품 추가');
  });

  it('폼이 열리면 없다 — 둘을 동시에 열 수 없다', () => {
    setup([p()]);
    fireEvent.click(btn('제품 추가'));
    expect(screen.queryByRole('button', { name: '제품 추가' })).toBeNull();
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

describe('카드 — 읽는 카드', () => {
  it('카드 안의 버튼은 카드 자체 하나뿐이고, 누르면 수정 폼이 열린다', () => {
    // 메인 페이지에 카드마다 버튼 셋이 깔리면 목록이 아니라 조작판으로 읽힌다(v4-1 §3-3).
    setup([p()]);
    expect(within(screen.getByTestId('section-active')).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(btn('토너 수정'));

    expect(screen.getByLabelText('제품 이름')).toBeTruthy();
  });

  it('카드 이름은 「수정」 한 마디지만, 며칠째·이름·칩은 설명으로 읽힌다 — aria-label이 내용을 삼키지 않게', () => {
    setup([p({ startDate: '2026-08-01' })]);
    const card = btn('토너 수정');
    const described = (card.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('29');
    expect(described).toContain('일째');
    expect(described).toContain('토너');
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

describe('오늘까지 쓰고 종료 — 폼 안에 산다', () => {
  it('종료일을 오늘로 넣고 폼을 닫는다 — 오늘까지 쓴 것으로 센다', () => {
    // 어제로 넣으면 오늘 찍은 사진에 그 제품이 안 붙는다. 경계 하루가 구간 바를 어긋나게 한다.
    const { onChange } = setup([p()]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.click(btn('토너 종료'));

    expect(onChange.mock.calls[0][0][0].endDate).toBe(TODAY);
    expect(screen.queryByLabelText('제품 이름')).toBeNull();
  });

  it('이미 종료한 제품의 폼에는 그 버튼이 없다 — 삭제는 있다', () => {
    setup([p({ endDate: '2026-08-10' })]);
    fireEvent.click(btn('토너 수정'));

    expect(screen.queryByRole('button', { name: '토너 종료' })).toBeNull();
    expect(btn('토너 삭제')).toBeTruthy();
  });

  it('추가 폼에는 종료·삭제가 없다 — 아직 없는 제품이다', () => {
    setup([p()]);
    fireEvent.click(btn('제품 추가'));

    expect(screen.queryByRole('button', { name: /종료$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /삭제$/ })).toBeNull();
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
    itemName: '데이셀디아트셀루미너스커버선크림',
    entpName: '데이셀코스메틱(주)',
    effects: ['자외선차단'],
    spf: '50+',
    pa: '++++',
    fetchedAt: '2026-08-29',
    ...over,
  });

  /** 제안의 품목명과 스냅샷의 원본 이름은 **같은 값이다** — 판정 기준이 여기서 갈린다. */
  const suggestion = (itemName: string, over: Partial<MfdsSnapshot> = {}): Suggestion => ({ itemName, snapshot: snap({ itemName, ...over }) });

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

  it('placeholder 예시가 검색 축을 가르친다 — 「브랜드 제품명」으로 쳐 보라는 시범이다', () => {
    /*
      v2-3 §3-7. 예시 자체가 가르침이다 — 옛 문구(「예: 수분 토너 (제품명으로 검색돼요)」)는
      브랜드 0건을 전제한 기대치 설계였고, 하필 예시 「수분 토너」가 공백 쿼리라 당시 구현에서
      정작 0건이 나는 자기모순이었다.
    */
    openForm();
    expect((screen.getByLabelText('제품 이름') as HTMLInputElement).placeholder).toBe('예: 토리든 다이브인 세럼');
  });

  it('placeholder에 약속 문장을 쓰지 않는다 — 하우스 브랜드는 여전히 0건일 수 있다', () => {
    // 「브랜드로 검색돼요」는 실제로 거짓이 되는 케이스가 있다(설화수→(주)아모레퍼시픽, §2-5).
    openForm();
    const { placeholder } = screen.getByLabelText('제품 이름') as HTMLInputElement;
    for (const promise of ['검색돼요', '찾아드', '검색됩니다']) expect(placeholder.includes(promise), promise).toBe(false);
  });

  it('브랜드+제품명으로 찾아 고르고 브랜드로 줄여 써도 스냅샷이 남는다 — v2-3의 통합 경로', async () => {
    /*
      ⚠️ 여기만 실제 `keepsSnapshot`을 탄다(네트워크만 목이다). 검색이 브랜드로 되기 시작하면
      「토리든 세럼」식 줄여 쓰기가 흔해지는데, 유지 판정이 업소명을 안 보면 고른 직후
      이름을 다듬는 순간 뱃지가 조용히 떨어진다(§3-3).
    */
    const toriden = suggestion('다이브인저분자히알루론산수분버블세럼', { entpName: '(주)토리든' });
    searchProducts.mockResolvedValue([toriden]);
    const { onChange } = openForm();

    type('토리든 다이브인 세럼');
    await settle();
    expect(searchProducts.mock.calls[0][0]).toBe('토리든 다이브인 세럼');

    fireEvent.click(screen.getByRole('button', { name: /다이브인저분자히알루론산수분버블세럼/ }));
    type('토리든 세럼');
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].name).toBe('토리든 세럼');
    expect(onChange.mock.calls[0][0][0].mfds).toEqual(toriden.snapshot);
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

    expect(onChange.mock.calls[0][0][0].mfds).toEqual(snap({ itemName: '선크림하나' }));
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

  it('고른 뒤 다른 제품 이름으로 갈아치우면 스냅샷을 떨군다 — 남의 뱃지가 서면 안 된다', async () => {
    /*
      ⚠️ 규제 민감축이다(§3-2·§3-4). 브랜드 검색은 0건이 정상이라 새 제안이 안 떠 **덮어쓸
      기회가 없다** — 무조건 유지하면 A의 업소명·기능성 뱃지가 B 카드에 조용히 남는다.
    */
    searchProducts.mockResolvedValue([suggestion('데이셀디아트셀루미너스커버선크림')]);
    const { onChange } = openForm();
    type('선크림');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /데이셀디아트셀루미너스커버선크림/ }));

    type('나이아드 세럼');
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].name).toBe('나이아드 세럼');
    expect(onChange.mock.calls[0][0][0].mfds).toBeUndefined();
  });

  it('수정 폼에서 기존 제품 이름을 갈아치워도 스냅샷을 떨군다 — 판정 기준이 스냅샷에 남아 있다', async () => {
    // 폼 state가 아니라 `mfds.itemName`을 보기 때문에 **나중 수정 세션에도** 판정이 선다(§3-3).
    const { onChange } = setup([p({ name: '데이셀 선크림', mfds: snap() })]);
    fireEvent.click(btn('데이셀 선크림 수정'));

    type('나이아드 세럼');
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].mfds).toBeUndefined();
    // 저장소를 왕복해도 수기 제품이어야 한다.
    expect(JSON.parse(JSON.stringify(onChange.mock.calls[0][0]))[0]).not.toHaveProperty('mfds');
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

  it('이름을 안 건드리고 수정하면 원래 스냅샷은 그대로 간다', async () => {
    const { onChange } = setup([p({ name: '데이셀 선크림', mfds: snap() })]);
    fireEvent.click(btn('데이셀 선크림 수정'));

    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-08-05' } });
    fireEvent.click(btn('저장'));

    expect(onChange.mock.calls[0][0][0].mfds).toEqual(snap());
  });
});

describe('제품 삭제', () => {
  it('한 번 묻고 지운다 — 되돌릴 수 없다', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = setup([p({ id: 'a' }), p({ id: 'b', name: '세럼' })]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.click(btn('토너 삭제'));

    expect(ask).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].map((x: Product) => x.id)).toEqual(['b']);
  });

  it('아니라고 하면 그대로 둔다', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onChange } = setup([p()]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.click(btn('토너 삭제'));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('날짜는 오늘까지다 — 미래는 기록이 아니다', () => {
  it('시작일 칸은 오늘까지만 고를 수 있다', () => {
    setup();
    fireEvent.click(btn('제품 추가'));
    expect(screen.getByLabelText('시작일').getAttribute('max')).toBe(TODAY);
  });

  it('종료일 칸은 시작일부터 오늘까지다', () => {
    setup([p({ startDate: '2026-08-01' })]);
    fireEvent.click(btn('토너 수정'));
    const end = screen.getByLabelText('종료일');
    expect(end.getAttribute('min')).toBe('2026-08-01');
    expect(end.getAttribute('max')).toBe(TODAY);
  });

  it('시작일이 미래면 저장할 수 없다 — 카드에 「-6일째」가 서던 구멍', () => {
    setup();
    fireEvent.click(btn('제품 추가'));
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '수분크림' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-09-04' } });
    expect(btn('저장').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: TODAY } });
    expect(btn('저장').disabled).toBe(false);
  });

  it('종료일이 시작일보다 앞이거나 미래면 저장할 수 없다', () => {
    setup([p({ startDate: '2026-08-01' })]);
    fireEvent.click(btn('토너 수정'));
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-07-31' } });
    expect(btn('저장').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-04' } });
    expect(btn('저장').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-08-10' } });
    expect(btn('저장').disabled).toBe(false);
  });

  it('시작일을 비우면 저장할 수 없다 — 빈 날짜는 저장소가 다시 읽을 때 조용히 버린다', () => {
    setup();
    fireEvent.click(btn('제품 추가'));
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '수분크림' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '' } });
    expect(btn('저장').disabled).toBe(true);
  });
});
