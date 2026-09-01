// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { deleteBackup, fetchBackup, getBackupKey, isBackupSupported, uploadBackup } from './logic/backup';
import { listPhotos } from './photoStore';
import { isBackupDirty, isBackupEnabled, isBackupPrompted, loadNotes, loadProducts } from './storage';

/**
 * 백업 배선(설계 §3-4·§4-3). App.test.tsx가 「무슨 화면인가」를 잰다면 여기는 **언제 부르는가**다.
 *
 * 잠그는 것: 옵트인이라 **켜기 전에는 한 번도 안 부른다** · 제안은 **딱 한 번** ·
 * 저장 뒤 업로드는 **디바운스로 묶인다** · 실패는 던지는 대신 `backupDirty`에 남고
 * **다음 실행이 곧 재시도**다(백오프 루프를 안 만드는 이유 — 설계 §3-3).
 *
 * ⚠️ 숨기는 조건은 「켰는가」가 아니라 **「쓸 수 있는가」**다(notify와 같은 규율) —
 * 키도 시트도 없는 기기에 버튼만 남기면 「눌렀는데 아무 일도 없다」가 된다.
 */
vi.mock('./photoStore', async (orig) => ({
  ...(await orig<typeof import('./photoStore')>()),
  openPhotoDb: vi.fn(async () => ({ close: () => {} }) as unknown as import('./photoStore').PhotoDb),
  listPhotos: vi.fn(),
}));

/** 백업 모듈은 목이다 — 실물(무음 실패 규율)은 `logic/backup.test.ts`가 잰다. */
vi.mock('./logic/backup', async (orig) => ({
  ...(await orig<typeof import('./logic/backup')>()),
  isBackupSupported: vi.fn(() => true),
  getBackupKey: vi.fn(async () => null),
  uploadBackup: vi.fn(async () => true),
  fetchBackup: vi.fn(async () => null),
  deleteBackup: vi.fn(async () => true),
}));

afterEach(cleanup);

const KEY = 'anon-hash-abcdef0123456789';
const RESTORE_LINK = '기기를 바꿨나요? 기록 복원';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listPhotos).mockResolvedValue([]);
  vi.mocked(isBackupSupported).mockReturnValue(true);
  vi.mocked(getBackupKey).mockResolvedValue(KEY);
  vi.mocked(uploadBackup).mockResolvedValue(true);
  vi.mocked(deleteBackup).mockResolvedValue(true);
  vi.mocked(fetchBackup).mockResolvedValue(null);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

/** 제품 탭에서 제품 하나를 저장한다. 「첫 등록」이 제안의 방아쇠다. */
function addProduct(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '제품' }));
  fireEvent.click(screen.getByRole('button', { name: '제품 추가' }));
  fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
}

function passOnboarding() {
  fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
}

describe('백업 제안 — 제품 첫 등록 직후 한 번', () => {
  it('제품을 처음 등록하면 백업을 제안한다', () => {
    render(<App />);
    passOnboarding();

    addProduct('수분크림');

    expect(screen.getByTestId('backup-prompt')).toBeTruthy();
  });

  it('「나중에」를 고르면 사라지고 다시 안 묻는다 — 거절한 사람에게 매번 묻지 않는다', () => {
    render(<App />);
    passOnboarding();
    addProduct('수분크림');

    fireEvent.click(screen.getByRole('button', { name: '나중에' }));

    expect(screen.queryByTestId('backup-prompt')).toBeNull();
    expect(isBackupPrompted(localStorage)).toBe(true);
    expect(isBackupEnabled(localStorage)).toBe(false);
  });

  it('이미 물어본 적이 있으면 제안하지 않는다', () => {
    localStorage.setItem('facefit.backupPrompted', '1');

    render(<App />);
    passOnboarding();
    addProduct('수분크림');

    expect(screen.queryByTestId('backup-prompt')).toBeNull();
  });

  it('쓸 수 없는 기기에서는 제안 자체가 없다 — 켤 수 없는 것을 권하지 않는다', () => {
    vi.mocked(isBackupSupported).mockReturnValue(false);

    render(<App />);
    passOnboarding();
    addProduct('수분크림');

    expect(screen.queryByTestId('backup-prompt')).toBeNull();
  });

  it('제안에서 켜면 저장소에 남고 바로 한 번 올린다 — 켠 직후가 비어 있으면 켠 보람이 없다', async () => {
    render(<App />);
    passOnboarding();
    addProduct('수분크림');

    fireEvent.click(screen.getByRole('button', { name: '백업 켜기' }));

    expect(isBackupEnabled(localStorage)).toBe(true);
    expect(isBackupPrompted(localStorage)).toBe(true);
    await vi.waitFor(() => expect(uploadBackup).toHaveBeenCalled());
    expect(vi.mocked(uploadBackup).mock.calls[0][0]).toBe(KEY);
  });
});

