import { describe, expect, it } from 'vitest';

import {
  isNotifyPrompted,
  isOnboarded,
  loadNotes,
  loadProducts,
  newId,
  PRODUCT_MAX,
  saveNote,
  saveNotifyPrompted,
  saveOnboarded,
  saveProducts,
  todayKey,
  type Product,
} from './storage';

/**
 * localStorage 영속.
 *
 * 여기서 잠그는 것은 **로더의 방어 강도가 필드마다 다르다**는 것이다 — 없으면 화면이 죽거나
 * 계산이 어긋나는 필드(`name`·`startDate`)는 레코드째 기각하고, 표시에만 쓰이는 필드
 * (`category`·`endDate`)는 **그 필드만 고쳐 레코드를 살린다.** 한 벌로 뭉치면 어느 쪽이든
 * 손해다 — 다 기각하면 카테고리 어휘 하나 바꿨다고 기록이 통째로 사라지고, 다 살리면
 * 시작일 없는 제품이 구간 바를 NaN으로 만든다.
 */
function fakeStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    getItem(k) {
      if (opts.throwOnGet) throw new Error('boom');
      return map.get(k) ?? null;
    },
    setItem(k, v) {
      if (opts.throwOnSet) throw new Error('boom');
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** 날것으로 밀어 넣는다 — 「옛 버전이 남긴 형태」는 정의상 오늘의 저장 함수를 안 거쳤다. */
function seed(s: Storage, key: string, raw: unknown) {
  s.setItem(key, typeof raw === 'string' ? raw : JSON.stringify(raw));
}

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-01',
  ...over,
});

describe('todayKey', () => {
  it('한국 시간 기준 YYYY-MM-DD를 준다', () => {
    // UTC 2026-08-29 00:30 → KST로는 이미 09:30, 같은 날이다.
    expect(todayKey(new Date('2026-08-29T00:30:00Z'))).toBe('2026-08-29');
  });

  it('UTC로 자르면 전날이 되는 시각도 한국 날짜로 찍는다', () => {
    // ⚠️ 여기가 이 함수의 존재 이유다. UTC 2026-08-28 20:00은 KST로 **다음 날 새벽 5시**다.
    // UTC로 자르면 사진 키가 하루 밀려, 「오늘 찍은 사진」이 어제 칸에 들어간다.
    expect(todayKey(new Date('2026-08-28T20:00:00Z'))).toBe('2026-08-29');
  });

  it('시간대를 바꾸면 답이 달라진다 — 옵션이 실제로 쓰인다는 유일한 증거', () => {
    /*
      ⚠️ 개발 기계가 KST라 `timeZone` 옵션을 통째로 빼도 위 두 테스트가 그대로 통과한다
      (restfit에서 돌연변이가 살아남아 발각됐다). 다른 시간대를 주입해 값이 갈리는지로
      옵션이 죽지 않았음을 잠근다.
    */
    const t = new Date('2026-08-28T20:00:00Z');
    expect(todayKey(t, 'UTC')).toBe('2026-08-28');
    expect(todayKey(t, 'Asia/Seoul')).toBe('2026-08-29');
  });
});

describe('newId', () => {
  it('부를 때마다 다른 값이다 — 같으면 목록에서 두 제품이 한 칸으로 접힌다', () => {
    expect(newId()).not.toBe(newId());
  });

  it('`crypto.randomUUID`가 없는 구형 웹뷰에서도 값을 준다', () => {
    const saved = globalThis.crypto;
    // 토스 웹뷰의 구형 엔진에는 없을 수 있다. 여기서 던지면 제품 추가 버튼이 통째로 죽는다.
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(newId()).toMatch(/\S/);
      expect(newId()).not.toBe(newId());
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: saved });
    }
  });
});

