# plan — facefit v1

> 앞으로 할 일. 설계는 [`docs/2026-08-29-v1-design.md`](docs/2026-08-29-v1-design.md)가 단일 출처다 —
> 여기는 그 §10 태스크 분해를 체크박스로 옮긴 실행 계획이다.
> 완료 기록은 [`changeLog.md`](changeLog.md), 함정은 [`claude-docs/troubleshooting.md`](claude-docs/troubleshooting.md).

**범례** ✅완료 / 🔜다음 / ⬜예정 / ⏸의도적 보류(v2) / ⚠️리스크·전제

## v1 — 기록이 쌓이는 것까지

- [x] ✅ **1. 부트스트랩** — restfit 골격 복사 + 이름·포트·appName + 작업 추적 3종
  - [x] `miniapp/` vite 골격(package.json `facefit-miniapp` · dev 5320 · tsconfig · index.html · index.css · ui.ts)
  - [x] `apps-in-toss.config.ts` — `appName: 'facefit'` · webView 플래그 3종 · camera 권한
  - [x] 이식(수정 0): `camera.ts` · `logic/capture.ts` · `logic/calendar.ts` · zoom-guard (+각 test)
  - [x] plan · changeLog · troubleshooting 분할 시스템 + README 내비게이터
  - [x] `storage.ts`의 `todayKey`만 선반입 — `calendar.test.ts`가 「오늘 키가 그 달 셀에 있다」로 그걸 건다
- [ ] 🔜 **2. photoStore 이식** — `facefit-photos` / `FacePhoto` 타입 (테스트 이식 후 구현)
- [ ] ⬜ **3. storage 신설** — 제품·관찰·온보딩 + `todayKey`
- [ ] ⬜ **4. 순수 로직** — `logic/products.ts` · `logic/timelapse.ts`
- [ ] ⬜ **5. FacePhoto 화면** — 고스트 + 플래시 캡처 + 저장 후 관찰 1탭
- [ ] ⬜ **6. Products 화면** — 목록·추가·수정·종료·삭제
- [ ] ⬜ **7. History 화면** — 월간 캘린더 · 날짜 시트 · 사진 모두 삭제
- [ ] ⬜ **8. Timelapse 화면** — 자동 재생 · 스크럽 · 2× · 제품 구간 바
- [ ] ⬜ **9. Onboarding + App 배선 + Home** — 3탭 · 전체화면 3종
- [ ] ⏸ **10. 검수 준비** — 콘솔 앱 생성 · 개인정보처리방침 · 릴리스 노트 · 실기기 확인
  - 이 태스크는 **구현 범위 밖**이다. `FLASH_MS`(500) · `BASE_FPS`(6)는 여기의 실기기 실측으로 확정한다.

## ⚠️ 리스크 · 미검증 가정 (설계 §11)

- 플래시 500ms로 전면 카메라 노출 보정이 충분한가 — 실기기 전용. 부족하면 상수만 조정.
- 6fps 체감 — 같은 방식. 상수 하나라 싸다.
- `appName: facefit` 가용성 — 콘솔 생성 시 중복 확인.
- 타임랩스 365장 blob URL 메모리 — 저사양 기기에서 덜컹거리면 「현재±N장만 유지」로 좁힌다(화면 내부 최적화).

## ⏸ v2 이후 (설계 §7 — 지금 안 하는 이유가 그 문서에 있다)

제품 추천·AI · 성분표 사진 · 얼굴 자동 정렬 · 두 날짜 비교 화면 · 아침/저녁 2슬롯 ·
동영상 내보내기 · 클라우드 백업 · 촬영 리마인드 푸시 · 플래시 끄기 토글 · 제품 검색
