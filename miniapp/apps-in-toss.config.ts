import { defineConfig } from '@apps-in-toss/web-framework/config';

// ⚠️ appName은 **표시 이름이 아니라 케밥-케이스 고유 ID**다(콘솔에서 수정 불가). 사람이 보는 이름은
//    콘솔의 「한국어 앱 이름」(= 그화장품효과있나)이고 여기와 별개다. 이 값은 `<appName>.ait` 파일명이자
//    **URL에 그대로 박힌다** — `intoss-private://<appName>?...` 와 `.../bundles/<appName>/upload-start`.
//    ⚠️ 한글을 넣어도 `ait build`는 통과한다(검증이 「문자열인가 && 빈칸 아닌가」뿐이다) — 그리고
//    deploy·실행에서 깨진다. **빌드 통과를 유효성의 증거로 삼지 말 것**(restfit T-218).
// ⚠️ 이름에 "토스"를 쓸 수 없다(운영정책). 콘솔 생성 시 중복이면 `face-fit` 등으로 바꾼다.
export default defineConfig({
  appName: 'facefit',
  brand: { primaryColor: '#3182F6' },
  // 카메라는 **얼굴 사진(매일 같은 구도로 찍는 얼굴 사진) 촬영 화면**이 쓴다 — 라이브 프리뷰
  // 위에 기준 사진을 반투명으로 겹쳐 사용자가 구도를 맞춘다. 네이티브 선언이 없으면 웹뷰의
  // `getUserMedia`가 열리지 않는다(restfit에서 프로브로 실측해 확인했다).
  // ⚠️ 심사 릴리즈 노트에 사용 목적을 함께 적는다 — 사진은 기기에만 저장되고 전송되지 않는다.
  permissions: [{ name: 'camera', access: 'access' }],
  webView: {
    // ⚠️ 당겨서 새로고침을 끈다 — 촬영 중 상태는 React state에만 있어서 **새로고침 한 번에 방금 찍은 사진이 날아간다.**
    pullToRefreshEnabled: false,
    // ⚠️ **없으면 iOS 웹뷰가 카메라 프리뷰를 전체화면으로 강탈한다**(WKWebView 기본값이 false다).
    // 실기기 증상: 촬영 화면에서 카메라를 켜면 버튼·고스트가 없는 네이티브 전체화면 플레이어가 뜨고,
    // 그걸 닫으면 앱의 인라인 `<video>`는 정지 프레임만 남는다 — **고스트 오버레이로 구도를 맞추는
    // 얼굴 촬영이 통째로 무용지물이 된다**(촬영 자체는 성공해서 더 눈에 안 띈다). 화면 코드의
    // `<video autoPlay playsInline muted>`는 이미 맞다 — 막은 것은 컨테이너 쪽이다.
    allowsInlineMediaPlayback: true,
    // ⚠️ 음소거된 카메라 프리뷰가 **제스처 없이** 재생을 시작하게 한다. 위 한 줄만으로는 인라인으로
    // 그릴 자리만 생기고, 이쪽이 막혀 있으면 `video.play()`가 사용자 조작을 기다리다 정지 프레임에 머문다.
    mediaPlaybackRequiresUserAction: false,
  },
  webBundleDir: 'dist',
});
