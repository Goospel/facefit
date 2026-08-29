import { Notification } from '@apps-in-toss/web-framework';

/**
 * 촬영 리마인드 알림 동의(설계 §2-2·§3-2).
 *
 * 발송은 **토스가 대신 한다** — 콘솔에 만들어 둔 정기 템플릿(매일 08:00)이 동의자 자동
 * 세그먼트로 나간다. 그래서 앱이 하는 일은 **동의 화면을 여는 것 하나뿐이고**, 서버는 0대다.
 *
 * ⚠️ **동의 여부를 앱이 저장하지 않는다.** 단일 출처는 토스다 — 사용자가 토스 알림 설정에서
 * 철회해도 앱은 알 수 없고, 사본을 두면 그 순간부터 거짓말이 된다(설계 §3-5). 다시 불러도
 * `alreadyAgreed`로 무해하게 끝나므로(**멱등**) 추적할 이유 자체가 없다.
 *
 * ⚠️ **어떤 실패도 밖으로 던지지 않는다.** 이 함수가 던지면 촬영 흐름이 알림 때문에 죽는다 —
 * 주객전도다(설계 §3-2).
 */

/**
 * 콘솔 REGULAR 기능성 템플릿의 코드(실측 확정값 — `{appName}-` 접두어가 필수다).
 *
 * ⚠️ 이 값이 콘솔과 어긋나면 **동의 시트가 안 뜨고, 앱 안에서는 그 실패를 구별할 수 없다**
 * (설계 §7-1 — 실기기 실수신이 유일한 최종 검증이다).
 */
export const TEMPLATE_CODE = 'facefit-daily-photo-reminder';

/**
 * 이 기기에서 동의를 물어볼 수 있는가(토스 5.255.0 이상).
 *
 * ⚠️ `try`가 장식이 아니다 — SDK의 `isSupported`는 `window.__appsInTossConstants`를 읽는데
 * **토스 밖(개발 브라우저)에는 그 전역이 없어 TypeError로 터진다.** 여기서 새어 나가면
 * 물어보려다 촬영 화면을 죽인다.
 */
export function isNotifySupported(): boolean {
  try {
    return Notification.requestAgreement.isSupported();
  } catch {
    return false;
  }
}

/**
 * 동의 화면을 연다. 토스가 시트를 직접 띄우고 결과만 돌려준다.
 *
 * `onDone(agreed)`는 **어떤 경로로든 반드시 한 번** 불린다(동의·거절·오류·미지원) —
 * 부르는 화면이 콜백을 영영 기다리다 굳는 상태를 안 만든다. 결과가 오면 SDK가 준 cleanup을
 * 여기서 부른다 — 해제를 화면에 떠넘기면 그 화면마다 같은 배선이 반복된다.
 */
export function requestNotifyAgreement(onDone: (agreed: boolean) => void): void {
  if (!isNotifySupported()) return void onDone(false);

  let cleanup: (() => void) | null = null;
  let settled = false;
  const finish = (agreed: boolean) => {
    // ⚠️ 해제한 뒤에도 브릿지가 한 번 더 답할 수 있다(동의 뒤 늦은 오류). 두 번 흘려보내면
    // 부르는 화면이 이미 끝낸 흐름을 또 끝내거나, 거절로 닫힌 결과가 뒤늦게 뒤집힌다.
    if (settled) return;
    settled = true;
    cleanup?.();
    cleanup = null;
    onDone(agreed);
  };

  try {
    cleanup = Notification.requestAgreement({
      options: { templateCode: TEMPLATE_CODE },
      onEvent: (r) => finish(r.type !== 'agreementRejected'),
      onError: () => finish(false),
    });
    // ⚠️ 브릿지가 **동기로** 답하면 위 대입 전에 `finish`가 이미 끝나 있다 —
    // 그때 그냥 두면 그 구독은 영영 안 풀린다.
    if (settled) {
      cleanup();
      cleanup = null;
    }
  } catch {
    // 미지원 버전에서 호출하면 SDK가 던진다(그 밖의 브릿지 오류도 여기로 온다).
    if (!settled) finish(false);
  }
}
