# v5 설계 — 얼굴 기름종이 알림 (2026-09-03)

> 근거: [푸시 리마인드 설계](2026-08-29-push-reminder-design.md)(콘솔 푸시 모델 · 문구 하드 제약 · §3-1 C안 기각) ·
> [서버 설계](2026-08-30-server-design.md)(익명 키 = capability 토큰 · 원 키 비저장 · 무음 폴백) ·
> [UX 2차 설계](2026-09-02-ux-2-design.md) §1(원칙 셋) · [UX 1차 명세](2026-09-02-ux-switch-camera-spec.md) §3(알림 행 알약) ·
> 이번 세션 실측: 콘솔 MCP 스키마 5종 · 앱인토스 개발자 문서(`api/push.md` · `api/user-key.md` · `api/auth.md` ·
> `documentation/integration/server-api.md` · `documentation/common/growth/smart-message.md`) · SDK `index.d.ts` 재확인 ·
> 콘솔 읽기 조회(동의문 1건 · 템플릿 목록 0건 · 토스로그인 설정 `null`) · `T-014`(번들↔앱정보 간극).
> **상태: 2026-09-03 사용자 승인.** 결정 셋(문서 말미 「사용자 결정」)이 본문에 반영돼 있다 — 야간 상한 없음 · 익명 키 거부 시 토스 로그인 · 오늘 탭 배치.

---

## 0. 결론 요약

- **성립한다 — 단, 「서버가 직접 보내는」 구조로만.** 콘솔 정기 발송(v2-1 방식)은 사용자별·시각별 발송이 원천 불가하고,
  앱 안 타이머는 웹뷰가 닫히면 안 돈다(SDK 재확인 — 로컬 알림·예약 export 없음). 남는 길은 하나다:
  **앱이 「썼어요」를 서버에 알리고 → 서버가 3시간 뒤 앱인토스 스마트 발송 API(`send-message`)를 호출**한다.
- **토스 로그인은 필요 없다(실측).** 발송 API 헤더 `x-anon-key`가 「미니앱 SDK의 `User.getAnonymousKey` 함수로 발급받을 수
  있어요」(`api/push.md` 원문) — **이미 백업이 쓰는 그 키**다. 로그인 0 · 개인정보 수집 0 원칙이 그대로 산다.
  ⚠️ 단 문서 두 장이 서로 어긋난다(§2-2) — **첫 태스크가 이 가정의 실측**이고, 깨지면 §3-1 ⓐ′(토스 로그인)으로 간다
  (사용자 결정 2026-09-03 — 접지 않는다. BookTimer의 토스 로그인 구현이 선례).
- **승인 게이트**: 체크 1회 = 알림 1회 예약. 알림이 온 뒤 앱에서 「썼어요 · 다음 알림」을 누르지 않으면 다음은 없다.
  **밤을 막는 장치는 이 게이트 하나다** — 야간 상한은 두지 않는다(사용자 결정 2026-09-03, §3-3).
- **비용 규모**: 서버 새 표면 **엔드포인트 2개**(`PUT/DELETE /v1/reminder`) + 워커 1개 + 테이블 1개 + 자바 파일 ~6 ·
  클라 새 파일 3 + 수정 4 · 콘솔 절차 **5건**(CONDITION_BASED 동의문 · SERVER 템플릿 · 검수 요청 · **mTLS 인증서 발급(콘솔 웹·사람 몫)** ·
  상세 설명 한 줄) · AWS SSM 파라미터 3개. **콘솔 앱정보 수정 필요 — 있음**(§3-6, T-014 교훈대로 번들과 같은 시점에).
- 서버에 새로 놓이는 데이터는 **「예약 시각 + 암호화한 익명 키」 한 행, 발송되면 삭제**(≤ 약 3시간 수명). 원 키 비저장
  원칙(`AnonKey.java`)과 충돌하므로 **서버 비밀키로 AES-GCM 암호화**해 둔다(§3-4) — DB만 새서는 백업 열람 토큰이 안 샌다.

---

## 1. 목표 · 비목표

**목표**: 사용자가 기름종이를 쓰고 앱에서 체크하면, 3시간(상수) 뒤 푸시 1건이 온다. 다음 알림은 사용자가 앱에서 승인해야만
1건 더 예약된다. 서버가 죽어도 앱의 다른 기능은 그대로 돈다(무음 폴백).

**비목표(YAGNI — §6에 이유)**: 간격 사용자 설정 · 자동 반복 · 하루 사용 횟수 통계 · 기름종이 사용 로그의 백업 포함 ·
사진·관찰과의 상관 분석 · 다중 알림 종류 · 알림 인박스 커스텀.

---

## 2. 조사 실측

### 2-1. 파트너 서버 발송 API (앱인토스 개발자 문서 — 1차 사료)

