// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBackupKey, isBackupSupported } from '../logic/backup';
import { cancelOilReminder, scheduleOilReminder } from '../logic/reminder';
import { isNotifySupported, OIL_TEMPLATE_CODE, requestNotifyAgreement, type NotifyResult } from '../notify';
import { OilReminder } from './OilReminder';

/**
 * 기름종이 알림 카드(v5 설계 §3-5 · §5-2 C-3).
 *
 * 여기서 잠그는 것:
 * - **지원 여부로만 숨긴다** — 동의 여부가 아니다(기존 규율). 못 쓰는 기기에 죽은 버튼을 남기지 않는다.
 * - **한 번의 탭이 두 가지 일을 하지 않는다**(2026-09-04 개편) — 1단계 「썼어요」는 화면만 옮기고,
 *   서버도 동의 시트도 **2단계에서만** 건드린다.
 * - **서버가 예약을 확인해야 「예약됨」이라 말한다** — 실패했는데 예약됨으로 그리면 거짓말이다.
 * - **동의를 거절하면 서버를 안 부른다** — 안 켠 사람의 시각을 서버에 올릴 이유가 없다.
 * - **채운 파란 버튼이 0개다** — 오늘 탭의 파란 자리는 「오늘 얼굴 찍기」 하나뿐이고,
 *   하루에 여러 번 반복되는 부수 행동이 그 신호를 나눠 가지면 「지금 할 일」이 흐려진다(설계 §3-5).
 *
 * ⚠️ 브릿지·서버는 목이다 — 실물은 `notify.test.ts`·`logic/reminder.test.ts`가 잰다.
 */
vi.mock('../notify', async (orig) => ({
  ...(await orig<typeof import('../notify')>()),
  isNotifySupported: vi.fn(),
  requestNotifyAgreement: vi.fn(),
}));

vi.mock('../logic/backup', async (orig) => ({
  ...(await orig<typeof import('../logic/backup')>()),
  isBackupSupported: vi.fn(),
  getBackupKey: vi.fn(),
}));

