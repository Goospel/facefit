import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE, buildBackupBlob, deleteBackup, fetchBackup, getBackupKey, uploadBackup } from './backup';
import type { Product } from '../storage';

/**
 * 백업 클라이언트(설계 §4-3).
 *
 * 이 모듈의 규율은 notify.ts와 **동형**이다 — SDK가 던지는 것을 삼키고, 어떤 실패도 밖으로
 * 던지지 않는다. 서버가 죽어도 앱은 v2와 똑같이 돌아야 하기 때문이다(설계 §0).
 * 그래서 여기 테스트의 절반이 「실패해도 안 던진다」를 확인한다.
 *
 * 가장 중요한 것은 {@link buildBackupBlob} 쪽이다 — **사진 바이트는 서버에 올라가지 않는다**는
 * 불변식의 클라이언트 절반이 거기 있다. 서버도 막지만(2,000자 상한), 애초에 **보낼 코드가
 * 없는 것**이 1차 방어다.
 */
const { getAnonymousKey } = vi.hoisted(() => ({
  getAnonymousKey: Object.assign(vi.fn(), { isSupported: vi.fn() }),
}));

vi.mock('@apps-in-toss/web-framework', () => ({ User: { getAnonymousKey } }));

const KEY = 'anon-hash-abcdef0123456789';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토리든 다이브인 세럼',
  category: 'serum',
  startDate: '2026-08-01',
  ...over,
});

/** 응답 하나짜리 가짜 fetch. 실제 네트워크는 이 모듈의 관심사가 아니다. */
function fakeFetch(init: { status: number; body?: string } | Error) {
  if (init instanceof Error) return vi.fn().mockRejectedValue(init);
  return vi.fn().mockResolvedValue({
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    text: async () => init.body ?? '',
    json: async () => JSON.parse(init.body ?? 'null'),
  } as unknown as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAnonymousKey.isSupported.mockReturnValue(true);
  getAnonymousKey.mockResolvedValue({ type: 'HASH', hash: KEY });
});

describe('buildBackupBlob — 불변식의 클라이언트 절반', () => {
  it('최상위 키가 정확히 넷이다 — 여기 하나가 늘면 서버가 400으로 막는다', () => {
    const blob = buildBackupBlob([product()], { '2026-09-01': 'better' }, '2026-09-01T00:00:00.000Z');

    expect(Object.keys(blob).sort()).toEqual(['clientSavedAt', 'notes', 'products', 'schemaVersion']);
  });

  it('제품·관찰을 그대로 싣는다 — 서버는 이 안을 불투명하게 저장한다', () => {
    const p = product({ mfds: undefined });

    const blob = buildBackupBlob([p], { '2026-09-01': 'worse' }, '2026-09-01T00:00:00.000Z');

    expect(blob.products).toEqual([p]);
    expect(blob.notes).toEqual({ '2026-09-01': 'worse' });
    expect(blob.schemaVersion).toBe(1);
  });

  it('사진을 실을 자리가 아예 없다 — 직렬화 결과에 사진 키가 나타나지 않는다', () => {
    // 이 테스트가 지키는 것은 코드가 아니라 **약속**이다: 「사진은 이 기기에만 저장되며
    // 어디로도 전송되지 않습니다」가 글자 그대로 참이어야 한다(온보딩 고지·검수 통과 문구).
    const json = JSON.stringify(buildBackupBlob([product()], {}, '2026-09-01T00:00:00.000Z'));

    expect(json).not.toMatch(/photo|image|dataUri|base64/i);
  });
});

