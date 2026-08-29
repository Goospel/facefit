import { describe, expect, it } from 'vitest';

import type { Product } from '../storage';
import { BASE_FPS, barSegments, dateFrac, frameDelay } from './timelapse';

/**
 * 타임랩스의 순수 산수 — jsdom이 필요 없다. 화면은 여기서 나온 분율을 CSS `%`로 옮기기만 한다.
 *
 * 여기서 잠그는 것 셋: **재생 속도가 상수 하나에서 나온다**(실기기에서 조정할 자리) ·
 * **제품 구간이 [첫 사진, 마지막 사진] 안으로 클램프된다**(밖으로 새면 막대가 화면 밖으로
 * 자란다) · **겹치는 제품은 줄이 갈린다**(겹쳐 그리면 둘 다 못 읽는다).
 */
const p = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-01',
  ...over,
});

describe('frameDelay', () => {
  it(`기본은 ${BASE_FPS}fps다 — 한 달치가 5초쯤 된다`, () => {
    expect(frameDelay(1)).toBeCloseTo(1000 / BASE_FPS, 5);
  });

  it('2×는 딜레이가 절반이다', () => {
    expect(frameDelay(2)).toBeCloseTo(frameDelay(1) / 2, 5);
  });
});

describe('dateFrac', () => {
  const FIRST = '2026-08-01';
  const LAST = '2026-08-11'; // 10일 간격

  it('첫 사진 날짜는 0이다', () => {
    expect(dateFrac(FIRST, FIRST, LAST)).toBe(0);
  });

  it('마지막 사진 날짜는 1이다', () => {
    expect(dateFrac(LAST, FIRST, LAST)).toBe(1);
  });

  it('중간 날짜는 일수 비율 그대로다', () => {
    // 8/06은 5일째 — 10일 구간의 정확히 절반이다.
    expect(dateFrac('2026-08-06', FIRST, LAST)).toBeCloseTo(0.5, 10);
  });

  it('월을 넘겨도 일수로 센다 — 문자열 산수로 근사하지 않는다', () => {
    // 8/01 → 9/01은 31일. 8/16은 15일째다.
    expect(dateFrac('2026-08-16', '2026-08-01', '2026-09-01')).toBeCloseTo(15 / 31, 10);
  });

  it('범위 밖도 그대로 돌려준다 — 클램프는 쓰는 쪽이 정한다', () => {
    expect(dateFrac('2026-07-27', FIRST, LAST)).toBeCloseTo(-0.5, 10);
    expect(dateFrac('2026-08-16', FIRST, LAST)).toBeCloseTo(1.5, 10);
  });

  it('첫 사진과 마지막 사진이 같은 날이면 0이다 — 0으로 나누지 않는다', () => {
    // 사진 1장이면 화면이 재생 자체를 안 열지만, 여기서 NaN이 새면 막대 폭이 통째로 사라진다.
    expect(dateFrac(FIRST, FIRST, FIRST)).toBe(0);
  });
});

describe('barSegments', () => {
  const FIRST = '2026-08-01';
  const LAST = '2026-08-11';
  const seg = (products: Product[]) => barSegments(products, FIRST, LAST);

  it('구간 안 제품은 시작·끝 분율을 그대로 갖는다', () => {
    const [s] = seg([p({ startDate: '2026-08-03', endDate: '2026-08-08' })]);
    expect(s.startFrac).toBeCloseTo(0.2, 10);
    expect(s.endFrac).toBeCloseTo(0.7, 10);
    expect({ id: s.id, name: s.name, lane: s.lane }).toEqual({ id: 'p1', name: '토너', lane: 0 });
  });

  it('종료일이 없으면 마지막 사진까지 이어진다', () => {
    // 「사용 중」은 오늘까지가 아니라 **마지막 프레임까지**다 — 바의 오른쪽 끝이 마지막 사진이다.
    expect(seg([p({ startDate: '2026-08-06' })])[0].endFrac).toBe(1);
  });

  it('구간 밖으로 삐져나온 제품은 클램프한다 — 안 하면 막대가 화면 밖으로 자란다', () => {
    const [s] = seg([p({ startDate: '2026-07-01', endDate: '2026-09-01' })]);
    expect({ start: s.startFrac, end: s.endFrac }).toEqual({ start: 0, end: 1 });
  });

  it('구간보다 완전히 이전에 끝난 제품은 아예 안 그린다', () => {
    // 클램프만 하면 폭 0짜리 막대가 왼쪽 끝에 이름표를 달고 서 있게 된다.
    expect(seg([p({ startDate: '2026-06-01', endDate: '2026-07-01' })])).toEqual([]);
  });

  it('구간보다 완전히 이후에 시작한 제품도 안 그린다', () => {
    expect(seg([p({ startDate: '2026-09-01' })])).toEqual([]);
  });

  it('겹치는 제품은 줄을 나눈다 — 겹쳐 그리면 둘 다 못 읽는다', () => {
    const got = seg([
      p({ id: 'a', name: '토너', startDate: '2026-08-01', endDate: '2026-08-08' }),
      p({ id: 'b', name: '세럼', startDate: '2026-08-05', endDate: '2026-08-11' }),
    ]);
    expect(got.map((s) => [s.id, s.lane])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('안 겹치면 같은 줄을 다시 쓴다 — 제품이 늘어도 바가 세로로 자라지 않는다', () => {
    const got = seg([
      p({ id: 'a', startDate: '2026-08-01', endDate: '2026-08-03' }),
      p({ id: 'b', startDate: '2026-08-05', endDate: '2026-08-07' }),
      p({ id: 'c', startDate: '2026-08-09', endDate: '2026-08-11' }),
    ]);
    expect(got.map((s) => s.lane)).toEqual([0, 0, 0]);
  });

  it('세 개가 한꺼번에 겹치면 줄이 셋이다', () => {
    const got = seg([
      p({ id: 'a', startDate: '2026-08-01' }),
      p({ id: 'b', startDate: '2026-08-02' }),
      p({ id: 'c', startDate: '2026-08-03' }),
    ]);
    expect(got.map((s) => s.lane).sort()).toEqual([0, 1, 2]);
  });

  it('시작이 늦은 제품이 목록에서 앞에 있어도 줄 배정은 시작 순이다', () => {
    // 그리디는 정렬을 전제한다 — 안 하면 먼저 온 늦은 제품이 0번 줄을 먹고, 이른 제품이
    // 아래로 밀려 바가 시간순으로 안 읽힌다.
    const got = seg([
      p({ id: 'late', startDate: '2026-08-06' }),
      p({ id: 'early', startDate: '2026-08-01', endDate: '2026-08-11' }),
    ]);
    expect(got.find((s) => s.id === 'early')!.lane).toBe(0);
    expect(got.find((s) => s.id === 'late')!.lane).toBe(1);
  });

  it('제품이 없으면 빈 목록이다', () => {
    expect(seg([])).toEqual([]);
  });
});
