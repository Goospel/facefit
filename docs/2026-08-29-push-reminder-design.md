# v2-1 설계 — 촬영 리마인드 푸시 (2026-08-29)

> 근거: [서비스 구상](2026-08-29-service-concept.md) §5-1(같은 시간대 촬영 습관화) ·
> §5-4(리텐션이 곧 제품) · §5-3(문구 규율 — 단정 금지).
> v1은 2026-08-29 라이브 출시 완료(miniAppId 70438 · appName `facefit` · sdk 3.1.1).

---

## 0. 결론 요약

- **서버 0대 그대로 성립한다.** 콘솔의 기능성 정기 발송(`push_template_create` type=`REGULAR`)은
  **토스가 대신 매일 발송**한다 — 파트너 서버도, 앱의 런타임 네트워크 호출도 필요 없다.
- 구조는 셋: ① **콘솔 알림동의문**(SCHEDULED · 매일 08:00) → ② **콘솔 정기 템플릿**(REGULAR ·
  기능성 · AI 자동검수) → ③ **앱에서 동의 요청**(`Notification.requestAgreement` — SDK에 이미 있음).
- 발송 대상은 **동의문에 동의한 사용자 자동 세그먼트**다 — 미동의자에겐 애초에 안 가고,
  철회는 토스 알림 설정에서 사용자가 한다. 앱이 관리할 상태가 거의 없다.
- 앱 코드 범위는 최소다: localStorage 키 1개 + SDK 래퍼 1개 + UI 지점 2곳(촬영 완료 후 1회 제안 ·
  Home 상시 진입점).
- 발송 시각은 **매일 08:00 KST 고정, 사용자 설정 없음**(§5-1 아침 권장). 시각 설정·다중 슬롯은 보류(§6).
- restfit에 푸시 전례는 **없다**(§2-3) — 이번이 첫 구현이고, 콘솔 도구 스키마가 1차 사료다.

---

## 1. 목표 · 비목표

**목표**: 동의한 사용자에게 매일 아침 08:00에 촬영 리마인드 푸시 1건이 간다. 그것뿐이다.

**비목표(YAGNI — §6 보류 목록에 이유)**: 발송 시각 사용자 설정 · 아침/저녁 다중 슬롯 ·
세그먼트 타기팅 · 미촬영자만 조준 · 발송 통계 대시보드 · 철회 감지와 재동의 유도.

---

## 2. 조사 결과 (실측)

### 2-1. 플랫폼 푸시 모델 (콘솔 MCP 도구 스키마 = 1차 사료)

| 개념 | 실측 내용 |
|---|---|
| **알림동의문** (`push_notification_agreement_create`) | 발송의 전제. `sendMethod=SCHEDULED`(정해진 요일·시각, 토스 대신 발송용)와 `CONDITION_BASED`(파트너 서버 직접 발송용) 두 종류. SCHEDULED는 `schedule{cronType: 'DAILY', dayOfWeek: 'MON,...,SUN'(DAILY여도 7일 전부 명시 필수), hour, minute}` + `purpose`(짧은 명사, 예 '촬영') 필수. **동의 화면 제목은 자동 생성** — DAILY면 「매일 {purpose} 알림을 보내드릴까요?」(질문형! §5-3과 자연 부합). 응답의 `termsId`(=agreementId)를 템플릿에 넣는다(`subscriptionTemplateId`·`stdConsentCode`를 넣으면 거부). 같은 요일·시각의 동의문이 이미 있으면 중복 거부 — 생성 전 `push_notification_agreement_list` 필수 |
| **템플릿** (`push_template_create`) | **"서버 없이 발송하기: 파트너사 서버가 없어도 이 tool 하나로 예약 발송까지 끝난다"**(스키마 원문). 조건 3개: 미니앱 status=OPEN(라이브라 충족) · `contentReachType=FUNCTIONAL`(생략 시 RECOMMEND로 들어가 실패) · SCHEDULED 동의문의 `termsId`. `type=REGULAR`(정기) + `sendOption.sendRegularOption{dayOfWeek, minute, hours, startTs, endTs}`로 반복 발송. AI 자동검수 통과 시 즉시 APPROVED = **그대로 예약 완료** |
| **발송 대상** | 세그먼트를 고르지 않는다 — **termsId에 동의한 사용자로 자동 생성**(콘솔 웹도 동일). `push_target_segment_*`는 이 흐름에서 불필요 |
| **`push_send_scheduled`** | 이름과 달리 **type=SERVER 전용 검수 요청 도구**다. NORMAL/REGULAR는 거부된다 — 이번 설계에서 호출하지 않는다(V2 자동검수 APPROVED가 곧 예약) |
| **문구 하드 제약** | 제목 ≤7자·마침표 금지 / 내용 ≤25자·**반드시 '요.'로 종결**·개행 금지 / `!` `~` 이모지 금지 / 변수는 `{{userName}}`만. **'요.' 종결 강제라 푸시 본문은 질문형('~요?')이 불가능** — 질문형 역할은 동의 화면 제목이 담당한다(위) |
| **링크** | `linkUri` 생략 시 `intoss://facefit` 기본 랜딩 — 생략이 정답 |
| **검증 도구** | `push_test_send`(본인에게만, 분당 5회) · `push_stats`(발송 시도/성공/읽음/클릭) · `push_cancel_scheduled` |

