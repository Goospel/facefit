import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isNotifySupported, OIL_TEMPLATE_CODE, requestNotifyAgreement, TEMPLATE_CODE } from './notify';

/**
 * 알림 동의 요청 래퍼(설계 §2-2·§3-2).
 *
 * SDK를 통째로 목으로 갈아 끼운다 — `Notification.requestAgreement`는 토스 웹뷰 브릿지를
 * 부르고, 브라우저·테스트에는 그 브릿지가 없다.
 *
 * 여기서 잠그는 것: **동의 여부를 앱이 안 들고 있다**(결과는 콜백으로 흘려보낼 뿐이다) ·
 * **결과가 오면 스스로 콜백을 해제한다**(부르는 화면이 cleanup을 들고 있을 이유가 없다) ·
 * **어떤 실패도 던지지 않는다**(설계 §3-2: 촬영 흐름을 푸시가 방해하는 순간 주객전도다).
 */
const { requestAgreement } = vi.hoisted(() => ({
  requestAgreement: Object.assign(vi.fn(), { isSupported: vi.fn() }),
}));

vi.mock('@apps-in-toss/web-framework', () => ({ Notification: { requestAgreement } }));

/** SDK가 준 cleanup. 「결과가 오면 해제한다」의 유일한 관측점이다. */
const cleanup = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  requestAgreement.isSupported.mockReturnValue(true);
  requestAgreement.mockReturnValue(cleanup);
});

/** 마지막 호출에 실린 콜백들. SDK가 결과를 돌려주는 순간을 흉내 낸다. */
function callbacks() {
  return requestAgreement.mock.calls.at(-1)![0] as {
    options: { templateCode: string };
    onEvent: (r: { type: 'newAgreement' | 'alreadyAgreed' | 'agreementRejected' }) => void;
    onError: (e: unknown) => void;
  };
}

describe('알림 동의 요청 — 지원 여부', () => {
  it('토스 앱이 구버전이면 SDK를 아예 안 부른다 — 부르면 던지는 API다', () => {
    requestAgreement.isSupported.mockReturnValue(false);

    requestNotifyAgreement(vi.fn());

    expect(requestAgreement).not.toHaveBeenCalled();
  });

  it('지원 여부 확인 자체가 던져도 조용히 접는다 — 토스 밖(개발 브라우저)에서는 실제로 던진다', () => {
    // SDK의 `isSupported`는 `window.__appsInTossConstants`를 읽는다 — 토스 웹뷰 밖에서는
    // 그 전역이 없어 **TypeError로 터진다.** 여기서 새어 나가면 촬영 화면이 통째로 죽는다.
    requestAgreement.isSupported.mockImplementation(() => {
      throw new TypeError('no bridge');
    });

    expect(isNotifySupported()).toBe(false);
    expect(() => requestNotifyAgreement(vi.fn())).not.toThrow();
    expect(requestAgreement).not.toHaveBeenCalled();
  });

  it('지원하면 그렇다고 답한다 — 제안 스텝을 띄울지의 근거다', () => {
    expect(isNotifySupported()).toBe(true);
  });

  it('SDK 호출이 던져도 조용히 접는다', () => {
    requestAgreement.mockImplementation(() => {
      throw new Error('boom');
    });
    const onDone = vi.fn();

    expect(() => requestNotifyAgreement(onDone)).not.toThrow();
    // 끝난 것으로 알린다 — 안 그러면 부른 화면이 콜백을 영영 기다린다.
    // ⚠️ **거절이 아니라 `unavailable`이다** — 사용자가 거절한 것과 우리가 못 물어본 것은
    // 화면이 해야 할 말이 다르다(「안 켰어요」 vs 「지금은 열 수 없어요」).
    expect(onDone).toHaveBeenCalledWith('unavailable');
  });
});

