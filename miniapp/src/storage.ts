/**
 * localStorage 영속. **서버가 없으므로 여기가 유일한 저장소다**(사진만 IndexedDB —
 * `photoStore.ts`).
 *
 * 읽기는 전부 방어적이다 — 프라이빗 모드에서 저장소가 막히거나, 옛 버전이 남긴 형태가
 * 달라도 앱이 죽으면 안 된다. 죽는 대신 빈 값으로 시작한다.
 *
 * ⚠️ **방어 강도가 필드마다 다르다**(설계 §4-2). 없으면 화면이 죽거나 계산이 어긋나는 필드
 * (`name`·`startDate`)는 레코드째 기각하고, 표시에만 쓰이는 필드(`category`·`endDate`)는
 * **그 필드만 고쳐 레코드를 살린다.** 한 벌로 뭉치면 어느 쪽이든 손해다 — 다 기각하면
 * 카테고리 어휘를 한 번 손보는 순간 그 제품 기록이 통째로 사라지고, 다 살리면 시작일 없는
 * 제품이 타임랩스 구간 바를 NaN으로 만든다.
 *
 * ⚠️ 기기를 바꾸면 기록이 날아간다. 클라우드 동기화는 의도적 보류(설계 §7).
 */

const PRODUCTS_KEY = 'facefit.products';
const NOTES_KEY = 'facefit.notes';
const USAGE_KEY = 'facefit.usage';
const ONBOARDED_KEY = 'facefit.onboarded';
const NOTIFY_PROMPTED_KEY = 'facefit.notifyPrompted';
const BACKUP_ENABLED_KEY = 'facefit.backupEnabled';
const BACKUP_PROMPTED_KEY = 'facefit.backupPrompted';
const BACKUP_DIRTY_KEY = 'facefit.backupDirty';
const LAST_BACKUP_AT_KEY = 'facefit.lastBackupAt';
const OIL_NEXT_AT_KEY = 'facefit.oilNextAt';

/** 제품 상한. 개인이 넘길 수 없는 수다 — 기능 제한이 아니라 **쿼터 방어만** 한다. */
export const PRODUCT_MAX = 200;

export const CATEGORIES = ['cleanser', 'toner', 'serum', 'cream', 'sunscreen', 'mask', 'etc'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * 사용 빈도(v4-2 §3-5). **이 필드가 하는 일은 하나뿐이다 — 촬영 때 물어볼 제품인가.**
 *
 * 「주 1~2회」 같은 선언 어휘를 안 두는 이유: 실사용 로그(`Usage`)가 있으면 선언은 필요 없고,
 * 선언과 로그가 어긋나면 어느 쪽이 참인지 아무도 못 고른다. 구간 판정(`isActive`)은 이걸 안 본다.
 */
export const FREQUENCIES = ['daily', 'occasional'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** 화면 문구. 어휘 곁에 **한 벌만** 둔다(`VERDICT_KO`와 같은 규율 — 사본이 둘이면 한쪽이 낡는다). */
export const FREQUENCY_KO: Record<Frequency, string> = { daily: '매일', occasional: '가끔' };

/**
 * 등록 시점에 식약처 보고품목 API에서 받아 **박제한** 메타(설계 §3-3).
 *
 * ⚠️ **재조회하지 않는다.** 열람할 때마다 다시 부르면 오프라인에서 카드가 깨지고, 호출 0이던
 * 열람 경로에 네트워크가 스민다. 보고 데이터는 사실상 불변(보고 이력)이라 부패 리스크도 낮다 —
 * 대신 `fetchedAt`으로 「언제 것인지」만 정직하게 남긴다.
 */
export type MfdsSnapshot = {
  /** `COSMETIC_REPORT_SEQ` — 제안 구분·향후 재조회 열쇠. */
  reportSeq: string;
  /**
   * `ITEM_NAME` 원본 품목명 — 이름을 고쳤을 때 **스냅샷을 유지할지 가르는 기준이다**(설계 §3-2).
   *
   * ⚠️ 폼 state가 아니라 여기 두는 이유: 몇 달 뒤 수정 세션에도 비교 기준이 남아 있어야 한다.
   */
  itemName: string;
  /** `ENTP_NAME`(업소명) — 카드의 「브랜드」 줄. */
  entpName: string;
  /** 보고된 기능성 구분(`'미백'`·`'주름개선'`·`'자외선차단'`). **명사뿐이다** — 설계 §3-4. */
  effects: string[];
  /** 원문 그대로(`'50+'`). 카드가 `SPF` 접두어를 붙인다. */
  spf?: string;
  /** 파서가 편 `'+'` 문자열(원문은 숫자 `"4"`). */
  pa?: string;
  /** `'YYYY-MM-DD'`. 스냅샷 원칙의 정직한 표기다. */
  fetchedAt: string;
};

export type Product = {
  /** `newId()`. 목록 key이자 삭제·수정의 지목 대상이라 없으면 그 줄을 손댈 방법이 없다. */
  id: string;
  name: string;
  category: Category;
  /** `'YYYY-MM-DD'`. 타임랩스 구간 바의 좌표가 이 형태를 전제한다. */
  startDate: string;
  /** 없으면 「사용 중」. `startDate`보다 앞이면 로드에서 이것만 버린다. */
  endDate?: string;
  /** 없으면 수기 등록 제품이다 — **v1 데이터 전부가 이 상태다.** */
  mfds?: MfdsSnapshot;
  /** 없으면 `daily`. **촬영 때 물어볼 제품인가만 가른다** — 구간 판정은 이걸 안 본다(§4-2). */
  frequency?: Frequency;
};

/**
 * 그날 피부가 어때 보였나. **`undefined`(그날 답 없음)가 정상 경로다** — 건너뛸 수 있는
 * 1문항이고, 지난날 소급 입력은 안 받는다(관찰은 그날의 눈으로만 성립한다 — 설계 §1-1).
 *
 * ⚠️ 어휘를 늘리면 v2 추천이 먹을 재료의 축이 바뀐다. 값은 셋으로 고정한다.
 */
export const VERDICTS = ['better', 'same', 'worse'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * 관찰 답의 표시 문구. **촬영 화면의 버튼 라벨과 같은 말이라야** 「내가 뭘 눌렀지」가 성립한다.
 * 어휘(`VERDICTS`) 곁에 **한 벌만** 둔다 — Home·History가 각자 사본을 들고 있었고(v4-1에서 통합),
 * 사본이 둘이면 문구를 다듬는 순간 한쪽이 조용히 낡는다.
 */
export const VERDICT_KO: Record<Verdict, string> = { better: '좋아졌어요', same: '그대로예요', worse: '나빠졌어요' };

/** 하루 1개. 사진과 **독립 저장**이다 — 사진을 지워도 관찰은 남는다(설계 §4-3). */
export type Notes = Record<string, Verdict>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function read(key: string, storage: Storage): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown, storage: Storage): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장이 막혀도 화면은 계속 돈다. 계산된 값은 호출한 쪽이 그대로 쓴다.
  }
}