### 2-2. 앱 쪽 동의 API (miniapp/node_modules `@apps-in-toss/web-framework` 3.x 타입 선언 실측)

```ts
// dist/index.d.ts §notification — 이미 설치된 의존성, 추가 설치 0
Notification.requestAgreement({
  options: { templateCode: string },          // 콘솔 템플릿 코드(templateSetGroupRequest.code)
  onEvent: (r: { type: 'newAgreement' | 'alreadyAgreed' | 'agreementRejected' }) => void,
  onError: (e: unknown) => void,
}): () => void                                 // cleanup 함수 반환 — 해제 필수
Notification.requestAgreement.isSupported(): boolean  // MIN_TOSS_APP_VERSION 5.255.0
```

- 토스가 동의 시트를 직접 띄우고 결과만 콜백으로 온다. 이미 동의한 사용자에겐 `alreadyAgreed` —
  **호출이 멱등**이라 앱이 동의 여부를 따로 추적할 필요가 없다.
- ⚠️ SDK 주석은 templateCode를 「콘솔 스마트발송 템플릿 코드」라고 부른다. 이번에 만드는 것은
  REGULAR 기능성 템플릿의 code인데 같은 값이 통하는지가 **유일한 미검증 연결 고리**다(§7-1).

### 2-3. restfit 전례 — 없음

`push|알림|동의|agreement` 전수 grep 결과, 매치는 전부 `Array.push()` · 운동 데이터의
`force: 'push'` · 배포 파이프라인의 `bundle_test_push`(검수용 프라이빗 링크 발급 —
사용자 푸시와 무관)였다. **사용자 리마인드 푸시를 구현한 적이 없다** — 이식할 코드는 없고,
이 설계가 첫 전례가 된다.

### 2-4. facefit v1 현황 (설계가 얹힐 자리)

- React 18 + TypeScript + Vite. 화면은 `screens/*.tsx`, 저장은 `storage.ts`
  (localStorage · `facefit.*` 키 · `Storage` 주입 패턴으로 테스트).
- `FacePhoto.tsx`: 저장 성공 → 관찰 1문항(좋아졌어요/그대로예요/나빠졌어요) → 종료.
  **이 마무리 지점이 동의 제안의 자리다**(방금 찍은 사용자 = 「내일도」가 가장 와닿는 순간, §5-4).
- `Home.tsx`: 촬영 카드가 맨 위 — 상시 진입점 한 줄을 얹을 표면.

---

## 3. 결정 사항 (대안 비교)

### 3-1. 발송 메커니즘 — 콘솔 정기 발송 (서버 0 유지) ✅

| 대안 | 판정 |
|---|---|
| **A. 콘솔 REGULAR 템플릿(토스 대신 발송)** | ✅ **채택.** 서버 0 원칙 그대로. 콘솔 작업 2건 + 앱 동의 호출뿐 |
| B. 파트너 서버 발송(type=SERVER + 발송 API) | ❌ 서버가 생긴다 — v2 AI 프록시도 아직 없는데 푸시 때문에 먼저 세울 이유가 없다 |
| C. 로컬 알림(앱 내 스케줄) | ❌ SDK에 로컬 알림 API가 없고, 웹뷰 미니앱은 꺼져 있으면 코드가 안 돈다 — 성립 불가 |

