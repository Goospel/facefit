import { describe, expect, it } from 'vitest';

import { todayKey } from '../storage';
import { addMonth, formatYm, monthCells, monthOf } from './calendar';

/**
 * 달력 격자의 산수. **라이브러리 0** — 날짜 키가 전부 `YYYY-MM-DD` 문자열이라
 * 셀 ↔ 기록 ↔ 사진 대조가 문자열 비교 하나로 끝난다.
 *
 * 가장 비싼 실수는 **하루 밀림**이다. `Date`의 UTC 메서드와 로컬 메서드를 섞으면 월 경계에서
 * 앞 빈칸이 하나 어긋나는데, 그 달력은 **모든 날짜가 한 칸씩 옆에 그려진다** — 눈으로는
 * 「달력이 있다」로 보여서 통과한다. 그래서 앞 빈칸 수를 직접 잠근다.
 */
describe('monthCells', () => {
  it('2026-08은 앞 빈칸 6칸으로 시작한다 — 1일이 토요일이다', () => {
    const cells = monthCells({ year: 2026, month: 8 });
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe('2026-08-01');
  });

  it('말일까지 빠짐없이 낸다 — 31일 달', () => {
    const cells = monthCells({ year: 2026, month: 8 });
    expect(cells[cells.length - 1]).toBe('2026-08-31');
    expect(cells.filter((c) => c !== null)).toHaveLength(31);
  });

  it('2026-02는 28일이다', () => {
    const cells = monthCells({ year: 2026, month: 2 }).filter((c) => c !== null);
    expect(cells).toHaveLength(28);
    expect(cells[cells.length - 1]).toBe('2026-02-28');
  });

  it('2028-02는 29일이다 — 윤년', () => {
    const cells = monthCells({ year: 2028, month: 2 }).filter((c) => c !== null);
    expect(cells).toHaveLength(29);
    expect(cells[cells.length - 1]).toBe('2028-02-29');
  });

  it('1일이 일요일이면 빈칸이 없다 — 2026-03', () => {
    // 앞 빈칸을 상수로 박거나 오프셋을 하나 밀면 이 달이 먼저 깨진다.
    expect(monthCells({ year: 2026, month: 3 })[0]).toBe('2026-03-01');
  });

  it('한 자리 월·일도 두 자리로 채운다 — 기록 키와 문자열이 그대로 맞아야 한다', () => {
    expect(monthCells({ year: 2026, month: 1 })).toContain('2026-01-05');
  });

  it('오늘 키가 반드시 그 달 셀에 들어 있다 — `todayKey`와의 정합', () => {
    // UTC/로컬을 섞으면 월 경계의 오늘이 달력에서 사라진다. 실행하는 날마다 다시 잰다.
    expect(monthCells(monthOf(todayKey()))).toContain(todayKey());
  });
});

describe('monthOf', () => {
  it('날짜 키에서 그 달을 뽑는다', () => {
    expect(monthOf('2026-08-26')).toEqual({ year: 2026, month: 8 });
  });

  it('앞의 0을 숫자로 읽는다 — 8진수로 새지 않는다', () => {
    expect(monthOf('2026-09-01')).toEqual({ year: 2026, month: 9 });
  });
});

describe('addMonth', () => {
  it('그 해 안에서는 그냥 더한다', () => {
    expect(addMonth({ year: 2026, month: 8 }, 1)).toEqual({ year: 2026, month: 9 });
    expect(addMonth({ year: 2026, month: 8 }, -1)).toEqual({ year: 2026, month: 7 });
  });

  it('1월에서 뒤로 가면 작년 12월이다', () => {
    expect(addMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('12월에서 앞으로 가면 내년 1월이다', () => {
    expect(addMonth({ year: 2025, month: 12 }, 1)).toEqual({ year: 2026, month: 1 });
  });
});

describe('formatYm', () => {
  it('한국어 표기로 낸다', () => {
    expect(formatYm({ year: 2026, month: 8 })).toBe('2026년 8월');
  });

  it('월에 0을 채우지 않는다 — 「2026년 03월」은 달력 헤더 말투가 아니다', () => {
    expect(formatYm({ year: 2026, month: 3 })).toBe('2026년 3월');
  });
});