| 항목 | 실측(원문 인용은 판정에 쓰인 부분만) |
|---|---|
| 엔드포인트 | `POST https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-message` (단건) · `send-test-message`(테스트 · `deploymentId` 필수) · `send-bulk-message`(50~2,500명) |
| 인증 | **mTLS**. 「모든 API는 mTLS(상호 TLS) 클라이언트 인증서로 호출 주체(미니앱)를 식별해요」 · 발급은 **콘솔 웹 왼쪽 메뉴 「mTLS 인증서」 → 「+ 발급받기」 → 인증서·키 파일 다운로드**(MCP 도구 없음 — 사람 몫) · 「인증서가 만료되기 전에 재발급」 · 「무중단 교체가 필요하면 인증서를 두 개 이상 등록」 |
| **수신자 식별** | 헤더 `x-toss-user-key`(토스 로그인 userKey) **또는** `x-anon-key` — 「**미니앱 SDK의 User.getAnonymousKey 함수로 발급받을 수 있어요**」(`api/push.md`). 「두 헤더를 동시에 전달하지 마세요」 |
| 본문 | `{ templateSetCode, context }` — `templateSetCode`「사전에 등록한 템플릿 코드 중 하나」 · `context`는 템플릿 변수(우리는 변수 0 → `{}`) |
| 전제 | 「테스트 발송을 포함해 모든 메시지는 문구 검수를 통해 승인 받은 이후 발송 가능해요」 · 오류 `5004` 「승인되지 않은 메시지 템플릿」 |
| 한도 | 사용자당 **분당 10회** · 앱당 분당 15,000회 · 서버 API 공통 3,000 QPM |
| 야간 제한 | **기능성 메시지에 대한 명시 규정 없음**(GitBook 질의 답변: 「기능성 메시지 자체에 대한 21시 이후 제한: 문서에 없음」). 야간 21~08시 개념은 토스로그인 약관의 「야간 혜택 수신 동의(선택)」 — 광고성 축이다. **플랫폼이 밤을 막아 주지 않는다** → 막는 장치는 승인 게이트뿐이다(§3-3 — 야간 상한은 사용자 결정으로 두지 않는다) |
| 방화벽 | outbound 대상 `apps-in-toss-api.toss.im` = `117.52.3.192` · `211.115.96.192` · `106.249.5.192`(443). EC2 보안그룹은 outbound 전체 허용이 기본이라 작업 0(§7-6에서 확인 항목으로만) |
| 익명 키 검증 API | `POST /api-partner/v1/apps-in-toss/users/anon-key/verify`(헤더 `x-anon-key` · 앱당 분당 3,000회) — **발송 템플릿 승인 전에 「mTLS + 익명 키 수용」을 실측할 수 있는 스모크 경로**(§4 절차 4) |

### 2-2. ⚠️ 문서 간 모순 — 이 설계의 최대 미검증 가정

- `api/push.md`·`api/user-key.md`: `x-anon-key` = `User.getAnonymousKey()`의 hash, 검증 엔드포인트까지 있다.
- `documentation/common/authentication/hash-key.md`: 「반환되는 사용자 키는 **토스 서버 API 호출용 키가 아니**」며 「내부 사용자 식별,
  데이터 관리 용도로만」.
- 판정: API 레퍼런스(전자)가 더 구체적이고 최신 기능(익명 키 검증 API)을 담고 있어 **전자를 채택**하되, **첫 태스크에서 실측**한다
  (§4 절차 4 · §5 태스크 0). 후자가 맞으면 §3-1 ⓐ′로 간다.

### 2-3. 콘솔 MCP 스키마 (읽기 조회 포함)

| 도구 | 판정에 쓰인 원문 |
|---|---|
| `push_notification_agreement_create` | `CONDITION_BASED` = 「조건이 맞을 때 파트너가 직접 보내는 방식. `sendCondition`을 함께 넣는다(≤255자) — **동의 화면 제목으로 그대로 노출되므로** '새로운 할인 상품이 생기면 알려드릴까요?'처럼 사용자에게 묻는 문장」 · `notificationTiming`(≤150자)은 약관 본문 「[알림 발송 시점]」 자리 · 중복 차단: 기존 동의문의 `notificationTiming`과 80% 이상 비슷하면 거부 |
| `push_template_create` | 「type=NORMAL/REGULAR 에는 sendMethod=SCHEDULED 동의문을, **type=SERVER 에는 CONDITION_BASED 동의문**을 짝지어」 · 「type=SERVER 는 세그먼트를 쓰지 않는다(대상은 파트너사 서버가 정한다)」 · 문구 제약 동일(제목 ≤7자 · 내용 ≤25자 '요.' 종결 · `!` `~` 이모지 금지) · `linkUri`는 「현재 미니앱의 intoss:// 주소여야 하며(**뒤에 경로·쿼리는 이어붙일 수 있음**)」 |
| `push_send_scheduled` | 「**서버 발송 템플릿(type=SERVER)만** 요청할 수 있다」 · 「승인은 발송 자격만 열어주고, 실제 발송은 미니앱 서버가 발송 API를 호출해야 일어난다」 · 「승인/검수 진행 상태는 push_template_list(reviewStatus 필터)로 폴링」 — v2-1에서 「부르지 않는 도구」였던 것이 이번엔 **정확히 이 용도** |
| `push_notification_agreement_list` (실호출) | 1건: `termsId 118527` SCHEDULED DAILY 08:00 「촬영」 — CONDITION_BASED는 **없다**(신설 필요) |
| `push_template_list` (실호출) | 0건(`totalPageCount: 0`) — v2-1 REGULAR 템플릿은 스마트메시지 경로라 이 목록에 안 잡힌다. 새 SERVER 템플릿은 여기 잡힐 것으로 본다(미검증 — 절차 3에서 확인) |
| `toss_login_get_config` (실호출) | `null` — 토스로그인은 설정된 적 없음. ⓐ′로 가면 `toss_login_update_terms`부터 |

