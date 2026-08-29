import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import basic from './__fixtures__/mfds-basic.json';
import brand from './__fixtures__/mfds-brand.json';
import divein from './__fixtures__/mfds-divein.json';
import sunLast from './__fixtures__/mfds-sun-last.json';
import toner from './__fixtures__/mfds-toner.json';
import { keepsSnapshot, MFDS_ENDPOINT, parseItems, searchProducts } from './mfds';

/**
 * 식약처 보고품목 응답 파서(설계 §4-1).
 *
 * 입력은 **태스크 1의 실응답 픽스처**다 — 손으로 지어낸 모양으로 잠그면 실제 봉투가
 * 달라졌을 때 아무도 못 잡는다(`__fixtures__/`는 실키로 받은 원본 그대로다).
 *
 * 여기서 잠그는 것 넷: **0건이면 `items` 키 자체가 없고 그건 에러가 아니라 정상이다**
 * (실측 §2-3 — 에러로 처리하면 무음 폴백이 붕괴한다) · **기능성 구분의 실소스는
 * `EE_DOC_DATA` 고시 문구다**(`EFFECT_YN`·`EE_NAME`은 죽어 있다) · **PA는 숫자로 온다**
 * ("4" = PA++++) · **취하된 보고는 제안에 안 세운다.**
 */
/**
 * ⚠️ **오늘일 수 없는 날짜여야 한다.** 실행일과 같은 값을 쓰면 `fetchedAt` 주입을 통째로
 * 무시하는 돌연변이가 그날 하루 살아남는다(`storage.ts`의 `todayKey` 함정과 같은 종류 —
 * 실제로 리뷰에서 이 파일이 그 구멍으로 걸렸다).
 */
const FETCHED = '2020-01-01';

/**
 * 실물 `EE_DOC_DATA` 모양(§2-3). **래핑은 고정이 아니다** — 같은 DOC 포맷이라도 문구가
 * CDATA에 실리기도, `ARTICLE` 속성에 평문으로 실리기도 한다. 그래서 파서는 XML을 안 읽고
 * 필드 전체 문자열을 훑는다. 여기서 지어낸 모양으로 재면 그 근거가 테스트에서 사라진다.
 */
const eeDoc = (...lines: string[]) =>
  `\n \n <DOC title="효능효과" type="EE">\n <SECTION title="">\n<ARTICLE title="">\n${lines
    .map((l) => `<PARAGRAPH tagName="p" textIndent="0" marginLeft="0"><![CDATA[${l}]]></PARAGRAPH>`)
    .join('\n')}\n  </ARTICLE>\n </SECTION>\n</DOC>\n`;

/** 픽스처 한 건을 복제해 필드만 갈아 끼운다 — 봉투는 실제 모양 그대로 둔다. */
function envelope(...items: Record<string, unknown>[]) {
  const sample = (basic as { body: { items: Record<string, unknown>[] } }).body.items[0];
  return { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { pageNo: 1, totalCount: items.length, numOfRows: 10, items: items.map((o) => ({ ...sample, ...o })) } };
}

