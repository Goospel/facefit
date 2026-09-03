import { API_BASE } from './backup';
import { todayKey } from '../storage';

/**
 * 기름종이 알림(v5 설계 §3-2). 서버는 두 가지만 한다 — **예약 한 줄을 받아 두고, 때가 되면
 * 보내고 지운다.** 화면은 서버를 **조회하지 않는다**: 상태의 단일 출처는 기기의 `oilNextAt`이다.
 *
 * 규율은 `backup.ts`와 **동형**이다 — 어떤 실패도 밖으로 던지지 않고 `null`·`false`로 끝난다.
 * 서버가 죽어도 앱의 다른 기능은 그대로 돌아야 한다(설계 §0의 무음 폴백).
 */

const ENDPOINT = `${API_BASE}/v1/reminder`;

/**
 * 승인 게이트의 세 자리(설계 §3-2).
 *
 * - `idle` — 미예약. **그날 첫 기름종이가 시작점이다.**
 * - `scheduled` — 예약됨. 알림이 아직 안 갔다.
 * - `awaiting` — 알림이 갔고, 다음을 받을지 사용자가 정할 차례다.
 */
export type OilState = 'idle' | 'scheduled' | 'awaiting';

/**
 * 저장된 시각 하나로 상태를 가른다.
 *
 * ⚠️ **날짜가 바뀌면 미예약으로 되돌린다.** 어젯밤 알림에 답하지 않은 사람에게 다음 날까지
 * 「다음도 받을까요」를 들이밀면 승인 게이트가 무기한 열려 있는 것과 같다 — 게이트가
 * 하루짜리라야 밤을 막는 장치 노릇을 한다(야간 상한을 안 두기로 한 근거 — 설계 §3-3).
 *
 * ⚠️ `timeZone`이 인자인 이유는 **테스트를 위해서다**(`todayKey`와 같은 사유). 개발 기계가
 * 한국 시간이라 옵션을 빼도 결과가 같아, 다른 시간대를 넣었을 때 답이 달라지는지로
 * 「KST 기준」이 실제로 걸려 있는지 검증한다.
 */
export function oilState(nextAt: string | null, now: Date, timeZone = 'Asia/Seoul'): OilState {
  if (!nextAt) return 'idle';

  const due = new Date(nextAt);
  // 해석 안 되는 값은 없는 것으로 친다 — 손상된 저장소 하나로 카드가 죽으면 안 된다.
  if (Number.isNaN(due.getTime())) return 'idle';
  if (due > now) return 'scheduled';
  return todayKey(due, timeZone) === todayKey(now, timeZone) ? 'awaiting' : 'idle';
}

/**
 * 예약 시각을 화면에 그릴 `'15:20'`. **서버가 준 문자열을 읽을 뿐 자기 시계로 계산하지
 * 않는다**(설계 §7-8). `sv-SE`가 `2026-09-03 15:20:00` 꼴을 준다 — `formatBackupTime`과 같은 관용구다.
 */
export function formatHm(iso: string, timeZone = 'Asia/Seoul'): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone }).slice(11, 16);
}

/**
 * 다음 알림을 예약한다. **본문이 없다** — 간격(3시간)은 서버 프로퍼티 한 곳에만 살고
 * (캘리브레이션 노브), 클라는 돌려받은 `dueAt`을 그대로 저장·표시한다.
 *
 * `null`은 「이번엔 예약이 안 됐다」다. 호출자는 **저장하지 않는다** — 예약이 안 됐는데
 * 「예약됨」으로 그리면 사용자는 오지 않을 알림을 기다린다(백업 `dirty` 규율과 같은 결).
 */
export async function scheduleOilReminder(key: string, fetchFn: typeof fetch = fetch): Promise<{ dueAt: string } | null> {
  try {
    const res = await fetchFn(ENDPOINT, { method: 'PUT', headers: { 'X-Anon-Key': key } });
    if (!res.ok) return null;

    const parsed: unknown = JSON.parse(await res.text());
    const dueAt = (parsed as { dueAt?: unknown } | null)?.dueAt;
    // 모양을 가정하지 않는다 — 못 믿을 값을 저장하면 화면이 빈 시각을 그린다.
    return typeof dueAt === 'string' && dueAt ? { dueAt } : null;
  } catch {
    // 네트워크 단절·CORS·JSON 파싱. 여기서 던지면 오늘 탭이 서버 때문에 죽는다.
    return null;
  }
}

/**
 * 예약을 지운다(멱등 204). **결과를 화면이 기다리지 않는다** — 실패해도 로컬은 지운다.
 * 남은 행은 예약대로 1회 가고 끝이지만, 「그만」을 눌렀는데 화면이 「예약됨」이면
 * 사용자에게는 빠져나갈 길이 없다(무음 폴백 — 설계 §3-4).
 */
export async function cancelOilReminder(key: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(ENDPOINT, { method: 'DELETE', headers: { 'X-Anon-Key': key } });
    return res.ok;
  } catch {
    return false;
  }
}
