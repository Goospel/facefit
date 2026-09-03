import { useState, type CSSProperties } from 'react';

import { Icon } from '../components/Icon';
import { getBackupKey, isBackupSupported } from '../logic/backup';
import { cancelOilReminder, formatHm, oilState, scheduleOilReminder, type OilState } from '../logic/reminder';
import { isNotifySupported, OIL_TEMPLATE_CODE, requestNotifyAgreement } from '../notify';
import { loadOilNextAt, saveOilNextAt } from '../storage';
import { ui } from '../ui';

/**
 * 기름종이 알림 카드(v5 설계 §3-5). 오늘 탭의 「아침 알림」 행 바로 아래 — 같은 카드 가족이다.
 *
 * **승인 게이트 하나가 이 기능의 전부다**: 체크 1회 = 알림 1회. 알림이 온 뒤 여기서 다시
 * 누르지 않으면 다음은 없고, 날짜가 바뀌면 저절로 처음으로 돌아간다. 야간 상한을 안 두는
 * 근거가 이 게이트다(설계 §3-3) — 밤에 울릴지는 사용자가 체크할 때 스스로 정한다.
 *
 * ⚠️ **어느 상태에서도 primary(채운 파랑)를 쓰지 않는다.** 오늘 탭의 파란 자리는 「오늘 얼굴
 * 찍기」이고 찍은 뒤엔 0개다(UX 2차 §1). 기름종이 체크는 하루에 여러 번 반복되는 부수 행동이라,
 * 그때마다 파란 버튼이 생기면 「지금 할 일」의 신호가 흐려진다. 행동은 알림 행과 같은 **알약**,
 * 상태는 **check + 글자**로 가른다.
 */

/** 오른쪽에 설 말. `scheduled`만 행동이 아니라 **사실**이라 알약을 안 쓴다. */
const RIGHT: Record<OilState, string> = { idle: '썼어요', scheduled: '예약됨', awaiting: '썼어요 · 다음 알림' };

/**
 * 행동 버튼의 접근성 이름. **한 마디로 고정한다** — 본문을 이어 붙이면 스크린리더가 설명까지
 * 버튼 이름으로 읽는다(알림 행과 같은 규율).
 *
 * ⚠️ `role="switch"`는 **안 쓴다**(설계 §3-5) — 켜짐의 반대가 「꺼짐」이 아니라 「오늘은 없음」이라
 * 스위치 은유가 틀리다. 「꺼짐」이라 읽히면 내일도 안 온다는 뜻이 되는데, 실제로는 하루짜리 상태다.
 */
const ACTION_LABEL = { idle: '기름종이 썼어요', awaiting: '기름종이 다음 알림 받기' } as const;

/** 그만두는 줄. 예약 전이면 「그만 받기」, 알림이 간 뒤면 「오늘은 그만」 — 남은 것이 다르다. */
const STOP_LABEL: Partial<Record<OilState, string>> = { scheduled: '그만 받기', awaiting: '오늘은 그만' };

const TONE_COLOR = { on: 'var(--blue-dark)', off: 'var(--text-sub)', warn: 'var(--amber)' } as const;

/** 테두리는 분리 속성으로 쓴다(`ui.ts` 머리말). 알림 행의 알약과 **같은 부품**이다. */
const pillStyle: CSSProperties = {
  flexShrink: 0,
  padding: '8px 14px',
  fontSize: 14,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  borderRadius: 999,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--blue)',
  background: '#fff',
  color: 'var(--blue)',
};

/** 예약된 뒤의 표시. 알약이 아니라 **표식 + 글자**다 — 행동이 아니라 사실이다. */
const doneStyle: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 14,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  color: 'var(--blue-dark)',
};

/** 카드 안에서 행 노릇만 한다 — 배경·테두리는 감싼 카드가 이미 그렸다. */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: 0,
  textAlign: 'left',
  background: 'none',
  border: 0,
  color: 'inherit',
};