describe('parseItems — 봉투 방어', () => {
  it('실응답 1건을 제안으로 바꾼다', () => {
    const got = parseItems(basic, FETCHED);

    expect(got).toHaveLength(1);
    expect(got[0].itemName).toBe('더마바이탈나노펩타이드토너');
    // 원본 품목명은 스냅샷에도 박제한다 — 나중 수정 세션에서 「줄여 쓰기냐 갈아치우기냐」를
    // 가릴 기준이 폼 state에만 있으면 그때는 이미 사라지고 없다(§3-3).
    expect(got[0].snapshot.itemName).toBe('더마바이탈나노펩타이드토너');
    expect(got[0].snapshot.entpName).toBe('(주)피코바이오');
    expect(got[0].snapshot.reportSeq).toBe('2008000083');
    expect(got[0].snapshot.fetchedAt).toBe(FETCHED);
  });

  it('0건이면 items 키 자체가 없다 — 에러가 아니라 정상 0건이다', () => {
    // ⚠️ 실측 봉투다(브랜드명 검색은 0건이 정상 — §3-2). 여기서 던지면 무음 폴백이 무너진다.
    expect(brand).not.toHaveProperty('body.items');
    expect(() => parseItems(brand, FETCHED)).not.toThrow();
    expect(parseItems(brand, FETCHED)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['문자열', 'boom'],
    ['body 없음', { header: { resultCode: '00' } }],
    ['items가 배열이 아님', { body: { items: { ITEM_NAME: '토너' } } }],
    ['배열이 통째로', [{ ITEM_NAME: '토너' }]],
  ])('봉투가 %s이면 빈 목록이다 — 던지지 않는다', (_label, json) => {
    expect(parseItems(json, FETCHED)).toEqual([]);
  });

  it('ITEM_NAME 없는 항목만 건너뛴다 — 나머지는 산다', () => {
    const got = parseItems(envelope({ ITEM_NAME: null }, { ITEM_NAME: '   ' }, { ITEM_NAME: '멀쩡한토너' }), FETCHED);

    expect(got.map((s) => s.itemName)).toEqual(['멀쩡한토너']);
  });

  it('취하된 보고는 제안에서 뺀다 — 취하를 최신 정보처럼 보여 주는 게 유일한 리스크다', () => {
    const got = parseItems(envelope({ ITEM_NAME: '취하된것', CANCEL_APPROVAL_YN: 'Y' }, { ITEM_NAME: '살아있는것', CANCEL_APPROVAL_YN: 'N' }), FETCHED);

    expect(got.map((s) => s.itemName)).toEqual(['살아있는것']);
  });
});

describe('parseItems — 기능성 구분(effects)', () => {
  it('EE_DOC_DATA 고시 문구에서 3종을 다 잡는다 — 실측 최근 레코드', () => {
    // ⚠️ 실소스가 여기다. `EFFECT_YN1~3`은 이 레코드에서 전부 null이라 그걸 믿으면 0종이 된다.
    const [got] = parseItems(sunLast, FETCHED);

    expect(got.snapshot.effects).toEqual(['미백', '주름개선', '자외선차단']);
  });

  it('EE_DOC_DATA가 null인 옛 레코드는 신호가 없으면 빈 목록이다', () => {
    expect(parseItems(basic, FETCHED)[0].snapshot.effects).toEqual([]);
  });

  /**
   * ⚠️ **「EE_NAME 사망」은 표본 편향이었다**(v2-3 리뷰 실측 — v2-2 설계 §4-1 추기).
   * 「다이브인」 픽스처에서 두 필드는 **상보적**이다: `EE_NAME`이 채워진 8/17건은
   * `EE_DOC_DATA`가 null이고 그 반대도 같다. 원문도 같은 고시 정형문이라 같은 감지에
   * OR로 태운다 — 안 태우면 그 8건의 뱃지가 통째로 빈다(하필 「토리든 다이브인 세럼」의
   * 1·2순위 제안이 여기 해당한다).
   */
  it('EE_DOC_DATA가 null이어도 EE_NAME 고시 문구에서 잡는다 — 두 필드는 상보적이다', () => {
    const items = parseItems(divein, FETCHED);
    const serum = items.find((s) => s.itemName === '다이브인저분자히알루론산수분버블세럼');

    // SPF·PA도 null인 레코드다 — 자외선 신호에 업혀 통과할 수 없다.
    expect(serum?.snapshot).not.toHaveProperty('spf');
    expect(serum?.snapshot.effects).toEqual(['미백', '주름개선']);
    // 한 종만 실린 레코드는 한 종만 — 뭉쳐서 붙이지 않는다.
    expect(items.find((s) => s.itemName === '다이브인포맨저분자히알루론산올인원')?.snapshot.effects).toEqual(['주름개선']);
  });

  it('EE_NAME이 null이면 EE_DOC_DATA 쪽 거동은 그대로다 — 상보의 반대편', () => {
    const sun = parseItems(divein, FETCHED).find((s) => s.itemName === '다이브인워터리핏선세럼');

    expect(sun?.snapshot.effects).toEqual(['자외선차단']);
  });

  it('EE_DOC_DATA가 null이어도 SPF가 있으면 자외선차단이다 — 어느 한쪽만 믿으면 구멍이 난다', () => {
    const [got] = parseItems(envelope({ EE_DOC_DATA: null, SPF: '30', PA: null }), FETCHED);

    expect(got.snapshot.effects).toEqual(['자외선차단']);
  });

  it('EE_DOC_DATA가 null이어도 PA가 있으면 자외선차단이다', () => {
    const [got] = parseItems(envelope({ EE_DOC_DATA: null, SPF: null, PA: '4' }), FETCHED);

    expect(got.snapshot.effects).toEqual(['자외선차단']);
  });

  it('문구에 자외선만 있고 SPF·PA가 없어도 자외선차단이다', () => {
    const [got] = parseItems(envelope({ EE_DOC_DATA: eeDoc('자외선으로부터 피부를 보호한다.'), SPF: null, PA: null }), FETCHED);

    expect(got.snapshot.effects).toEqual(['자외선차단']);
  });

  it('미백·주름개선을 각각 따로 잡는다 — 뭉쳐서 붙이지 않는다', () => {
    const white = parseItems(envelope({ EE_DOC_DATA: eeDoc('피부의 미백에 도움을 준다.') }), FETCHED);
    const wrinkle = parseItems(envelope({ EE_DOC_DATA: eeDoc('피부의 주름개선에 도움을 준다.') }), FETCHED);

    expect(white[0].snapshot.effects).toEqual(['미백']);
    expect(wrinkle[0].snapshot.effects).toEqual(['주름개선']);
  });
});

describe('parseItems — SPF · PA 표기', () => {
  it('SPF는 원문 그대로 둔다 — 카드가 접두어를 붙인다', () => {
    expect(parseItems(sunLast, FETCHED)[0].snapshot.spf).toBe('50+');
  });

  it('PA 숫자는 그 수만큼의 +로 편다 — 실측은 "4"로 온다', () => {
    // ⚠️ 경계다. `repeat(n-1)`이면 PA+++가 되어 화면이 등급을 한 칸 낮춰 말한다.
    expect(parseItems(sunLast, FETCHED)[0].snapshot.pa).toBe('++++');
    expect(parseItems(envelope({ PA: '1' }), FETCHED)[0].snapshot.pa).toBe('+');
    expect(parseItems(envelope({ PA: '2' }), FETCHED)[0].snapshot.pa).toBe('++');
  });

  it('이미 +로 온 값은 그대로 둔다', () => {
    expect(parseItems(envelope({ PA: '+++' }), FETCHED)[0].snapshot.pa).toBe('+++');
  });

  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['엉뚱한 값', '알 수 없음'],
    ['범위 밖 숫자', '9'],
  ])('PA가 %s이면 필드 자체가 없다 — 화면에 빈 칩이 서면 안 된다', (_label, pa) => {
    expect(parseItems(envelope({ PA: pa }), FETCHED)[0].snapshot).not.toHaveProperty('pa');
  });

  it('SPF 없는 옛 레코드는 필드 자체가 없다', () => {
    expect(parseItems(toner, FETCHED)[0].snapshot).not.toHaveProperty('spf');
    expect(parseItems(toner, FETCHED)).toHaveLength(2);
  });
});

