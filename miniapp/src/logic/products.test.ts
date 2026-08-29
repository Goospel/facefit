import { describe, expect, it } from 'vitest';

import type { Product } from '../storage';
import { isActive, sortProducts } from './products';

/**
 * 제품의 순수 산수. 화면 없이 재는 것은 둘뿐이다 — **그날 쓰고 있었나**(구간 판정)와
 * **어떤 순서로 보여 줄까**(정렬).
 *
 * ⚠️ 날짜는 전부 `'YYYY-MM-DD'` 문자열이라 **비교가 문자열 비교 하나**로 끝난다.
 * `Date`로 파싱하면 시간대가 끼어들어 경계에서 하루가 밀린다.
 */
const p = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-10',
  ...over,
});

describe('isActive', () => {
  it('시작일 당일부터 쓰고 있는 것이다', () => {
    // 당일을 빼면 「오늘 등록하고 오늘 찍은 사진」에 그 제품이 안 붙는다 — 등록 동선이 바로 헛돈다.
    expect(isActive(p(), '2026-08-10')).toBe(true);
  });

  it('시작일 전날은 아니다', () => {
    expect(isActive(p(), '2026-08-09')).toBe(false);
  });

  it('종료일이 없으면 계속 쓰고 있는 것이다', () => {
    expect(isActive(p(), '2030-01-01')).toBe(true);
  });

  it('종료일 당일까지는 쓴 것이다 — 「오늘까지 쓰고 종료」가 오늘을 포함한다', () => {
    expect(isActive(p({ endDate: '2026-08-20' }), '2026-08-20')).toBe(true);
  });

  it('종료일 다음날부터는 아니다', () => {
    expect(isActive(p({ endDate: '2026-08-20' }), '2026-08-21')).toBe(false);
  });

  it('하루만 쓴 제품도 그날은 쓴 것이다', () => {
    expect(isActive(p({ startDate: '2026-08-10', endDate: '2026-08-10' }), '2026-08-10')).toBe(true);
  });
});

describe('sortProducts', () => {
  it('사용 중이 먼저, 그 안에서는 최근 시작한 것이 위다', () => {
    const list = [
      p({ id: 'old', startDate: '2026-01-01' }),
      p({ id: 'new', startDate: '2026-08-01' }),
      p({ id: 'mid', startDate: '2026-05-01' }),
    ];
    expect(sortProducts(list, '2026-08-29').map((x) => x.id)).toEqual(['new', 'mid', 'old']);
  });

  it('종료한 제품은 사용 중 아래로 내려간다 — 시작일이 더 최근이어도', () => {
    // 지금 뭘 쓰고 있는지가 이 목록에 오는 이유다. 시작일만으로 줄 세우면 끝난 제품이 위에 선다.
    const list = [
      p({ id: 'ended', startDate: '2026-08-20', endDate: '2026-08-25' }),
      p({ id: 'using', startDate: '2026-08-01' }),
    ];
    expect(sortProducts(list, '2026-08-29').map((x) => x.id)).toEqual(['using', 'ended']);
  });

  it('아직 시작 안 한 제품도 「사용 중」이 아니다 — 미래 시작일을 넣을 수 있다', () => {
    const list = [p({ id: 'future', startDate: '2026-12-01' }), p({ id: 'using', startDate: '2026-08-01' })];
    expect(sortProducts(list, '2026-08-29').map((x) => x.id)).toEqual(['using', 'future']);
  });

  it('원본 배열을 건드리지 않는다 — 화면 state를 제자리에서 뒤집으면 리렌더가 안 돈다', () => {
    const list = [p({ id: 'a', startDate: '2026-01-01' }), p({ id: 'b', startDate: '2026-08-01' })];
    sortProducts(list, '2026-08-29');
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
