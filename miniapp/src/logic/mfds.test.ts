import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import basic from './__fixtures__/mfds-basic.json';
import brand from './__fixtures__/mfds-brand.json';
import sunLast from './__fixtures__/mfds-sun-last.json';
import toner from './__fixtures__/mfds-toner.json';
import { MFDS_ENDPOINT, parseItems, searchProducts } from './mfds';

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
const FETCHED = '2026-08-29';

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

  it('EE_DOC_DATA가 null이어도 SPF가 있으면 자외선차단이다 — 어느 한쪽만 믿으면 구멍이 난다', () => {
    const [got] = parseItems(envelope({ EE_DOC_DATA: null, SPF: '30', PA: null }), FETCHED);

    expect(got.snapshot.effects).toEqual(['자외선차단']);
  });

  it('EE_DOC_DATA가 null이어도 PA가 있으면 자외선차단이다', () => {
    const [got] = parseItems(envelope({ EE_DOC_DATA: null, SPF: null, PA: '4' }), FETCHED);

    expect(got.snapshot.effects).toEqual(['자외선차단']);
  });

  it('문구에 자외선만 있고 SPF·PA가 없어도 자외선차단이다', () => {
    const [got] = parseItems(envelope({ EE_DOC_DATA: '<![CDATA[자외선으로부터 피부를 보호한다.]]>', SPF: null, PA: null }), FETCHED);

    expect(got.snapshot.effects).toEqual(['자외선차단']);
  });

  it('미백·주름개선을 각각 따로 잡는다 — 뭉쳐서 붙이지 않는다', () => {
    const white = parseItems(envelope({ EE_DOC_DATA: '<![CDATA[피부의 미백에 도움을 준다.]]>' }), FETCHED);
    const wrinkle = parseItems(envelope({ EE_DOC_DATA: '<![CDATA[피부의 주름개선에 도움을 준다.]]>' }), FETCHED);

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

    await searchProducts('수분 토너', signal, fetchFn as unknown as typeof fetch);

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url.startsWith(`${MFDS_ENDPOINT}?`)).toBe(true);
    expect(url).toContain('serviceKey=a%2Fb%3Dc%2Bd');
    expect(params(fetchFn, 0).get('item_name')).toBe('수분 토너');
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