describe('알림 동의 요청 — 결과 전달', () => {
  it('콘솔에 만든 템플릿 코드로 동의 화면을 연다', () => {
    requestNotifyAgreement(vi.fn());

    // ⚠️ 콘솔 실측값이다(`{appName}-` 접두어 필수 — 설계 §4-3). 이 값이 어긋나면
    // 동의 시트가 안 뜨고, 그건 앱 안에서 구별할 방법이 없는 실패다.
    expect(callbacks().options.templateCode).toBe('facefit-daily-photo-reminder');
    expect(TEMPLATE_CODE).toBe('facefit-daily-photo-reminder');
  });

  /*
    ⚠️ 동의문이 **기능마다 따로**다(v5 설계 §3-5). 아침 촬영 알림은 REGULAR 정기 발송이고
    기름종이 알림은 CONDITION_BASED 조건 발송이라, 하나로 묶으면 한쪽만 원한 사용자에게
    다른 쪽까지 켜진다. 그래서 코드를 **인자로** 받되 기본값은 기존 상수로 둔다 —
    이미 부르고 있는 자리들을 다 고치는 변경은 이 기능이 요구하지 않는다.
  */
  it('두 번째 인자로 준 코드로 연다 — 기름종이 동의문은 아침 알림과 다른 동의문이다', () => {
    requestNotifyAgreement(vi.fn(), OIL_TEMPLATE_CODE);

    expect(callbacks().options.templateCode).toBe('facefit-oil-paper-reminder');
    expect(OIL_TEMPLATE_CODE).toBe('facefit-oil-paper-reminder');
  });

  it.each(['newAgreement', 'alreadyAgreed'] as const)('%s를 뭉개지 않고 그대로 넘긴다', (type) => {
    /*
      ⚠️ **둘을 boolean 하나로 합치면 안 된다.** `alreadyAgreed`는 「지금 켜져 있다」는
      뜻이고, 상태를 물어보는 API가 없는 이 SDK에서 **그것이 유일하게 진실을 아는 순간**이다
      (`Notification`에는 `requestAgreement` 하나뿐 — 실측). 합치면 화면은 「방금 켰다」와
      「원래 켜져 있었다」를 구별 못 해, 이미 켠 사용자에게 아무 말도 못 한다.
    */
    const onDone = vi.fn();
    requestNotifyAgreement(onDone);

    callbacks().onEvent({ type });

    expect(onDone).toHaveBeenCalledWith(type);
  });

  it('거절이면 동의 안 된 것으로 알린다 — 그래도 흐름은 끝난다', () => {
    const onDone = vi.fn();
    requestNotifyAgreement(onDone);

    callbacks().onEvent({ type: 'agreementRejected' });

    expect(onDone).toHaveBeenCalledWith('agreementRejected');
  });

  it('오류가 나도 끝난 것으로 알린다 — 부른 화면이 영영 기다리면 안 된다', () => {
    const onDone = vi.fn();
    requestNotifyAgreement(onDone);

    callbacks().onError(new Error('bridge died'));

    // 거절과 갈라 둔다 — 브릿지가 죽은 것을 「사용자가 안 켰다」로 적으면 거짓말이다.
    expect(onDone).toHaveBeenCalledWith('unavailable');
  });
});

describe('알림 동의 요청 — 콜백 해제', () => {
  it.each([
    ['동의', () => callbacks().onEvent({ type: 'newAgreement' })],
    ['오류', () => callbacks().onError(new Error('x'))],
  ])('%s로 끝나면 SDK가 준 cleanup을 부른다 — 해제는 래퍼가 들고 있다', (_label, settle) => {
    requestNotifyAgreement(vi.fn());
    expect(cleanup).not.toHaveBeenCalled();

    settle();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('해제한 뒤 늦은 신호가 와도 결과는 딱 한 번이다 — 브릿지가 조용히 두 번 답할 수 있다', () => {
    // 부르는 화면은 이 콜백으로 **흐름을 끝낸다**. 두 번 오면 이미 닫힌 화면을 또 닫거나,
    // 거절로 끝난 것을 뒤늦게 동의로 뒤집는다.
    const onDone = vi.fn();
    requestNotifyAgreement(onDone);

    callbacks().onEvent({ type: 'newAgreement' });
    callbacks().onError(new Error('늦게 온 오류'));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('newAgreement');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('결과가 동기로 와도 해제한다 — cleanup을 손에 쥐기 전에 끝나는 순간이 있다', () => {
    // 브릿지가 즉시 답하면 `onEvent`가 **`requestAgreement`가 돌아오기 전에** 돈다.
    // 그때 순진하게 대입만 하면 그 구독은 영영 안 풀린다.
    requestAgreement.mockImplementation((p: { onEvent: (r: { type: string }) => void }) => {
      p.onEvent({ type: 'newAgreement' });
      return cleanup;
    });
    const onDone = vi.fn();

    requestNotifyAgreement(onDone);

    expect(onDone).toHaveBeenCalledWith('newAgreement');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