describe('백업 업로드 — 디바운스와 dirty', () => {
  beforeEach(() => {
    localStorage.setItem('facefit.onboarded', '1');
    localStorage.setItem('facefit.backupPrompted', '1');
  });

  it('꺼져 있으면 저장해도 한 번도 안 부른다 — 옵트인의 전부가 이것이다', async () => {
    render(<App />);

    addProduct('토너');
    await new Promise((r) => setTimeout(r, 30));

    expect(uploadBackup).not.toHaveBeenCalled();
  });

  it('켜져 있으면 저장 뒤 올린다 — 여러 번 저장해도 마지막 상태 하나만 간다(디바운스)', async () => {
    localStorage.setItem('facefit.backupEnabled', '1');

    render(<App />);
    addProduct('토너');
    addProduct('세럼');

    await vi.waitFor(() => expect(uploadBackup).toHaveBeenCalled(), { timeout: 9000 });
    // 전체 블롭을 덮어쓰는 프로토콜이라 중간 상태는 값이 없다.
    const blob = vi.mocked(uploadBackup).mock.calls.at(-1)![1];
    expect(blob.products.map((p) => p.name)).toEqual(['토너', '세럼']);
  }, 15000);

  it('업로드가 실패하면 dirty만 남기고 넘어간다 — 저장 흐름이 백업 때문에 죽지 않는다', async () => {
    localStorage.setItem('facefit.backupEnabled', '1');
    vi.mocked(uploadBackup).mockResolvedValue(false);

    render(<App />);
    addProduct('토너');

    await vi.waitFor(() => expect(isBackupDirty(localStorage)).toBe(true), { timeout: 9000 });
    expect(loadProducts(localStorage).map((p) => p.name)).toEqual(['토너']);
  }, 15000);

  it('시작할 때 밀린 게 있으면 다시 올리고, 성공하면 지운다 — 앱을 여는 행위가 곧 재시도다', async () => {
    localStorage.setItem('facefit.backupEnabled', '1');
    localStorage.setItem('facefit.backupDirty', '1');

    render(<App />);

    await vi.waitFor(() => expect(uploadBackup).toHaveBeenCalled());
    await vi.waitFor(() => expect(isBackupDirty(localStorage)).toBe(false));
  });

  it('꺼져 있으면 dirty가 있어도 안 올린다 — 끈 사람의 데이터가 나가면 안 된다', async () => {
    localStorage.setItem('facefit.backupDirty', '1');

    render(<App />);
    await new Promise((r) => setTimeout(r, 30));

    expect(uploadBackup).not.toHaveBeenCalled();
  });
});

