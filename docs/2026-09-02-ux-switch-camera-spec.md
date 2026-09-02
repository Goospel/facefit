# UX 개선 1차 — 스위치 · 촬영 화면 (구현 명세)

**상태: 승인(2026-09-02 사용자 — 「스위치랑 촬영 화면부터 구현해줘」)**
시안: https://claude.ai/code/artifact/593f1e2f-6585-4eb2-93a1-b66e12086901 (③ 촬영 · ⑤ 컨트롤 행)

원칙 셋 중 이번에 구현하는 것은 둘이다.
- **켜짐과 꺼짐은 색·표식·글자 셋으로 가른다** — 어느 하나만 봐도 상태를 안다.
- **화면에 파란 버튼은 하나** — 촬영 화면에서는 셔터다.

첫 진입 안내 카드·제품 탭 찍기 CTA·기록 탭 타임랩스 승격(①②④)은 **이번 범위 밖**이다 — 화면 구조가 바뀌어 설계 문서를 따로 올린다.

---

## 1. 아이콘 셋 추가 — `components/Icon.tsx`

`ICONS`에 셋을 더한다(24 그리드 · 2px 라운드 스트로크 · 20px 검수).

| 이름 | path | 쓰는 곳 |
|---|---|---|
| `check` | `M5 12.5l4.5 4.5L19 7.5` | 스위치 켜짐 표식 · 알림 켜짐 |
| `timer` | `M12 8v5l3 2` · `M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z` · `M9 2h6` | 촬영 타이머 칩 |
| `layers` | `M12 4l8 4.5-8 4.5-8-4.5z` · `M4 13l8 4.5 8-4.5` | 겹쳐 보기 칩 |

`Icon.test.ts`가 이름 목록을 검사한다면 갱신한다.

---

## 2. 백업 스위치 — `screens/Products.tsx` `BackupToggle`

### 2-1. 스위치 그림(`trackStyle`/`thumbStyle` 개정)

| | 꺼짐 | 켜짐 |
|---|---|---|
| 트랙 | 배경 `#fff` · 2px `var(--line-strong)` 테두리 | 배경 `var(--blue)` · 2px `var(--blue)` 테두리 |
| 손잡이 | 23px · `var(--text-weak)` | 23px · `#fff` · 오른쪽으로 `translateX(20px)` |
| 트랙 안 표식 | 오른쪽에 9px 빈 원(2px `var(--line-strong)` 테두리) | 왼쪽 8px 자리에 `check` 아이콘 13px 흰색 |
| 상태 글자 | 스위치 **아래** 11px/700 `var(--text-weak)` 「꺼짐」 | 11px/700 `var(--blue-dark)` 「켜짐」 |

- 치수는 51×31 그대로(iOS 관례). 트랙은 `position: relative`, 표식은 `position: absolute; top: 50%; transform: translateY(-50%)`.
- 상태 글자와 표식은 `aria-hidden` — 상태는 `role="switch"` + `aria-checked`가 이미 말한다(중복 낭독 금지, 기존 규율).
- 테두리는 shorthand `border`를 쓰지 않는다(`ui.ts` 머리말 — `borderWidth/Style/Color` 분리). `transition`은 유지.

### 2-2. 행(카드) 톤

| 상태 | 카드 | 아래 줄 문구 | 아래 줄 색/굵기 |
|---|---|---|---|
| 꺼짐 | 기존 그대로 | 「꺼져 있어요 · 켜면 기기를 바꿔도 제품과 관찰이 남아요」 | `var(--text-sub)` 400 |
| 켜짐(정상) | 배경·테두리 `var(--blue-soft)` | 「켜져 있어요 · 마지막 백업 {at}」 | `var(--blue-dark)` 600 |
| 켜짐(실패) | 배경·테두리 `var(--blue-soft)` | 「켜져 있어요 · 아직 백업하지 못했어요」 | `var(--amber)` 600 (기존 경고 의미 유지) |

`data-testid="backup-state"`는 그대로 둔다. 「켜져 있어요/꺼져 있어요」로 **문장이 시작**하는 것이 요점이다 — 스위치를 못 알아봐도 첫 두 글자로 안다.

---

## 3. 알림 행 — `screens/Home.tsx`

스위치가 **아니라 행동**이라는 것이 눈에 보여야 한다(백업 스위치와 같은 카드 가족이라 혼동됐다).

- 오른쪽 `notify.right` 표시를 **알약 모양**으로: `padding: 8px 14px` · 14px/600 · `borderRadius: 999` · 테두리 1px `var(--blue)` · 배경 `#fff` · 글자 `var(--blue)`. 행 전체가 버튼인 구조는 그대로(`aria-label`도 그대로) — 알약은 `<span aria-hidden>` 장식이다.
- `tone === 'on'`일 때는 알약이 아니라 `check` 아이콘 16px + 「켜짐」 (`var(--blue-dark)` 600, 아이콘 색 동일). 알약은 「누르면 무언가 열린다」의 신호라, 이미 켜진 상태에 두면 도로 행동으로 읽힌다.
- `warn`은 알약 그대로(다시 누르라는 뜻이 맞다).
- ⚠️ **「끄려면 토스 앱 → …」 경로 줄은 한 글자도 안 건드린다** — 실기기 보고로 넣은 줄이다(주석 참고). 시안에서 생략된 것은 시안의 축약이지 삭제 지시가 아니다.