/** 판정(`oilState`·`formatHm`)은 실물을 쓴다 — 화면이 저장된 값을 제대로 읽는지가 관심사다. */
vi.mock('../logic/reminder', async (orig) => ({
  ...(await orig<typeof import('../logic/reminder')>()),
  scheduleOilReminder: vi.fn(),
  cancelOilReminder: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** 2026-09-03 15:20 KST. 「지났나」 판정의 기준점이다. */
const NOW = '2026-09-03T06:20:00Z';
const DUE = '2026-09-03T09:20:00Z'; // 18:20 KST
const PAST = '2026-09-03T03:20:00Z'; // 12:20 KST — 오늘, 이미 지남
const LATER = '2026-09-03T12:20:00Z'; // 21:20 KST — 예약을 뒤로 옮겼을 때 받는 값
const KEY = 'anon-hash-abcdef0123456789';

/**
 * 버튼 이름 넷이 **서로 다르다**. 사용자가 하는 일이 넷 다 다르기 때문이고, 같은 이름을
 * 돌려쓰면 스크린리더만 쓰는 사람에게 지금이 어느 칸인지가 안 보인다.
 */
const ASK = '기름종이 썼어요'; // 1단계 — 미예약·알림 뒤
const AGAIN_NOW = '기름종이 또 썼어요'; // 1단계 — 예약이 이미 걸려 있을 때
const CONFIRM = '3시간 뒤 알림 받기'; // 2단계
const SKIP = '알림 없이 넘어가기'; // 2단계에서 빠져나가는 줄
const STOP = '기름종이 알림 그만 받기';

/** 짧은 움직임(예약 확인)은 Web Animations API로 준다 — jsdom에는 없어 심어 준다. */
const animate = vi.fn();
/** 움직임을 줄이는 설정. 기본은 「줄이지 않음」이고, 필요한 테스트가 뒤집는다. */
let reduceMotion = false;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // ⚠️ `Date`만 가짜로 둔다 — 타이머까지 멈추면 `findBy*`가 영영 안 끝난다.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.mocked(isNotifySupported).mockReturnValue(true);
  vi.mocked(isBackupSupported).mockReturnValue(true);
  vi.mocked(getBackupKey).mockResolvedValue(KEY);
  vi.mocked(scheduleOilReminder).mockResolvedValue({ dueAt: DUE });
  vi.mocked(cancelOilReminder).mockResolvedValue(true);
  reduceMotion = false;
  Element.prototype.animate = animate as never;
  window.matchMedia = ((q: string) => ({ matches: reduceMotion && q.includes('reduced-motion') })) as never;
});

function setup(nextAt?: string) {
  if (nextAt) localStorage.setItem('facefit.oilNextAt', nextAt);
  return render(<OilReminder />);
}

/** 1단계. **화면만 옮긴다** — 서버도 동의 시트도 여기서는 안 건드린다. */
function tapUsed(label: string = ASK) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/** 2단계. 여기서 처음 동의를 묻는다. */
function tapConfirm() {
  fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
}

/** 눌러서 토스가 준 결과를 흘려 넣는다 — Home의 알림 행과 같은 관용구다. */
function answer(result: NotifyResult) {
  const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls.at(-1)!;
  act(() => onDone(result));
}

const sub = () => screen.getByTestId('oil-sub');

describe('노출 조건 — 지원 여부로만 가른다', () => {
  it.each([
    ['알림', () => vi.mocked(isNotifySupported).mockReturnValue(false)],
    ['익명 키', () => vi.mocked(isBackupSupported).mockReturnValue(false)],
  ])('%s를 못 쓰는 기기에서는 카드 자체가 없다', (_label, disable) => {
    disable();

    const { container } = setup();

    expect(container.innerHTML).toBe('');
  });
});

describe('1단계 「썼어요」 — 서버도 동의도 건드리지 않는다', () => {
  it('무엇을 해 주는지 말하고 누를 알약을 준다', () => {
    setup();

    expect(sub().textContent).toContain('쓰고 나서');
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
  });

  it('그만 받을 것이 없으니 취소 줄도 없다', () => {
    setup();

    expect(screen.queryByRole('button', { name: STOP })).toBeNull();
  });

  /*
    ⚠️⚠️ **이 테스트가 개편의 전부다**(사용자 지적 2026-09-04). 원래 알약 하나가
    「썼어요 · 다음 알림」이라 **탭 한 번이 두 가지 일**을 했다 — 기름종이를 썼다고 표시하는 것과
    알림을 받겠다는 것. 그래서 사용을 기록하려던 사람에게 **동의 시트부터** 들이밀었고,
    무슨 일이 일어났는지도 흐렸다.

    이제 1단계는 **화면만 옮긴다.** 동의는 실제로 알림을 요청하는 2단계에서만 묻는다.
  */
  it('누르는 것만으로는 동의도 예약도 일어나지 않는다 — 다음 칸을 열 뿐이다', () => {
    setup();

    tapUsed();

    expect(requestNotifyAgreement).not.toHaveBeenCalled();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
    // 대신 2단계가 열렸다 — 여기서 비로소 3시간을 말한다.
    expect(sub().textContent).toContain('3시간 뒤에');
    expect(screen.getByRole('button', { name: CONFIRM })).toBeTruthy();
  });

  /*
    ⚠️ 어느 칸에서 시작하든 **같은 2단계로 모인다.** 예약이 걸린 동안에도, 알림이 간 뒤에도
    「썼다」는 사실을 말하는 방법이 하나여야 규칙이 하나가 된다(사용자 결정 2026-09-04 —
    「예약 중이면 1탭으로 바로 재예약」을 일부러 안 골랐다).
  */
  it.each([
    ['예약된 동안', DUE, AGAIN_NOW],
    ['알림이 간 뒤', PAST, ASK],
  ])('%s에도 같은 1단계로 들어간다', (_s, seed, label) => {
    setup(seed);

    tapUsed(label);

    expect(requestNotifyAgreement).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: CONFIRM })).toBeTruthy();
  });
});

