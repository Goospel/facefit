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