### 3-2. 동의 UX — 첫 촬영 완료 직후 1회 제안 + Home 상시 진입점 ✅

| 대안 | 판정 |
|---|---|
| A. 온보딩에서 제안 | ❌ 가치를 경험하기 전의 요청 — 거절률만 높인다. 온보딩은 이미 기기 전용 고지·카메라로 붐빈다 |
| **B. 첫 촬영 저장·관찰 완료 직후 1회** | ✅ **채택.** 「방금 찍었다 → 내일도 이 시간에」가 §5-4 리텐션 문법 그대로 |
| C. 설정 화면 신설 | ❌ 설정 화면 자체가 없다 — 버튼 하나를 위해 화면을 만드는 건 과함. Home 한 줄이면 된다 |

- **자동 제안은 딱 1회**: localStorage `facefit.notifyPrompted`(불리언)로 기록. 거절(닫기 포함)하면
  다시 자동으로 묻지 않는다 — 재요청 규율.
- **Home에 「아침 알림 받기」 한 줄 상시 노출**: `requestAgreement`가 멱등(`alreadyAgreed`)이라
  동의 상태를 추적·분기할 필요가 없다. 이미 동의한 사용자가 눌러도 무해하고, **철회 후
  재동의 경로를 겸한다**(철회 감지 기능 없이). 동의 직후엔 해당 세션 안에서만 문구를
  「알림 신청됨」으로 바꾼다 — 세션 간 숨김은 안 한다(추적 상태를 안 만드는 대가, 의도된 절단).
- **실패는 조용히**: `isSupported() === false`(토스 5.255.0 미만)이거나 `onError`가 오면
  제안 UI를 그냥 접는다 — **촬영 흐름을 푸시가 방해하는 순간 주객전도다.**
- 앱 내 제안 문구는 질문형으로: 「내일도 이 시간에 알려드릴까요?」 + [알림 받기] [괜찮아요].

### 3-3. 발송 시각 — 매일 08:00 KST 고정 ✅

- §5-1 「아침 세안 직후 권장」의 기본값. 동의문 스케줄이 요일·시각 단위로 고정되는 플랫폼
  구조상, 시각을 사용자별로 바꾸려면 **시각 슬롯마다 동의문+템플릿 쌍이 N개** 필요하다 —
  v2 첫 계단에 명백한 과함. 수요가 실측되면 §6에서 꺼낸다.
- 08:00 근거: 세안 직후를 겨냥하되 너무 이르면(7시 전) 수면 방해 민원 리스크. 상수 하나라
  콘솔에서 바꾸는 비용도 0에 가깝다(동의문은 시각이 같으면 중복 거부되므로, 변경 시
  기존 동의문 재사용 여부를 `push_notification_agreement_list`로 먼저 판단).

### 3-4. 푸시 문구안 (§5-3 규율 × 콘솔 하드 제약)

콘솔 제약('요.' 종결 강제) 때문에 푸시 본문은 질문형이 불가능하다 — 질문형은 동의 화면
제목(「매일 촬영 알림을 보내드릴까요?」 자동 생성)과 앱 내 제안 문구가 담당하고, 푸시 본문은
**단정 없는 권유형**으로 규율을 지킨다. 효과 단정 문구는 세 안 모두 없음.

| 안 | 제목(≤7자) | 내용(≤25자 · '요.' 종결) |
|---|---|---|
| **A (추천)** | 아침 한 장 | 세안 후 오늘 얼굴을 남겨봐요. |
| B | 오늘의 기록 | 한 장 찍고 어제와 비교해봐요. |
| C | 촬영 시간 | 매일 같은 시각이 관찰을 만들어요. |

A 추천 근거: 행동 지시가 가장 구체적(세안 후 = §5-1 조건 통제까지 실어 나른다).
AI 자동검수 반려 시 B → C 순으로 재시도한다.

### 3-5. 미동의·동의철회 사용자

