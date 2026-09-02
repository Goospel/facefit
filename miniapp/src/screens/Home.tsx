import { useState } from 'react';

import { isActive, sortProducts } from '../logic/products';
import { isNotifySupported, requestNotifyAgreement, type NotifyResult } from '../notify';
import { VERDICT_KO, type Notes, type Product } from '../storage';
import { ui } from '../ui';
import { LOCAL_ONLY, useObjectUrl, usePhotos } from './usePhotos';

/**
 * 오늘 탭.
 *
 * **오늘 찍었는가**가 이 화면이 답하는 유일한 질문이다 — 나머지(관찰 답 · 사용 중 제품)는
 * 그 답에 딸린 맥락이다. 그래서 촬영 카드가 화면 맨 위 가장 큰 표면이다.
 */

/**
 * 알림 행이 할 말. **누른 결과를 글자로 되돌려주는 자리다.**
 *
 * ⚠️ 실기기에서 「받기」를 눌렀는데 화면이 안 변해 **켜진 건지 아닌지 알 수 없다**는 보고를
 * 받았다(2026-09-01 · T-010의 두 번째 결함 재발). 원인은 두 겹이었다: 결과 표시가 오른쪽
 * 작은 회색 글씨뿐이었고, 게다가 래퍼가 `alreadyAgreed`를 boolean으로 뭉개 **이미 켠
 * 사람에게 해 줄 말 자체가 없었다.**
 *
 * 렌더 시점의 상태는 여전히 모른다(SDK에 조회 API가 없다 — `notify.ts`). 하지만 **누르는
 * 순간의 진실**은 토스가 준다. 그 순간을 그대로 옮긴다.
 */
const NOTIFY_TEXT: Record<NotifyResult, { sub: string; right: string; tone: 'on' | 'off' | 'warn' }> = {
  newAgreement: { sub: '알림을 켰어요 · 내일 아침 8시부터 알려드려요', right: '켜짐', tone: 'on' },
  // 이 줄이 「켜진 건지 모르겠다」에 답하는 유일한 줄이다.
  alreadyAgreed: { sub: '이미 켜져 있어요 · 매일 아침 8시에 알려드려요', right: '켜짐', tone: 'on' },
  agreementRejected: { sub: '알림을 켜지 않았어요 · 눌러서 언제든 켤 수 있어요', right: '받기', tone: 'off' },
  // 못 물어본 것을 「안 켰다」로 적으면 거짓말이고, 사용자는 자기가 거절한 줄 안다.
  unavailable: { sub: '지금은 알림 화면을 열 수 없어요 · 잠시 뒤 다시 눌러 주세요', right: '받기', tone: 'warn' },
};

const NOTIFY_IDLE = { sub: '매일 아침 8시에 찍을 시간을 알려드려요', right: '받기', tone: 'off' } as const;

const TONE_COLOR = { on: 'var(--blue)', off: 'var(--text-sub)', warn: 'var(--amber)' } as const;

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
   * 방금 누른 결과. **이 세션 안에서만 산다**(설계 §3-2의 의도된 절단).
   *
   * 동의 여부의 단일 출처는 토스다 — 저장해 두면 사용자가 토스 설정에서 철회한 순간
   * 「켜짐」이 거짓말이 되고, 재동의할 버튼마저 사라진다. `null`은 「아직 안 눌러 봤다」이지
   * 「꺼졌다」가 **아니다** — 그래서 그때는 상태를 말하지 않고 무엇을 해 주는지만 말한다.
   */
  const [notifyResult, setNotifyResult] = useState<NotifyResult | null>(null);
  const notify = notifyResult ? NOTIFY_TEXT[notifyResult] : NOTIFY_IDLE;
  const on = notify.tone === 'on';
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

              접근성 이름은 한 마디로 고정한다 — 본문을 이어 붙이면 스크린리더가 설명까지
              버튼 이름으로 읽는다.
            */
            aria-label={on ? '아침 알림 켜짐' : '아침 알림 받기'}
            style={{ ...ui.card, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}
            onClick={() => requestNotifyAgreement(setNotifyResult)}
          >
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>아침 알림</span>
              <span
                data-testid="notify-sub"
                style={{ display: 'block', fontSize: 13, marginTop: 2, fontWeight: notifyResult ? 600 : 400, color: TONE_COLOR[notify.tone] }}
              >
                {notify.sub}
              </span>
              {/*
                끄는 **경로**. ⚠️ 「토스 알림 설정에서 끌 수 있어요」라고만 적었더니 실기기에서
                **못 끄겠다**는 보고를 받았다(2026-09-01) — 앱에는 끌 수단이 없고(SDK에 철회
                API가 없다) 토스 설정은 여러 단계 안쪽이라, 단계를 안 주면 사실상 못 끄는 것과
                같다. 경로는 짐작이 아니라 **토스 공식 문서(스마트 발송 가이드)의 값**이다.

                ⚠️⚠️ **상태와 무관하게 늘 보인다.** 처음엔 「켜짐」일 때만 보여줬는데, 요청이
                실패하자(`unavailable`) 경로가 통째로 사라졌다 — 끄고 싶은 사람에게 「먼저
                켜기에 성공해야 끄는 법을 알려준다」는 앞뒤가 안 맞는다. 애초에 앱은 켜졌는지
                **알지도 못하므로**(T-012) 그 조건 자체가 성립하지 않는다. 켜기 전에 보이는
                것도 이롭다 — 빠져나갈 길을 알고 켜게 된다.
              */}
              <span style={{ display: 'block', fontSize: 12, marginTop: 4, color: 'var(--text-sub)' }}>
                끄려면 토스 앱 → 전체 → 설정 → 알림 → 서비스별 알림
              </span>
            </span>
            {/* 눌러서 여는 것임을 오른쪽이 말한다 — 켜진 뒤에도 멱등이라 자리를 지킨다. */}
            <span aria-hidden style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue)' }}>
              {notify.right}
            </span>
          </button>
        </>
      )}

      <p style={{ ...ui.sub, marginTop: 24 }}>{LOCAL_ONLY}</p>
    </main>
  );
}