/**
 * 이름을 고쳤을 때 스냅샷을 그대로 둬도 되는가(설계 §3-2 — 리뷰 반영).
 *
 * **줄여 쓰기는 살고 갈아치우기는 죽는다.** 무조건 유지하면 실수로 고른 제품 A 위에 전혀
 * 다른 이름 B를 타이핑해도(브랜드 검색은 0건이 정상이라 새 제안이 안 떠 덮어쓸 기회가 없다)
 * A의 업소명·기능성 뱃지가 B 카드에 선다 — §3-4가 규제 민감으로 지목한 표시축이다.
 */
describe('keepsSnapshot — 이름 수정 시 스냅샷 유지 판정', () => {
  const ORIGIN = '데이셀디아트셀루미너스커버선크림';
  /** 판정 입력은 스냅샷 통째다(§3-3) — 업소명이 이미 박제돼 있어 대조 축이 하나 더 있다. */
  const origin = (itemName = ORIGIN, entpName = '데이셀코스메틱(주)') => ({ itemName, entpName });

  it.each([
    ['그대로', ORIGIN],
    ['줄여 쓰기 — 토큰이 다 원본 안에 있다', '데이셀 선크림'],
    ['앞부분만', '데이셀디아트'],
    ['토큰 순서가 뒤집혀도', '선크림 데이셀'],
    ['공백이 여러 칸이어도', '데이셀   선크림'],
  ])('%s이면 유지한다 — 품목명이 길어 다듬는 건 정상 사용이다', (_label, name) => {
    expect(keepsSnapshot(name, origin())).toBe(true);
  });

  it.each([
    ['다른 제품으로 갈아치움', '나이아드 세럼'],
    ['한 토큰만 남의 것이어도', '데이셀 세럼'],
    ['빈 이름', '   '],
  ])('%s이면 떨군다 — 남의 뱃지가 서면 안 된다', (_label, name) => {
    expect(keepsSnapshot(name, origin())).toBe(false);
  });

  it('원본의 공백과 대소문자는 무시한다 — 표기 차이로 정상 사용을 죽이면 안 된다', () => {
    /*
      ⚠️ **토큰이 원본의 공백을 가로지르는 예로 재야 한다.** 공백을 안 지워도 통과하는 예로
      재면 그 정규화가 죽어도 아무도 못 잡는다(실측으로 살아남아 고쳤다). 「띄어쓰기만 뺀
      이름」은 흔한 정상 사용인데, 원본 공백을 안 지우면 갈아치우기로 오판된다.
    */
    expect(keepsSnapshot('아쿠아토너', origin('아쿠아 토너 수분'))).toBe(true);
    expect(keepsSnapshot('CERA toner', origin('Cera Toner 수분'))).toBe(true);
  });

  /**
   * 브랜드 축 편입(§3-3). **브랜드 검색이 생기는 순간 「토리든 세럼」식 줄여 쓰기가 흔한
   * 패턴이 된다** — 브랜드 토큰은 품목명에 없고 업소명에만 있어서, 업소명을 안 보면
   * 검색으로 고른 제품을 자기 말로 줄여 쓰는 순간 스냅샷이 떨어진다.
   */
  it('브랜드 토큰이 업소명에만 있어도 유지한다 — 「토리든 세럼」은 정상 줄여 쓰기다', () => {
    expect(keepsSnapshot('토리든 세럼', { itemName: '다이브인저분자히알루론산수분버블세럼', entpName: '(주)토리든' })).toBe(true);
  });

  it('법인 접두어는 안 벗긴다 — 부분문자열 대조가 「토리든」 ⊂ 「(주)토리든」을 이미 흡수한다', () => {
    expect(keepsSnapshot('토리든', { itemName: '다이브인선크림', entpName: '(주)토리든' })).toBe(true);
  });

  it('업소명 축이 붙어도 갈아치우기는 여전히 떨군다 — OR 확장은 유지 방향으로만 넓힌다', () => {
    expect(keepsSnapshot('나이아드 세럼', { itemName: '다이브인저분자히알루론산수분버블세럼', entpName: '(주)토리든' })).toBe(false);
  });

  it('필드 경계를 가로지르는 토큰은 불매치다 — 필드별 OR이지 이어 붙인 한 문자열이 아니다', () => {
    /*
      ⚠️ 두 필드를 이어 붙여 대조하면(「수분세럼」+「주식회사코스메틱」) 경계에 걸친
      「세럼주식」 같은 우연 매치가 생긴다(§3-2). 그 오염은 화면에서 구별이 안 된다.
    */
    expect(keepsSnapshot('세럼주식', { itemName: '수분세럼', entpName: '주식회사코스메틱' })).toBe(false);
  });
});

