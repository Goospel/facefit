import type { Category, Product } from '../storage';

/**
 * 제품의 순수 산수. 화면 없이 재는 것은 둘뿐이다 — 그날 쓰고 있었나, 어떤 순서로 보여 줄까.
 *
 * ⚠️ **날짜 비교는 문자열 비교다.** 키가 전부 `'YYYY-MM-DD'`라 사전순이 곧 시간순이고,
 * `Date`로 파싱하면 시간대가 끼어들어 경계에서 하루가 밀린다(`logic/calendar.ts` 머리말과 같은 규율).
 */

/**
 * 화면에 뜨는 이름. **어휘 키와 따로 두는 이유는 저장값이 영어이기 때문이다** —
 * 한글을 저장하면 문구를 다듬는 순간 지난 기록의 카테고리가 어휘 밖으로 떨어진다.
 *
 * ⚠️ `Record<Category, string>`이라 어휘를 늘리면 **여기가 컴파일 에러로 막는다.**
 * `Record<string, string>`으로 넓히면 빠뜨린 카테고리가 화면에 `undefined`로 뜬다.
 */
export const CATEGORY_KO: Record<Category, string> = {
  cleanser: '클렌저',
  toner: '토너',
  serum: '세럼',
  cream: '크림',
  sunscreen: '선크림',
  mask: '마스크',
  etc: '기타',
};

/**
 * 그날 이 제품을 쓰고 있었나. **양 끝이 다 닫힌 구간이다** —
 * 시작일 당일부터(오늘 등록하고 오늘 찍으면 붙어야 한다) 종료일 당일까지
 * (「오늘까지 쓰고 종료」가 오늘을 포함한다).
 */
export function isActive(p: Product, date: string): boolean {
  return p.startDate <= date && (p.endDate === undefined || date <= p.endDate);
}

/**
 * 목록 순서 — **사용 중 먼저, 그 안에서 최근 시작한 것이 위**.
 *
 * 지금 뭘 쓰고 있는지가 이 목록에 오는 이유다. 시작일만으로 줄 세우면 이번 주에 끝낸 제품이
 * 몇 달째 쓰는 제품 위에 선다.
 *
 * ⚠️ **복사본을 정렬한다.** 화면 state 배열을 제자리에서 뒤집으면 참조가 그대로라 리렌더가 안 돈다.
 */
export function sortProducts(products: Product[], date: string): Product[] {
  return [...products].sort((a, b) => {
    const rank = Number(isActive(b, date)) - Number(isActive(a, date));
    if (rank !== 0) return rank;
    return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0;
  });
}
