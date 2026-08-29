import { describe, expect, it } from 'vitest';

import config from '../apps-in-toss.config';

/**
 * 앱인토스 config는 **런타임에 아무도 안 읽는 파일이라 계측기가 없으면 통째로 조용하다** —
 * 값을 뒤집어도 테스트 전부가 초록이고, 깨지는 것은 실기기에서다(그것도 눈에 잘 안 띈다).
 *
 * ⚠️ 문자열 grep이 아니라 **실제 export를 읽는다.** 정규식은 포맷이 바뀌면 조용히 0건이 되고,
 * 0건은 「값이 맞다」와 구별이 안 된다.
 */
describe('apps-in-toss config', () => {
  it('appName은 케밥 케이스 고유 ID다 — URL에 그대로 박힌다', () => {
    // ⚠️ 한글을 넣어도 `ait build`는 통과하고 deploy·실행에서 깨진다(restfit T-218).
    // 「토스」도 못 쓴다(운영정책).
    expect(config.appName).toBe('facefit');
    expect(config.appName).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('카메라 권한을 선언한다 — 없으면 웹뷰의 getUserMedia가 아예 안 열린다', () => {
    expect(config.permissions).toContainEqual({ name: 'camera', access: 'access' });
  });

  it('당겨서 새로고침을 끈다 — 새로고침 한 번에 방금 찍은 사진이 날아간다', () => {
    expect(config.webView?.pullToRefreshEnabled).toBe(false);
  });

  it('인라인 재생을 켠다 — 없으면 iOS가 카메라 프리뷰를 전체화면으로 강탈한다', () => {
    /*
      ⚠️ 이 한 줄이 빠지면 **고스트 오버레이로 구도를 맞추는 촬영이 통째로 무용지물이 된다**
      (버튼·고스트가 없는 네이티브 전체화면 플레이어가 뜨고, 닫으면 인라인 `<video>`는 정지
      프레임만 남는다). 촬영 자체는 성공해서 더 눈에 안 띈다 — restfit 실기기 실측이다.
    */
    expect(config.webView?.allowsInlineMediaPlayback).toBe(true);
  });

  it('제스처 없이 프리뷰가 재생되게 둔다 — 아니면 정지 프레임에 머문다', () => {
    // 위 한 줄만으로는 인라인으로 그릴 자리만 생기고, 이쪽이 막혀 있으면 `video.play()`가
    // 사용자 조작을 기다린다.
    expect(config.webView?.mediaPlaybackRequiresUserAction).toBe(false);
  });
});
