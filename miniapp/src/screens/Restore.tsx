import { useEffect, useState } from 'react';

import { fetchBackup, getBackupKey, type BackupBlob } from '../logic/backup';
import { ui } from '../ui';

/**
 * 기기 이전 복원(설계 §3-4).
 *
 * **이 화면의 값은 데이터가 아니라 고지에 있다.** 복원은 로컬을 통째로 덮어쓰는 파괴적
 * 동작이고, 넘어오지 않는 것이 있다 — **사진**이다. 그걸 복원한 **뒤에** 알게 되면 사고라서,
 * 「사진은 복원되지 않아요」가 확인 버튼 **위에** 고정으로 붙는다(설계 §3-2의 정직한 구멍).
 *
 * ⚠️ **자동 복원은 하지 않는다.** 빈 로컬 상태는 신규 사용자의 정상 상태이기도 해서,
 * 자동이면 「새로 시작하고 싶은」 사람의 의사를 덮는다(설계 §3-3).
 *
 * 저장은 여기서 하지 않는다 — 블롭을 그대로 넘기고 배선은 App이 한다. 이 화면이 저장까지
 * 하면 「무엇을 저장소에 쓰는가」가 두 곳으로 갈린다.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'found'; blob: BackupBlob }
  /** 404. **오류가 아니라 신규 사용자의 정상 상태다** — 문구도 실패가 아니라 사실만 말한다. */
  | { kind: 'empty' }
  /** 키를 못 얻었거나 서버를 못 불렀다. 사용자가 지금 할 수 있는 일은 없다. */
  | { kind: 'error' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function Restore({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: (blob: BackupBlob) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    // 화면을 닫은 뒤 늦게 도착한 응답이 state를 건드리면 React가 경고하고, 무엇보다
    // 이미 떠난 화면의 결과가 다음 화면에 섞인다.
    let alive = true;

    void (async () => {
      const key = await getBackupKey();
      if (!alive) return;
      // 키가 없으면 서버를 부를 이유가 없다 — 부를 수 있는 자격 자체가 없다.
      if (!key) return setState({ kind: 'error' });

      const blob = await fetchBackup(key);
      if (!alive) return;
      setState(blob ? { kind: 'found', blob } : { kind: 'empty' });
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={ui.pageFull}>
      <h1 style={{ ...ui.h1, marginTop: 24 }}>기록 복원</h1>

      {state.kind === 'loading' && <p style={ui.sub}>백업을 찾는 중이에요…</p>}

      {state.kind === 'empty' && (
        <p data-testid="restore-empty" style={ui.sub}>
          백업을 찾지 못했어요. 이전 기기에서 백업을 켜 두지 않았다면 복원할 기록이 없어요.
        </p>
      )}

      {state.kind === 'error' && (
        <p data-testid="restore-error" style={ui.sub}>
          지금은 복원할 수 없어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {state.kind === 'found' && (
        <>
          <div style={{ ...ui.card, padding: 16, marginTop: 8 }}>
            <p data-testid="restore-summary" style={{ ...ui.h2, margin: 0 }}>
              {summarize(state.blob)}
            </p>
          </div>

          {/*
            ⚠️ **확인 버튼보다 위에 있어야 한다.** 이 문장이 아래로 내려가는 순간, 사용자는
            복원을 누른 뒤에 사진이 없다는 것을 알게 된다 — 그게 설계가 막으려는 사고다.
          */}
          <p data-testid="restore-photo-notice" style={{ ...ui.sub, marginTop: 16 }}>
            <b>사진은 복원되지 않아요.</b> 사진은 이전 기기에만 저장돼 있어요. 복원되는 것은
            제품 기록과 그날의 관찰이에요.
          </p>
          <p style={{ ...ui.sub, marginTop: 8 }}>이 기기에 있던 기록은 덮어써져요.</p>

          <span style={ui.spacer} />

          <div style={ui.stickyFooter}>
            <button style={ui.primary} onClick={() => onRestored(state.blob)}>
              이 기록으로 복원하기
            </button>
            <button style={{ ...ui.ghost, width: '100%', marginTop: 8 }} onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      )}

      {state.kind !== 'found' && (
        <>
          <span style={ui.spacer} />
          <div style={ui.stickyFooter}>
            {/* 어느 경로로든 닫을 수 있다 — 막다른 화면을 만들지 않는다. */}
            <button style={ui.secondary} onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      )}
    </main>
  );
}

/** 「무엇을 몇 건, 언제 저장분」. 확인 전에 알아야 덮어쓸지 정할 수 있다. */
function summarize(blob: BackupBlob): string {
  const head = `제품 ${blob.products.length}건 · 관찰 ${Object.keys(blob.notes).length}건`;
  const day = blob.clientSavedAt?.slice(0, 10);
  // 시각은 클라가 만든 문자열이라 형태를 못 믿는다 — 날짜로 안 보이면 그 절만 뺀다.
  return DATE_RE.test(day ?? '') ? `${head}\n${day} 저장분` : head;
}