---

## 4. 촬영 화면 — `screens/FacePhoto.tsx` (프리뷰 상태만)

### 4-1. 컨트롤 한 줄

「촬영」·「3초 후 촬영」 두 버튼과 「고스트 켜기/끄기」 글자 버튼을 걷고, 한 줄로 바꾼다:

```
[ ⏱ 3초 꺼짐 ]      ( ● 셔터 )      [ ◈ 겹치기 켜짐 ]
```

- 컨테이너: `display: flex; align-items: center; justify-content: space-between; margin-top: 12px`.
- **셔터**(가운데): `<button aria-label="촬영">` · 76×76 · `borderRadius: 999` · 배경 투명 · 4px 흰 테두리 · `padding: 4` · 안에 흰 원(`flex: 1; borderRadius: 999; background: #fff`). `disabled={busy}`. **화면에서 유일하게 큰 버튼**이다.
- **타이머 칩**(왼쪽): `role="switch"` `aria-checked={timerOn}` `aria-label="3초 타이머"`. 보이는 글자 「3초 켜짐」/「3초 꺼짐」 + `timer` 아이콘 16px.
- **겹쳐 보기 칩**(오른쪽): `role="switch"` `aria-checked={ghostOn}` `aria-label="겹쳐 보기"`. 보이는 글자 「겹치기 켜짐」/「겹치기 꺼짐」 + `layers` 아이콘 16px. **`baseline`이 없으면 `visibility: hidden`으로 자리만 지킨다**(셔터가 가운데 서야 한다). 이 칩이 기존 `ghostOn` 토글의 후신이다.
- 칩 스타일(둘 공통): `display: flex; alignItems: center; gap: 5; padding: 8px 11px; fontSize: 13; fontWeight: 600; whiteSpace: nowrap; borderRadius: 999`. 꺼짐 = 배경 투명 · 1px `#3a3f47` 테두리 · 글자 `#b0b8c1`. 켜짐 = 배경 `var(--blue)` · 테두리 `var(--blue)` · 글자 `#fff`. 테두리는 분리 속성으로.

### 4-2. 동작

- 새 state `timerOn`(boolean, 기본 `false`, 세션 안에서만). 셔터 클릭: `timerOn ? setCount(3) : setFlash(true)`. 기존 카운트다운·플래시·`busy` 잠금 로직은 그대로.
- 칩은 `busy` 중에도 누를 수 있다(상태 바꾸기는 촬영을 방해하지 않는다).
- 안내 두 줄(`baseline` 유무별 첫 줄 + 「아침 세안 직후…」)과 `LOCAL_ONLY` 줄은 **그대로** 둔다. 셔터 줄 아래 `LOCAL_ONLY`는 `margin: 14px 0 0`.
- 확인 화면(`shot`)의 「다시 찍기 / 저장」 두 버튼은 이번 범위 밖 — 그대로.

### 4-3. 테스트 갱신 지점(`FacePhoto.test.tsx`)

- `btn('촬영')`은 그대로 셔터를 잡는다(접근성 이름 유지).
- 「3초 후 촬영」 테스트 → 「3초 타이머」 스위치를 켠 뒤 「촬영」을 눌러 카운트다운이 도는지, **안 켜면 즉시 플래시**인지 둘 다.
- 「고스트 끄기/켜기」 → `getByRole('switch', { name: '겹쳐 보기' })`의 `aria-checked` 토글 + 고스트 img 유무.
- 첫 촬영(사진 0장)에서는 「겹쳐 보기」 스위치가 **보이지 않아야** 한다(`visibility: hidden` — `toBeVisible()` 대신 style 단언이라도 좋다).

---

## 5. 순서·검증

1. Red: `Products.test.tsx`(상태 글자 「켜짐/꺼짐」 · 문구 「켜져 있어요/꺼져 있어요」 · 켜짐 카드 톤) · `Home.test.tsx`(알약/켜짐 표시) · `FacePhoto.test.tsx`(4-3) · `Icon.test.ts`. 실패를 눈으로 본 뒤 구현.
2. Green 후 돌연변이 최소 2건 실측(예: 상태 글자를 「켜짐」 고정으로 → 꺼짐 테스트가 죽는가 · 타이머 분기 제거 → 즉시 플래시 테스트가 죽는가).
3. `npm test` → `npm run build`(tsc)까지. 기준선 548.
4. 커밋은 T-026(`.commit-msg-tmp` + `git commit -F`), PR 본문은 `.pr-body-tmp` + `--body-file`. plan.md에 「UX 개선 1차」 항목(✅) · changeLog 한 줄.