describe('2단계 「알림 받기」 — 여기서 처음 동의를 묻는다', () => {
  it('기름종이 동의문으로 동의 화면을 연다 — 아침 알림과 다른 동의문이다', () => {
    setup();

    tapUsed();
    tapConfirm();

    expect(requestNotifyAgreement).toHaveBeenCalledWith(expect.any(Function), OIL_TEMPLATE_CODE);
  });

  it('연타해도 한 번만 묻고 한 번만 예약한다', async () => {
    setup();

    tapUsed();
    tapConfirm();
    tapConfirm();
    answer('alreadyAgreed');
    await act(async () => {});

    expect(requestNotifyAgreement).toHaveBeenCalledTimes(1);
    expect(scheduleOilReminder).toHaveBeenCalledTimes(1);
  });

  it.each(['newAgreement', 'alreadyAgreed'] as const)('%s면 서버에 예약하고 받은 시각을 그린다', async (result) => {
    setup();

    tapUsed();
    tapConfirm();
    answer(result);

    expect(await screen.findByText(/18:20/)).toBeTruthy();
    expect(scheduleOilReminder).toHaveBeenCalledWith(KEY);
    // 저장까지 가야 앱을 껐다 켜도 「예약됨」이다 — state만 바뀌면 다음 실행에 사라진다.
    expect(localStorage.getItem('facefit.oilNextAt')).toBe(DUE);
  });

  /*
    오른쪽은 **사실**을 말한다(예약됐다) — 그래서 알약이 아니라 체크 표식이다. 누를 수 있다는
    것은 왼쪽 설명이 말한다. 알약으로 바꾸면 「아직 안 됐으니 누르라」로 읽혀, 이미 잡힌 예약이
    안 잡힌 것처럼 보인다.
  */
  it('예약된 뒤의 오른쪽은 알약이 아니라 체크 표식이다', () => {
    setup(DUE);

    const right = screen.getByTestId('oil-right');
    expect(right.textContent).toContain('예약됨');
    expect(right.querySelector('svg')).toBeTruthy();
  });

  /*
    ⚠️ **빠져나갈 길이 같은 자리에 있어야 한다.** 2단계는 질문이므로 「아니오」가 필요하고,
    아니라고 답한 결과는 **아무것도 남지 않는 것**이다 — 서버도 저장소도 안 건드린다.
  */
  it('「괜찮아요」로 빠져나가면 아무것도 남지 않는다', () => {
    setup();

    tapUsed();
    fireEvent.click(screen.getByRole('button', { name: SKIP }));

    expect(requestNotifyAgreement).not.toHaveBeenCalled();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
  });

  /*
    ⚠️ **거절했는데 서버를 부르면 안 된다.** 알림을 안 켠 사람의 예약 시각이 서버에 남는 것은
    그 자체로 약속 위반이고(카드 고지 줄이 「알림 시각만 잠시 저장된다」고 말한다), 가지도 않을
    알림을 위해 행을 만드는 셈이다.
  */
  it('동의를 거절하면 서버를 아예 안 부른다', async () => {
    setup();

    tapUsed();
    tapConfirm();
    answer('agreementRejected');

    expect(await screen.findByText(/켜지 않았어요/)).toBeTruthy();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
    // 다시 누를 수 있게 둔다 — 마음이 바뀌는 것이 정상이다.
    expect(screen.getByRole('button', { name: CONFIRM })).toBeTruthy();
  });

  /*
    ⚠️ **서버가 실패하면 저장하지 않는다**(백업의 `dirty` 규율과 같은 결). 예약이 안 됐는데
    「18:20에 알려드릴게요」라 그리면, 사용자는 오지 않을 알림을 기다린다.
  */
  it('서버가 실패하면 예약됨으로 그리지 않고 다시 눌러 달라고 한다', async () => {
    vi.mocked(scheduleOilReminder).mockResolvedValue(null);
    setup();

    tapUsed();
    tapConfirm();
    answer('alreadyAgreed');

    expect(await screen.findByText(/예약할 수 없어요/)).toBeTruthy();
    expect(sub().getAttribute('style')).toContain('--amber');
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
    // 실패한 자리에 그대로 둔다 — 다시 누르는 것이 곧 재시도다.
    expect(screen.getByRole('button', { name: CONFIRM })).toBeTruthy();
  });

  it('익명 키를 못 얻어도 같은 말을 한다 — 못 예약한 것은 매한가지다', async () => {
    vi.mocked(getBackupKey).mockResolvedValue(null);
    setup();

    tapUsed();
    tapConfirm();
    answer('alreadyAgreed');

    expect(await screen.findByText(/예약할 수 없어요/)).toBeTruthy();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
  });

  it('동의 화면을 못 열어도 거절과 다르게 말한다 — 못 물어본 것을 거절로 적지 않는다', async () => {
    setup();

    tapUsed();
    tapConfirm();
    answer('unavailable');

    expect(await screen.findByText(/예약할 수 없어요/)).toBeTruthy();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
  });
});