export function OilReminder() {
  /**
   * 상태의 단일 출처(설계 §3-2). **서버를 조회하지 않는다** — 서버는 「보낼 행」만 갖고 보내면
   * 지우므로, 물어봐야 알 수 있는 것이 없다.
   */
  const [nextAt, setNextAt] = useState(loadOilNextAt);
  /**
   * 방금 누른 결과. **이 세션 안에서만 산다**(알림 행과 같은 절단) — 거절도 실패도 다음에
   * 다시 누르면 되는 일이라, 저장해 두면 지난 실패가 오늘의 사실인 척한다.
   */
  const [session, setSession] = useState<'rejected' | 'failed' | null>(null);

  /**
   * ⚠️ 숨기는 조건은 **동의 여부가 아니라 지원 여부**다(기존 규율). 둘 다 필요하다 —
   * 시트를 못 열면 동의를 받을 수 없고, 익명 키를 못 얻으면 서버에 예약할 수 없다.
   * 어느 쪽이든 눌러도 아무 일 없는 카드가 되므로 아예 안 그린다.
   */
  if (!isNotifySupported() || !isBackupSupported()) return null;

  const state = oilState(nextAt, new Date());

  async function schedule() {
    const key = await getBackupKey();
    const res = key ? await scheduleOilReminder(key) : null;
    /*
      ⚠️ **서버가 확인해 줘야 저장한다**(설계 §3-2). 예약이 안 됐는데 「다음 알림 18:20」이라
      그리면 사용자는 오지 않을 알림을 기다린다 — 백업의 `dirty` 규율과 같은 결이다.
    */
    if (!res) return setSession('failed');

    saveOilNextAt(res.dueAt);
    setNextAt(res.dueAt);
    setSession(null);
  }

  /**
   * 「썼어요」. **매번 동의를 거친다**(멱등 — `alreadyAgreed`면 시트 없이 즉시 통과).
   * 앱은 동의 사본을 안 둔다 — 단일 출처는 토스이고, 사본을 두면 철회한 순간 거짓말이 된다.
   */
  function tap() {
    requestNotifyAgreement((result) => {
      // 거절이면 서버를 아예 안 부른다 — 안 켠 사람의 시각을 서버에 올릴 이유가 없다.
      if (result === 'agreementRejected') return setSession('rejected');
      // 못 물어본 것과 서버 실패는 사용자가 할 일이 같다(다시 누르기) — 같은 말을 한다.
      if (result === 'unavailable') return setSession('failed');
      void schedule();
    }, OIL_TEMPLATE_CODE);
  }

  /**
   * 「그만 받기」·「오늘은 그만」. **로컬을 먼저 지우고 서버 결과는 안 기다린다**(무음 폴백) —
   * 실패해도 남은 행은 예약대로 1회 가고 끝이지만, 눌렀는데 화면이 「예약됨」이면
   * 사용자에게는 빠져나갈 길이 없다.
   */
  function stop() {
    saveOilNextAt('');
    setNextAt(null);
    setSession(null);
    void getBackupKey().then((key) => {
      if (key) void cancelOilReminder(key);
    });
  }

  const [sub, tone] =
    session === 'rejected'
      ? (['알림을 켜지 않았어요 · 눌러서 언제든 켤 수 있어요', 'off'] as const)
      : session === 'failed'
        ? (['지금은 예약할 수 없어요 · 잠시 뒤 다시 눌러 주세요', 'warn'] as const)
        : state === 'scheduled'
          ? ([`다음 알림 ${formatHm(nextAt!)} · 그때 다시 쓸지 정해요`, 'on'] as const)
          : state === 'awaiting'
            ? (['알림을 보냈어요 · 다음도 받을까요', 'on'] as const)
            : (['쓰고 나서 누르면 3시간 뒤에 알려드려요', 'off'] as const);

  const body = (
    <>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>기름종이 알림</span>
        <span
          data-testid="oil-sub"
          style={{ display: 'block', fontSize: 13, marginTop: 2, fontWeight: tone === 'off' ? 400 : 600, color: TONE_COLOR[tone] }}
        >
          {sub}
        </span>
      </span>
      {/* 장식이라 `aria-hidden` — 이름은 버튼의 `aria-label`이다(알림 행과 같은 규율). */}
      <span aria-hidden data-testid="oil-right" style={state === 'scheduled' ? doneStyle : pillStyle}>
        {state === 'scheduled' && <Icon name="check" size={16} />}
        {RIGHT[state]}
      </span>
    </>
  );

  return (
    <div style={{ ...ui.card, marginTop: 8 }}>
      {/*
        예약된 동안에는 **누를 것이 없다** — 오른쪽이 행동이 아니라 사실이고, 되돌리는 길은
        아래 「그만 받기」 하나다. 버튼으로 두면 「예약됨」을 또 누르라는 뜻으로 읽힌다.
      */}
      {state === 'scheduled' ? (
        <div style={rowStyle}>{body}</div>
      ) : (
        <button aria-label={ACTION_LABEL[state]} style={rowStyle} onClick={tap}>
          {body}
        </button>
      )}

      {STOP_LABEL[state] && (
        <button aria-label="기름종이 알림 그만 받기" style={{ ...ui.ghost, marginTop: 4, marginLeft: -12 }} onClick={stop}>
          {STOP_LABEL[state]}
        </button>
      )}

      {/*
        상시 고지(설계 §3-6 · T-014 교훈). 서버에 **새 종류의 데이터**가 놓이는 기능이라,
        콘솔 상세 설명과 같은 말을 앱 안에서도 한다 — 켜기 전에 무엇이 올라가는지 알고 눌러야 한다.
        상태와 무관하게 늘 보인다: 예약에 성공해야 고지를 보여주는 건 앞뒤가 안 맞는다.
      */}
      <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '8px 0 0' }}>
        알림 시각만 서버에 잠시 저장되고 알림이 가면 지워져요
      </p>
    </div>
  );
}
