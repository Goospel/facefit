import { useState } from 'react';

import { formatBackupTime } from '../logic/backup';
import { isActive, sortProducts } from '../logic/products';
import { isNotifySupported, requestNotifyAgreement } from '../notify';
import type { Notes, Product } from '../storage';
import { ui } from '../ui';
import { LOCAL_ONLY, useObjectUrl, usePhotos } from './usePhotos';

/**
 * 오늘 탭.
 *
 * **오늘 찍었는가**가 이 화면이 답하는 유일한 질문이다 — 나머지(관찰 답 · 사용 중 제품)는
 * 그 답에 딸린 맥락이다. 그래서 촬영 카드가 화면 맨 위 가장 큰 표면이다.
 */

const VERDICT_KO: Record<string, string> = { better: '좋아졌어요', same: '그대로예요', worse: '나빠졌어요' };

/**
 * 백업 상태 한 줄. **켜 놓고 안 되는 상태를 숨기지 않는다** — 그게 제일 위험한 상태다
 * (사용자는 지켜지고 있다고 믿는데 실제로는 아무것도 안 올라갔다).
 */
function backupStateText(enabled: boolean, lastBackupAt: string | null): string {
  if (!enabled) return '기록 백업이 꺼져 있어요';
  const at = formatBackupTime(lastBackupAt);
  return at ? `기록 백업 켜짐 · 마지막 백업 ${at}` : '기록 백업 켜짐 · 아직 백업하지 못했어요';
}

export function Home({
  products,
  notes,
  date,
  onShoot,
  backup,
}: {
  products: Product[];
  notes: Notes;
  /** 오늘. 「오늘 찍었나」와 「지금 쓰는 제품」이 같은 값을 봐야 한다. */
  date: string;
  onShoot: () => void;
  /**
   * 기록 백업(v3 §3-4). **`undefined`면 표면 자체가 없다** — 쓸 수 없는 기기에서 버튼만
   * 남기면 「눌렀는데 아무 일도 없다」가 된다(알림 버튼과 같은 규율). 그 판단은 App이 한다.
   */
  backup?: { enabled: boolean; lastBackupAt: string | null; onToggle: () => void };
}) {
  const { photos } = usePhotos();
  /**
   * 방금 이 화면에서 신청했는가. **이 세션 안에서만 산다**(설계 §3-2의 의도된 절단).
   *
   * 동의 여부의 단일 출처는 토스다 — 저장해 두면 사용자가 토스 설정에서 철회한 순간
   * 「신청됨」이 거짓말이 되고, 재동의할 버튼마저 사라진다.
   */
  const [notifyAsked, setNotifyAsked] = useState(false);
  const todayPhoto = photos.find((p) => p.date === date);
  const todayUrl = useObjectUrl(todayPhoto?.blob);
  const verdict = notes[date];

  const using = sortProducts(products, date).filter((p) => isActive(p, date));

  return (
    <main style={ui.page}>
      <h1 style={ui.h1}>오늘</h1>

      <div style={{ ...ui.card, padding: 16 }}>
        {todayPhoto ? (
          <>
            {todayUrl && (
              <img
                src={todayUrl}
                alt="오늘 찍은 사진"
                style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 10, background: 'var(--bg-sub)' }}
              />
            )}
            {/* 답이 없으면 줄 자체가 없다 — 「미응답」을 적으면 건너뛴 것이 실패로 보인다. */}
            {verdict && (
              <p data-testid="today-note" style={{ ...ui.sub, margin: '10px 0 0', textAlign: 'center' }}>
                {VERDICT_KO[verdict]}
              </p>
            )}
            {/* 하루 1장이라 다시 찍으면 덮어쓴다 — 버튼 문구가 그걸 미리 말한다. */}
            <button style={{ ...ui.secondary, marginTop: 12 }} onClick={onShoot}>
              다시 찍기
            </button>
          </>
        ) : (
          <>
            <p style={{ ...ui.h2, textAlign: 'center' }}>오늘은 아직 안 찍었어요</p>
            <p style={{ ...ui.sub, textAlign: 'center' }}>지난 사진에 얼굴을 겹쳐 같은 구도로 찍어요.</p>
            <button style={ui.primary} onClick={onShoot}>
              오늘 얼굴 찍기
            </button>
          </>
        )}
      </div>

      {/*
        **동의 상태를 보고 숨기지 않는다** — 이미 동의한 사람이 눌러도 `alreadyAgreed`로
        무해하게 끝나고(멱등), 토스 설정에서 철회한 사람의 재동의 경로를 그대로 겸한다
        (설계 §3-2 — 철회는 앱이 알 수 없다).

        ⚠️ 숨기는 조건은 **동의 여부가 아니라 지원 여부**다. 시트를 열 수 없는 기기
        (구버전 토스·토스 밖)에서 버튼만 남기면 「눌렀는데 아무 일도 없다」가 된다.
      */}
      {isNotifySupported() && (
        <button
          style={{ ...ui.ghost, width: '100%', marginTop: 8 }}
          onClick={() => requestNotifyAgreement((agreed) => agreed && setNotifyAsked(true))}
        >
          {notifyAsked ? '알림 신청됨' : '아침 알림 받기'}
        </button>
      )}

      {/*
        알림 버튼과 달리 **상태를 버튼과 갈라서 글자로 말한다.**

        ⚠️ 처음엔 버튼 라벨 하나로 뒀는데, 실기기에서 사용자가 「기록 백업 켜기」를 보고
        **이미 켜진 줄 알았다**(2026-09-01). 토글 라벨에 행동만 적으면 상태로 읽힌다 —
        어느 쪽으로 읽어도 말이 되기 때문이다.

        같은 줄이 두 번째 구멍도 막는다: 켜기를 눌렀을 때 성공했는지 화면에 아무 표시가
        없었다. 백그라운드 업로드가 조용한 것은 의도지만(무음 폴백), **사용자가 명시적으로
        누른 행동**까지 조용하면 그건 폴백이 아니라 그냥 깜깜한 것이다.
      */}
      {backup && (
        <div style={{ marginTop: 8 }}>
          <p data-testid="backup-state" style={{ ...ui.sub, margin: '0 0 6px', textAlign: 'center' }}>
            {backupStateText(backup.enabled, backup.lastBackupAt)}
          </p>
          <button style={{ ...ui.ghost, width: '100%' }} onClick={backup.onToggle}>
            {backup.enabled ? '기록 백업 끄기' : '기록 백업 켜기'}
          </button>
        </div>
      )}

      <h2 style={{ ...ui.h2, fontSize: 14, color: 'var(--text-sub)', marginTop: 24 }}>{`쓰는 중 ${using.length}`}</h2>
      {using.length === 0 ? (
        // 제품이 없으면 이 앱의 절반이 빈다 — 사진만 쌓이고 「무엇을 쓰는 동안」이 없다.
        <p style={{ ...ui.sub, marginTop: 8 }}>제품 탭에서 등록하면 사진과 함께 기간이 남아요.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {/* 이름만 적는다 — 카테고리는 제품 탭이 이미 말하고, 여기서는 요약이 목적이다. */}
          {using.map((p) => (
            <span key={p.id} style={ui.chip}>
              {p.name}
            </span>
          ))}
        </div>
      )}

      <p style={{ ...ui.sub, marginTop: 24 }}>{LOCAL_ONLY}</p>
    </main>
  );
}