### 2-4. SDK 재확인 (`@apps-in-toss/web-framework` `dist/index.d.ts` 2,554줄)

- `notification` 도메인 export는 `Notification.requestAgreement`(+ deprecated `requestNotificationAgreement`)뿐. `schedul|localNotif|alarm|background` 매치 **0** — 판이 뒤집히지 않는다. ⓑ 기각 확정.
- `Environment.initialURL: string` — 「앱에 처음 진입할 때 사용한 스킴 URL이에요. 이후 페이지 이동은 반영되지 않아요」. 공유 링크 문서가
  `intoss://<앱이름>/about?name=test` 꼴 쿼리를 명시하고, GitBook 질의 답변도 「`Environment.initialURL`은 …스킴 URL 문자열을 그대로 제공」 ·
  `window.location`으로는 「확인이 안 됩니다」. → 푸시 랜딩 쿼리는 **`initialURL`에서 읽는다**(§3-5). ⚠️ 앱이 이미 떠 있는 상태에서 푸시를 탭했을 때
  웹뷰가 새로 뜨는지는 미문서(§7-4).
- `User.getAnonymousKey()` → `{ type: 'HASH', hash }` — 백업이 쓰는 `getBackupKey()`(`logic/backup.ts`) 그대로 재사용.

### 2-5. 현 코드에서 얹힐 자리

- 서버: `AnonKey.fromHeader`(길이 8~128 검증 → sha256) · `RateLimiter.allow(bucket, limit)` · `JdbcTemplate` 리포지토리 · Flyway `V1__backup.sql` · H2 MySQL 모드 테스트 · `deploy-on-ec2.sh`가 SSM `/facefit/<이름>`을 그대로 환경변수로 렌더 · 컨테이너 JVM은 UTC · **스케줄러 미사용**(`@EnableScheduling` 없음 — 추가).
- 클라: `notify.ts`의 `requestNotifyAgreement(onDone)`은 `TEMPLATE_CODE` 상수 고정 → 인자화 필요 · `Home.tsx` 알림 행(알약 = 행동 / check+글자 = 상태 · `NotifyResult` 4갈래) · `storage.ts` 플래그 게터/세터 패턴 · `App.tsx` `useState<Tab>('products')` — 랜딩 분기 자리.

---

## 3. 결정 사항

### 3-1. 발송 메커니즘 — 파트너 서버 발송(SERVER 템플릿 + `x-anon-key`) ✅

| 대안 | 3시간 뒤 개인별 | 승인 게이트 | 로그인 | 비용 | 판정 |
|---|---|---|---|---|---|
| **ⓐ 파트너 서버 발송** — 앱 → `PUT /v1/reminder` → 서버 워커 → `send-message`(`x-anon-key`) | ✅ | ✅ (예약은 오직 사용자 탭으로만 생긴다) | 불필요(실측 §2-1) | 서버 표면 2 + 워커 + mTLS 인증서 + 콘솔 3건 | ✅ **채택** |
| ⓐ′ 위와 같되 토스 로그인 userKey | ✅ | ✅ | **필요** | ⓐ + 콘솔 토스로그인 약관 동의(`toss_login_update_terms`)·clientId + 클라 로그인 화면 + 서버 OAuth 코드 교환(`사용자 정보 받기` API) + userKey 저장 + **개인정보 문구 전면 개정**(수집 0 원칙 포기) — 대략 ⓐ의 2~3배, 검수 리스크 별도 | ⏸ **ⓐ의 §2-2 가정이 깨질 때의 폴백** — 사용자 결정(2026-09-03): 거부되면 접지 않고 이 길로 간다. BookTimer의 토스 로그인 구현(콘솔 약관·clientId·서버 코드 교환)을 선례로 옮긴다 |
| ⓑ 앱 안 타이머(`setTimeout`) | ✕ 웹뷰가 닫히면 코드가 안 돈다 · SDK에 로컬 알림 없음(§2-4) | — | — | 0 | ❌ **성립 불가** |
| ⓒ 콘솔 정기 발송 근사 — 고정 슬롯(예: 10·13·16·19시) 각각 SCHEDULED 동의문+REGULAR 템플릿 | ✕ **동의자 전원**에게 슬롯마다 간다 — 「내가 쓴 뒤 3시간」이 아니다 | ✕ 승인 없이 매일 반복 · 밤 방지는 슬롯 선택으로만 | 불필요 | 콘솔 8건, 코드 거의 0 | ❌ 사용자 요구의 두 핵심(개인 시각 · 게이트)을 모두 못 채운다 |

### 3-2. 승인 게이트 모델 ✅

```
[미예약] --썼어요--> [예약됨: due = now+3h] --(서버 발송)--> [알림 뒤 · 승인 대기]
   ^                     |  그만 받기                          |  썼어요·다음 알림 → [예약됨]
   |                     v                                    |  오늘은 그만 / 무응답 → 끝
   +---------------------+------------------------------------+
   (날짜가 바뀌면 자동으로 [미예약] — 「그날 첫 기름종이」가 다시 시작점)
```

- **상태의 단일 출처는 기기의 `facefit.oilNextAt`(ISO 문자열) 하나**다. 서버는 「보낼 행」만 갖고, 보내면 지운다. 화면은 서버를 조회하지 않는다:
  `nextAt` 없음 → 미예약 · `nextAt > now` → 예약됨 · `nextAt ≤ now` → 승인 대기 · `nextAt`의 KST 날짜 ≠ 오늘 → 미예약으로 간주(자동 리셋).