- **미동의**: 발송 대상이 동의자 자동 세그먼트라 **아무것도 안 가고, 앱이 할 일도 없다.**
- **철회**: 토스 알림 설정에서 사용자가 직접 한다 — 앱은 알 수 없고 알 필요도 없다(발송
  대상에서 자동 제외). 재동의 경로는 Home 상시 버튼(§3-2)이 겸한다.
- 앱이 저장하는 상태는 `facefit.notifyPrompted` 하나뿐 — 동의 여부의 단일 출처는 토스다.
  앱에 동의 상태 사본을 두면 철회 시 반드시 어긋난다(안 만드는 게 정합성이다).

---

## 4. 콘솔 절차 (코드 0 — 운영 태스크, MCP 도구로 수행)

순서가 곧 의존성이다: 동의문 → 템플릿(termsId 필요) → 앱 코드(templateCode 필요).

1. `push_notification_agreement_list`(workspaceId 69821, miniAppId 70438)로 기존 동의문 확인
   (신규 앱이라 없을 것 — 중복 차단 규칙 때문에 생성 전 확인이 필수 절차다).
2. `push_notification_agreement_create`:
   - `sendMethod: 'SCHEDULED'` · `schedule: { cronType: 'DAILY', dayOfWeek: 'MON,TUE,WED,THU,FRI,SAT,SUN', hour: 8, minute: 0 }`
   - `purpose: '촬영'` → 동의 화면 제목 「매일 촬영 알림을 보내드릴까요?」 자동 생성
   - `agreementName: '매일 촬영 리마인드 알림 동의'` · `notificationTiming: '매일 아침 8시에 촬영 리마인드를 보내드려요'`
   - → 응답의 **`termsId` 기록**(plan.md 태스크 체크박스에 남긴다)
3. `push_template_create`:
   - `type: 'REGULAR'` · `templateSetGroupRequest.contentReachType: 'FUNCTIONAL'` · `termsId`(2의 값)
   - `templateSetGroupRequest.code: 'daily-photo-reminder'` — **이 값이 앱의 templateCode다**
   - 소재: §3-4 A안. `linkUri` 생략(기본 `intoss://facefit`)
   - `sendOption`: `sendingTs`(다음 08:00) + `isRegularType: true` + `sendRegularOption{ dayOfWeek: 'MON,...,SUN', minute: 0, hours: '8', startTs: 내일 08:00 }` —
     ⚠️ `hours` 문자열 형식·`endTs` 필요 여부는 스키마에 미문서. 거부 메시지를 보고 맞춘다(§7-2)
   - AI 자동검수 → **APPROVED면 그대로 예약 완료**(push_send_scheduled 호출 금지 — SERVER 전용)
4. `push_test_send`(templateSendRateMap: 소재 1개 100%)로 본인 수신 확인.

---

## 5. 앱 코드 설계 + 태스크 분해 (TDD — v1 설계 §10 스타일)

새 파일 1개 + 수정 3곳. 서버·신규 의존성 0.

| 파일 | 변경 |
|---|---|
| `src/storage.ts` | `facefit.notifyPrompted` 게터/세터 2함수 추가(기존 `Storage` 주입 패턴 그대로) |
| `src/notify.ts` (신설) | `TEMPLATE_CODE = 'daily-photo-reminder'` 상수 + `requestNotifyAgreement(onDone)` 래퍼 — `isSupported()` false면 즉시 no-op 반환, cleanup 함수 관리 내장 |
| `src/screens/FacePhoto.tsx` | 관찰 1문항 종료 지점에 미제안(`!notifyPrompted`)이면 제안 스텝 1개: 「내일도 이 시간에 알려드릴까요?」 [알림 받기]/[괜찮아요] — 어느 쪽이든 `notifyPrompted` 기록 후 종료 |
| `src/screens/Home.tsx` | 「아침 알림 받기」 한 줄 버튼 상시 노출 — 탭 시 래퍼 호출, 콜백 오면 세션 내 문구 「알림 신청됨」 |

**태스크** (승인 후 plan.md v2 절로 — §8 반영안):

