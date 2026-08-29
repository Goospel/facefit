/**
 * 달력 격자의 산수. 라이브러리 0 — 필요한 것은 「앞 빈칸 몇 칸 · 말일 며칠」 둘뿐이다.
 *
 * ⚠️ **UTC 메서드로 통일한다.** `Date`의 로컬 메서드를 한 줄이라도 섞으면 시간대에 따라
 * 월 경계에서 하루가 밀려, 달력 전체가 한 칸씩 옆으로 그려진다. `Date.UTC`로 만들고
 * `getUTC*`로만 읽는 것을 이 파일의 규칙으로 둔다 — 화면에 나가는 문자열은 여기서
 * 직접 조립하므로 로컬 시각은 애초에 개입할 자리가 없다.
 *
 * ⚠️ **이 규칙은 테스트가 못 잡는다 — 리뷰가 지킨다.** 개발 기계가 KST(UTC+9)라
 * `getUTC*`를 로컬 메서드로 바꿔도 값이 같아 **전 테스트가 초록으로 통과한다**(리뷰가
 * 돌연변이로 실측). 이 워크트리의 Node는 `TZ` 환경변수도 안 먹어서 비 KST 실행으로
 * 잠글 방법이 없다. 그러니 이 파일에 `getFullYear`·`getMonth`·`getDate`·`getDay`가
 * 보이면 **테스트가 초록이어도 버그다.**
 */

/** 보는 달. `month`는 **1~12**다 — `Date`의 0~11과 섞이지 않게 화면 말투로 들고 다닌다. */
export type Ym = { year: number; month: number };

const pad = (n: number) => String(n).padStart(2, '0');

/** `'YYYY-MM-DD'` → 그 달. 기록·사진 키가 전부 이 형태라 파싱은 자르기 하나다. */
export function monthOf(dateKey: string): Ym {
  const [year, month] = dateKey.split('-');
  return { year: Number(year), month: Number(month) };
}

/** 한 달 이동. 12월 ↔ 1월만 해를 넘긴다. */
export function addMonth(ym: Ym, delta: 1 | -1): Ym {
  const month = ym.month + delta;
  if (month < 1) return { year: ym.year - 1, month: 12 };
  if (month > 12) return { year: ym.year + 1, month: 1 };
  return { year: ym.year, month };
}

/**
 * 일요일 시작 격자. 앞 빈칸(`null`) + 그 달의 날짜 키 전부.
 *
 * 말일은 「다음 달 0일」로 얻는다 — 윤년 규칙을 손으로 쓰지 않는다.
 */
export function monthCells(ym: Ym): (string | null)[] {
  const lead = new Date(Date.UTC(ym.year, ym.month - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= last; d += 1) cells.push(`${ym.year}-${pad(ym.month)}-${pad(d)}`);
  return cells;
}

/** 달력 헤더 문구. */
export function formatYm(ym: Ym): string {
  return `${ym.year}년 ${ym.month}월`;
}