- **서버가 시각을 정한다.** `PUT`은 본문 없이 호출하고 `{ dueAt }`을 돌려받아 저장한다 — 3시간 상수가 서버 프로퍼티
  `facefit.reminder.interval-minutes=180` **한 곳**에만 산다(캘리브레이션 노브). 클라의 「3시간」은 안내 문구에만 있다(§3-5 문구 표 각주).
- 저장 순서: 동의 확인(`requestAgreement`, 멱등) → `PUT` 성공 → `oilNextAt` 저장. **서버 실패면 저장하지 않는다** — 예약 안 됐는데 「예약됨」으로 그리면 거짓말이다(백업 `dirty` 규율과 같은 결).
- 「썼어요」는 **매번 `requestAgreement`를 거친다**(`alreadyAgreed`면 시트 없이 즉시 통과) — 앱은 동의 사본을 안 둔다(v2-1 §3-5 그대로). 거절이면 예약하지 않는다.

### 3-3. 야간 상한 — 두지 않는다 (사용자 결정 2026-09-03) ✅

설계 초안은 「`due_at`이 22:00~07:00 KST면 서버가 예약을 거부」를 제안했다(게이트는 알림이 온 **뒤**만 막아서, 19:30 체크 → 22:30
발송은 못 막는다는 이유). 사용자는 **게이트만** 두기로 했다 — 밤에 울릴지는 사용자가 체크할 때 스스로 정한다. 서버에 야간 판정·
프로퍼티·`{ dueAt: null }` 응답 갈래는 **없다**. `PUT`은 항상 `{ dueAt }`을 돌려준다. 되살리려면 서버 한 곳(§3-4 컨트롤러)에 판정을 얹고
클라에 문구 한 줄을 더하면 된다(§6).

### 3-4. 서버 상태 모델 · 워커 · 삭제 ✅

