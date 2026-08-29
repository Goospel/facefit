import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import {
  PHOTO_MAX,
  clearPhotos,
  deletePhoto,
  listPhotos,
  openPhotoDb,
  savePhoto,
  type FacePhoto,
  type PhotoDb,
} from './photoStore';

/**
 * 사진 저장소. **IDB는 jsdom에 없어서 `fake-indexeddb`를 주입해 실제 호출 경로를 태운다** —
 * 트랜잭션·이벤트 루프를 몇 줄로 흉내 내면 그 흉내를 테스트하는 꼴이 된다.
 *
 * 여기서 잠그는 것은 넷이다: **날짜가 키라서 하루 1장이 저절로 된다** · 상한을 넘으면
 * **오래된 것부터** 빠진다 · 깨진 값은 목록에서 조용히 빠진다 · 그리고 `storage.ts`와
 * 정반대로 **저장 실패는 호출자에게 드러난다**(방금 찍은 사진이 소리 없이 증발하면
 * 사용자는 한 달 뒤에야 안다) — 그것도 **쿼터 초과와 그 외를 갈라서**(화면 문구가 다르다).
 */
describe('photoStore', () => {
  /** 팩토리를 새로 만들면 DB도 새것이다 — 테스트끼리 사진이 새지 않는다. */
  const freshIdb = () => new IDBFactory() as unknown as IDBFactory;

  /** `2025-01-01`부터 i일 뒤. 상한 테스트가 한 달을 넘겨서 문자열 조립으로는 모자란다. */
  const dayKey = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

  const photo = (date: string, over: Partial<FacePhoto> = {}): FacePhoto => ({
    date,
    blob: new Blob([date], { type: 'image/jpeg' }),
    capturedAt: 1_700_000_000_000,
    width: 960,
    height: 1280,
    ...over,
  });

  async function open(): Promise<PhotoDb> {
    const db = await openPhotoDb(freshIdb());
    if (!db) throw new Error('테스트 전제가 깨졌다 — fake-indexeddb가 안 열렸다');
    return db;
  }

  /**
   * `savePhoto`를 우회한 날것 쓰기. 「옛 버전이 남긴 손상 레코드」는 정의상 오늘의 쓰기 검증을
   * 안 거쳤으므로, 읽기 쪽 방어를 재려면 이 경로가 필요하다.
   *
   * ⚠️ 스토어 이름 리터럴이 구현과 이중 기재다 — 바뀌면 여기서 요란하게 깨진다(그게 낫다).
   */
  function putRaw(db: PhotoDb, record: unknown): Promise<void> {
    return new Promise((resolve) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(record as never);
      tx.oncomplete = () => resolve();
    });
  }

  /** 어휘 검증을 안 거친 **원시 레코드 수**. 프루닝이 세는 것과 같은 수라서 이걸로 재야 한다. */
  function countRaw(db: PhotoDb): Promise<number> {
    return new Promise((resolve) => {
      const req = db.transaction('photos', 'readonly').objectStore('photos').count();
      req.onsuccess = () => resolve(req.result);
    });
  }

  describe('openPhotoDb', () => {
    it('IDB가 없는 환경은 null로 끝난다 — 화면이 안내로 빠지는 유일한 신호다', async () => {
      // 던지지 않는다. 프라이빗 모드·구형 웹뷰에서 앱이 죽는 대신 사진 기능만 접힌다.
      await expect(openPhotoDb(undefined)).resolves.toBeNull();
    });

    it('여는 데 실패해도 null이지 예외가 아니다', async () => {
      const broken = { open: () => { throw new DOMException('blocked', 'SecurityError'); } } as unknown as IDBFactory;
      await expect(openPhotoDb(broken)).resolves.toBeNull();
    });
  });

  describe('savePhoto / listPhotos', () => {
    it('저장한 사진을 날짜 오름차순으로 돌려준다 — [0]이 기준 사진이다', async () => {
      const db = await open();

      // 일부러 뒤죽박죽 넣는다. 순서가 넣은 순서가 아니라 날짜순이어야 고스트가 기준을 짚는다.
      expect(await savePhoto(db, photo('2025-03-02'))).toBe('ok');
      expect(await savePhoto(db, photo('2025-01-05'))).toBe('ok');
      expect(await savePhoto(db, photo('2025-02-01'))).toBe('ok');

      expect((await listPhotos(db)).map((p) => p.date)).toEqual(['2025-01-05', '2025-02-01', '2025-03-02']);
    });

    it('Blob과 메타를 그대로 되돌려준다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05', { capturedAt: 42, width: 720, height: 960 }));

      const [got] = await listPhotos(db);
      expect(got.blob).toBeInstanceOf(Blob);
      expect(await got.blob.text()).toBe('2025-01-05');
      expect(got.blob.type).toBe('image/jpeg');
      expect({ capturedAt: got.capturedAt, width: got.width, height: got.height }).toEqual({
        capturedAt: 42,
        width: 720,
        height: 960,
      });
    });

    it('같은 날 다시 찍으면 교체된다 — 「하루 1장」은 날짜가 키인 것의 결과다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05', { capturedAt: 1 }));

      expect(await savePhoto(db, photo('2025-01-05', { capturedAt: 2, width: 111 }))).toBe('ok');

      const list = await listPhotos(db);
      expect(list).toHaveLength(1);
      // 두 번째 것이 남아야 한다. 첫 장이 이겨 버리면 「다시 찍기」가 아무 일도 안 한 것과 같다.
      expect(list[0].capturedAt).toBe(2);
      expect(list[0].width).toBe(111);
    });

    it('DB가 못 쓰게 되면 빈 목록이다 — 화면은 「사진 없음」으로 돈다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05'));
      db.close();

      await expect(listPhotos(db)).resolves.toEqual([]);
    });

    it('깨진 값은 목록에서 빠진다 — 어휘 밖 레코드가 화면까지 가지 않는다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05'));
      // ⚠️ **`savePhoto`를 우회해 밀어 넣는다.** 이제 쓰기 경계가 막으므로, savePhoto로 넣으면
      // 애초에 저장이 안 돼 「읽기 쪽 방어」가 관측되지 않는다(테스트가 공허해진다). 실제로도
      // 손상 레코드는 옛 버전이 남긴 것이라 **오늘의 검증을 안 거친 채** DB에 있다.
      await putRaw(db, { date: '2025-01-06', blob: 'not-a-blob', capturedAt: 1, width: 1, height: 1 });
      // 날짜 어휘(YYYY-MM-DD) 밖. 정렬도 비교 화면의 날짜 표시도 이 형태를 전제한다.
      await putRaw(db, { ...photo('2025-01-07'), date: 'nope' });

      expect((await listPhotos(db)).map((p) => p.date)).toEqual(['2025-01-05']);
    });

    it('깨진 값은 저장 자체를 거부한다 — 유령이 정원을 차지하면 기준 사진이 밀려난다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05'));

      // 읽기 쪽이 걸러 주니 저장은 통과시켜도 된다고 보기 쉬운데, **프루닝은 원시 키를 센다** —
      // 목록에 안 보이는 레코드가 상한 한 자리를 먹고, 정원이 찬 날 가장 오래된 유효 사진이
      // 대신 지워진다. 그래서 읽기 방어가 있어도 쓰기에서 막아야 한다.
      // 입력 검증 실패는 쿼터가 아니라 **버그 신호**라 `'fail'`로 묶는다 — 별도 상을 주면
      // 화면이 사용자에게 보여 줄 문구가 없는 상태가 하나 더 는다.
      expect(await savePhoto(db, { ...photo('2025-01-06'), blob: 'not-a-blob' } as unknown as FacePhoto)).toBe('fail');

      // 레코드 수 불변 — 걸러진 게 아니라 **애초에 안 들어갔다**는 뜻이다.
      await expect(countRaw(db)).resolves.toBe(1);
    });
  });

  describe('상한 프루닝', () => {
    it(`${PHOTO_MAX}장을 넘기면 가장 오래된 것부터 빠진다`, async () => {
      const db = await open();
      for (let i = 0; i < PHOTO_MAX; i++) await savePhoto(db, photo(dayKey(i)));
      expect(await listPhotos(db)).toHaveLength(PHOTO_MAX);

      expect(await savePhoto(db, photo(dayKey(PHOTO_MAX)))).toBe('ok');

      const list = await listPhotos(db);
      expect(list).toHaveLength(PHOTO_MAX);
      // 방금 찍은 것이 남고, 맨 앞 하루가 밀려난다. 반대로 자르면 오늘 사진이 증발한다.
      expect(list[0].date).toBe(dayKey(1));
      expect(list[list.length - 1].date).toBe(dayKey(PHOTO_MAX));
    });
  });

  describe('저장 실패는 삼키지 않는다', () => {
    /**
     * 실패한 트랜잭션 흉내. **어떤 이벤트가 발화하는지가 이 목의 전부다** — 실패 경로마다
     * 발화 조합이 달라서, 하나로 뭉치면 안 걸리는 핸들러가 생긴다(리뷰 실측으로 걸렸다).
     */
    function failingDb(fire: ('error' | 'abort')[], error: DOMException | null = null): PhotoDb {
      const store = { put: () => ({}), getAllKeys: () => ({}), delete: () => ({}) };
      const tx: Record<string, unknown> = {
        objectStore: () => store,
        // 실패 원인은 **트랜잭션의 `error`에만** 남는다 — 이걸 안 읽으면 쿼터 초과와
        // 그 밖의 실패가 화면에서 같은 문구가 된다(「다시 시도」는 쿼터엔 거짓말이다).
        error,
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      setTimeout(() => {
        for (const e of fire) (tx[`on${e}`] as (() => void) | null)?.();
      }, 0);
      return { transaction: () => tx } as unknown as PhotoDb;
    }

    const quota = () => new DOMException('quota', 'QuotaExceededError');

    it('쿼터 초과는 quota다 — "공간이 부족해요"를 띄울 유일한 근거', async () => {
      // storage.ts의 write는 실패를 삼키지만 여기서만은 다르다(설계 §5.1의 유일한 이탈).
      // 발화 순서 `error → abort`는 fake-indexeddb 실측값이다 — 실전에서 반환값을 정하는 것은
      // **먼저 오는 onerror**다.
      await expect(savePhoto(failingDb(['error', 'abort'], quota()), photo('2025-01-05'))).resolves.toBe('quota');
    });

    it('쿼터 초과가 abort로만 와도 quota다 — 브라우저마다 발화 조합이 다르다', async () => {
      await expect(savePhoto(failingDb(['abort'], quota()), photo('2025-01-05'))).resolves.toBe('quota');
    });

    it('쿼터가 아닌 실패는 fail이다 — 문구가 갈린다', async () => {
      // 「공간이 부족해요 — 오래된 사진을 지워 주세요」를 아무 실패에나 띄우면, 공간이
      // 멀쩡한 사람에게 사진을 지우라고 시키는 꼴이 된다.
      const other = new DOMException('gone', 'InvalidStateError');
      await expect(savePhoto(failingDb(['error'], other), photo('2025-01-05'))).resolves.toBe('fail');
    });

    it('원인을 모르는 실패도 fail이다 — tx.error가 비어 있는 경로', async () => {
      await expect(savePhoto(failingDb(['error']), photo('2025-01-05'))).resolves.toBe('fail');
    });

    it('onabort만 와도 끝난다 — 요청 에러 없이 끊기면 이쪽만 발화한다', async () => {
      // 강제 close·version change처럼 **요청 에러 없이** 트랜잭션이 끊기는 경로가 있다.
      // 이 핸들러가 없으면 promise가 영영 pending이라 확인 화면이 「저장 중」에서 굳는다 —
      // 실패를 돌려주는 것보다 나쁘다.
      await expect(savePhoto(failingDb(['abort']), photo('2025-01-05'))).resolves.toBe('fail');
    });

    it('DB가 닫혀 있어도 던지지 않고 fail이다', async () => {
      const db = await open();
      db.close();

      await expect(savePhoto(db, photo('2025-01-05'))).resolves.toBe('fail');
    });
  });

  describe('deletePhoto / clearPhotos', () => {
    it('한 장만 지운다 — 나머지 날짜는 남는다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05'));
      await savePhoto(db, photo('2025-01-06'));

      await deletePhoto(db, '2025-01-05');

      expect((await listPhotos(db)).map((p) => p.date)).toEqual(['2025-01-06']);
    });

    it('전체 삭제는 비운다 — 프라이버시 기능이라 v1에서 뺄 수 없다', async () => {
      const db = await open();
      await savePhoto(db, photo('2025-01-05'));
      await savePhoto(db, photo('2025-01-06'));

      await clearPhotos(db);

      expect(await listPhotos(db)).toEqual([]);
    });

    it('DB가 닫혀 있어도 던지지 않는다', async () => {
      const db = await open();
      db.close();

      await expect(deletePhoto(db, '2025-01-05')).resolves.toBeUndefined();
      await expect(clearPhotos(db)).resolves.toBeUndefined();
    });
  });
});