/**
 * 레코드 id. `crypto.randomUUID`가 **구형 웹뷰에 없을 수 있다** — 여기서 던지면
 * 「제품 추가」 버튼이 통째로 죽는다. 충돌만 안 나면 되는 값이라 폴백은 이걸로 족하다.
 */
export function newId(): string {
  // ⚠️ 타입은 `crypto`가 늘 있다고 말하지만 구형 웹뷰의 런타임은 그렇지 않다 —
  // 타입을 믿고 이 가드를 걷으면 그 기기에서만 버튼이 죽는다(우리 눈에는 안 보인다).
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isText = (v: unknown): v is string => typeof v === 'string';

/**
 * 스냅샷이 화면에 세워도 되는 모양인가(설계 §3-3). **검증 등급은 「표시용」이다** —
 * 어긋나면 `mfds`만 버리고 레코드는 산다(카테고리 강등과 같은 급). 제품 기록이 본체고
 * API 메타는 장식이라, 여기서 레코드째 기각하면 메타 오류 하나에 기간 기록이 통째로 증발한다.
 *
 * ⚠️ 타입까지 보는 이유는 **화면이 이 값을 그대로 그리기 때문이다** — 객체가 섞여 들어오면
 * React가 렌더에서 던져 제품 탭이 죽는다. 「살리는 방어」가 죽이는 방어로 뒤집히는 자리다.
 */
function isSnapshot(v: unknown): v is MfdsSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  // `Array.isArray`는 안 본다 — JSON 배열은 `reportSeq`를 달고 올 수 없어 바로 아래 줄에서
  // 어차피 걸린다(가드를 얹어 봐야 어떤 입력으로도 안 밟히는 죽은 가지가 된다).
  const m = v as MfdsSnapshot;
  // ⚠️ `itemName`이 없으면 이름 수정 시의 유지 판정 자체가 불가능하다(§3-2) — 그 상태로
  // 살려 두면 갈아치운 이름 위에 남의 뱃지가 조용히 남는다.
  if (!isText(m.reportSeq) || !isText(m.itemName) || !isText(m.entpName) || !isText(m.fetchedAt)) return false;
  if (!Array.isArray(m.effects) || !m.effects.every(isText)) return false;
  // 없는 것은 정상이다(선크림이 아닌 제품). 있는데 문자열이 아닌 것만 걸러낸다.
  return (m.spf === undefined || isText(m.spf)) && (m.pa === undefined || isText(m.pa));
}