| 결정 | 채택 | 기각 |
|---|---|---|
| 테이블 | `reminder(key_hash CHAR(64) PK, key_enc VARBINARY(512), due_at DATETIME(3), attempts TINYINT, created_at DATETIME(3))` + `due_at` 인덱스. **키당 1행**(재체크 = 덮어쓰기) | 이력 테이블 — 통계는 비목표 |
| 원 키 보관 | **AES-GCM(IV 12바이트 선두 부착)로 암호화**, 키는 SSM `/facefit/FACEFIT_REMINDER_KEK`(base64 32B) → 환경변수. `AnonKey.java`의 「원 키는 어디에도 저장되지 않는다」를 「**평문으로는**」으로 좁힌다 — DB만 새면 백업 열람 토큰은 안 새고, 행 수명도 ≤ 약 3시간이다 | 평문 저장 + 짧은 수명 — 불변식 주석을 뒤집는다 · 별도 KMS — 규모 대비 과함 |
| 워커 | `@Scheduled(fixedDelay = 60_000)` 단일 스레드: `due_at ≤ now AND attempts < 3` 최대 100행 → 행마다 `attempts+1` **먼저** 기록(claim) → `send-message` → 성공이면 `DELETE`. 실패면 다음 분에 재시도, 3회면 방치 → 청소 쿼리(`due_at < now-1d`)가 지운다. `// ponytail: 단일 인스턴스·at-most-once-per-attempt — 크래시 창에서 최대 3회 중복 가능. 수평 확장 날 SELECT … FOR UPDATE SKIP LOCKED` | 정확한 시각(초 단위) 타이머 — 분 단위면 족하다 · 외부 큐 — YAGNI |
| 발송 클라이언트 | Java 21 `HttpClient` + `SSLContext`(PEM 인증서·PKCS#8 키를 환경변수에서 로드) — **의존성 추가 0**. 응답 `resultType`/`errorCode`만 로그(키·해시 비기록) | OkHttp·BouncyCastle — PEM이 PKCS#8이면 표준 API로 충분(§7-3) |
| 삭제 | `DELETE /v1/reminder` 멱등 204. 클라 「그만 받기/오늘은 그만」·날짜 리셋 시 호출(무음 폴백 — 실패해도 로컬은 지운다. 남은 행은 예약대로 1회 가고 끝) | 발송 뒤 행 유지 — 화면이 서버를 안 보므로 값이 없다 |
| 레이트리밋 | `facefit.ratelimit.reminder-put-per-key-per-minute=6` + 기존 IP 상한 | — |
| 인증 | `X-Anon-Key` → `AnonKey.fromHeader` 그대로. 401 규칙 동일 | — |

### 3-5. UX — 오늘 탭 · 알림 행 아래 카드 · primary 아님 ✅

**자리**: 오늘 탭, 「아침 알림」 행 **바로 아래**(같은 카드 가족). 「오늘 탭 축소」(⏸ — 「오늘 사진 + 알림」만 남기는 안)와 **충돌하지 않는다** —
축소 뒤에도 남는 「알림」 축에 속한다. 제품 탭은 첫 진입 카드·찍기 CTA·백업 스위치로 이미 찼고, 「오늘 하루의 행동」이 오늘 탭의 주제다.

**파란 버튼 규칙**: 이 카드는 **어느 상태에서도 primary(채운 파랑)를 쓰지 않는다.** 근거 — 오늘 탭의 파란 자리는 「오늘 얼굴 찍기」이고
찍은 뒤엔 0개다(UX 2차 §1 표). 기름종이 체크는 하루 여러 번 반복되는 **부수 행동**이라, 그때마다 파란 버튼이 생기면 「지금 할 일」의
신호가 흐려진다. 행동은 알림 행과 같은 **알약**(테두리 파랑·배경 흰색 — 이미 오늘 탭에 있는 부품), 상태는 **check + 글자**로 가른다(색·표식·글자 셋).

| 상태 (`oilNextAt`) | 아래 줄 문구 | 오른쪽 | 추가 행 |
|---|---|---|---|
| 미예약 | 「쓰고 나서 누르면 3시간 뒤에 알려드려요」(text-sub) | 알약 「썼어요」 | — |
| 예약됨 | 「다음 알림 **15:20** · 그때 다시 쓸지 정해요」(blue-dark 600) | check + 「예약됨」 | ghost 「그만 받기」 |
| 승인 대기(`nextAt ≤ now`) | 「알림을 보냈어요 · 다음도 받을까요」(blue-dark 600) | 알약 「썼어요 · 다음 알림」 | ghost 「오늘은 그만」 |
| 세션 한정 — 서버 실패/미지원 | 「지금은 예약할 수 없어요 · 잠시 뒤 다시 눌러 주세요」(amber) | 알약 「썼어요」 | — |
| 세션 한정 — 동의 거절 | 「알림을 켜지 않았어요 · 눌러서 언제든 켤 수 있어요」(text-sub) | 알약 「썼어요」 | — |

- 제목 「기름종이 알림」. 카드 맨 아래 12px 상시 줄: 「알림 시각만 서버에 잠시 저장되고 알림이 가면 지워져요」(개인정보 고지 — §3-6).
- 노출 조건은 **지원 여부**(`isNotifySupported() && isBackupSupported()`)다 — 동의 여부가 아니다(기존 규율). 둘 중 하나라도 거짓이면 카드 자체를 안 그린다.
- `aria-label`: 행동 버튼 「기름종이 썼어요」 / 「기름종이 다음 알림 받기」 · 「기름종이 알림 그만 받기」. `role="switch"`는 **안 쓴다** — 켜짐의 반대가 「꺼짐」이 아니라 「오늘은 없음」이라 스위치 은유가 틀린다.
- **푸시 랜딩**: 템플릿 `linkUri = intoss://facefit?tab=home`. `App`이 마운트 시 `Environment.initialURL`을 try로 읽어 `tab=home`이면 시작 탭을 `home`으로(그 외·실패·토스 밖 = 기존 `products`). 승인 버튼에 **한 탭으로** 닿게 하는 유일한 장치다(§7-4).
- 동의 시트: 새 CONDITION_BASED 동의문의 제목이 곧 `sendCondition`이다 → **「기름종이를 쓰고 체크하면 다음 알림을 보내드릴까요?」**(질문형 규율). 앱은 `Notification.requestAgreement({ templateCode: 'facefit-oil-paper-reminder' })`.

**푸시 문구 3안** (제목 ≤7자 · 내용 ≤25자 '요.' 종결 · `!` 이모지 금지 · 효과·의학 단정 금지 — 「3시간」을 권고가 아니라 **경과 사실**로만 쓴다):

| 안 | 제목(글자 수) | 내용(글자 수 · 공백 포함) | 비고 |
|---|---|---|---|
| **A (추천)** | 기름종이 시간 (7) | 체크한 뒤 3시간이 지났어요. (16) | 경과 사실만. ⚠️ 「3」이 박혀 노브를 바꾸면 템플릿 재검수 |
| B | 기름종이 (4) | 다음 기름종이는 앱에서 정해요. (17) | 숫자 없음 · 게이트를 그대로 말함 |
| C | 기름종이 알림 (7) | 체크한 뒤 시간이 됐어요. (14) | 숫자 없음 · 가장 짧음 |

검수 반려 시 A → B → C. 셋 다 「쓰세요」라고 하지 않는다 — 다음 사용 여부는 사용자 판단이다.

### 3-6. 개인정보 정합 (T-014 교훈) ✅

- 서버에 **새 종류의 데이터**가 놓인다(예약 시각 · 암호화 키). 콘솔 상세 설명의 현행 문장(「기록 백업을 켜면 제품·관찰·사용 기록만 서버에 저장」)은
  그대로 참이지만 **누락**이 생긴다 → 한 줄 추가안: **「기름종이 알림을 켜면 다음 알림 시각만 서버에 잠시 저장되고, 알림이 가면 지워져요.」**(47자).
  ⚠️ 현행 495/500자라 다른 문장을 그만큼(약 42자) 줄여야 한다(2026-09-03 정정 때와 같은 작업).
- **시점**: 이 번들의 검수 제출과 **같은 턴**에 `miniapp_update_basic_info` → `miniapp_meta_status.reviewState`로 접수 확인(T-014 추기 규칙). 릴리스 노트에도 같은 문장.
- 개인정보 처리방침: 이 앱은 별도 등록 경로가 없다(plan v1 태스크 10 실측) — 상세 설명·온보딩이 그 표면이다. 온보딩의 「로그인이 없어요」는 계속 참(수정 0). 카드 안 상시 고지 한 줄(§3-5)로 앱 안에서도 말한다.
- `LOCAL_ONLY`(사진 문장) **무변경**.

---

## 4. 콘솔 · 인프라 절차 (코드 0 — 순서가 의존성)

1. **mTLS 인증서 발급(사용자 · 콘솔 웹)** — 왼쪽 메뉴 「mTLS 인증서」 → 「+ 발급받기」 → 인증서·키 파일 다운로드. 키가 `BEGIN RSA PRIVATE KEY`(PKCS#1)면
   `openssl pkcs8 -topk8 -nocrypt`로 PKCS#8 변환(§7-3). 만료일 기록(plan 체크박스).
2. **SSM 파라미터 3개**(프로필 `booktimer` · 서울): `/facefit/FACEFIT_TOSS_MTLS_CERT_PEM` · `/facefit/FACEFIT_TOSS_MTLS_KEY_PEM`(SecureString · 각 ≤4KB 표준 티어) ·
   `/facefit/FACEFIT_REMINDER_KEK`(`openssl rand -base64 32`). `deploy-on-ec2.sh`의 이름 루프에 세 이름 추가(태스크 S-1).
3. **동의문**: `push_notification_agreement_create` — `sendMethod: 'CONDITION_BASED'` · `agreementName: '기름종이 알림 동의'` ·
   `sendCondition: '기름종이를 쓰고 체크하면 다음 알림을 보내드릴까요?'` · `notificationTiming: '기름종이를 쓰고 앱에서 체크한 뒤 약 3시간이 지나면 1회 보내드려요'`
   (기존 「매일 아침 8시에 촬영 리마인드…」와 80% 유사 아님) → `termsId` 기록.
4. **가정 실측 스모크(서버 배포 전, 로컬 curl)** — 인증서로 `POST …/users/anon-key/verify` 헤더 `x-anon-key: <내 기기 키>`(키는 실기기 콘솔 로그 또는 백업 요청 헤더에서 1회 채취).
   200이면 **mTLS + 익명 키 수용** 확정. 거부면 §3-1 ⓐ′ 결정으로 돌아간다 — **여기서 멈추고 보고**.
5. **템플릿**: `push_template_create` — `type: 'SERVER'` · `contentReachType: 'FUNCTIONAL'` · `termsId`(3) · `templateSetGroupRequest.code: 'facefit-oil-paper-reminder'`
   (앱의 `templateCode`) · 소재 1개 `code: 'facefit-oil-paper-reminder-1'` · 문구 A안 · `pushTemplateRequest.linkUri: 'intoss://facefit?tab=home'` · `sendOption` 생략 가능 여부는 거부 메시지로 맞춘다(스키마상 `sendingTs` required — SERVER에선 무의미할 가능성, §7-5).
6. **검수 요청**: `push_send_scheduled(templateSetGroupNo)` → `push_template_list(reviewStatus)` 폴링 → `APPROVED`. ⚠️ 발송 API의 `templateSetCode`가 그룹 code인지 소재 code인지 미문서 — 절차 7에서 둘 다 시도.
7. **테스트 발송**: `send-test-message`(`deploymentId` = 테스트 번들 업로드 응답값)로 본인 수신 → `templateSetCode` 값 확정 → 서버 프로퍼티에 기록.
8. **상세 설명 한 줄 + 릴리스 노트**(§3-6) — 번들 검수 제출과 같은 턴.

---

## 5. 코드 설계 + TDD 태스크 분해

### 5-1. 서버 (`server/`)

| 파일 | 변경 |
|---|---|
| `db/migration/V2__reminder.sql` (신설) | §3-4 테이블 + `idx_reminder_due` |
| `common/KeyCipher.java` (신설) | `byte[] seal(String)` / `String open(byte[])` — AES/GCM/NoPadding · IV 12B 선두 · KEK는 `${facefit.reminder.kek}`(base64) |
| `reminder/ReminderController.java` (신설) | `PUT /v1/reminder`(본문 없음) → 키 → 레이트리밋 → upsert → `{dueAt}` · `DELETE` 204 멱등 |
| `reminder/ReminderRepository.java` (신설) | `upsert(hash, enc, dueAt)`(DELETE+INSERT — 백업과 같은 관용구) · `findDue(now, limit)` · `claim(hash)`(`attempts+1`) · `delete(hash)` · `purge(before)` |
| `reminder/TossMessenger.java` (신설) | `interface`가 아니라 클래스 하나 — `boolean send(String anonKey)`: mTLS `HttpClient`(`@Lazy` 생성 · PEM → `SSLContext`) · `POST send-message` · `resultType == SUCCESS`. 테스트는 `@MockitoBean`으로 대체 |
| `reminder/ReminderWorker.java` (신설) | `@Scheduled(fixedDelay=60_000)` — §3-4 워커 + `purge` |
| `FacefitApplication.java` | `@EnableScheduling` |
| `application.properties` / `-test.properties` | `facefit.reminder.interval-minutes=180` · `template-set-code=`(절차 7 값) · `kek=${FACEFIT_REMINDER_KEK}` · `mtls.cert-pem=${FACEFIT_TOSS_MTLS_CERT_PEM}` · `mtls.key-pem=${FACEFIT_TOSS_MTLS_KEY_PEM}` · `ratelimit.reminder-put-per-key-per-minute=6`. 테스트 프로파일은 고정 KEK · 빈 PEM(워커는 `@MockitoBean` 메신저) |
| `deploy/deploy-on-ec2.sh` | SSM 이름 루프에 3개 추가 |

**TDD 태스크 (Red 케이스 먼저)**

- **S-1 마이그레이션 + KeyCipher** — Red: `MigrationTest`에 `reminder` 테이블·인덱스 존재 · `KeyCipherTest`: 왕복 동일 · 같은 평문 두 번 봉인이 다른 바이트(IV) · 변조 1바이트 → 예외 · 잘못된 KEK 길이 → 기동 실패.
- **S-2 API** — Red(`ReminderApiTest`·`ReminderAuthTest`): PUT 200 `dueAt` = now+180분(±1분, 서버 시계 주입) · DB에 `key_hash`=sha256만, `key_enc`는 원 키와 **바이트가 다름** · PUT 두 번 → 1행·`attempts` 0 리셋 · DELETE 204 → 재DELETE 204 · 키 없음/짧음 401 · 키당 7번째 429 · 밤 시각(예: 23:00 KST)에 PUT해도 **그대로 예약**된다(야간 상한 없음 — §3-3 결정의 회귀 가드) · `/health`는 상한 밖 유지.
- **S-3 워커** — Red(`ReminderWorkerTest` · 메신저 mock · `Clock` 주입): due 지난 행만 send · send 성공 → 행 삭제 · 실패 → 행 유지·`attempts` 1 · 3회 실패 → 더는 호출 안 함 · `due_at < now-1d` 행 purge · 메신저가 받는 인자는 **복호화된 원 키**(sealed가 아님).
- **S-4 TossMessenger** — Red: 본문이 `{"templateSetCode":…,"context":{}}` · 헤더 `x-anon-key` 존재·`x-toss-user-key` 부재 · `resultType: FAIL` → false · 예외 → false(던지지 않음). HTTP는 `HttpClient`를 인터페이스 없이 쓰므로 로컬 `com.sun.net.httpserver` 스텁(JDK 내장)으로 검증. mTLS 자체는 운영 스모크(절차 4·7)로.
- **S-5 배포·스모크** — deploy 스크립트 갱신 → 머지 → 자동 배포 → 라이브 `PUT`(내 키) → 3시간 뒤 실수신. 배포 순서: **서버 먼저**(v4-2와 같은 이유 — 클라가 없는 엔드포인트를 부르면 무음 실패).

### 5-2. 클라이언트 (`miniapp/`)

| 파일 | 변경 |
|---|---|
| `src/storage.ts` | `loadOilNextAt(): string \| null` · `saveOilNextAt(iso: string)`(빈 문자열 = 삭제) — `lastBackupAt`과 동형(손상값 → null) |
| `src/notify.ts` | `requestNotifyAgreement(onDone, templateCode = TEMPLATE_CODE)` — 두 번째 인자 추가 · `OIL_TEMPLATE_CODE = 'facefit-oil-paper-reminder'` |
| `src/logic/reminder.ts` (신설) | `oilState(nextAt, now, tz)` 순수 함수 → `'idle' \| 'scheduled' \| 'awaiting'`(날짜 리셋 포함) · `formatHm(iso)`(`sv-SE` 관용구) · `scheduleOilReminder(key, fetchFn)` → `{dueAt: string \| null} \| null`(null = 실패) · `cancelOilReminder(key, fetchFn)` → boolean. 무음 폴백 — `backup.ts`와 동형 |
| `src/logic/landing.ts` (신설) | `tabFromInitialUrl(url: string): 'home' \| null` 순수 + `readInitialTab()`(`Environment.initialURL` try — 토스 밖 TypeError 삼킴) |
| `src/screens/OilReminder.tsx` (신설) | §3-5 카드. props 없음(저장소·SDK 직접 · 키는 `logic/backup.ts`의 `getBackupKey()` 재사용) — Home처럼 `useState`로 세션 결과 보관 |
| `src/screens/Home.tsx` | 알림 행 아래 `<OilReminder />` 1줄(지원 조건은 컴포넌트 안에서) |
| `src/App.tsx` | `useState<Tab>(() => readInitialTab() ?? 'products')` |

**TDD 태스크**

- **C-1 storage + reminder 순수 로직** — Red: `oilState`: null → idle · 미래 → scheduled · 과거(오늘) → awaiting · **어제 날짜 → idle** · 손상 문자열 → idle · `formatHm('2026-09-03T06:20:00Z')` → `'15:20'` · `scheduleOilReminder`: 200 `{dueAt}` 반환 · 네트워크 예외 → null · 5xx → null · 헤더 `X-Anon-Key` · `cancel`: 204 → true · 실패 → false.
- **C-2 notify 인자화** — Red: 두 번째 인자로 준 코드가 `options.templateCode`에 실림 · 생략 시 기존 상수(기존 12케이스 무변경 통과).
- **C-3 OilReminder 카드** — Red(SDK·fetch mock · `vi.useFakeTimers`로 now 고정): 미지원(둘 중 하나 false)이면 DOM에 없음 · idle 문구·알약 「썼어요」 · 탭 → `requestAgreement` 호출 → `alreadyAgreed` → PUT → `oilNextAt` 저장 → 「다음 알림 15:20」+check · `agreementRejected` → PUT **호출 안 함** · PUT 실패 → 저장 안 함 + amber 문구 · scheduled에서 「그만 받기」 → DELETE + 저장소 비움 + idle · awaiting(과거 nextAt)에서 「썼어요 · 다음 알림」 → 재예약 · **채운 파란 버튼(`background: var(--blue)`) 0개** · 고지 줄 상시.
- **C-4 랜딩** — Red: `tabFromInitialUrl('intoss://facefit?tab=home')` → home · `'intoss://facefit'` → null · `'intoss://facefit?tab=xyz'` → null · `readInitialTab`이 SDK 예외에 null · `App`이 `tab=home`이면 오늘 탭 렌더(`aria-current`).
- **C-5 릴리스** — `npm test` · `npm run build` → 번들 → 테스트 푸시 → 실기기: 체크 → 3시간 뒤 실수신 → 푸시 탭 → **오늘 탭으로 열림** → 「다음 알림」 → 재수신(게이트 1회전) → 「오늘은 그만」 → 더는 안 옴. 상세 설명 한 줄(§3-6) 같은 턴 → 검수 제출 → plan/changeLog sweep.

### 5-3. 순서

절차 1~4(인증서·가정 실측) → S-1~S-5(서버 라이브) → 절차 5~7(템플릿 승인·코드 확정 → 서버 프로퍼티 배포) → C-1~C-5.
**절차 4에서 거부되면 S-1 이후를 시작하지 않는다.**

---

## 6. 보류 목록

| 기능 | 보류 이유 |
|---|---|
| 간격 사용자 설정 | 서버 상수 1개로 시작(노브). 수요 실측 뒤 — `PUT` 본문에 `intervalMinutes` 하나 얹으면 되는 크기라 지금 안 만든다 |
| 자동 반복 | 사용자 원문이 게이트를 기본값으로 지정 — 반복은 요구 밖 |
| 야간 상한(22:00~07:00 예약 거부) | 사용자 결정(2026-09-03) — 게이트만 둔다. 밤 알림 민원이 실측되면 서버 컨트롤러 한 곳 + 클라 문구 한 줄로 되살린다(§3-3) |
| 사용 로그 백업·통계 | 「몇 번 썼나」는 요구에 없다. 기록이 필요해지면 `usage`와 같은 자리(사진 속성)로 재설계 |
| 알림 뒤 앱 안 배너 | `initialURL` 랜딩 + 카드 승인 대기 상태로 충분 |
| 인증서 만료 자동 알림 | 만료일을 plan에 적고 사람이 본다. 만료 시 증상은 워커 실패 로그 — 1회 겪으면 CloudWatch 알람 검토 |
| 촬영 알림 동의문에 철회 경로 추가(기존 ⬜) | 무관 · 그대로 |

---

## 7. 리스크 · 미검증 가정

1. **`x-anon-key`가 `send-message`에서 실제로 수용되는가**(§2-2 모순) — 절차 4의 verify 스모크 + 절차 7의 테스트 발송으로 두 번 확인. 실패 폴백 ⓐ′(토스 로그인)는 §3-1 표의 비용.
2. **익명 키의 발송 축** — 백업 v3-2(기기 2대 동일성)가 아직 미검증이다. 발송은 「지금 이 기기가 낸 키」로 하면 되므로 이 설계는 그 가정에 **의존하지 않는다**(기기를 바꾸면 그 기기에서 다시 체크한다).
3. **PEM 형식** — Java 표준 API는 PKCS#8(`BEGIN PRIVATE KEY`)만 읽는다. 발급 파일이 PKCS#1이면 절차 1의 openssl 변환 1회. 인증서 체인이 여러 장이면 `CertificateFactory.generateCertificates`로 전부 넣는다. SSM 표준 티어 4KB 초과 시 advanced 티어(월 $0.05).
4. **푸시 랜딩** — `initialURL`은 「처음 진입」 값이다. 토스 앱에 미니앱이 살아 있는 채로 푸시를 탭하면 쿼리가 안 실릴 수 있다 → 그때는 사용자가 오늘 탭을 누른다(카드는 어차피 거기 있다). C-5 실기기에서 두 경우(앱 종료 후 탭 · 백그라운드 후 탭) 모두 확인.
5. **SERVER 템플릿 생성 필드** — `sendOption.sendingTs`가 스키마상 required인데 SERVER에선 뜻이 없다. 거부 메시지로 맞춘다(v2-1 §7-2와 같은 급). 검수는 AI 자동이 아닐 수 있어 **승인 소요 미지**.
6. **EC2 outbound** — 기본 전체 허용이지만 보안그룹을 손본 이력이 있으면 `443 → 117.52.3.192` 등 3개 IP 확인.
7. **콘솔 상세 설명 500자** — 47자 추가분만큼 다른 문장을 줄여야 한다. 검수 지연 재발을 막는 유일한 수단이 이 정합이라 **생략 불가**.
8. **시계** — `dueAt`은 서버 시계(UTC JVM). 클라 표시는 `dueAt` 문자열을 KST로 포맷할 뿐 자기 시계로 계산하지 않는다. 승인 대기 판정(`nextAt ≤ now`)만 기기 시계 — 몇 분 어긋나도 해가 없다.

---

## 사용자 결정 (2026-09-03 — 본문에 반영됨)

1. **가정 실측 뒤 진행 방식** — 절차 4에서 익명 키가 거부되면 **ⓐ′ 토스 로그인을 도입한다**(접지 않는다). BookTimer의 토스 로그인 구현을 선례로 참고.
2. **야간 상한 — 두지 않는다.** 밤을 막는 장치는 「다음 알림 승인」 게이트 하나(§3-3 · §6).
3. **배치 — 오늘 탭 알림 행 아래.** 실기기로 보고 고친다.