describe('제품 — loadProducts / saveProducts', () => {
  it('저장한 것을 그대로 돌려준다', () => {
    const s = fakeStorage();
    saveProducts([product(), product({ id: 'p2', name: '세럼', category: 'serum' })], s);

    expect(loadProducts(s).map((p) => p.name)).toEqual(['토너', '세럼']);
  });

  it('아무것도 없으면 빈 목록이다', () => {
    expect(loadProducts(fakeStorage())).toEqual([]);
  });

  it('깨진 JSON도 빈 목록이다 — 앱이 죽는 대신 빈손으로 시작한다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', '{{{');
    expect(loadProducts(s)).toEqual([]);
  });

  it('저장소가 막혀 있어도 던지지 않는다 — 프라이빗 모드', () => {
    expect(loadProducts(fakeStorage({ throwOnGet: true }))).toEqual([]);
    expect(() => saveProducts([product()], fakeStorage({ throwOnSet: true }))).not.toThrow();
  });

  it('배열이 아니면 빈 목록이다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', { nope: 1 });
    expect(loadProducts(s)).toEqual([]);
  });

  it('이름이 비면 레코드째 기각한다 — 목록에 이름 없는 줄이 서면 지울 수도 없다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', [product({ id: 'a', name: '' }), product({ id: 'b', name: '   ' }), product({ id: 'c' })]);

    expect(loadProducts(s).map((p) => p.id)).toEqual(['c']);
  });

  it('시작일 형태가 어긋나면 레코드째 기각한다 — 구간 바가 이 형태를 전제한다', () => {
    // 날짜 → 분율 환산이 NaN이 되면 타임랩스의 제품 막대가 통째로 안 그려진다.
    const s = fakeStorage();
    seed(s, 'facefit.products', [product({ id: 'a', startDate: '2026/08/01' }), product({ id: 'b', startDate: undefined as never }), product({ id: 'c' })]);

    expect(loadProducts(s).map((p) => p.id)).toEqual(['c']);
  });

  it('카테고리가 어휘 밖이면 etc로 강등하되 레코드는 살린다 — 기록은 귀하다', () => {
    // 기각하면 카테고리 어휘를 한 번 손보는 순간 그 제품 기록이 통째로 사라진다.
    // 카테고리는 **표시용 칩 하나**라, 틀린 값이 남아서 잃는 것보다 레코드를 잃는 쪽이 크다.
    const s = fakeStorage();
    seed(s, 'facefit.products', [product({ category: 'essence' as never })]);

    const [got] = loadProducts(s);
    expect(got.category).toBe('etc');
    expect(got.name).toBe('토너');
  });

  it('종료일이 시작일보다 앞이면 종료일만 버린다 — 「사용 중」으로 되돌아간다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', [product({ startDate: '2026-08-10', endDate: '2026-08-01' })]);

    const [got] = loadProducts(s);
    expect(got.endDate).toBeUndefined();
    expect(got.startDate).toBe('2026-08-10');
  });

  it('종료일 형태가 어긋나도 종료일만 버린다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', [product({ endDate: 'yesterday' })]);

    expect(loadProducts(s)[0].endDate).toBeUndefined();
  });

  it('같은 날 시작하고 끝낸 제품은 종료일이 살아 있다 — 경계는 허용이다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', [product({ startDate: '2026-08-10', endDate: '2026-08-10' })]);

    expect(loadProducts(s)[0].endDate).toBe('2026-08-10');
  });

  it('모르는 필드를 떨구지 않는다 — v2가 스키마 마이그레이션 없이 얹힌다', () => {
    /*
      ⚠️ 로더가 `{ id, name, category, startDate }`로 **재조립**하면, v2에서 성분표 사진 키
      같은 필드를 얹는 순간 앱을 한 번 열기만 해도 그 값이 조용히 증발한다. 필수 필드만
      검사하고 나머지는 그대로 흘려보낸다.
    */
    const s = fakeStorage();
    seed(s, 'facefit.products', [{ ...product(), ingredientPhotoKey: '2026-08-01', memo: '재구매' }]);

    const [got] = loadProducts(s) as (Product & { ingredientPhotoKey?: string; memo?: string })[];
    expect(got.ingredientPhotoKey).toBe('2026-08-01');
    expect(got.memo).toBe('재구매');
  });

  it('강등할 때도 모르는 필드는 남는다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.products', [{ ...product({ category: 'essence' as never }), memo: '재구매' }]);

    const [got] = loadProducts(s) as (Product & { memo?: string })[];
    expect({ category: got.category, memo: got.memo }).toEqual({ category: 'etc', memo: '재구매' });
  });

  it(`${PRODUCT_MAX}개를 넘기면 최근 것만 남는다 — 쿼터 방어일 뿐이다`, () => {
    const s = fakeStorage();
    const many = Array.from({ length: PRODUCT_MAX + 3 }, (_, i) => product({ id: `p${i}`, name: `제품${i}` }));
    seed(s, 'facefit.products', many);

    const got = loadProducts(s);
    expect(got).toHaveLength(PRODUCT_MAX);
    // 앞에서 자른다 — 뒤에서 자르면 방금 등록한 제품이 저장하자마자 사라진다.
    expect(got[0].id).toBe('p3');
  });
});

