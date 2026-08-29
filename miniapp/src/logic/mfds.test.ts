import { describe, expect, it } from 'vitest';

import basic from './__fixtures__/mfds-basic.json';
import brand from './__fixtures__/mfds-brand.json';
import sunLast from './__fixtures__/mfds-sun-last.json';
import toner from './__fixtures__/mfds-toner.json';
import { parseItems } from './mfds';

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