/*
  ⚠️ **예약이 걸린 동안에도 다시 걸 수 있어야 한다**(사용자 결정 2026-09-04). 기름종이는 하루에
  여러 번 쓰는 물건이라 3시간을 다 기다리지 않고 또 쓰는 것이 정상인데, 그때 누를 표면이 없으면
  「그만 받기 → 다시 누르기」를 거쳐야 다음 알림을 옮길 수 있었다.

  서버는 원래 키당 한 줄을 **덮어쓴다**(`ReminderRepository.upsert`) — 막고 있던 것은 화면뿐이다.
*/
describe('예약이 걸린 동안 — 3시간을 다 기다리지 않아도 된다', () => {
  it('또 눌러 2단계를 거치면 시각을 새로 받는다', async () => {
    vi.mocked(scheduleOilReminder).mockResolvedValue({ dueAt: LATER });
    setup(DUE);

    tapUsed(AGAIN_NOW);
    tapConfirm();
    answer('alreadyAgreed');

    expect(await screen.findByText(/21:20/)).toBeTruthy();
    expect(localStorage.getItem('facefit.oilNextAt')).toBe(LATER);
  });
});

describe('승인 대기 — 알림이 간 뒤', () => {
  it('알림을 보냈다고 말하고 또 썼는지 묻는다', () => {
    setup(PAST);

    expect(sub().textContent).toContain('알림을 보냈어요');
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
  });

  it('한 바퀴를 돌아 다시 예약된다 — 게이트가 매번 같은 순서로 돈다', async () => {
    setup(PAST);

    tapUsed();
    tapConfirm();
    answer('alreadyAgreed');

    expect(await screen.findByText(/18:20/)).toBeTruthy();
    expect(localStorage.getItem('facefit.oilNextAt')).toBe(DUE);
  });

  /*
    ⚠️ **어제 것은 승인 대기가 아니다**(설계 §3-2의 날짜 리셋). 어젯밤 알림에 답하지 않은
    사람에게 아침까지 「또 썼나요」를 들이밀면 게이트가 무기한 열려 있는 것과 같다.
  */
  it('어제 예약분이면 아무 일 없었던 것처럼 미예약으로 돌아간다', () => {
    setup('2026-09-02T14:50:00Z'); // 2026-09-02 23:50 KST

    expect(sub().textContent).toContain('쓰고 나서');
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
  });
});

