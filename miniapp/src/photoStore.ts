/**
 * 얼굴 사진 영속(IndexedDB). **사진은 이 기기를 떠나지 않는다** — 서버는 0대다.
 *
 * `storage.ts`와 따로 두는 이유는 API가 비동기·이벤트 기반이라서지, 관례가 달라서가 아니다.
 * 세 관례를 그대로 옮긴다 — **방어적 읽기**(DB가 안 열리거나 값이 깨져도 빈 목록으로 시작한다) ·
 * **주입 가능**(`IDBFactory`를 인자로 받아 테스트가 가짜를 넣는다) · **어휘 검증**(형태가
 * 어긋난 레코드는 화면까지 가지 않는다).
 *
 * ⚠️ **딱 하나 다른 것: 저장 실패를 삼키지 않는다.** `storage.ts`의 `write`는 실패해도 화면이
 * 돌게 조용히 넘어가지만, 방금 찍은 사진이 소리 없이 증발하면 사용자는 **한 달 뒤에야** 안다.
 * `savePhoto`는 결과를 세 상(`ok`/`quota`/`fail`)으로 돌려주고, 화면이 그걸 받아 안내를
 * 띄운다(설계 §5-1).
 *
 * ⚠️ 기기를 바꾸면 사진이 날아간다. 클라우드 백업은 기록과 같은 의도적 보류다.
 */

const DB_NAME = 'facefit-photos';
const STORE = 'photos';

/**
 * 보관 상한. 1년 치 ≈ 최대 70MB로, 넘으면 저장할 때 가장 오래된 것부터 지운다.
 *
 * 무제한으로 두면 쿼터 초과가 「그날 사진이 저장 안 됨」으로 나타난다 — 사용자에게는
 * 원인 없는 증발로 보인다. 1년 넘게 찍은 사람의 기준 사진이 이때 밀려나는데,
 * **1년 전 얼굴은 이미 기준이 아니다**(설계 §4-1).
 */
export const PHOTO_MAX = 365;

export type FacePhoto = {
  /**
   * `todayKey()`가 주는 KST `YYYY-MM-DD`. **이것이 키다** —
   * 같은 날 다시 찍으면 `put`이 덮어써서 「하루 1장」에 분기가 0줄 든다.
   */
  date: string;
  blob: Blob;
  /** 같은 날 재촬영 판별용 부차 정보. 정렬은 `date`가 한다. */
  capturedAt: number;
  /** 저장본 픽셀 크기 — 타임랩스·캘린더 시트가 이미지 로드 전에 자리를 잡는 데 쓴다. */
  width: number;
  height: number;
};

export type PhotoDb = IDBDatabase;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 어휘 검증. **`blob`이 Blob이 아니면 `createObjectURL`에서 화면이 죽는다** — 옛 버전이
 * 남겼거나 손상된 레코드 한 장 때문에 나머지 1년 치를 못 보는 일은 없어야 한다.
 * `date`까지 보는 것은 정렬과 날짜 표시가 둘 다 그 형태를 전제하기 때문이다.
 */
function isPhoto(v: unknown): v is FacePhoto {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as FacePhoto;
  return (
    typeof p.date === 'string' &&
    DATE_RE.test(p.date) &&
    p.blob instanceof Blob &&
    typeof p.capturedAt === 'number' &&
    typeof p.width === 'number' &&
    typeof p.height === 'number'
  );
}

/**
 * DB를 연다. **`null`은 「이 환경에서는 사진을 못 쓴다」는 뜻**이고, 화면은 그걸 받아
 * 안내로 빠진다 — 프라이빗 모드·구형 웹뷰에서 앱 전체가 죽는 대신 사진 기능만 접힌다.
 */
export function openPhotoDb(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<PhotoDb | null> {
  // ⚠️ 아래 try/catch가 이 줄을 덮으므로 지워도 결과는 같다(돌연변이가 살아남아 확인했다).
  // 그래도 남기는 이유: 「IDB가 없는 환경」은 예외가 아니라 **설계된 경로**다. 이 줄을 걷으면
  // `undefined.open()`이 던지는 TypeError에 기대는 꼴이 되어, 의도가 코드에서 사라진다.
  if (!idb) return Promise.resolve(null);

  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    // 프라이빗 모드의 일부 브라우저는 open 호출 자체가 던진다 — 이벤트까지 못 간다.
    try {
      req = idb.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // 다른 탭이 옛 버전을 붙들고 있으면 영영 안 열린다. 화면이 「여는 중」에서 굳지 않게 끝낸다.
    req.onblocked = () => resolve(null);
  });
}

/**
 * 저장 결과. **`quota`를 따로 두는 이유는 그 경우에만 사용자가 할 수 있는 일이 있어서다** —
 * 「공간이 부족해요, 오래된 사진을 지워 주세요」와 「잠시 후 다시 시도해 주세요」는
 * 서로에게 거짓말이다(설계 §5.3).
 *
 * ⚠️ **입력 검증 실패도 `fail`로 묶는다.** 그건 사용자가 아니라 우리 버그 신호인데, 별도 상을
 * 주면 화면이 보여 줄 문구가 없는 상태만 하나 는다.
 */