describe('복원 진입 — 온보딩 하단', () => {
  it('온보딩에 복원 링크가 있다 — 새 기기의 첫 화면이 여기라 유일하게 자연스러운 자리다', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: RESTORE_LINK })).toBeTruthy();
  });

  it('쓸 수 없는 기기에서는 링크가 없다', () => {
    vi.mocked(isBackupSupported).mockReturnValue(false);

    render(<App />);

    expect(screen.queryByRole('button', { name: RESTORE_LINK })).toBeNull();
  });

  it('복원을 확인하면 로컬에 반영되고 온보딩을 통과한다', async () => {
    vi.mocked(fetchBackup).mockResolvedValue({
      schemaVersion: 1,
      products: [{ id: 'p1', name: '복원된 세럼', category: 'serum', startDate: '2026-08-01' }],
      notes: { '2026-08-30': 'better' },
      clientSavedAt: '2026-09-01T10:00:00.000Z',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: RESTORE_LINK }));

    fireEvent.click(await screen.findByRole('button', { name: '이 기록으로 복원하기' }));

    await vi.waitFor(() => expect(loadProducts(localStorage).map((p) => p.name)).toEqual(['복원된 세럼']));
    expect(loadNotes(localStorage)['2026-08-30']).toBe('better');
    // 복원했다는 것은 백업을 쓰겠다는 뜻이다 — 새 기기에서 다시 켜게 만들지 않는다.
    expect(isBackupEnabled(localStorage)).toBe(true);
    // 온보딩을 다시 보여주면 방금 복원한 기록 위에 「시작하기」가 뜬다.
    expect(screen.getByRole('button', { name: '제품' })).toBeTruthy();
  });
});

describe('백업 버튼 — Home 상시', () => {
  beforeEach(() => {
    localStorage.setItem('facefit.onboarded', '1');
  });

  it('꺼져 있으면 켜는 버튼이다', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: '기록 백업 켜기' })).toBeTruthy();
  });

  /*
    ⚠️ 실기기에서 사용자가 「기록 백업 켜기」를 보고 **이미 켜진 줄** 알았다(2026-09-01).
    버튼에 **행동만** 적혀 있어서 상태로 읽힌 것이다 — 켜짐/꺼짐을 글자로 따로 말하지 않으면
    토글 라벨은 어느 쪽으로도 읽힌다. 그래서 상태 줄을 버튼과 **갈라** 놓는다.

    같은 줄이 두 번째 구멍도 막는다: 켜기를 눌렀을 때 성공했는지 화면에 아무 표시가 없었다.
    백그라운드 업로드가 조용한 건 의도지만, **사용자가 명시적으로 누른 행동**까지 조용하면
    그건 무음 폴백이 아니라 그냥 깜깜한 것이다.
  */
  it('꺼져 있다는 것을 **글자로** 말한다 — 버튼 라벨만으로는 상태로 읽힌다', () => {
    render(<App />);
    expect(screen.getByTestId('backup-state').textContent).toContain('꺼져 있어요');
  });

  it('켜져 있고 백업한 적이 있으면 마지막 시각을 말한다 — 「지금 지켜지고 있나」의 답이다', () => {
    localStorage.setItem('facefit.backupEnabled', '1');
    localStorage.setItem('facefit.lastBackupAt', '2026-09-01T12:25:30.553Z');

    render(<App />);

    const state = screen.getByTestId('backup-state').textContent ?? '';
    expect(state).toContain('켜짐');
    expect(state).toContain('9월 1일 21:25');
  });

  it('켜져 있는데 아직 못 올렸으면 그렇다고 말한다 — 켜 놓고 안 되는 상태가 제일 위험하다', () => {
    localStorage.setItem('facefit.backupEnabled', '1');

    render(<App />);

    expect(screen.getByTestId('backup-state').textContent).toContain('아직 백업하지 못했어요');
  });

  it('켜면 켜짐이 남고 문구가 바뀐다', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '기록 백업 켜기' }));

    expect(isBackupEnabled(localStorage)).toBe(true);
    expect(screen.getByRole('button', { name: '기록 백업 끄기' })).toBeTruthy();
    await vi.waitFor(() => expect(uploadBackup).toHaveBeenCalled());
  });

  it('끄면 서버 데이터도 지운다 — 「끄기」가 곧 삭제권 행사다', async () => {
    localStorage.setItem('facefit.backupEnabled', '1');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '기록 백업 끄기' }));

    expect(isBackupEnabled(localStorage)).toBe(false);
    await vi.waitFor(() => expect(deleteBackup).toHaveBeenCalledWith(KEY));
  });

  it('쓸 수 없는 기기에서는 버튼이 없다', () => {
    vi.mocked(isBackupSupported).mockReturnValue(false);

    render(<App />);

    expect(screen.queryByRole('button', { name: '기록 백업 켜기' })).toBeNull();
  });
});