/*
  ⚠️ **눌렀는지 모르겠다는 말이 나오지 않게 한다**(사용자 지적 2026-09-04 — 이 개편의 출발점).
  알약이 체크 표식으로 바뀌는 것만으로는 눈을 떼고 있던 사람이 놓친다. 예약이 확정된 **그 순간에만**
  짧은 움직임을 준다 — 상시 애니메이션이 아니라 1회성 신호다.
*/
describe('예약을 확인시킨다', () => {
  it('예약된 순간 체크 표식에 짧은 움직임을 준다', async () => {
    setup();

    tapUsed();
    tapConfirm();
    answer('alreadyAgreed');
    await screen.findByText(/18:20/);

    expect(animate).toHaveBeenCalled();
  });

  /* 그냥 그려도 되는 상태 변화까지 매번 흔들지 않는다 — 움직임은 「방금 됐다」에만 붙는다. */
  it('그냥 켜 두기만 한 화면은 흔들지 않는다', () => {
    setup(DUE);

    expect(animate).not.toHaveBeenCalled();
  });

  /* 접근성 기본 — 움직임을 줄이라고 설정한 사람에게는 안 준다(문구·표식은 그대로 바뀐다). */
  it('움직임을 줄이는 설정이면 움직이지 않는다', async () => {
    reduceMotion = true;
    setup();

    tapUsed();
    tapConfirm();
    answer('alreadyAgreed');
    await screen.findByText(/18:20/);

    expect(animate).not.toHaveBeenCalled();
  });
});