export type SaveResult = 'ok' | 'quota' | 'fail';

/**
 * 한 장 저장 + 상한 프루닝. **`ok`가 아니면 호출자가 반드시 화면에 드러낸다.**
 *
 * `add`가 아니라 `put`인 것이 「하루 1장」의 구현 전부다 — 같은 날짜면 조용히 교체된다.
 */
export function savePhoto(db: PhotoDb, photo: FacePhoto): Promise<SaveResult> {
  // ⚠️ **쓰기 경계에서 막는다.** 깨진 레코드가 들어가면 저장은 `true`로 보고되는데 목록에는
  // 안 뜬다 — 읽기 쪽 어휘 검증이 걸러 내기 때문이다. 그런데 프루닝은 **원시 키를 세므로**
  // 그 유령이 정원 한 자리를 차지하고, 상한에 닿는 날 **기준 사진(가장 오래된 유효 사진)이
  // 대신 밀려난다.** 여기서 한 줄로 막으면 프루닝은 손댈 것이 없다.
  if (!isPhoto(photo)) return Promise.resolve('fail');

  return new Promise((resolve) => {
    let tx: IDBTransaction;
    // DB가 닫혔거나 스토어가 없으면 여기서 던진다.
    try {
      tx = db.transaction(STORE, 'readwrite');
    } catch {
      return resolve('fail');
    }
    // 핸들러가 닫아 잡을 별칭. `let`을 그대로 잡으면 「할당 전 사용」으로 읽힐 수 있다.
    const opened = tx;
    const store = tx.objectStore(STORE);
    store.put(photo);

    // 프루닝은 같은 트랜잭션 안에서 한다 — 저장이 실패했는데 삭제만 남는 순서를 만들지 않는다.
    // 키가 'YYYY-MM-DD'라 **사전순이 곧 시간순**이고, getAllKeys는 오름차순이다.
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const over = keys.result.length - PHOTO_MAX;
      for (let i = 0; i < over; i++) store.delete(keys.result[i]);
    };

    /**
     * 실패 상은 **트랜잭션의 `error`가 정한다** — 여기서 이름을 안 읽으면 「공간이 부족해요」와
     * 「잠시 후 다시」가 한 문구로 뭉개져, 공간이 멀쩡한 사람에게 사진을 지우라고 시키거나
     * 정말 꽉 찬 사람에게 영영 되는 일 없는 재시도를 권하게 된다.
     *
     * ⚠️ `error`가 비는 경로(요청 에러 없이 끊긴 abort)가 있어서 `fail`이 기본값이다.
     */
    const failed = () => resolve(opened.error?.name === 'QuotaExceededError' ? 'quota' : 'fail');

    tx.oncomplete = () => resolve('ok');
    // 쿼터 초과(QuotaExceededError)가 여기로 온다. 삼키면 사진이 소리 없이 증발한다.
    tx.onerror = failed;
    tx.onabort = failed;
  });
}

/**
 * 전부. **날짜 오름차순이라 `[0]`이 기준 사진**(남아 있는 가장 오래된 것)이고,
 * 마지막이 최신이다 — 고스트 오버레이와 비교 화면이 이 순서에 기댄다.
 *
 * 정렬 코드가 없는 것은 실수가 아니다. `getAll`은 스펙상 키 오름차순으로 돌려주고,
 * 키가 곧 날짜다. 목록이 커야 365개라 인덱스·커서 최적화도 안 한다.
 */
export function listPhotos(db: PhotoDb): Promise<FacePhoto[]> {
  return new Promise((resolve) => {
    let req: IDBRequest<unknown[]>;
    try {
      req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    } catch {
      return resolve([]);
    }
    req.onsuccess = () => resolve(req.result.filter(isPhoto));
    req.onerror = () => resolve([]);
  });
}

/**
 * 한 장 삭제. **첫 장을 지우면 다음으로 오래된 사진이 기준이 된다** — v1에서 「기준 바꾸기」는
 * 별도 상태 없이 이것으로 한다(설계 §1-3).
 */
export function deletePhoto(db: PhotoDb, date: string): Promise<void> {
  return run(db, (store) => store.delete(date));
}

/** 전체 삭제. 프라이버시 기능이라 v1에서 뺄 수 없다(설계 §1-6 — 기록 탭 하단으로 계승). */
export function clearPhotos(db: PhotoDb): Promise<void> {
  return run(db, (store) => store.clear());
}

/**
 * 삭제 계열 공통. 실패해도 던지지 않는다 — 화면이 다음에 읽을 목록이 진실이고,
 * 안 지워졌으면 그 사진이 그대로 보인다(사용자가 다시 누를 수 있다).
 */
function run(db: PhotoDb, op: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, 'readwrite');
    } catch {
      return resolve();
    }
    op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}