1. **콘솔 — 알림동의문**: §4-1·2 수행, termsId 기록 — 코드 0, 검증은 list 재조회
2. **콘솔 — REGULAR 템플릿 + 자동검수 + 테스트 발송**: §4-3·4 수행, APPROVED·본인 수신 확인 — 문구 A안(반려 시 B→C)
3. **storage 확장**: notifyPrompted 테스트 Red(미기록=false · 기록 후 true · 손상값 방어) → 구현
4. **notify 래퍼 + FacePhoto 제안 스텝**: 테스트 Red(미제안일 때만 스텝 노출 · 어느 버튼이든 prompted 기록 · isSupported=false면 스텝 자체가 안 뜸 · onError에도 흐름 종료) → 구현. SDK 모듈은 vitest에서 mock
5. **Home 버튼**: 테스트 Red(상시 노출 · 탭 시 래퍼 호출 · 콜백 후 문구 전환) → 구현
6. **릴리스 + 실기기 검증**: `npm run release` → 번들 업로드 → 검수 → 실기기에서 동의 →
   **다음날 08:00 실수신 확인**(§7-1 가정의 최종 검증) → plan/changeLog sweep

---

## 6. 보류 목록 (지금 안 하는 이유)

| 기능 | 보류 이유 |
|---|---|
| 발송 시각 사용자 설정 | 시각 슬롯마다 동의문+템플릿 쌍이 필요(플랫폼 구조) — 첫 계단에 N배 비용. 08:00 불만이 실측되면 |
| 아침/저녁 다중 슬롯 | 위와 동일 + v1 「하루 1장(date가 키)」 전제와 충돌 — v1 보류 사유 그대로 |
| 미촬영자만 조준 | 오늘 찍었는지는 **기기 안에만 있다**(서버 0) — 플랫폼 세그먼트로 알 수 없다. 구조적 불가 |
| 세그먼트 타기팅 | 동의자 자동 세그먼트로 충분 — 콘솔도 REGULAR에선 세그먼트를 안 받는다 |
| 발송 통계 대시보드 | `push_stats` 1회 조회로 충분 — 화면을 만들 데이터가 아직 없다 |
| 철회 감지·재동의 유도 | 철회를 앱이 알 수 없다(API 없음). Home 상시 버튼이 재동의 경로를 이미 겸한다 |

---

## 7. 리스크 · 미검증 가정

1. **templateCode ↔ REGULAR 기능성 템플릿 연결(최대 리스크)** — SDK 주석은 「스마트발송 템플릿
   코드」라 부른다. `templateSetGroupRequest.code`가 그대로 통하는지는 태스크 6의 실기기
   동의 → 실수신으로만 확정된다. 실패 시 폴백: 동의 시트가 안 뜨면 콘솔 웹에서 템플릿
   코드 표기를 확인하고, 그래도 안 되면 앱인토스 개발자 문서·문의로 templateCode의 정확한
   출처를 확인한다(설계 구조는 그대로 유지 — 코드 값만 바뀐다).
2. **`sendRegularOption` 필드 형식 미문서** — `hours`가 문자열인 이유(복수 시각 CSV 추정)·
   `endTs` 필수 여부 불명. 태스크 2에서 거부 메시지를 보고 맞춘다 — 콘솔 웹과 같은 입력
   조합이 안전값이다.
3. **AI 자동검수 반려 가능성** — 문구 3안 준비로 흡수. 셋 다 반려면 반려 사유가 다음 문구의
   입력이다.
4. **08:00이 실제 세안 시각과 어긋날 가능성** — 의도된 절단(§3-3). 수신 후 무시율이 높으면
   시각 변경(상수 수준) 또는 §6 시각 설정 승격을 검토한다.
5. **토스 앱 5.255.0 미만 사용자** — `isSupported()` 가드로 제안 자체를 숨긴다. 촬영 기능엔
   영향 0.
6. **plan.md 반영안** — v2 절(⏸ 목록)에서 「촬영 리마인드 푸시」를 꺼내 위 태스크 1~6을
   체크박스로 신설하고, 이 문서를 단일 출처로 링크한다. termsId·templateSetGroupNo 같은
   콘솔 산출 식별자는 태스크 체크박스 완료 시 값과 함께 기록한다(PR 번호와 달리 불변값이라
   stale 리스크 없음).
