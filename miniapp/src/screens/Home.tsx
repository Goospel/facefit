import { useState } from 'react';

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

export function Home({
  products,
  notes,
  date,
  onShoot,
}: {
  products: Product[];
  notes: Notes;
  /** 오늘. 「오늘 찍었나」와 「지금 쓰는 제품」이 같은 값을 봐야 한다. */
  date: string;
  onShoot: () => void;
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

      {/*
        **동의 상태를 보고 숨기지 않는다** — 이미 동의한 사람이 눌러도 `alreadyAgreed`로
        무해하게 끝나고(멱등), 토스 설정에서 철회한 사람의 재동의 경로를 그대로 겸한다
        (설계 §3-2 — 철회는 앱이 알 수 없다).

        ⚠️ 숨기는 조건은 **동의 여부가 아니라 지원 여부**다. 시트를 열 수 없는 기기
        (구버전 토스·토스 밖)에서 버튼만 남기면 「눌렀는데 아무 일도 없다」가 된다.
      */}
      {isNotifySupported() && (
        <>
          {/* 제품 탭의 백업 스위치와 같은 규칙 — 설정성 컨트롤은 목록 뒤, 구분선 아래. */}
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '24px 0 16px' }} />
          <button
            /*
              ⚠️ **스위치가 아니다.** 동의의 단일 출처는 토스이고 철회는 앱이 감지할 수 없다
              (설계 §3-5) — 상태를 그리면 동의한 사람에게도 앱을 열 때마다 「꺼짐」으로 보인다.
              백업 스위치와 모양은 같은 가족이되 오른쪽이 상태가 아니라 **행동**인 이유다.

              접근성 이름은 행동 하나로 고정한다 — 본문을 이어 붙이면 스크린리더가 설명까지
              버튼 이름으로 읽는다.
            */
            aria-label={notifyAsked ? '알림 신청됨' : '아침 알림 받기'}
            style={{ ...ui.card, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}
            onClick={() => requestNotifyAgreement((agreed) => agreed && setNotifyAsked(true))}
          >
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>아침 알림</span>
              <span data-testid="notify-sub" style={{ display: 'block', fontSize: 13, marginTop: 2, color: 'var(--text-sub)' }}>
                {notifyAsked ? '토스 알림 설정에서 언제든 끌 수 있어요' : '매일 아침 8시에 찍을 시간을 알려드려요'}
              </span>
            </span>
            {/* 눌러서 여는 것임을 오른쪽이 말한다 — 신청 뒤에도 멱등이라 자리를 지킨다. */}
            <span aria-hidden style={{ fontSize: 14, fontWeight: 600, color: notifyAsked ? 'var(--text-weak)' : 'var(--blue)' }}>
              {notifyAsked ? '신청됨' : '받기'}
            </span>
          </button>
        </>
      )}

      <p style={{ ...ui.sub, marginTop: 24 }}>{LOCAL_ONLY}</p>
    </main>
  );
}