/*
  ⚠️⚠️ **마운트 순간에 얼지 않는다**(2026-09-04 실기기 보고 · T-021).

  상태는 `oilState(nextAt, new Date())` 한 줄로 정해지는데, 시간이 흐르는 것은 리렌더를 일으키지
  않는다 — 그래서 알림이 실제로 도착해도 카드는 마운트 당시의 「예약됨」에 **고착**했다. 그
  상태에서는 다음 알림을 켤 방법이 아예 없었다.

  「처음엔 되고 두 번째부터 안 되는」 정체가 이것이다: 첫 알림은 대개 앱이 죽은 뒤에 와서
  콜드 스타트가 카드를 새로 마운트해 주지만(`readInitialTab`이 오늘 탭으로 보낸다), 앱이 살아
  있는 채로 복귀하면 `initialURL`도 안 실리고(`landing.ts`) 탭도 그대로라 리마운트가 없다.

  계기를 **둘** 두는 이유: 타이머는 앱을 열어 둔 채 시각을 넘길 때, 복귀 감지는 백그라운드에서
  타이머가 스로틀될 때를 각각 잡는다 — 어느 하나로는 구멍이 남는다.
*/
describe('시각이 흐르면 상태도 흐른다', () => {
  it('예약 시각이 되면 스스로 승인 대기로 넘어간다 — 앱을 열어 둔 채여도', () => {
    // ⚠️ 이 블록만 타이머까지 가짜다(기본 설정은 `Date`만) — 잴 것이 타이머 그 자체다.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(NOW));
    setup(DUE);
    expect(screen.getByTestId('oil-right').textContent).toContain('예약됨');

    act(() => {
      vi.setSystemTime(new Date('2026-09-03T09:20:01Z'));
      vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 2000);
    });

    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    expect(sub().textContent).toContain('알림을 보냈어요');
  });

  it('앱으로 돌아오면 다시 센다 — 백그라운드에 있는 동안 시각이 지났을 수 있다', () => {
    setup(DUE);

    act(() => {
      vi.setSystemTime(new Date('2026-09-03T09:21:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    // 지나간 시각을 「알려드릴게요」라 계속 말하고 있으면 그 자체가 거짓말이다.
    expect(sub().textContent).not.toContain('18:20');
  });

  /* 예약을 지운 뒤에도 옛 시각의 타이머가 살아 있으면, 엉뚱한 때에 화면이 한 번 흔들린다. */
  it('카드가 사라져도 리스너를 남기지 않는다', () => {
    const off = vi.spyOn(document, 'removeEventListener');
    const { unmount } = setup(DUE);

    unmount();

    expect(off).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});

describe('그만 받기 — 되돌릴 수 있어야 켤 수 있다', () => {
  it.each([
    ['예약됨', DUE, '그만 받기'],
    ['승인 대기', PAST, '오늘은 그만'],
  ])('%s 상태에서 누르면 서버와 기기 양쪽을 비우고 미예약으로 돌아간다', async (_s, seed, label) => {
    setup(seed);

    expect(screen.getByRole('button', { name: STOP }).textContent).toContain(label);
    fireEvent.click(screen.getByRole('button', { name: STOP }));

    expect(await screen.findByRole('button', { name: ASK })).toBeTruthy();
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
    expect(cancelOilReminder).toHaveBeenCalledWith(KEY);
  });

  /*
    ⚠️ **서버 삭제가 실패해도 로컬은 지운다**(무음 폴백). 남은 행은 예약대로 1회 가고 끝이지만,
    「그만」을 눌렀는데 화면이 계속 「예약됨」이면 사용자에게는 빠져나갈 길이 없어진다.
  */
  it('서버 삭제가 실패해도 화면은 미예약으로 간다', async () => {
    vi.mocked(cancelOilReminder).mockResolvedValue(false);
    setup(DUE);

    fireEvent.click(screen.getByRole('button', { name: STOP }));

    expect(await screen.findByRole('button', { name: ASK })).toBeTruthy();
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
  });
});

describe('오늘 탭의 파란 자리를 나눠 갖지 않는다', () => {
  /*
    ⚠️ 이 카드는 **어느 상태에서도 primary(채운 파랑)를 안 쓴다**(설계 §3-5). 오늘 탭의 파란
    버튼은 「오늘 얼굴 찍기」 하나이고 찍은 뒤엔 0개다 — 하루에 여러 번 반복되는 부수 행동이
    그때마다 파란 버튼을 만들면 「지금 할 일」의 신호가 흐려진다.
  */
  it.each([
    ['미예약', undefined, false],
    ['2단계', undefined, true],
    ['예약됨', DUE, false],
    ['승인 대기', PAST, false],
  ])('%s 상태에 채운 파란 버튼이 없다', (_s, seed, step2) => {
    const { container } = setup(seed);
    if (step2) tapUsed();

    const filled = [...container.querySelectorAll('[style]')].filter((el) =>
      (el.getAttribute('style') ?? '').includes('background: var(--blue)'),
    );
    expect(filled).toHaveLength(0);
  });

  /*
    ⚠️ **`role="switch"`를 안 쓴다**(설계 §3-5) — 켜짐의 반대가 「꺼짐」이 아니라 「오늘은
    없음」이라 스위치 은유가 틀리다. 스크린리더가 「꺼짐」이라 읽으면 내일도 안 온다는 뜻으로
    들리는데, 실제로는 내일 다시 누르면 되는 하루짜리 상태다.
  */
  it.each([
    ['미예약', undefined],
    ['예약됨', DUE],
    ['승인 대기', PAST],
  ])('%s 상태에 스위치가 없다', (_s, seed) => {
    setup(seed);

    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});

describe('개인정보 고지 — 상시', () => {
  /*
    ⚠️ 서버에 **새 종류의 데이터**가 놓이는 기능이다(설계 §3-6 · T-014 교훈). 콘솔 상세 설명과
    같은 말을 앱 안에서도 해야, 켜기 전에 무엇이 올라가는지 알고 누를 수 있다.
    상태와 무관하게 늘 보이는 것이 조건이다 — 예약에 성공해야 고지를 보여주는 건 앞뒤가 안 맞는다.
  */
  it.each([
    ['미예약', undefined, false],
    ['2단계', undefined, true],
    ['예약됨', DUE, false],
    ['승인 대기', PAST, false],
  ])('%s 상태에서도 무엇이 서버에 남는지 말한다', (_s, seed, step2) => {
    setup(seed);
    if (step2) tapUsed();

    expect(screen.getByText(/알림 시각만 서버에 잠시 저장되고 알림이 가면 지워져요/)).toBeTruthy();
  });
});
