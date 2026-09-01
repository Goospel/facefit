// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Restore } from './Restore';
import { fetchBackup, getBackupKey } from '../logic/backup';
import type { BackupBlob } from '../logic/backup';

/**
 * 기기 이전 복원(설계 §3-4).
 *
 * **이 화면의 존재 이유는 데이터가 아니라 고지다.** 복원은 로컬을 덮어쓰는 파괴적 동작이고,
 * 넘어오지 않는 것(사진)이 있다 — 그걸 **복원한 뒤에 알게 되면 사고다.** 그래서 「사진은
 * 복원되지 않아요」가 확인 버튼 **위에** 고정으로 붙는다(설계 §3-2의 정직한 구멍).
 *
 * 404는 오류가 아니라 신규 사용자의 정상 상태라, 문구도 실패가 아니라 사실만 말한다.
 */
vi.mock('../logic/backup', async (orig) => ({
  ...(await orig<typeof import('../logic/backup')>()),
  getBackupKey: vi.fn(),
  fetchBackup: vi.fn(),
}));

afterEach(cleanup);

const KEY = 'anon-hash-abcdef0123456789';
const CONFIRM = '이 기록으로 복원하기';

const blob: BackupBlob = {
  schemaVersion: 1,
  products: [
    { id: 'p1', name: '토리든 다이브인 세럼', category: 'serum', startDate: '2026-08-01' },
    { id: 'p2', name: '아누아 어성초 토너', category: 'toner', startDate: '2026-08-10' },
  ],
  notes: { '2026-08-30': 'better', '2026-08-31': 'same', '2026-09-01': 'worse' },
  clientSavedAt: '2026-09-01T10:34:18.752Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBackupKey).mockResolvedValue(KEY);
  vi.mocked(fetchBackup).mockResolvedValue(blob);
});

describe('복원 미리보기', () => {
  it('무엇이 몇 건인지 먼저 보여준다 — 확인 전에 알아야 덮어쓸지 정할 수 있다', async () => {
    render(<Restore onClose={vi.fn()} onRestored={vi.fn()} />);

    const summary = await screen.findByTestId('restore-summary');
    expect(summary.textContent).toContain('제품 2건');
    expect(summary.textContent).toContain('관찰 3건');
  });

  it('언제 저장분인지 말한다 — 며칠 전 것을 덮어쓰는 상황을 사용자가 알아야 한다', async () => {
    render(<Restore onClose={vi.fn()} onRestored={vi.fn()} />);

    expect((await screen.findByTestId('restore-summary')).textContent).toContain('2026-09-01');
  });

  it('**사진은 복원되지 않는다고 확인 전에 말한다** — 복원 뒤에 알게 되면 사고다', async () => {
    render(<Restore onClose={vi.fn()} onRestored={vi.fn()} />);

    const notice = await screen.findByTestId('restore-photo-notice');
    expect(notice.textContent).toContain('사진은 복원되지 않아요');
    // 확인 버튼보다 **앞에** 있어야 눈에 먼저 들어온다. DOM 순서가 그 유일한 보증이다.
    const confirm = screen.getByRole('button', { name: CONFIRM });
    expect(notice.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('복원 실행', () => {
  it('확인하면 블롭을 그대로 넘긴다 — 이 화면은 저장하지 않는다(배선은 App의 몫)', async () => {
    const onRestored = vi.fn();
    render(<Restore onClose={vi.fn()} onRestored={onRestored} />);

    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(blob));
  });

  it('확인 전에는 아무것도 넘기지 않는다 — 자동 복원은 신규 사용자의 의사를 덮는다', async () => {
    const onRestored = vi.fn();
    render(<Restore onClose={vi.fn()} onRestored={onRestored} />);

    await screen.findByTestId('restore-summary');

    expect(onRestored).not.toHaveBeenCalled();
  });
});

describe('백업이 없거나 못 부를 때', () => {
  it('404면 「찾지 못했어요」다 — 오류가 아니라 신규 사용자의 정상 상태다', async () => {
    vi.mocked(fetchBackup).mockResolvedValue(null);

    render(<Restore onClose={vi.fn()} onRestored={vi.fn()} />);

    expect((await screen.findByTestId('restore-empty')).textContent).toContain('백업을 찾지 못했어요');
    expect(screen.queryByRole('button', { name: CONFIRM })).toBeNull();
  });

  it('키를 못 가져오면 복원 버튼을 안 띄운다 — 눌러도 아무 일 없는 버튼을 남기지 않는다', async () => {
    vi.mocked(getBackupKey).mockResolvedValue(null);

    render(<Restore onClose={vi.fn()} onRestored={vi.fn()} />);

    await screen.findByTestId('restore-error');
    expect(screen.queryByRole('button', { name: CONFIRM })).toBeNull();
    // 키가 없으면 서버를 부를 이유가 없다.
    expect(fetchBackup).not.toHaveBeenCalled();
  });

  it('어느 경로로든 닫을 수 있다 — 막다른 화면을 만들지 않는다', async () => {
    vi.mocked(fetchBackup).mockResolvedValue(null);
    const onClose = vi.fn();

    render(<Restore onClose={onClose} onRestored={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '닫기' }));

    expect(onClose).toHaveBeenCalled();
  });
});