describe('getBackupKey — SDK 래퍼', () => {
  it('성공하면 hash를 준다', async () => {
    await expect(getBackupKey()).resolves.toBe(KEY);
  });

  it('미지원 버전이면 SDK를 아예 안 부른다 — 부르면 던지는 API다', async () => {
    getAnonymousKey.isSupported.mockReturnValue(false);

    await expect(getBackupKey()).resolves.toBeNull();
    expect(getAnonymousKey).not.toHaveBeenCalled();
  });

  it('isSupported가 던져도 null이다 — 토스 밖에서는 그 전역이 없어 TypeError가 난다', async () => {
    getAnonymousKey.isSupported.mockImplementation(() => {
      throw new TypeError('window.__appsInTossConstants is undefined');
    });

    await expect(getBackupKey()).resolves.toBeNull();
  });

  it('SDK가 던지면 null이다 — UNSUPPORTED_APP_VERSION·UNKNOWN_ERROR를 던지는 API다', async () => {
    getAnonymousKey.mockRejectedValue(new Error('UNKNOWN_ERROR'));

    await expect(getBackupKey()).resolves.toBeNull();
  });

  it('hash가 없는 응답이면 null이다 — 형태를 가정하지 않는다', async () => {
    getAnonymousKey.mockResolvedValue({ type: 'HASH' });

    await expect(getBackupKey()).resolves.toBeNull();
  });

  it('빈 문자열 hash도 null이다 — 그 키로는 아무것도 못 한다', async () => {
    getAnonymousKey.mockResolvedValue({ type: 'HASH', hash: '' });

    await expect(getBackupKey()).resolves.toBeNull();
  });
});

describe('uploadBackup', () => {
  const blob = buildBackupBlob([product()], {}, '2026-09-01T00:00:00.000Z');

  it('PUT으로 키 헤더와 블롭을 보낸다', async () => {
    const f = fakeFetch({ status: 200, body: '{"savedAt":"2026-09-01T00:00:00Z"}' });

    await expect(uploadBackup(KEY, blob, f)).resolves.toBe(true);

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/v1/backup`);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['X-Anon-Key']).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual(blob);
  });

  it('서버가 500이면 false다 — 던지지 않는다', async () => {
    await expect(uploadBackup(KEY, blob, fakeFetch({ status: 500 }))).resolves.toBe(false);
  });

  it('레이트리밋(429)도 그냥 false다 — 호출자는 성공·실패만 알면 된다', async () => {
    await expect(uploadBackup(KEY, blob, fakeFetch({ status: 429 }))).resolves.toBe(false);
  });

  it('네트워크가 끊겨도 false다 — 여기서 던지면 저장 흐름이 백업 때문에 죽는다', async () => {
    await expect(uploadBackup(KEY, blob, fakeFetch(new TypeError('Failed to fetch')))).resolves.toBe(false);
  });
});

describe('fetchBackup', () => {
  const stored = { schemaVersion: 1, products: [product()], notes: {}, clientSavedAt: '2026-09-01T00:00:00.000Z' };

  it('200이면 블롭을 준다', async () => {
    const f = fakeFetch({ status: 200, body: JSON.stringify(stored) });

    await expect(fetchBackup(KEY, f)).resolves.toEqual(stored);
    expect((f.mock.calls[0][1] as RequestInit).method ?? 'GET').toBe('GET');
  });

  it('404면 null이다 — 백업이 없는 것은 오류가 아니라 신규 사용자의 정상 상태다', async () => {
    await expect(fetchBackup(KEY, fakeFetch({ status: 404 }))).resolves.toBeNull();
  });

  it('JSON이 아니면 null이다 — 복원 화면이 파싱 오류로 죽으면 안 된다', async () => {
    await expect(fetchBackup(KEY, fakeFetch({ status: 200, body: 'not json' }))).resolves.toBeNull();
  });

  it('모양이 어긋나면 null이다 — 남의 응답이 섞여 들어와도 복원을 시작하지 않는다', async () => {
    await expect(fetchBackup(KEY, fakeFetch({ status: 200, body: '{"hello":"world"}' }))).resolves.toBeNull();
  });

  it('네트워크가 끊기면 null이다', async () => {
    await expect(fetchBackup(KEY, fakeFetch(new TypeError('Failed to fetch')))).resolves.toBeNull();
  });
});

describe('deleteBackup', () => {
  it('204면 true다', async () => {
    const f = fakeFetch({ status: 204 });

    await expect(deleteBackup(KEY, f)).resolves.toBe(true);
    expect((f.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('실패하면 false다 — 「백업 끄기」가 화면을 죽이지 않는다', async () => {
    await expect(deleteBackup(KEY, fakeFetch({ status: 500 }))).resolves.toBe(false);
  });

  it('네트워크가 끊겨도 false다', async () => {
    await expect(deleteBackup(KEY, fakeFetch(new TypeError('Failed to fetch')))).resolves.toBe(false);
  });
});
