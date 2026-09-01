import { User } from '@apps-in-toss/web-framework';

import type { Notes, Product } from '../storage';

/**
 * 백업 클라이언트(설계 §4-3). 서버는 두 가지만 한다 — 이건 그중 하나다.
 *
 * 규율은 notify.ts와 **동형**이다: SDK가 던지는 것을 삼키고, **어떤 실패도 밖으로 던지지
 * 않는다.** 서버가 죽어도·느려도 앱은 v2와 똑같이 돌아야 한다(설계 §0의 무음 폴백).
 * 그래서 모든 함수가 `null`이나 `false`로 끝나고, 호출자는 그걸 「이번엔 안 됐다」로만 읽는다.
 */

/**
 * 서버 주소. **공개 값이라 소스에 박는다** — 비밀이 아니고 서버도 하나뿐이다.
 *
 * ⚠️ 설계 §5는 `VITE_API_BASE`를 필수로 적었지만, 그러면 `.env`가 없는 빌드에서 백업이
 * **조용히** 죽는다(모든 서버 경로가 무음 폴백이라 아무도 못 알아챈다). 기본값을 두고
 * 환경변수는 **덮어쓰기 용도로만** 남긴다 — 로컬에서 서버를 띄워 붙일 때 쓴다.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'https://facefit-api.booktimer.app';

const ENDPOINT = `${API_BASE}/v1/backup`;

/**
 * 서버로 오가는 전체 상태. **동기화가 아니라 백업이라** 이게 통째로 오간다(설계 §3-3).
 *
 * ⚠️ **사진이 들어갈 자리가 없다.** 「사진은 이 기기에만 저장되며 어디로도 전송되지
 * 않습니다」가 글자 그대로 참이어야 하고(온보딩 고지·검수 통과 문구), 그 1차 방어가
 * **보낼 코드를 아예 안 갖는 것**이다. 서버의 2,000자 상한은 2차 방어다(설계 §3-2).
 */
export type BackupBlob = {
  schemaVersion: 1;
  products: Product[];
  notes: Notes;
  /** 클라가 만든 문자열. 복원 미리보기의 「언제 저장분」 재료다 — 서버는 해석하지 않는다. */
  clientSavedAt: string;
};

/** 페이로드를 만드는 유일한 자리. 여기 키가 하나 늘면 서버가 400으로 막는다(최상위 화이트리스트). */
export function buildBackupBlob(products: Product[], notes: Notes, clientSavedAt: string): BackupBlob {
  return { schemaVersion: 1, products, notes, clientSavedAt };
}

/**
 * 익명 키를 가져온다. **`null`이면 백업 UI 자체를 숨긴다** — 사용자가 할 수 있는 일이 없는
 * 안내는 소음이기 때문이다(notify 전례).
 *
 * ⚠️ `try`가 둘인 이유가 다르다. `isSupported()`는 토스 웹뷰 전역을 읽어 **토스 밖에서
 * TypeError로 터지고**, `getAnonymousKey()`는 미지원 버전·브릿지 오류를 **던진다**
 * (SDK 문서: `UNSUPPORTED_APP_VERSION`·`UNKNOWN_ERROR`).
 */
export async function getBackupKey(): Promise<string | null> {
  try {
    if (!User.getAnonymousKey.isSupported()) return null;
  } catch {
    return null;
  }

  try {
    const res = await User.getAnonymousKey();
    // 형태를 가정하지 않는다 — 키는 불투명 문자열이고, 없으면 없는 것이다(설계 §8-4).
    const hash = (res as { hash?: unknown } | undefined)?.hash;
    return typeof hash === 'string' && hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

/**
 * 전체 블롭을 덮어쓴다. **fire-and-forget**이다 — `false`를 받은 호출자는 `backupDirty`만
 * 세우고 넘어간다(다음 앱 시작이 곧 재시도다. 백오프 루프를 안 만드는 이유 — 설계 §3-3).
 */
export async function uploadBackup(key: string, blob: BackupBlob, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Anon-Key': key },
      body: JSON.stringify(blob),
    });
    return res.ok;
  } catch {
    // 네트워크 단절·CORS·중단. 여기서 던지면 **제품 저장 흐름이 백업 때문에 죽는다.**
    return false;
  }
}

/**
 * 복원용 조회. **404는 오류가 아니다** — 백업이 없는 것은 신규 사용자의 정상 상태다.
 *
 * 모양이 어긋나면 `null`이다. 복원은 로컬을 덮어쓰는 파괴적 동작이라, **믿을 수 없는
 * 응답으로는 시작하지 않는 편**이 「반쯤 복원된 상태」보다 낫다.
 */
export async function fetchBackup(key: string, fetchFn: typeof fetch = fetch): Promise<BackupBlob | null> {
  try {
    const res = await fetchFn(ENDPOINT, { method: 'GET', headers: { 'X-Anon-Key': key } });
    if (!res.ok) return null;

    const parsed: unknown = JSON.parse(await res.text());
    if (!isBackupBlob(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 「백업 끄기」 = 서버 데이터 즉시 삭제. 삭제권 이행이자 문구를 믿을 수 있게 하는 근거다. */
export async function deleteBackup(key: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(ENDPOINT, { method: 'DELETE', headers: { 'X-Anon-Key': key } });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 최소한의 모양 검사. 필드 하나하나를 검증하지 **않는다** — 그건 `loadProducts`의 일이고
 * (필드별 방어 강도가 다르다), 여기서 또 하면 규칙이 두 벌이 되어 드리프트한다.
 */
function isBackupBlob(v: unknown): v is BackupBlob {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.schemaVersion === 1 &&
    Array.isArray(o.products) &&
    typeof o.notes === 'object' &&
    o.notes !== null &&
    !Array.isArray(o.notes)
  );
}