/**
 * ⚠️ **미지 필드를 보존한다**(설계 §4-2). `{ id, name, category, startDate }`로 재조립하면
 * v2에서 성분표 사진 키 같은 필드를 얹는 순간 **앱을 한 번 열기만 해도** 그 값이 조용히
 * 증발한다. 필수 필드만 검사하고 고칠 것만 고쳐 나머지는 그대로 흘려보낸다.
 *
 * `null`은 「이 레코드는 못 살린다」다.
 */
function reviveProduct(v: unknown): Product | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const raw = v as Product;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  // 이름 없는 줄은 목록에 서 봐야 무엇인지 알 수 없고 지울 수도 없다.
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (typeof raw.startDate !== 'string' || !DATE_RE.test(raw.startDate)) return null;

  const category = CATEGORIES.includes(raw.category) ? raw.category : 'etc';
  // 시작일과 **같은 날**은 살린다 — 하루 쓰고 접은 제품이 실제로 있다.
  const endOk =
    raw.endDate === undefined || (typeof raw.endDate === 'string' && DATE_RE.test(raw.endDate) && raw.endDate >= raw.startDate);

  const out = { ...raw, category };
  if (!endOk) delete out.endDate;
  if (out.mfds !== undefined && !isSnapshot(out.mfds)) delete out.mfds;
  // 어휘 밖 빈도는 **필드만** 지운다 — 없으면 `daily`라 레코드를 죽일 이유가 없다(§4-2).
  if (out.frequency !== undefined && !FREQUENCIES.includes(out.frequency)) delete out.frequency;
  return out;
}

export function loadProducts(storage: Storage = localStorage): Product[] {
  const v = read(PRODUCTS_KEY, storage);
  if (!Array.isArray(v)) return [];
  // 앞에서 자른다 — 뒤에서 자르면 방금 등록한 제품이 저장하자마자 사라진다.
  return v.map(reviveProduct).filter((p): p is Product => p !== null).slice(-PRODUCT_MAX);
}

export function saveProducts(products: Product[], storage: Storage = localStorage): void {
  write(PRODUCTS_KEY, products.slice(-PRODUCT_MAX), storage);
}

export function loadNotes(storage: Storage = localStorage): Notes {
  const v = read(NOTES_KEY, storage);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Notes = {};
  // 어휘 밖 답은 **그 날짜만** 버린다. 통째로 버리면 그만큼이 v2 추천 재료의 공백이 된다.
  for (const [date, verdict] of Object.entries(v)) {
    if (VERDICTS.includes(verdict as Verdict)) out[date] = verdict as Verdict;
  }
  return out;
}

/** 하루 1개, 재답변은 덮어쓴다. 돌려주는 것이 화면이 쓸 다음 상태다. */
export function saveNote(date: string, verdict: Verdict, storage: Storage = localStorage): Notes {
  const next = { ...loadNotes(storage), [date]: verdict };
  write(NOTES_KEY, next, storage);
  return next;
}

/**
 * 관찰 전체를 덮어쓴다. **복원 전용이다**(v3 §3-4) — 평소 경로는 `saveNote` 하나뿐이고,
 * 여기로 통째 쓰기가 생기는 유일한 이유가 「기기 이전 복원」이다.
 *
 * ⚠️ 쓴 뒤에는 `loadNotes`로 **다시 읽어서** 화면에 올린다 — 서버에서 온 값이라 형태를
 * 못 믿는데, 방어 규칙을 여기에 또 쓰면 로더와 두 벌이 되어 드리프트한다.
 */
export function saveNotes(notes: Notes, storage: Storage = localStorage): void {
  write(NOTES_KEY, notes, storage);
}

/**
 * 사진 날짜 → **그 사진 직전 루틴(어제~촬영 전)에 쓴 제품 id**(v4-2 §4-1).
 *
 * 사진·관찰과 **같은 키**라 셋의 대조가 문자열 비교 하나로 끝나고, 「팩은 밤에 하고 사진은
 * 아침에 찍는다」는 시점 불일치가 정의로 해소된다(§3-2).
 *
 * ⚠️ **3상이다**: 키 없음 = 안 물어봤다 · `[]` = 물어봤고 안 썼다 · `[id…]` = 썼다.
 * `[]`를 「없음」으로 접으면 팩을 **안 한 날의 사진**이 대조군 노릇을 못 한다 — 그 대조가
 * 이 기능의 존재 이유라(§0), 빈 배열은 데이터가 아니라 **사실**이다.
 *
 * ⚠️ 제품 id의 존재 여부는 **검사하지 않는다.** 지운 제품의 id가 남는 것이 정상이고(§4-9),
 * 화면의 조인(`products.find`)이 알아서 걸러낸다 — 여기서 지우면 정리 코드가 늘 뿐이다.
 */
