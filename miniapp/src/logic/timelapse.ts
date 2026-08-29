import type { Product } from '../storage';
import { daysBetween } from './calendar';

/**
 * 타임랩스의 순수 산수 — 화면 없이 전부 잰다. 화면은 여기서 나온 분율을 CSS `%`로 옮기고
 * 딜레이를 `setTimeout`에 넣기만 한다.
 *
 * ⚠️ 날짜 산수는 `logic/calendar.ts`의 `daysBetween` 하나를 쓴다 — 그 파일이 **UTC 전용**
 * 규칙을 머리말로 들고 있고, 여기서 따로 짜면 그 규칙이 두 곳으로 갈린다.
 */

/**
 * 기본 재생 속도. 166ms/장이라 **한 달치가 5초, 1년치가 1분**이다.
 *
 * ⚠️ 이 숫자는 **실기기 체감으로 확정한다**(설계 §11) — 상수 하나라 바꾸는 비용이 0이고,
 * jsdom에서 재 봐야 「몇 ms인가」밖에 안 나온다. 여기 말고 다른 곳에 fps를 적지 않는다.
 */
export const BASE_FPS = 6;

/** 한 장을 보여 주는 시간(ms). 2×는 딜레이가 절반이다. */
export function frameDelay(speed: 1 | 2): number {
  return 1000 / (BASE_FPS * speed);
}

/**
 * 제품 구간 바의 막대 하나. 분율은 **[첫 사진 날짜, 마지막 사진 날짜] 안에서 0~1**이고,
 * `lane`은 세로로 몇 번째 줄인가다.
 */
export type Segment = { id: string; name: string; startFrac: number; endFrac: number; lane: number };

/**
 * 날짜의 위치 분율. `first`가 0, `last`가 1이다.
 *
 * **클램프하지 않는다** — 현재 프레임은 정의상 구간 안이고, 구간 밖을 재는 것은
 * `barSegments`뿐이라 자르는 판단은 그쪽이 한다.
 *
 * ⚠️ `first === last`(사진 1장)면 **0으로 나누게 된다.** 화면이 재생 자체를 안 열지만,
 * 여기서 NaN이 새면 막대 폭이 통째로 사라져 원인을 짚기 어렵다 — 0으로 끝낸다.
 */
export function dateFrac(date: string, first: string, last: string): number {
  const span = daysBetween(first, last);
  if (span <= 0) return 0;
  return daysBetween(first, date) / span;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 제품 목록 → 구간 바.
 *
 * - 종료일이 없으면 **마지막 사진까지** 이어진다(바의 오른쪽 끝이 「지금」이다).
 * - 구간 밖으로 삐져나오면 클램프한다 — 안 하면 막대가 화면 밖으로 자란다.
 * - 구간과 **전혀 안 겹치는** 제품은 제외한다. 클램프만 하면 폭 0짜리 막대가 끝에 이름표를
 *   달고 서 있게 된다.
 * - 겹치는 제품은 줄을 나눈다(그리디) — 겹쳐 그리면 둘 다 못 읽는다. 개인이 동시에 쓰는
 *   제품은 몇 개 수준이라 최적 배정은 YAGNI다.
 */
export function barSegments(products: Product[], first: string, last: string): Segment[] {
  const within = products.filter((p) => (p.endDate ?? last) >= first && p.startDate <= last);
  // ⚠️ 그리디는 **정렬을 전제한다.** 안 하면 목록에서 먼저 온 늦은 제품이 0번 줄을 먹고,
  // 이른 제품이 아래로 밀려 바가 시간순으로 안 읽힌다.
  const sorted = [...within].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  /** 줄마다 「지금까지 채워진 오른쪽 끝」. 새 막대의 시작이 그보다 뒤면 그 줄을 다시 쓴다. */
  const laneEnd: number[] = [];
  return sorted.map((p) => {
    const startFrac = clamp01(dateFrac(p.startDate, first, last));
    const endFrac = clamp01(dateFrac(p.endDate ?? last, first, last));
    let lane = laneEnd.findIndex((end) => end < startFrac);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = endFrac;
    return { id: p.id, name: p.name, startFrac, endFrac, lane };
  });
}