describe('관찰 기록 — loadNotes / saveNote', () => {
  it('하루에 하나, 재답변은 덮어쓴다', () => {
    const s = fakeStorage();
    saveNote('2026-08-29', 'same', s);
    saveNote('2026-08-29', 'better', s);
    saveNote('2026-08-28', 'worse', s);

    expect(loadNotes(s)).toEqual({ '2026-08-29': 'better', '2026-08-28': 'worse' });
  });

  it('아무것도 없으면 빈 객체다', () => {
    expect(loadNotes(fakeStorage())).toEqual({});
  });

  it('깨진 JSON도 빈 객체다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.notes', 'nope');
    expect(loadNotes(s)).toEqual({});
  });

  it('배열이 들어와도 빈 객체다 — 옛 버전이 목록으로 저장했을 수 있다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.notes', ['better']);
    expect(loadNotes(s)).toEqual({});
  });

  it('어휘 밖 답은 그 날짜만 버린다 — 나머지 날은 남는다', () => {
    // 사진과 독립 저장이라 이게 v2 추천의 유일한 「피부 판정」 재료다. 통째로 버리면 그만큼이 공백이 된다.
    const s = fakeStorage();
    seed(s, 'facefit.notes', { '2026-08-27': 'amazing', '2026-08-28': 'better', '2026-08-29': 42 });

    expect(loadNotes(s)).toEqual({ '2026-08-28': 'better' });
  });

  it('저장소가 막혀 있어도 던지지 않는다', () => {
    expect(loadNotes(fakeStorage({ throwOnGet: true }))).toEqual({});
    expect(() => saveNote('2026-08-29', 'same', fakeStorage({ throwOnSet: true }))).not.toThrow();
  });
});

describe('온보딩 — isOnboarded / saveOnboarded', () => {
  it('처음에는 안 본 상태다 — 그게 온보딩을 띄울 유일한 근거다', () => {
    expect(isOnboarded(fakeStorage())).toBe(false);
  });

  it('한 번 보면 다시 안 뜬다', () => {
    const s = fakeStorage();
    saveOnboarded(s);
    expect(isOnboarded(s)).toBe(true);
  });

  it('엉뚱한 값이 들어 있으면 안 본 것으로 친다 — 온보딩을 한 번 더 보는 편이 안전하다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.onboarded', 'yes');
    expect(isOnboarded(s)).toBe(false);
  });

  it('저장소가 막혀 있어도 던지지 않는다', () => {
    expect(isOnboarded(fakeStorage({ throwOnGet: true }))).toBe(false);
    expect(() => saveOnboarded(fakeStorage({ throwOnSet: true }))).not.toThrow();
  });
});

/**
 * 알림 동의를 **자동으로 권한 적이 있는가**(설계 §3-2). 동의했는가가 아니다 — 동의 여부의
 * 단일 출처는 토스이고, 앱에 사본을 두면 사용자가 철회한 순간 반드시 어긋난다.
 *
 * 이 플래그가 하는 일은 하나뿐이다: **자동 제안은 딱 한 번**. 거절한 사람에게 매번 다시 묻지 않는다.
 */
describe('알림 제안 이력 — isNotifyPrompted / saveNotifyPrompted', () => {
  it('처음에는 아직 안 물어본 상태다 — 그게 제안을 띄울 유일한 근거다', () => {
    expect(isNotifyPrompted(fakeStorage())).toBe(false);
  });

  it('한 번 물어보면 다시 자동으로 묻지 않는다', () => {
    const s = fakeStorage();
    saveNotifyPrompted(s);
    expect(isNotifyPrompted(s)).toBe(true);
    // 온보딩 플래그와 **다른 칸**이다. 키를 복사해 오면 알림을 한 번 권한 것이 온보딩을
    // 본 것으로도 읽혀, 고지를 못 본 사람이 곧장 카메라로 간다.
    expect(isOnboarded(s)).toBe(false);
  });

  it('키는 `facefit.notifyPrompted`다 — 게터·세터가 나란히 오타 나면 아무도 못 잡는다', () => {
    // 짝지어 쓰고 읽는 테스트만 있으면 **키 오타가 통과한다**(실측: `notifyPromted` 돌연변이가
    // 292케이스를 전부 살아남았다). 저장된 기록은 앱 업데이트를 건너 살아야 하므로 리터럴로 박는다.
    const s = fakeStorage();
    seed(s, 'facefit.notifyPrompted', '1');
    expect(isNotifyPrompted(s)).toBe(true);
  });

  it('엉뚱한 값이 들어 있으면 안 물어본 것으로 친다 — 한 번 더 묻는 쪽이 영영 못 묻는 것보다 낫다', () => {
    const s = fakeStorage();
    seed(s, 'facefit.notifyPrompted', 'yes');
    expect(isNotifyPrompted(s)).toBe(false);
  });

  it('저장소가 막혀 있어도 던지지 않는다 — 촬영 흐름이 알림 때문에 죽으면 주객전도다', () => {
    expect(isNotifyPrompted(fakeStorage({ throwOnGet: true }))).toBe(false);
    expect(() => saveNotifyPrompted(fakeStorage({ throwOnSet: true }))).not.toThrow();
  });
});