/**
 * 검색 래퍼(설계 §3-2·§4-1).
 *
 * 여기서 잠그는 것 셋: **2요청 최신순**(기본 정렬이 2008년부터 오름차순이라 첫 페이지를
 * 그대로 쓰면 제안이 단종급 옛 제품으로 도배된다) · **0건이면 두 번째 요청을 안 부른다**
 * (쿼터는 유한하다) · **어떤 실패도 빈 목록이다**(던지면 등록 흐름이 검색 때문에 죽는다).
 *
 * ⚠️ `fetch`를 주입한다 — 실네트워크에 매달리면 테스트가 식약처 점검 시간에 빨개진다.
 */
const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;

/** 마지막 페이지 계산의 입력이 되는 봉투. 항목은 필요 없다(첫 요청은 totalCount만 본다). */
const count = (totalCount: number) => ok({ header: { resultCode: '00' }, body: { pageNo: 1, totalCount, numOfRows: 1 } });

function params(fetchFn: ReturnType<typeof vi.fn>, nth: number) {
  return new URL(fetchFn.mock.calls[nth][0] as string).searchParams;
}

describe('searchProducts', () => {
  const signal = new AbortController().signal;

  beforeEach(() => vi.stubEnv('VITE_MFDS_KEY', 'test-key'));
  afterEach(() => vi.unstubAllEnvs());

  it('두 번 부른다 — ①총 건수 ②마지막 페이지, 그리고 역순으로 준다', async () => {
    // ⚠️ 역순이 이 전략의 전부다. 빼면 자동완성이 2008년 레코드로 도배된다(실측 §2-3).
    const fetchFn = vi.fn().mockResolvedValueOnce(count(5948)).mockResolvedValueOnce(ok(toner));

    const got = await searchProducts('토너', signal, fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(params(fetchFn, 0).get('numOfRows')).toBe('1');
    expect(params(fetchFn, 1).get('numOfRows')).toBe('10');
    // 5948건 / 10 = 595페이지째가 마지막이다.
    expect(params(fetchFn, 1).get('pageNo')).toBe('595');
    expect(got.map((s) => s.itemName)).toEqual(['비오데팡스엑스퍼트슈퍼화이트닝토너', '더마바이탈나노펩타이드토너']);
    /*
      ⚠️ 프로덕션 경로는 `parseItems(last)` — **`fetchedAt` 기본 인자를 타는 유일한 자리다.**
      파서 테스트는 전부 날짜를 주입해서 재기 때문에, 기본값이 `''`로 뭉개져도 아무도 못 잡는다
      (리뷰에서 실제로 그 돌연변이가 살아남았다). 여기서 형태만 잠근다.
    */
    expect(got[0].snapshot.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('잔여가 딱 떨어지지 않아도 마지막 페이지를 집는다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(4751)).mockResolvedValueOnce(ok(sunLast));

    await searchProducts('선크림', signal, fetchFn as unknown as typeof fetch);

    // 4751건 → 476페이지째에 1건이 남는다(제안이 1~10건 사이에서 출렁이는 것은 수용 — §3-2).
    expect(params(fetchFn, 1).get('pageNo')).toBe('476');
  });

  it('검색어와 서비스키를 인코딩해 싣는다', async () => {
    // ⚠️ 발급받는 일반 인증키(Decoding)에는 `/`·`=`가 섞인다 — 날로 이으면 쿼리가 깨진다.
    vi.stubEnv('VITE_MFDS_KEY', 'a/b=c+d');
    const fetchFn = vi.fn().mockResolvedValue(count(0));

    // ⚠️ 단일 토큰 쿼리다 — 공백 쿼리는 앵커 사다리(§3-1)를 타 `item_name`이 앵커로 바뀐다.
    // 이 테스트가 재는 것은 인코딩이므로 검증 대상을 재지정한다(v2-3 §4-3 예외 1건).
    await searchProducts('수분토너', signal, fetchFn as unknown as typeof fetch);

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url.startsWith(`${MFDS_ENDPOINT}?`)).toBe(true);
    expect(url).toContain('serviceKey=a%2Fb%3Dc%2Bd');
    expect(params(fetchFn, 0).get('item_name')).toBe('수분토너');
    // JSON으로 달라고 해야 한다 — 기본은 XML이고 그러면 파서가 아무것도 못 읽는다.
    expect(params(fetchFn, 0).get('type')).toBe('json');
  });

  it('0건이면 두 번째 요청을 안 부른다 — 쿼터는 유한하다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(brand));

    expect(await searchProducts('토리든', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('키가 없으면 fetch를 아예 안 부른다 — 키 없는 개발 환경·CI에서 앱은 v1처럼 돈다', async () => {
    vi.stubEnv('VITE_MFDS_KEY', '');
    const fetchFn = vi.fn();

    expect(await searchProducts('토너', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('취소 신호를 그대로 fetch에 넘긴다 — 늦게 온 응답이 새 검색을 덮으면 안 된다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(20)).mockResolvedValueOnce(ok(toner));

    await searchProducts('토너', signal, fetchFn as unknown as typeof fetch);

    expect(fetchFn.mock.calls[0][1].signal).toBe(signal);
    expect(fetchFn.mock.calls[1][1].signal).toBe(signal);
  });

  it.each([
    ['네트워크 실패', () => vi.fn().mockRejectedValue(new TypeError('offline'))],
    ['취소', () => vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
    ['JSON이 아님', () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('nope'); } })],
  ])('%s이면 조용히 빈 목록이다 — 에러 UI를 만들지 않는다', async (_label, make) => {
    const fetchFn = make();

    await expect(searchProducts('토너', signal, fetchFn as unknown as typeof fetch)).resolves.toEqual([]);
  });

  it('비200이면 본문이 멀쩡해 보여도 빈 목록이다', async () => {
    /*
      ⚠️ **본문을 정상 봉투로 둔다.** 「빈 응답을 주는 실패」로 재면 상태 코드를 안 보는
      돌연변이가 다른 가드(resultCode·totalCount)에 걸려 **죽은 척한다** — 실측으로 이 케이스가
      살아남아 고쳤다. 여기서는 상태 코드를 보는 것만이 유일한 방어선이어야 한다.
    */
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ header: { resultCode: '00' }, body: { totalCount: 20 } }) })
      .mockResolvedValueOnce(ok(toner));

    expect(await searchProducts('토너', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('resultCode가 00이 아니면 빈 목록이다 — 키 오류·쿼터 초과도 200으로 온다', async () => {
    // 같은 이유로 본문을 정상 형태로 채운다. 200 + 에러 코드가 이 게이트웨이의 실제 실패 모양이다.
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(ok({ header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' }, body: { totalCount: 20 } }))
      .mockResolvedValueOnce(ok(toner));

    expect(await searchProducts('토너', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('두 번째 요청이 실패해도 조용히 빈 목록이다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(20)).mockRejectedValueOnce(new TypeError('offline'));

    await expect(searchProducts('토너', signal, fetchFn as unknown as typeof fetch)).resolves.toEqual([]);
  });
});

/**
 * 다중 토큰 앵커 사다리(v2-3 §3-1).
 *
 * **`item_name` LIKE는 연속 부분문자열만 잡는다** — 보고 품목명엔 공백이 없어서
 * (「다이브인저분자히알루론산수분버블세럼」) 「토리든 다이브인 세럼」을 통째로 보내면
 * 구조적으로 0건이다(실측 §2-1). 그래서 **토큰 하나를 앵커로 골라** 보낸다.
 *
 * 여기서 잠그는 것 넷: **최장 토큰부터**(브랜드가 앞에 오는 한국어 쿼리에서 첫 토큰 고정은
 * 0건의 주범이다) · **1자 토큰은 앵커가 아니다**(20만 건 전집에서 앵커 가치가 없는데
 * 사다리를 거기서 멈춰 세운다) · **프로브 3회 상한**(토큰 폭탄 쿼리에 요청이 폭주한다) ·
 * **앵커는 원문 케이스 그대로 나간다**(API LIKE의 영문 대소문자 감도는 미실측이다 — 소문자화는
 * 클라 대조 안에서만 한다).
 */
describe('searchProducts — 앵커 사다리(다중 토큰)', () => {
  const signal = new AbortController().signal;

  beforeEach(() => vi.stubEnv('VITE_MFDS_KEY', 'test-key'));
  afterEach(() => vi.unstubAllEnvs());

  const names = (fetchFn: ReturnType<typeof vi.fn>) => fetchFn.mock.calls.map((_c, i) => params(fetchFn, i).get('item_name'));

  it('최장 토큰을 첫 앵커로 보낸다 — 긴 토큰일수록 매치가 적어 앵커가 강하다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(17)).mockResolvedValueOnce(ok(divein));

    await searchProducts('토리든 다이브인 세럼', signal, fetchFn as unknown as typeof fetch);

    // 「세럼」(수만 건)도 「토리든」(0건)도 아닌 「다이브인」(17건)이 앵커다.
    expect(params(fetchFn, 0).get('item_name')).toBe('다이브인');
  });

  it('앵커가 0건이면 다음 토큰으로 다시 프로브한다 — 길이 내림차순으로 사다리를 탄다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(0)).mockResolvedValueOnce(count(0)).mockResolvedValueOnce(count(2)).mockResolvedValueOnce(ok(toner));

    await searchProducts('토리든 다이브인 세럼', signal, fetchFn as unknown as typeof fetch);

    expect(names(fetchFn).slice(0, 3)).toEqual(['다이브인', '토리든', '세럼']);
  });

  it('1자 토큰은 앵커 후보에서 뺀다 — 광역 프로브가 사다리를 조기 종료시킨다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(count(0));

    await searchProducts('토리든 다 세럼', signal, fetchFn as unknown as typeof fetch);

    expect(names(fetchFn)).toEqual(['토리든', '세럼']);
  });

  it('앵커 후보가 전부 1자면 요청 자체를 안 한다', async () => {
    const fetchFn = vi.fn();

    expect(await searchProducts('가 나', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('사다리는 3회에서 멈춘다 — 토큰이 많아도 요청이 폭주하면 안 된다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(count(0));

    const got = await searchProducts('토리든 다이브인 저분자 수분 세럼', signal, fetchFn as unknown as typeof fetch);

    expect(names(fetchFn)).toEqual(['다이브인', '토리든', '저분자']);
    // 사다리 전멸은 무음 []다 — 실패를 알리지 않는다(§3-1).
    expect(got).toEqual([]);
  });

  it('0건인 앵커에는 본문 요청을 안 붙인다 — 쿼터는 유한하다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(0)).mockResolvedValueOnce(count(17)).mockResolvedValueOnce(ok(divein));

    await searchProducts('토리든 다이브인', signal, fetchFn as unknown as typeof fetch);

    // 프로브(다이브인 0건) → 프로브(토리든) → 본문. 0건 앵커에 본문이 붙으면 4회가 된다.
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(params(fetchFn, 0).get('numOfRows')).toBe('1');
    expect(params(fetchFn, 1).get('numOfRows')).toBe('1');
  });

  it('앵커는 원문 케이스 그대로 나간다 — 소문자화는 클라 대조 안에서만 한다', async () => {
    // API LIKE의 영문 대소문자 감도는 미실측이다. 낮춰 보내면 잡히던 것이 조용히 0건이 될 수 있다.
    const fetchFn = vi.fn().mockResolvedValue(count(0));

    await searchProducts('CERA Toner', signal, fetchFn as unknown as typeof fetch);

    expect(names(fetchFn)).toEqual(['Toner', 'CERA']);
  });

  it('사다리의 모든 요청에 같은 취소 신호를 물린다 — 도중에 취소되면 통째로 멈춘다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(0)).mockResolvedValueOnce(count(17)).mockResolvedValueOnce(ok(divein));

    await searchProducts('토리든 다이브인', signal, fetchFn as unknown as typeof fetch);

    for (const call of fetchFn.mock.calls) expect(call[1].signal).toBe(signal);
  });
});

/**
 * 창 이원화 · 클라 대조 · 폴백(v2-3 §3-2·§3-4·§3-5).
 *
 * 입력은 **「다이브인」 실응답 픽스처**(17건 — (주)토리든 다수 + 코스모빈(주)·주식회사로리코
 * 소수)다. 브랜드 토큰이 품목명엔 없고 **업소명에만** 있는 실제 모양이라, 지어낸 봉투로
 * 재면 이 기능의 근거가 테스트에서 사라진다.
 *
 * 여기서 잠그는 것 넷: **T ≤ 30이면 전수 창**(창이 좁은데 필터까지 얹으면 생존 0이 잦다) ·
 * **대조는 품목명 OR 업소명**(브랜드 토큰은 업소명에만 있다 — 빠지면 기능 자체가 무효다) ·
 * **전수 창 생존 0이면 앵커 결과 그대로**(하우스 브랜드에서 필터가 검색을 현행보다 나쁘게
 * 만드는 유일한 경로다) · **광역 창 생존 0은 무음 []**(무관 제품 도배가 0건보다 나쁘다).
 */
describe('searchProducts — 창 이원화 · 대조 · 폴백', () => {
  const signal = new AbortController().signal;

  beforeEach(() => vi.stubEnv('VITE_MFDS_KEY', 'test-key'));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['앵커가 17건이면 전수', 17, '17', '1'],
    ['경계 — 30건도 전수다', 30, '30', '1'],
    ['31건부터는 광역 — 마지막 페이지', 31, '30', '2'],
    ['광역 100건의 마지막 페이지', 100, '30', '4'],
  ])('%s', async (_label, total, rows, pageNo) => {
    // ⚠️ 경계가 `T < 30`으로 밀리면 딱 30건짜리 앵커가 광역 취급돼 대조가 창 밖을 못 본다.
    const fetchFn = vi.fn().mockResolvedValueOnce(count(total)).mockResolvedValueOnce(ok(divein));

    await searchProducts('토리든 다이브인 세럼', signal, fetchFn as unknown as typeof fetch);

    expect(params(fetchFn, 1).get('numOfRows')).toBe(rows);
    expect(params(fetchFn, 1).get('pageNo')).toBe(pageNo);
  });

  it('「토리든 다이브인 세럼」이 토리든 세럼만 남긴다 — 브랜드 토큰은 업소명에서 맞는다', async () => {
    /*
      ⚠️ 이 한 줄이 v2-3의 전부다. 대조에서 업소명 OR가 빠지면 브랜드 토큰이 전멸시켜
      0건이 되고(기능 무효), 대조 자체가 없으면 코스모빈·로리코 제품이 섞인다.
    */
    const fetchFn = vi.fn().mockResolvedValueOnce(count(17)).mockResolvedValueOnce(ok(divein));

    const got = await searchProducts('토리든 다이브인 세럼', signal, fetchFn as unknown as typeof fetch);

    // 역순(최신부터)이다 — 안 뒤집으면 제안이 옛 레코드로 도배된다.
    expect(got.map((s) => s.itemName)).toEqual([
      '다이브인저분자히알루론산수분버블세럼',
      '다이브인프로저분자히알루론산글로우세럼',
      '다이브인워터리핏선세럼',
    ]);
    // 타사 제품(코스모빈(주)의 「…딥다이브인…세럼」, 주식회사로리코의 「레티0.5다이브인세럼」)은 빠진다.
    expect(got.every((s) => s.snapshot.entpName === '(주)토리든')).toBe(true);
  });

  it('전수 창에서 생존이 0이면 앵커 결과를 그대로 준다 — 필터가 검색을 나쁘게 만들면 안 된다', async () => {
    /*
      하우스 브랜드 시나리오(§3-5): 브랜드명≠법인명이면(설화수→(주)아모레퍼시픽) 브랜드
      토큰이 어디에도 안 맞아 대조가 전멸시킨다. 앵커 자체가 전집에서 ≤30건인 강한
      식별자이므로 앵커 결과가 곧 정답 후보다 — 제안 줄에 업소명이 보여 사용자가 판별한다.
    */
    const fetchFn = vi.fn().mockResolvedValueOnce(count(17)).mockResolvedValueOnce(ok(divein));

    const got = await searchProducts('설화수 다이브인', signal, fetchFn as unknown as typeof fetch);

    // 전수 창은 최대 30건이 온다 — 제안은 10건으로 자른다(UI 밀도).
    expect(got).toHaveLength(10);
    expect(got[0].itemName).toBe('다이브인저분자히알루론산수분버블세럼');
    // 폴백은 이미 받은 본문의 재사용이다 — 추가 요청 0.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('광역 창에서 생존이 0이면 무음 빈 목록이다 — 무관 제품 도배가 0건보다 나쁘다', async () => {
    // 광역 앵커의 최신 30건은 쿼리와 무관한 제품 도배다. 사용자 요구는 「내 제품이 뜨는 것」이다.
    const fetchFn = vi.fn().mockResolvedValueOnce(count(9000)).mockResolvedValueOnce(ok(divein));

    expect(await searchProducts('설화수 세럼', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
  });

  it.each([
    ['30건은 전수 창이라 폴백이 산다', 30, 10],
    ['31건부터 광역이라 무음이다', 31, 0],
  ])('경계 — %s', async (_label, total, len) => {
    /*
      ⚠️ **요청 파라미터로는 이 경계가 안 잡힌다** — T=30이면 전수(rows=30·pageNo=1)와
      광역(rows=30·마지막 페이지=1)이 같은 요청이라, 경계를 `T < 30`으로 미는 돌연변이가
      파라미터 테스트에서 살아남는다(실측으로 살아남아 이 케이스를 보탰다).
      경계가 실제로 갈리는 자리는 **생존 0의 처리**다.
    */
    const fetchFn = vi.fn().mockResolvedValueOnce(count(total)).mockResolvedValueOnce(ok(divein));

    expect(await searchProducts('설화수 다이브인', signal, fetchFn as unknown as typeof fetch)).toHaveLength(len);
  });

  it('대조 토큰도 소문자화한다 — 정규화는 keepsSnapshot과 같은 유틸 한 벌이다', async () => {
    /*
      ⚠️ **생존이 앵커 결과의 진부분집합이어야 판별이 선다.** 전멸시키는 예로 재면 전수 창
      폴백(§3-5)이 앵커 결과를 그대로 돌려줘 소문자화가 죽어도 통과한다(실측으로 이 함정을
      만나 케이스를 다시 짰다).
    */
    const body = envelope(
      { ITEM_NAME: '세라마이드수분토너', ENTP_NAME: '(주)테스트' },
      { ITEM_NAME: 'CERAMIDE세라마이드수분크림', ENTP_NAME: '(주)테스트' },
    );
    const fetchFn = vi.fn().mockResolvedValueOnce(count(2)).mockResolvedValueOnce(ok(body));

    const got = await searchProducts('세라마이드 CERA', signal, fetchFn as unknown as typeof fetch);

    expect(got.map((s) => s.itemName)).toEqual(['CERAMIDE세라마이드수분크림']);
  });

  it('본문이 실패하면 다음 앵커로 안 넘어가고 조용히 끝낸다 — 실패는 전 경로에서 []다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(count(17)).mockRejectedValueOnce(new TypeError('offline'));

    expect(await searchProducts('토리든 다이브인 세럼', signal, fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
