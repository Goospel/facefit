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
const KEY = 'anon-hash-abcdef0123456789';

const ASK = '기름종이 썼어요';
const AGAIN = '기름종이 다음 알림 받기';
const STOP = '기름종이 알림 그만 받기';

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
});

function setup(nextAt?: string) {
  if (nextAt) localStorage.setItem('facefit.oilNextAt', nextAt);
  return render(<OilReminder />);
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

describe('미예약 — 그날의 시작점', () => {
  it('무엇을 해 주는지 말하고 누를 알약을 준다', () => {
    setup();

    expect(screen.getByText('기름종이 알림')).toBeTruthy();
    expect(sub().textContent).toContain('3시간 뒤에 알려드려요');
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    // 알림 행과 **같은 부품**(`ui.pill`)이다 — 파란 채움 대신 알약이 이 카드의 행동 신호다.
    expect(screen.getByTestId('oil-right').getAttribute('style')).toContain('999');
  });

  it('그만 받을 것이 없으니 취소 줄도 없다', () => {
    setup();

    expect(screen.queryByRole('button', { name: STOP })).toBeNull();
  });

  it('누르면 기름종이 동의문으로 동의 화면을 연다 — 아침 알림과 다른 동의문이다', () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: ASK }));

    expect(requestNotifyAgreement).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestNotifyAgreement).mock.calls[0][1]).toBe(OIL_TEMPLATE_CODE);
  });

  /*
    ⚠️ **동의 시트가 뜨는 동안에도 이 버튼은 살아 있다.** 시트가 뜨기까지의 빈 시간에 연타하면
    시트가 두 번 뜨고 예약도 두 번 나간다 — 서버는 키당 1행이라 결과는 같지만, 사용자는 시트를
    두 번 닫아야 하고 레이트리밋(분당 6회)만 축낸다.
  */
  it('연타해도 한 번만 묻고 한 번만 예약한다', async () => {
    setup();
    const button = screen.getByRole('button', { name: ASK });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(requestNotifyAgreement).toHaveBeenCalledTimes(1);
    answer('alreadyAgreed');
    expect(await screen.findByText(/18:20/)).toBeTruthy();
    expect(scheduleOilReminder).toHaveBeenCalledTimes(1);
  });
});

describe('예약 — 동의 확인 뒤 서버가 시각을 정한다', () => {
  it.each(['newAgreement', 'alreadyAgreed'] as const)('%s면 서버에 예약하고 받은 시각을 그린다', async (result) => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: ASK }));
    answer(result);

    expect(await screen.findByText(/18:20/)).toBeTruthy();
    expect(scheduleOilReminder).toHaveBeenCalledWith(KEY);
    // 저장까지 가야 앱을 껐다 켜도 「예약됨」이다 — state만 바뀌면 다음 실행에 사라진다.
    expect(localStorage.getItem('facefit.oilNextAt')).toBe(DUE);
  });

  it('예약된 뒤의 오른쪽은 알약이 아니라 체크 표식이다 — 예약된 것을 또 누르라고 하지 않는다', () => {
    setup(DUE);

    const right = screen.getByTestId('oil-right');
    expect(right.textContent).toContain('예약됨');
    expect(right.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: ASK })).toBeNull();
  });

  /*
    ⚠️ **거절했는데 서버를 부르면 안 된다.** 알림을 안 켠 사람의 예약 시각이 서버에 남는 것은
    그 자체로 약속 위반이고(카드 고지 줄이 「알림 시각만 잠시 저장된다」고 말한다), 가지도 않을
    알림을 위해 행을 만드는 셈이다.
  */
  it('동의를 거절하면 서버를 아예 안 부른다', async () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: ASK }));
    answer('agreementRejected');

    expect(await screen.findByText(/켜지 않았어요/)).toBeTruthy();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
    // 다시 누를 수 있게 둔다 — 마음이 바뀌는 것이 정상이다.
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
  });

  /*
    ⚠️ **서버가 실패하면 저장하지 않는다**(백업의 `dirty` 규율과 같은 결). 예약이 안 됐는데
    「다음 알림 18:20」이라 그리면, 사용자는 오지 않을 알림을 기다린다.
  */
  it('서버가 실패하면 예약됨으로 그리지 않고 다시 눌러 달라고 한다', async () => {
    vi.mocked(scheduleOilReminder).mockResolvedValue(null);
    setup();

    fireEvent.click(screen.getByRole('button', { name: ASK }));
    answer('alreadyAgreed');

    expect(await screen.findByText(/예약할 수 없어요/)).toBeTruthy();
    expect(sub().getAttribute('style')).toContain('--amber');
    expect(localStorage.getItem('facefit.oilNextAt')).toBeNull();
  });

  it('익명 키를 못 얻어도 같은 말을 한다 — 못 예약한 것은 매한가지다', async () => {
    vi.mocked(getBackupKey).mockResolvedValue(null);
    setup();

    fireEvent.click(screen.getByRole('button', { name: ASK }));
    answer('alreadyAgreed');

    expect(await screen.findByText(/예약할 수 없어요/)).toBeTruthy();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
  });

  it('동의 화면을 못 열어도 거절과 다르게 말한다 — 못 물어본 것을 거절로 적지 않는다', async () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: ASK }));
    answer('unavailable');

    expect(await screen.findByText(/예약할 수 없어요/)).toBeTruthy();
    expect(scheduleOilReminder).not.toHaveBeenCalled();
  });
});

describe('승인 대기 — 알림이 간 뒤', () => {
  it('알림을 보냈다고 말하고 다음을 받을지 묻는다', () => {
    setup(PAST);

    expect(sub().textContent).toContain('알림을 보냈어요');
    expect(screen.getByRole('button', { name: AGAIN })).toBeTruthy();
  });

  it('승인하면 한 번 더 예약한다 — 게이트가 한 바퀴 돈다', async () => {
    setup(PAST);

    fireEvent.click(screen.getByRole('button', { name: AGAIN }));
    answer('alreadyAgreed');

    expect(await screen.findByText(/18:20/)).toBeTruthy();
    expect(localStorage.getItem('facefit.oilNextAt')).toBe(DUE);
  });

  /*
    ⚠️ **어제 것은 승인 대기가 아니다**(설계 §3-2의 날짜 리셋). 어젯밤 알림에 답하지 않은
    사람에게 아침까지 「다음도 받을까요」를 들이밀면 게이트가 무기한 열려 있는 것과 같다.
  */
  it('어제 예약분이면 아무 일 없었던 것처럼 미예약으로 돌아간다', () => {
    setup('2026-09-02T14:50:00Z'); // 2026-09-02 23:50 KST

    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    expect(screen.queryByRole('button', { name: AGAIN })).toBeNull();
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
    ['미예약', undefined],
    ['예약됨', DUE],
    ['승인 대기', PAST],
  ])('%s 상태에 채운 파란 버튼이 없다', (_s, seed) => {
    const { container } = setup(seed);

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
    ['미예약', undefined],
    ['예약됨', DUE],
    ['승인 대기', PAST],
  ])('%s 상태에서도 무엇이 서버에 남는지 말한다', (_s, seed) => {
    setup(seed);

    expect(screen.getByText(/알림 시각만 서버에 잠시 저장되고 알림이 가면 지워져요/)).toBeTruthy();
  });
});
