import { Environment } from '@apps-in-toss/web-framework';

/**
 * 푸시 랜딩(v5 설계 §3-5·§7-4).
 *
 * 기름종이 알림을 탭한 사람이 **한 번에 승인 버튼에 닿게** 하는 유일한 장치다 — 카드는
 * 오늘 탭에 있는데 시작 탭은 제품이라, 이 배선이 없으면 알림을 받고도 갈 곳을 모른다.
 *
 * ⚠️ `initialURL`은 「**처음 진입**」 값이다. 미니앱이 살아 있는 채로 푸시를 탭하면 쿼리가
 * 안 실릴 수 있다 — 그때는 사용자가 오늘 탭을 누른다(카드는 어차피 거기 있다).
 */

/**
 * 스킴이 지목하는 시작 탭. **모르는 값에는 아무 말도 하지 않는다**(`null`) — 평소 진입의
 * 시작 탭을 뒤집을 근거는 「우리가 만든 푸시 링크」뿐이다.
 *
 * `URL`로 파싱하지 않는 이유: `intoss://`는 커스텀 스킴이라 구현마다 `searchParams`가
 * 비는 일이 있다. 우리가 콘솔 템플릿에 박는 값은 한 가지 형태뿐이라 그것만 본다.
 */
export function tabFromInitialUrl(url: string): 'home' | null {
  return /[?&]tab=home(&|$)/.test(url) ? 'home' : null;
}

/**
 * SDK를 읽는 자리. **토스 밖에서는 `null`이다.**
 *
 * ⚠️ `try`가 장식이 아니다 — `Environment.initialURL`은 토스 웹뷰 전역을 읽어 개발 브라우저에서
 * **TypeError로 터진다.** 여기서 새어 나가면 시작 탭을 고르려다 앱이 통째로 안 뜬다
 * (`isNotifySupported`·`isBackupSupported`와 같은 규율).
 */
export function readInitialTab(): 'home' | null {
  try {
    return tabFromInitialUrl(Environment.initialURL);
  } catch {
    return null;
  }
}
