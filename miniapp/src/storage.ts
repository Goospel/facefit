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
const ONBOARDED_KEY = 'facefit.onboarded';

/** 제품 상한. 개인이 넘길 수 없는 수다 — 기능 제한이 아니라 **쿼터 방어만** 한다. */
export const PRODUCT_MAX = 200;

export const CATEGORIES = ['cleanser', 'toner', 'serum', 'cream', 'sunscreen', 'mask', 'etc'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Product = {
  /** `newId()`. 목록 key이자 삭제·수정의 지목 대상이라 없으면 그 줄을 손댈 방법이 없다. */
  id: string;
  name: string;
  category: Category;
  /** `'YYYY-MM-DD'`. 타임랩스 구간 바의 좌표가 이 형태를 전제한다. */
  startDate: string;
  /** 없으면 「사용 중」. `startDate`보다 앞이면 로드에서 이것만 버린다. */
  endDate?: string;
};

/**
 * 그날 피부가 어때 보였나. **`undefined`(그날 답 없음)가 정상 경로다** — 건너뛸 수 있는
 * 1문항이고, 지난날 소급 입력은 안 받는다(관찰은 그날의 눈으로만 성립한다 — 설계 §1-1).
 *
 * ⚠️ 어휘를 늘리면 v2 추천이 먹을 재료의 축이 바뀐다. 값은 셋으로 고정한다.
 */
export const VERDICTS = ['better', 'same', 'worse'] as const;
export type Verdict = (typeof VERDICTS)[number];

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
