import { todayKey, type MfdsSnapshot } from '../storage';

/**
 * 식약처 기능성화장품 보고품목 API(설계 §4-1). **우리가 운영하는 서버는 여전히 0대다** —
 * v2-1 푸시가 토스 서버를 빌렸듯 여기서는 식약처 서버를 빌린다.
 *
 * ⚠️ **어떤 실패도 밖으로 던지지 않는다.** 오프라인·쿼터 소진·점검·커버리지 밖 — 전부
 * 「제안이 안 뜬다」로 수렴하고 사용자는 그대로 수기 등록을 이어간다(설계 §3-2). 에러 배너를
 * 만드는 순간 등록 흐름을 검색이 방해하는 주객전도가 된다.
 */

export const MFDS_ENDPOINT = 'https://apis.data.go.kr/1471000/FtnltCosmRptPrdlstInfoService/getRptPrdlstInq';

export type Suggestion = { itemName: string; snapshot: MfdsSnapshot };

/**
 * PA 표기 정규화. **원문은 숫자다**(실측 `"4"` = PA++++).
 *
 * ⚠️ `repeat` 경계가 그대로 화면의 등급이다 — 하나 모자라면 앱이 PA+++라고 말한다.
 * 모르는 값은 **필드를 안 만든다**(빈 칩이 서는 것보다 없는 편이 정직하다).
 */
function normalizePa(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (/^[1-4]$/.test(v)) return '+'.repeat(Number(v));
  return v.includes('+') ? v : undefined;
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * 원시 응답 → 제안 목록. 순수 함수다(`fetchedAt` 주입 — 시계에 매달리면 테스트가 자정에 깨진다).
 *
 * ⚠️ **`items` 부재는 에러가 아니라 정상 0건이다**(실측 §2-3 — 0건이면 키 자체가 없다).
 * 여기서 던지면 브랜드명 검색 한 번에 등록 화면이 통째로 죽는다.
 */
export function parseItems(json: unknown, fetchedAt: string = todayKey()): Suggestion[] {
  const items = (json as { body?: { items?: unknown } } | null)?.body?.items;
  if (!Array.isArray(items)) return [];

  const out: Suggestion[] = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;

    const itemName = text(row.ITEM_NAME);
    // 이름 없는 제안은 골라도 채울 것이 없다.
    if (!itemName) continue;
    // 취하된 보고를 최신 정보처럼 세우는 것이 이 목록의 유일한 리스크다(§3-2).
    if (row.CANCEL_APPROVAL_YN === 'Y') continue;

    const spf = text(row.SPF);
    const pa = normalizePa(row.PA);
    /*
      ⚠️ 실소스는 `EE_DOC_DATA`의 **법정 고시 정형문**이다 — `EFFECT_YN1~3`·`EE_NAME`은
      옛 레코드가 전부 "N", 최근 레코드가 전부 null이라 믿으면 0종이 된다(실측 §2-3).
      XML 파서는 안 만든다. 정형문 감지라 `includes`로 족하고, 화면에 서는 것은
      **문장이 아니라 분류명(명사)뿐이다**(§3-4).
    */
    const doc = typeof row.EE_DOC_DATA === 'string' ? row.EE_DOC_DATA : '';
    const effects: string[] = [];
    if (doc.includes('미백')) effects.push('미백');
    if (doc.includes('주름')) effects.push('주름개선');
    // ⚠️ 이중 신호를 OR로 쓴다 — 옛 레코드는 SPF/PA가 null이라 문구만 있고, 문구가 비어도
    // SPF가 있으면 자외선차단이다. 어느 한쪽만 믿으면 각각 구멍이 난다.
    if (doc.includes('자외선') || spf || pa) effects.push('자외선차단');

    out.push({
      itemName,
      snapshot: {
        reportSeq: text(row.COSMETIC_REPORT_SEQ) ?? '',
        entpName: text(row.ENTP_NAME) ?? '',
        effects,
        ...(spf ? { spf } : null),
        ...(pa ? { pa } : null),
        fetchedAt,
      },
    });
  }
  return out;
}

/** 실측 봉투(§2-3). `items`는 `parseItems`가 다시 방어적으로 읽으므로 여기서는 안 본다. */
type Envelope = { header?: { resultCode?: unknown }; body?: { totalCount?: unknown } };

/** 한 페이지. **정상 봉투가 아니면 `null`이다** — 부르는 쪽은 그걸 빈손으로만 읽는다. */
async function page(
  key: string,
  query: string,
  numOfRows: number,
  pageNo: number,
  signal: AbortSignal,
  fetchFn: typeof fetch,
): Promise<Envelope | null> {
  /*
    ⚠️ `URLSearchParams`로 조립한다 — 발급받는 일반 인증키(Decoding)에 `/`·`+`·`=`가 섞여
    있어서 날로 이으면 `+`가 공백으로 읽혀 키가 통째로 어긋난다. 어긋난 키의 증상은
    「제안이 안 뜸」이라 앱 안에서는 구별이 안 된다.
  */
  const qs = new URLSearchParams({ serviceKey: key, type: 'json', item_name: query, pageNo: String(pageNo), numOfRows: String(numOfRows) });
  try {
    const res = await fetchFn(`${MFDS_ENDPOINT}?${qs}`, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as Envelope;
    // 키 오류·쿼터 초과도 200으로 온다 — 봉투 안의 코드가 유일한 판정이다.
    return json?.header?.resultCode === '00' ? json : null;
  } catch {
    // 오프라인·취소·JSON 파싱 실패. 전부 「제안이 안 뜬다」로 수렴한다(§3-2).
    return null;
  }
}

/**
 * 최신순 제안. **2요청 전략**이다(§3-2) — API에 정렬 파라미터가 없고 기본이 보고일
 * 오름차순(2008년부터)이라, ①`numOfRows=1`로 총 건수를 재고 ②마지막 페이지를 받아 역순으로 준다.
 *
 * ⚠️ 총 건수가 0이면 **두 번째 요청을 안 부른다** — 브랜드명 검색(0건이 정상)이 잦아서
 * 그대로 두면 쿼터의 절반이 빈 응답에 쓰인다.
 */
export async function searchProducts(query: string, signal: AbortSignal, fetchFn: typeof fetch = fetch): Promise<Suggestion[]> {
  const key = import.meta.env.VITE_MFDS_KEY;
  // 키 없는 개발 환경·CI에서는 부르지 않는다 — 콘솔 403 소음만 남는다.
  if (!key) return [];

  const first = await page(key, query, 1, 1, signal, fetchFn);
  const total = first?.body?.totalCount;
  if (typeof total !== 'number' || total < 1) return [];

  const last = await page(key, query, 10, Math.ceil(total / 10), signal, fetchFn);
  return parseItems(last).reverse();
}
