import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readInitialTab, tabFromInitialUrl } from './landing';

/**
 * 푸시 랜딩(v5 설계 §3-5·§7-4).
 *
 * 기름종이 알림을 탭한 사람이 **한 번에 승인 버튼에 닿게** 하는 유일한 장치다 — 카드는
 * 오늘 탭에 있는데 앱의 시작 탭은 제품이라, 이 배선이 없으면 알림을 받고도 「그래서 어디로
 * 가라는 거지」가 된다.
 *
 * 규율은 `notify.ts`·`backup.ts`와 **동형**이다: SDK가 던지는 것을 삼키고 밖으로 안 흘린다.
 * ⚠️ `Environment.initialURL`은 토스 웹뷰 전역을 읽어 **토스 밖(개발 브라우저)에서
 * TypeError로 터진다** — 여기서 새어 나가면 앱이 통째로 안 뜬다.
 */
const { environment } = vi.hoisted(() => ({ environment: {} as { initialURL?: string } }));

vi.mock('@apps-in-toss/web-framework', () => ({
  Environment: {
    get initialURL() {
      // 토스 밖의 실제 동작을 흉내 낸다 — 값을 안 심으면 던진다.
      if (environment.initialURL === undefined) throw new TypeError('no bridge');
      return environment.initialURL;
    },
  },
}));

beforeEach(() => {
  delete environment.initialURL;
});

describe('tabFromInitialUrl — 스킴에서 시작 탭을 읽는다', () => {
  it('푸시 템플릿이 싣는 스킴이면 오늘 탭이다', () => {
    expect(tabFromInitialUrl('intoss://facefit?tab=home')).toBe('home');
  });

  /*
    ⚠️ **아무 값도 안 붙은 진입은 그대로 둔다.** 홈 화면 아이콘으로 여는 평소 경로가 이것이고,
    여기서 오늘 탭을 열면 부르지 않은 얼굴 사진이 앱을 열자마자 뜬다(2026-09-02 실기기 피드백으로
    제품 탭을 첫 자리로 옮긴 그 이유다).
  */
  it('쿼리가 없으면 아무 말도 하지 않는다 — 평소 진입의 시작 탭을 뒤집지 않는다', () => {
    expect(tabFromInitialUrl('intoss://facefit')).toBeNull();
  });

  it('모르는 값이면 아무 말도 하지 않는다 — 오타 하나로 엉뚱한 탭이 열리지 않는다', () => {
    expect(tabFromInitialUrl('intoss://facefit?tab=xyz')).toBeNull();
    expect(tabFromInitialUrl('')).toBeNull();
  });
});

describe('readInitialTab — SDK를 읽는 자리', () => {
  it('스킴에 실린 값을 그대로 돌려준다', () => {
    environment.initialURL = 'intoss://facefit?tab=home';

    expect(readInitialTab()).toBe('home');
  });

  it('토스 밖에서는 null이다 — 여기서 던지면 개발 브라우저에서 앱이 통째로 안 뜬다', () => {
    expect(() => readInitialTab()).not.toThrow();
    expect(readInitialTab()).toBeNull();
  });
});