export type Usage = Record<string, string[]>;

export function loadUsage(storage: Storage = localStorage): Usage {
  const v = read(USAGE_KEY, storage);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Usage = {};
  for (const [date, ids] of Object.entries(v)) {
    // 어긋난 키·값은 **그 날짜만** 버린다(`loadNotes`와 같은 등급). 원소는 더 잘게 — 이상한
    // id 하나 때문에 그날 기록을 통째로 버리면 사진의 의미가 사라진다.
    if (DATE_RE.test(date) && Array.isArray(ids)) out[date] = ids.filter(isText);
  }
  return out;
}

/** 하루 1개, 다시 찍으면 덮어쓴다(§4-9). 돌려주는 것이 화면이 쓸 다음 상태다 — `saveNote`와 동형. */
export function saveUsage(date: string, ids: string[], storage: Storage = localStorage): Usage {
  const next = { ...loadUsage(storage), [date]: ids };
  write(USAGE_KEY, next, storage);
  return next;
}

/** 로그 전체를 덮어쓴다. **복원 전용이다** — `saveNotes`와 같은 이유로 쓴 뒤 다시 읽어 올린다. */
export function saveUsageAll(usage: Usage, storage: Storage = localStorage): void {
  write(USAGE_KEY, usage, storage);
}

/**
 * 온보딩을 봤는가. **엉뚱한 값이면 안 본 것으로 친다** — 온보딩을 한 번 더 보는 쪽이
 * 프라이버시·권한 고지를 못 본 채로 카메라를 여는 것보다 안전하다.
 *
 * JSON을 안 쓰는 건 값이 플래그 하나뿐이라서다.
 */
export function isOnboarded(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveOnboarded(storage: Storage = localStorage): void {
  try {
    storage.setItem(ONBOARDED_KEY, '1');
  } catch {
    // 읽기와 같은 이유로 삼킨다. 이번 실행에서는 화면 state가 온보딩을 넘겨 준다.
  }
}

/**
 * 알림 동의를 **자동으로 권한 적이 있는가**(설계 §3-2). **동의했는가가 아니다** — 동의 여부의
 * 단일 출처는 토스이고, 앱에 사본을 두면 사용자가 토스 설정에서 철회한 순간 반드시 어긋난다.
 *
 * 이 플래그가 하는 일은 하나뿐이다: 촬영 직후의 **자동 제안은 딱 한 번.** 거절한 사람에게
 * 매일 다시 묻지 않는다. 엉뚱한 값이면 안 물어본 것으로 친다 — 한 번 더 묻는 쪽이,
 * 손상된 값 하나 때문에 영영 못 묻는 것보다 낫다(온보딩과 같은 이유로 JSON을 안 쓴다).
 */
export function isNotifyPrompted(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(NOTIFY_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveNotifyPrompted(storage: Storage = localStorage): void {
  try {
    storage.setItem(NOTIFY_PROMPTED_KEY, '1');
  } catch {
    // 삼킨다. 여기서 던지면 **촬영 흐름이 알림 때문에 죽는다** — 주객전도다(설계 §3-2).
  }
}

/**
 * 백업 플래그 넷(v3 설계 §4-3). 전부 **꺼진 쪽이 안전한 기본값**이다 — 저장소가 막히거나
 * 값이 이상하면 「안 켜짐」·「안 물어봄」·「밀린 것 없음」으로 읽는다.
 *
 * 값이 `'1'`인지만 보고 JSON을 안 쓰는 것은 온보딩·알림 플래그와 같은 이유다: 손상된 값
 * 하나 때문에 파싱이 터지느니, 못 알아본 값은 그냥 기본값으로 떨어지는 편이 낫다.
 */

/**
 * 백업을 켰는가. **양방향이다** — 끌 수 있어야 「백업 끄기」(=서버 데이터 즉시 삭제)라는
 * 입구가 성립한다. 기본이 꺼짐인 것은 옵트인 결정 때문이다(설계 §3-4): 서버 전송이 처음
 * 생기는 기능이라 사용자 행위로 시작한다.
 */
export function isBackupEnabled(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(BACKUP_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveBackupEnabled(on: boolean, storage: Storage = localStorage): void {
  try {
    if (on) storage.setItem(BACKUP_ENABLED_KEY, '1');
    else storage.removeItem(BACKUP_ENABLED_KEY);
  } catch {
    // 삼킨다 — 저장 흐름이 백업 설정 때문에 죽으면 주객전도다.
  }
}

/**
 * 백업을 **자동으로 권한 적이 있는가**(켰는가가 아니다). 하는 일은 하나뿐이다:
 * 제품 첫 등록 직후의 **자동 제안은 딱 한 번.** 거절한 사람에게 매번 다시 묻지 않는다.
 * 단방향인 것은 되돌릴 이유가 없어서다(notifyPrompted와 동형).
 */
export function isBackupPrompted(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(BACKUP_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveBackupPrompted(storage: Storage = localStorage): void {
  try {
    storage.setItem(BACKUP_PROMPTED_KEY, '1');
  } catch {
    // 삼킨다.
  }
}

/**
 * 못 올린 변경이 있는가. **업로드 실패의 유일한 흔적이다** — 백오프 루프를 안 만들고
 * 이 플래그만 세운 뒤, **다음 앱 시작이 곧 재시도**가 된다(설계 §3-3).
 * 지울 수 있어야 하는 이유: 못 지우면 성공한 뒤에도 매 실행마다 다시 올린다.
 */
export function isBackupDirty(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(BACKUP_DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveBackupDirty(dirty: boolean, storage: Storage = localStorage): void {
  try {
    if (dirty) storage.setItem(BACKUP_DIRTY_KEY, '1');
    else storage.removeItem(BACKUP_DIRTY_KEY);
  } catch {
    // 삼킨다.
  }
}

/**
 * 마지막 백업 시각. **서버가 준 문자열을 그대로** 들고 있다 — 표시용이라 해석하지 않는다.
 * 빈 문자열을 `null`로 접는 것은 화면이 빈 시각을 그리지 않게 하기 위해서다.
 */
export function loadLastBackupAt(storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(LAST_BACKUP_AT_KEY) || null;
  } catch {
    return null;
  }
}

export function saveLastBackupAt(iso: string, storage: Storage = localStorage): void {
  try {
    storage.setItem(LAST_BACKUP_AT_KEY, iso);
  } catch {
    // 삼킨다.
  }
}

/**
 * 기름종이 알림의 다음 예약 시각(v5 설계 §3-2). **상태의 단일 출처다** — 화면은 서버를
 * 조회하지 않고 이 값 하나로 미예약·예약됨·승인 대기를 가른다(판정은 `logic/reminder.ts`).
 *
 * `lastBackupAt`과 동형이다: 서버가 준 문자열을 **해석하지 않고** 들고만 있고, 빈 값은
 * `null`로 접는다. 해석은 판정 함수 한 곳에만 둔다 — 여기서 또 하면 규칙이 두 벌이 된다.
 */
export function loadOilNextAt(storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(OIL_NEXT_AT_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * 빈 문자열은 **삭제다.** 「그만 받기」·「오늘은 그만」이 곧 이 호출이라, 지우는 경로가 없으면
 * 사용자에게 되돌릴 방법이 없다. 빈 값을 그대로 써 두면 `loadOilNextAt`이 `null`로 접긴 하지만
 * 저장소에 죽은 키가 남는다 — 지울 수 있는 것은 지운다.
 */
export function saveOilNextAt(iso: string, storage: Storage = localStorage): void {
  try {
    if (iso) storage.setItem(OIL_NEXT_AT_KEY, iso);
    else storage.removeItem(OIL_NEXT_AT_KEY);
  } catch {
    // 삼킨다 — 오늘 탭이 알림 저장 때문에 죽으면 주객전도다.
  }
}

/**
 * 한국 시간 기준 `YYYY-MM-DD`. **사진 키이자 제품 시작일·관찰 기록 키다.**
 *
 * UTC로 자르면 한국의 오전 9시 이전이 전날로 찍혀 **오늘 찍은 사진이 어제 칸에 들어간다.**
 * `sv-SE` 로케일이 `YYYY-MM-DD` 형태를 준다.
 *
 * ⚠️ `timeZone`이 인자인 이유는 **테스트를 위해서다.** 개발 기계가 한국 시간이라
 * 옵션을 통째로 빼도 결과가 같아 테스트가 공허해진다(restfit에서 돌연변이가 살아남아 발각됐다).
 * 다른 시간대를 넣었을 때 답이 달라지는지로 옵션이 실제로 쓰이는지 검증한다.
 */
export function todayKey(date: Date = new Date(), timeZone = 'Asia/Seoul'): string {
  return date.toLocaleDateString('sv-SE', { timeZone });
}
