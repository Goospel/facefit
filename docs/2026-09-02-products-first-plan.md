# 첫 화면을 「제품」으로 — 구현 계획 (v4-1 · 2026-09-02)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱을 열면 제품 목록이 첫 화면이고, 얼굴 사진은 「오늘」 탭에 들어가야만 보인다. 제품 탭은
사진 없는 「오늘 상태 줄」 + 읽는 카드(「n일째」 블록) + 폼 안의 종료·삭제로 메인 페이지가 된다.

**Architecture:** 설계 단일 출처 [docs/2026-09-02-products-first-design.md](2026-09-02-products-first-design.md).
라우터 없는 `App.tsx`의 `tab` 값과 `TABS` 순서만 바꾸고, 변경의 본체는 `Products.tsx` 한 파일이다
(상태 줄 · 카드 · 폼 줄 · 제목 줄). 사진은 Products가 `usePhotos()`로 직접 연다(화면 수명에 DB 수명을
가두는 기존 규칙). 새 로직은 없다 — `daysBetween` · `isActive` · `sortProducts`를 그대로 쓴다.

**Tech Stack:** React 18 + TypeScript + Vite 6, vitest + @testing-library/react(jsdom). 스타일은
`ui.ts` 인라인 객체 + `index.css` CSS 변수. 작업 디렉터리는 워크트리
`C:\Users\kimsa\ClodeProjects\facefit\.claude\worktrees\task-selection-d89649`, 브랜치 `feat/products-first`
(origin/main 기준 · 설계 문서 커밋 2건 포함). 미니앱 명령은 전부 `miniapp/`에서 돈다.

---

## 읽고 시작할 것

- 설계 문서 §3(결정)·§5(테스트). 이 계획은 그 §5를 코드로 옮긴 것이다.
- `miniapp/src/ui.ts` 머리말 — **테두리는 shorthand(`border`)로 쓰지 않는다**(리렌더에서 색이 풀린다).
- `miniapp/src/components/Icon.tsx` 머리말 — 20px에서 안 뭉개지는 획만.
- 커밋 메시지는 한글이라 **`.commit-msg-tmp`(UTF-8) + `git commit -F`** 로 넣는다(PowerShell 인라인
  `-m`은 CP949로 깨진다 — T-026). `.commit-msg-tmp`는 gitignore 되어 있다. 아래 커밋 스텝의
  heredoc은 **Bash 도구**에서 그대로 돈다. 메시지 끝에 `Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>`.
- 각 태스크의 「Red 확인」은 **실제로 실패를 눈으로 본 뒤** 구현으로 넘어간다. 실패 사유가 예상과
  다르면 테스트가 잘못 짜인 것이니 거기서 멈추고 고친다.
- 검증 명령: `npm test` (vitest run) · `npm run build` (tsc -b + vite build — **테스트가 못 잡는 타입
  오류를 잡은 전례가 있다**, 태스크마다 둘 다 돌린다).

---

## 파일 지도

| 파일 | 책임 | 이 계획에서 |
|---|---|---|
| `miniapp/src/storage.ts` | 저장소 + 어휘(`VERDICTS`) | `VERDICT_KO` 한 벌 신설(Task 1) |
| `miniapp/src/screens/Home.tsx` · `History.tsx` | 오늘 탭 · 기록 탭 | 자체 `VERDICT_KO` 삭제 → import(Task 1). 그 외 0 변경 |
| `miniapp/src/components/Icon.tsx` | 앱 전용 아이콘 | `chevron` 추가(Task 2) |
| `miniapp/src/index.css` | CSS 변수 · 전역 | `--blue-soft` 추가(Task 2) |
| `miniapp/src/screens/Products.tsx` | 제품 탭 | 상태 줄(Task 3) · 카드+폼 줄(Task 5) · 제목 줄+빈 상태(Task 6) |
| `miniapp/src/App.tsx` | 배선 | Products에 `notes`·`onShoot`(Task 3) · 탭 순서·시작 탭(Task 4) |
| 테스트 | 각 파일 옆 `*.test.ts(x)` | 태스크마다 Red 먼저 |
| `plan.md` · `changeLog.md` | 운영 로그 | Task 7 sweep |

---

### Task 1: `VERDICT_KO` 한 벌로 — storage로 올리고 Home·History가 import

**Files:**
- Modify: `miniapp/src/storage.ts` (`export type Verdict` 바로 아래)
- Modify: `miniapp/src/screens/Home.tsx:16` (자체 사전 삭제) · storage import
- Modify: `miniapp/src/screens/History.tsx:23-32` (자체 사전 삭제) · storage import
- Test: `miniapp/src/storage.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`miniapp/src/storage.test.ts`의 storage import에 `VERDICT_KO`, `VERDICTS`를 추가하고(이미 있는 것은
그대로), 파일 끝에:

```ts
describe('VERDICT_KO — 관찰 문구 한 벌', () => {
  it('어휘 셋에 문구가 하나씩 있다 — 화면들이 이 한 벌을 나눠 쓴다', () => {
    // 촬영 화면의 버튼 라벨과 같은 말이라야 「내가 뭘 눌렀지」가 성립한다. 사본이 둘이면 어긋난다.
    expect(VERDICTS.map((v) => VERDICT_KO[v])).toEqual(['좋아졌어요', '그대로예요', '나빠졌어요']);
  });
});
```

- [ ] **Step 2: Red 확인**

Run: `cd miniapp && npx vitest run src/storage.test.ts`
Expected: FAIL — `VERDICT_KO`가 export 되지 않아 `undefined[...]` TypeError 또는 import 오류.

- [ ] **Step 3: 구현**

`miniapp/src/storage.ts`, `export type Verdict = (typeof VERDICTS)[number];` 바로 아래에:

```ts
/**
 * 관찰 답의 표시 문구. **촬영 화면의 버튼 라벨과 같은 말이라야** 「내가 뭘 눌렀지」가 성립한다.
 * 어휘(`VERDICTS`) 곁에 **한 벌만** 둔다 — Home·History가 각자 사본을 들고 있었고(v4-1에서 통합),
 * 사본이 둘이면 문구를 다듬는 순간 한쪽이 조용히 낡는다.
 */
export const VERDICT_KO: Record<Verdict, string> = { better: '좋아졌어요', same: '그대로예요', worse: '나빠졌어요' };
```

`miniapp/src/screens/Home.tsx`:
- 16행 `const VERDICT_KO: Record<string, string> = { ... };` 줄 삭제.
- `import type { Notes, Product } from '../storage';` → `import { VERDICT_KO, type Notes, type Product } from '../storage';`

`miniapp/src/screens/History.tsx`:
- 23~32행(주석 블록 + `const VERDICT_KO ... };`) 삭제.
- storage import 줄에 `VERDICT_KO` 추가(예: `import { VERDICT_KO, type Notes, type Verdict } from '../storage';`
  — 기존 import 형태를 보고 맞춘다). `Verdict` 타입이 더는 안 쓰이면 import에서 뺀다(tsc가 알려 준다).

- [ ] **Step 4: Green 확인**

Run: `cd miniapp && npm test && npm run build`
Expected: 테스트 전부 PASS(기존 484 + 1). 빌드 통과.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
관찰 문구 사전을 storage 한 벌로 올린다 (v4-1 Task 1)

Home·History가 같은 세 문장을 각자 들고 있었다. 제품 탭에 세 번째 사본을 만드는 대신
어휘(VERDICTS) 곁에 한 벌만 두고 두 화면이 import 한다.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add miniapp/src/storage.ts miniapp/src/storage.test.ts miniapp/src/screens/Home.tsx miniapp/src/screens/History.tsx
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
```

---

### Task 2: `chevron` 아이콘 + `--blue-soft` 변수

**Files:**
- Modify: `miniapp/src/components/Icon.tsx` (`ICONS` 객체)
- Modify: `miniapp/src/index.css` (`:root`의 `--blue-dark` 다음 줄)
- Test: `miniapp/src/components/Icon.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`miniapp/src/components/Icon.test.ts`의 첫 케이스를 교체:

```ts
  it('탭 셋과 셰브론이 모두 있다', () => {
    expect(Object.keys(ICONS).sort()).toEqual(['bottle', 'calendar', 'chevron', 'face']);
  });
```

- [ ] **Step 2: Red 확인**

Run: `cd miniapp && npx vitest run src/components/Icon.test.ts`
Expected: FAIL — 배열에 `chevron`이 없다.

- [ ] **Step 3: 구현**

`miniapp/src/components/Icon.tsx`의 `ICONS` 안, `calendar` 항목 뒤에:

```ts
  /**
   * 셰브론(제품 카드 오른쪽). **카드 전체가 버튼이라는 유일한 신호**라 장식이 아니다.
   * 획 하나라 20px에서도 선다 — 원을 두르거나 획을 더 넣으면 여기서 먼저 뭉개진다.
   */
  chevron: ['M9 6l6 6-6 6'],
```

`miniapp/src/index.css`의 `--blue-dark: #1b64da;` 다음 줄에:

```css
  /* 제품 카드 「n일째」 블록 배경. 위에 --blue 글자가 선다(대비 약 3.3:1 — 16px/700 큰 글자 AA). */
  --blue-soft: #e8f3ff;
```

⚠️ `index.css`는 BOM 없음·LF다. Edit 도구로 그 줄만 넣는다(파일을 통째로 다시 쓰지 않는다).

- [ ] **Step 4: Green 확인**

Run: `cd miniapp && npm test && npm run build`
Expected: 전부 PASS. 빌드 통과.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
셰브론 아이콘과 연파랑 변수를 더한다 (v4-1 Task 2)

제품 카드가 통째로 버튼이 되면서 오른쪽에 눌린다는 신호가 필요하고(chevron),
「n일째」 숫자 블록 배경으로 토스 연파랑(--blue-soft)이 필요하다.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add miniapp/src/components/Icon.tsx miniapp/src/components/Icon.test.ts miniapp/src/index.css
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
```

---

### Task 3: 오늘 상태 줄 — Products가 사진을 열고, 사진은 안 그린다

**Files:**
- Modify: `miniapp/src/screens/Products.tsx` (props · `usePhotos` · `TodayStrip` 신설)
- Modify: `miniapp/src/App.tsx` (`<Products>`에 `notes` · `onShoot` 전달 — tsc를 그린으로 유지하기 위해 같은 태스크)
- Test: `miniapp/src/screens/Products.test.tsx`

- [ ] **Step 1: 테스트 하네스 갱신 + 실패하는 테스트**

`miniapp/src/screens/Products.test.tsx` 머리 부분을 이렇게 바꾼다.

import 두 줄 추가·수정:

```ts
import { listPhotos, openPhotoDb, type FacePhoto as Photo } from '../photoStore';
import type { MfdsSnapshot, Notes, Product } from '../storage';
```

`vi.mock('../logic/mfds', ...)` 아래에 사진 저장소 목(Home.test와 같은 방식):

```ts
/**
 * 사진 저장소도 목이다 — 이 화면은 「오늘 찍었나」만 묻고 사진 자체는 **그리지 않는다.**
 * `openPhotoDb`·`listPhotos`를 setup에서 매번 세운다(`restoreAllMocks`가 구현을 지워도 안전하게).
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  openPhotoDb: vi.fn(),
  listPhotos: vi.fn(),
}));

const photo = (date: string): Photo => ({ date, blob: new Blob([date]), capturedAt: 1, width: 960, height: 1280 });
```

`setup`을 교체:

```ts
function setup(products: Product[] = [], over: { photos?: string[]; notes?: Notes } = {}) {
  vi.mocked(openPhotoDb).mockResolvedValue({ close: () => {} } as unknown as import('../photoStore').PhotoDb);
  vi.mocked(listPhotos).mockResolvedValue((over.photos ?? []).map(photo));
  const onChange = vi.fn<(next: Product[]) => void>();
  const onShoot = vi.fn();
  const view = render(
    <Products products={products} onChange={onChange} date={TODAY} notes={over.notes ?? {}} onShoot={onShoot} />,
  );
  return { onChange, onShoot, ...view };
}
```

그리고 `describe('제품 목록', ...)` 앞에 새 describe:

```tsx
/** 비동기 DB 목이 끝까지 돌게 한 틱 기다린다 — 안 기다리면 「안 찍었어요」가 초기 렌더로 늘 통과한다. */
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe('오늘 상태 줄 — 사진은 그리지 않는다', () => {
  it('아직 안 찍었으면 찍자고 하고, 누르면 촬영을 연다', async () => {
    const { onShoot } = setup();
    await flush();

    expect(screen.getByText('오늘 아직 안 찍었어요')).toBeTruthy();
    fireEvent.click(btn('오늘 얼굴 찍기'));
    expect(onShoot).toHaveBeenCalledTimes(1);
  });

  it('찍었으면 관찰 답을 말하고, 오른쪽은 「다시 찍기」다', async () => {
    const { onShoot } = setup([], { photos: [TODAY], notes: { [TODAY]: 'better' } });

    expect(await screen.findByText('오늘 찍었어요')).toBeTruthy();
    expect(screen.getByText('좋아졌어요')).toBeTruthy();
    fireEvent.click(btn('오늘 얼굴 다시 찍기'));
    expect(onShoot).toHaveBeenCalledTimes(1);
  });

  it('찍었는데 답이 없으면 오늘 탭을 가리킨다 — 「미응답」을 적으면 건너뛴 것이 실패로 보인다', async () => {
    setup([], { photos: [TODAY] });
    expect(await screen.findByText("'오늘' 탭에서 볼 수 있어요")).toBeTruthy();
  });

  it('어제 사진은 오늘 사진이 아니다', async () => {
    setup([], { photos: ['2026-08-28'] });
    await flush();
    expect(screen.getByText('오늘 아직 안 찍었어요')).toBeTruthy();
  });

  it('어느 상태에도 <img>가 없다 — 얼굴은 부르기 전엔 안 보인다', async () => {
    const { container } = setup([], { photos: [TODAY], notes: { [TODAY]: 'same' } });
    await screen.findByText('오늘 찍었어요');
    expect(container.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Red 확인**

Run: `cd miniapp && npx vitest run src/screens/Products.test.tsx`
Expected: 새 describe 5건 FAIL(「오늘 아직 안 찍었어요」 없음 등). 기존 케이스는 그대로 PASS
(새 props는 무시된다).

- [ ] **Step 3: 구현 — Products**

`miniapp/src/screens/Products.tsx` import(세 줄 — `Icon`은 아래 `TodayStrip`이 바로 쓴다):

```ts
import { Icon } from '../components/Icon';
import { CATEGORIES, newId, VERDICT_KO, type Category, type MfdsSnapshot, type Notes, type Product, type Verdict } from '../storage';
import { usePhotos } from './usePhotos';
```

props에 추가(`backup?` 위):

```ts
  /** 오늘의 관찰 답. 상태 줄이 「찍었어요」 아래에 이 문구를 단다. */
  notes: Notes;
  /** 상태 줄의 유일한 행동 — 촬영 전체화면을 연다(닫으면 이 탭으로 돌아온다). */
  onShoot: () => void;
```

컴포넌트 시그니처의 구조분해에 `notes, onShoot` 추가. 본문 `const [editing, ...]` 아래에:

```ts
  /** 「오늘 찍었나」만 묻는다. 사진 DB 수명은 이 화면 수명에 갇힌다(App 설계 §1-4). */
  const { photos } = usePhotos();
  const todayPhoto = photos.find((p) => p.date === date);
```

JSX에서 `<h1 style={ui.h1}>제품</h1>` 바로 아래에:

```tsx
      <TodayStrip shot={Boolean(todayPhoto)} verdict={notes[date]} onShoot={onShoot} />
```

파일 끝(`ProductForm` 앞이든 뒤든)에 `TodayStrip`:

```tsx
/**
 * 오늘 상태 줄(v4-1 §3-2). **사진은 절대 안 그린다** — 이 탭이 첫 화면이 된 이유가 「부르지
 * 않았는데 얼굴이 보인다」였다. 찍었는지와 관찰 답만 말하고, 오른쪽은 행동이다.
 *
 * 알림 행·백업 행과 같은 가족(카드 + 가로 flex + 오른쪽 글자). **행 전체가 버튼**이고 두 상태
 * 모두 촬영을 연다 — 「보기」로 오늘 탭에 보내는 안은 한 행에 행동이 둘이라 버렸다. 「다시 찍기」가
 * 덮어쓰기임은 오늘 탭의 같은 문구가 이미 가르친다.
 *
 * DB가 열리기 전 한 프레임은 「안 찍었어요」로 뜰 수 있다 — 오늘 탭이 첫 화면이던 때와 같은
 * 깜빡임이라 받아들인다.
 */
function TodayStrip({ shot, verdict, onShoot }: { shot: boolean; verdict: Verdict | undefined; onShoot: () => void }) {
  return (
    <button
      aria-label={shot ? '오늘 얼굴 다시 찍기' : '오늘 얼굴 찍기'}
      onClick={onShoot}
      style={{ ...ui.card, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', color: 'var(--blue)' }}
    >
      {/* 오늘 탭 아이콘과 같은 그림이라 「저 줄이 저 화면을 연다」가 눈으로 이어진다. */}
      <Icon name="face" />
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          {shot ? '오늘 찍었어요' : '오늘 아직 안 찍었어요'}
        </span>
        <span style={{ display: 'block', fontSize: 13, marginTop: 2, color: 'var(--text-sub)' }}>
          {shot ? (verdict ? VERDICT_KO[verdict] : "'오늘' 탭에서 볼 수 있어요") : '지난 사진에 얼굴을 겹쳐 같은 구도로 찍어요'}
        </span>
      </span>
      <span aria-hidden style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue)' }}>
        {shot ? '다시 찍기' : '찍기'}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: 구현 — App 배선**

`miniapp/src/App.tsx`의 `<Products ... />`에 두 prop 추가(`date={date}` 다음):

```tsx
          notes={notes}
          onShoot={() => setView('shoot')}
```

- [ ] **Step 5: Green 확인**

Run: `cd miniapp && npm test && npm run build`
Expected: 전부 PASS(+5). 빌드 통과(App이 새 필수 props를 넘긴다).

- [ ] **Step 6: 커밋**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
제품 탭 맨 위에 사진 없는 「오늘 상태 줄」을 둔다 (v4-1 Task 3)

찍었는지와 관찰 답만 말하고 오른쪽은 행동(찍기/다시 찍기)이다. 행 전체가 버튼이라
아침 알림을 받고 들어온 사람이 한 번 눌러 촬영으로 간다. 어느 상태에도 <img>가 없음을
테스트가 잠근다 — 이 변경의 존재 이유다.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add miniapp/src/screens/Products.tsx miniapp/src/screens/Products.test.tsx miniapp/src/App.tsx
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
```

---

### Task 4: 탭 — 제품이 첫 자리·첫 화면

**Files:**
- Modify: `miniapp/src/App.tsx:51-55` (`TABS`) · `useState<Tab>('home')`
- Test: `miniapp/src/App.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`miniapp/src/App.test.tsx` import에 `within` 추가:

```ts
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
```

「시작하면 오늘 탭으로 들어간다」 케이스를 교체하고 한 케이스를 더한다:

```tsx
  it('시작하면 제품 탭으로 들어간다 — 얼굴은 부르기 전엔 안 보인다', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    expect(screen.queryByRole('button', { name: '시작하기' })).toBeNull();
    expect(tab('제품').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: '제품' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '오늘' })).toBeNull();
  });

  it('탭 순서는 제품 · 오늘 · 기록이다 — 첫 자리가 첫 화면이다', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['제품', '오늘', '기록']);
  });
```

`describe('탭 이동')`의 「제품 탭으로 간다」를 「오늘 탭으로 간다」로 교체(제품은 이제 시작 탭이라 이동
테스트로서 의미가 없다):

```tsx
  it('오늘 탭으로 간다', () => {
    start();
    fireEvent.click(tab('오늘'));
    expect(screen.getByRole('heading', { name: '오늘' })).toBeTruthy();
  });
```

`describe('전체화면')`의 「닫으면 보던 탭으로 돌아온다」 마지막 expect 두 줄을:

```tsx
    expect(screen.getByRole('button', { name: '오늘 얼굴 찍기' })).toBeTruthy();
    expect(tab('제품').getAttribute('aria-current')).toBe('page');
```

(이 describe의 「촬영을 열면 탭바가 사라진다」는 이제 **제품 탭의 상태 줄**을 누른다 — 이름이 같아
본문은 그대로다. 그래도 통과하는지 눈으로 본다.)

- [ ] **Step 2: Red 확인**

Run: `cd miniapp && npx vitest run src/App.test.tsx`
Expected: 「시작하면 제품 탭으로」 · 「탭 순서」 · 「닫으면 보던 탭」 3건 FAIL(시작 탭이 아직 오늘이고
순서가 `오늘, 제품, 기록`). 「오늘 탭으로 간다」는 PASS(이동 자체는 이미 된다).

- [ ] **Step 3: 구현**

`miniapp/src/App.tsx`:

```ts
/**
 * 순서가 곧 시작 화면이다(v4-1 §3-1). **제품이 첫 자리** — 오늘 탭이 첫 화면이면 부르지 않은
 * 얼굴 사진이 앱을 열자마자 뜬다(2026-09-02 실기기 피드백). 오늘 탭 자체는 한 글자도 안 바뀐다.
 */
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'products', label: '제품', icon: 'bottle' },
  { key: 'home', label: '오늘', icon: 'face' },
  { key: 'history', label: '기록', icon: 'calendar' },
];
```

`const [tab, setTab] = useState<Tab>('home');` → `useState<Tab>('products');`

- [ ] **Step 4: Green 확인**

Run: `cd miniapp && npm test && npm run build`
Expected: 전부 PASS. `App.backup.test.tsx`는 시작 후 `제품` 탭을 한 번 더 누르는데 이미 그 탭이라 무해하다.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
첫 화면과 탭 첫 자리를 「제품」으로 옮긴다 (v4-1 Task 4)

들어가자마자 내 얼굴이 보인다는 실기기 피드백. 탭 순서 제품·오늘·기록, 시작 탭 products.
오늘 탭은 0 변경 — 얼굴은 그 탭에 들어가야만 보인다.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add miniapp/src/App.tsx miniapp/src/App.test.tsx
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
```

---

### Task 5: 읽는 카드(「n일째」 블록) + 종료·삭제를 폼 안으로

**Files:**
- Modify: `miniapp/src/screens/Products.tsx` (`Row` → `Card` · `MfdsMeta` 프래그먼트화 · `ProductForm`에 `onEnd`/`onRemove` · 본문 배선)
- Test: `miniapp/src/screens/Products.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`miniapp/src/screens/Products.test.tsx`:

「시작일부터 며칠째인지 보여준다」 케이스(현재 `D+28` 기대)를 교체하고 두 케이스를 더한다:

```tsx
  it('시작일부터 며칠째인지 보여준다 — 시작 당일이 1일째다', () => {
    // 8/01 시작, 오늘 8/29 → daysBetween 28 + 1 = 29일째.
    setup([p({ startDate: '2026-08-01' })]);
    expect(screen.getByText('29')).toBeTruthy();
    expect(screen.getByText('일째')).toBeTruthy();
  });

  it('오늘 시작한 제품은 1일째다 — 0일째는 말이 안 된다', () => {
    setup([p({ startDate: TODAY })]);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('종료한 제품은 쓴 날수를 보여주고, 그 수는 오늘과 무관하다', () => {
    // 8/1 ~ 8/11 → 11일. 오늘까지 세면 끝난 제품이 계속 자란다.
    setup([p({ startDate: '2026-08-01', endDate: '2026-08-11' })]);
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('일')).toBeTruthy();
    expect(screen.queryByText('일째')).toBeNull();
  });
```

(기존 「종료한 제품은 쓴 기간을 보여준다」 — `8월 1일 ~ 8월 11일` 기대 — 는 **그대로 둔다**. 메타 줄에 남는다.)

`describe('제품 수정', ...)` 앞에 새 describe:

```tsx
describe('카드 — 읽는 카드', () => {
  it('카드 안의 버튼은 카드 자체 하나뿐이고, 누르면 수정 폼이 열린다', () => {
    // 메인 페이지에 카드마다 버튼 셋이 깔리면 목록이 아니라 조작판으로 읽힌다(v4-1 §3-3).
    setup([p()]);
    expect(within(screen.getByTestId('section-active')).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(btn('토너 수정'));

    expect(screen.getByLabelText('제품 이름')).toBeTruthy();
  });
});
```

`describe('오늘까지 쓰고 종료', ...)`를 통째로 교체:

```tsx
describe('오늘까지 쓰고 종료 — 폼 안에 산다', () => {
  it('종료일을 오늘로 넣고 폼을 닫는다 — 오늘까지 쓴 것으로 센다', () => {
    // 어제로 넣으면 오늘 찍은 사진에 그 제품이 안 붙는다. 경계 하루가 구간 바를 어긋나게 한다.
    const { onChange } = setup([p()]);
    fireEvent.click(btn('토너 수정'));

    fireEvent.click(btn('토너 종료'));

    expect(onChange.mock.calls[0][0][0].endDate).toBe(TODAY);
    expect(screen.queryByLabelText('제품 이름')).toBeNull();
  });

  it('이미 종료한 제품의 폼에는 그 버튼이 없다 — 삭제는 있다', () => {
    setup([p({ endDate: '2026-08-10' })]);
    fireEvent.click(btn('토너 수정'));

    expect(screen.queryByRole('button', { name: '토너 종료' })).toBeNull();
    expect(btn('토너 삭제')).toBeTruthy();
  });

  it('추가 폼에는 종료·삭제가 없다 — 아직 없는 제품이다', () => {
    setup([p()]);
    fireEvent.click(btn('제품 추가'));

    expect(screen.queryByRole('button', { name: /종료$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /삭제$/ })).toBeNull();
  });
});
```

`describe('제품 삭제', ...)`의 두 케이스에서 `fireEvent.click(btn('토너 삭제'));` **앞에**
`fireEvent.click(btn('토너 수정'));`를 넣는다(두 케이스 모두).

- [ ] **Step 2: Red 확인**

Run: `cd miniapp && npx vitest run src/screens/Products.test.tsx`
Expected: FAIL — 「29」·「1」·「11」 없음(아직 `D+28` 등), 「카드 안의 버튼 하나뿐」(현재 3개),
「종료 — 폼 안」 3건(폼에 종료·삭제 없음 / 추가 폼 케이스는 현재 카드 버튼이 잡혀 실패), 삭제 2건은
현재 카드 버튼으로 통과할 수도 있다 — 그건 Step 3 뒤에도 통과해야 한다.

- [ ] **Step 3: 구현**

`miniapp/src/screens/Products.tsx`:

(a) import에 `Icon` 추가(Task 3에서 이미 넣었으면 그대로):

```ts
import { Icon } from '../components/Icon';
```

(b) 본문의 `<Row ... />` 두 곳을 `<Card key={p.id} product={p} date={date} onEdit={setEditing} />`로 교체.

(c) `<ProductForm ... />` 호출에 두 prop 추가:

```tsx
        <ProductForm
          initial={editing === 'new' ? null : editing}
          today={date}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
          onEnd={editing === 'new' ? undefined : () => endToday(editing)}
          onRemove={editing === 'new' ? undefined : () => remove(editing)}
        />
```

(d) `Row` 함수를 **삭제**하고 `Card`로 교체:

```tsx
/**
 * 제품 카드(v4-1 §3-3). **카드 전체가 버튼이고 안에 다른 버튼은 없다** — 메인 페이지에
 * 카드마다 버튼 셋이 깔리면 목록이 아니라 조작판으로 읽힌다. 수정·종료·삭제는 폼 안에 산다.
 *
 * 왼쪽 숫자 블록이 카드의 얼굴이다. 사용 중이면 「n일째」(**시작 당일이 1일째** — 0일째는 말이
 * 안 된다), 종료면 쓴 날수 「n일」이 회색으로 선다. 끝난 제품의 숫자는 **자라지 않는다.**
 *
 * ⚠️ 접근성 이름은 `${name} 수정` 한 마디다 — 본문을 이어 붙이면 스크린리더가 칩까지 버튼
 * 이름으로 읽는다.
 */
function Card({ product, date, onEdit }: { product: Product; date: string; onEdit: (p: Product) => void }) {
  const using = isActive(product, date);
  const ended = product.endDate;
  const days = daysBetween(product.startDate, ended ?? date) + 1;
  return (
    <button
      aria-label={`${product.name} 수정`}
      onClick={() => onEdit(product)}
      style={{ ...ui.card, padding: 12, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}
    >
      <span
        style={{
          ...dayBlockStyle,
          background: using ? 'var(--blue-soft)' : 'var(--bg-sub)',
          borderColor: using ? 'var(--blue-soft)' : 'var(--line)',
          color: using ? 'var(--blue)' : 'var(--text-sub)',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>{days}</span>
        <span style={{ fontSize: 10, lineHeight: 1.1 }}>{ended ? '일' : '일째'}</span>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 15, color: using ? 'var(--text)' : 'var(--text-sub)' }}>{product.name}</b>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={ui.chip}>{CATEGORY_KO[product.category]}</span>
          {product.mfds && <MfdsMeta m={product.mfds} />}
          {ended && <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{`${md(product.startDate)} ~ ${md(ended)}`}</span>}
        </span>
      </span>
      <span style={{ color: 'var(--text-weak)', display: 'flex' }}>
        <Icon name="chevron" size={18} />
      </span>
    </button>
  );
}

/** 숫자 블록. 테두리는 shorthand로 쓰지 않는다(`ui.ts` 머리말 — 리렌더에서 색이 풀린다). */
const dayBlockStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 44,
  height: 44,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  fontVariantNumeric: 'tabular-nums',
};
```

(e) `MfdsMeta`를 **프래그먼트**로 — 메타 줄(flex)의 일부가 되므로 자체 wrapper를 없앤다. 머리말 주석은
그대로 두고 return만:

```tsx
function MfdsMeta({ m }: { m: MfdsSnapshot }) {
  // 「SPF50+ PA++++」. 한쪽만 있으면 그 한쪽만, 둘 다 없으면 칩 자체가 없다(빈 칩 방지).
  const uv = [m.spf && `SPF${m.spf}`, m.pa && `PA${m.pa}`].filter(Boolean).join(' ');
  return (
    <>
      {m.entpName && <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{m.entpName}</span>}
      {m.effects.map((e) => (
        <span key={e} style={ui.chip}>
          {e}
        </span>
      ))}
      {uv && <span style={ui.chip}>{uv}</span>}
    </>
  );
}
```

(f) `ProductForm` props에 추가:

```ts
  /** 수정일 때만. 카드에서 걷어낸 두 행동의 새 집이다(v4-1 §3-4). */
  onEnd?: () => void;
  onRemove?: () => void;
```

구조분해에 `onEnd, onRemove` 추가. 취소·저장 `<div style={ui.row}>...</div>` **바로 아래**에:

```tsx
      {/*
        종료·삭제의 집(v4-1 §3-4). 종료일 칸이 있는데도 버튼을 두는 이유: 네이티브 피커에서 오늘을
        고르는 건 세 번 누르기, 이건 한 번이다. 추가 폼에는 없다 — 아직 없는 제품을 종료·삭제할 수 없다.
        접근성 이름은 **원래 이름**(`initial.name`)으로 — 편집 중인 draft 이름으로 붙이면 글자를
        칠 때마다 버튼 이름이 바뀐다.
      */}
      {initial && (
        <div style={ui.row}>
          {onEnd && isActive(initial, today) && (
            <button aria-label={`${initial.name} 종료`} style={{ ...ui.secondary, flex: 1, padding: '10px 12px' }} onClick={onEnd}>
              오늘까지 쓰고 종료
            </button>
          )}
          {onRemove && (
            <button
              aria-label={`${initial.name} 삭제`}
              style={{ ...ui.secondary, flex: 1, padding: '10px 12px', color: 'var(--red)' }}
              onClick={onRemove}
            >
              삭제
            </button>
          )}
        </div>
      )}
```

(g) `ProductForm` 루트 `<div style={{ ...ui.card, display: 'grid', gap: 12 }}>`에 `marginTop: 16` 추가
(상태 줄 바로 아래 붙지 않게).

- [ ] **Step 4: Green 확인**

Run: `cd miniapp && npm test && npm run build`
Expected: 전부 PASS. 특히 「카드의 식약처 메타」 describe(업소명·뱃지·SPF/PA·출처 캡션 1줄·문장 금지)가
**손대지 않고** 그대로 통과해야 한다 — 메타 줄로 옮겼을 뿐 내용이 같다. 빌드 통과.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
제품 카드를 읽는 카드로 — 버튼 셋을 폼 안으로 옮긴다 (v4-1 Task 5)

카드 전체가 버튼이고 안에 다른 버튼은 없다. 왼쪽 「n일째」 블록(시작 당일 = 1일째,
종료면 쓴 날수), 가운데 이름과 메타 한 줄, 오른쪽 셰브론. 오늘까지 쓰고 종료·삭제는
카드를 눌러 연 폼 안에 산다. D+n 표기는 사라진다.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add miniapp/src/screens/Products.tsx miniapp/src/screens/Products.test.tsx
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
```

---

### Task 6: 제목 줄의 「추가」 + 빈 상태의 큰 버튼 — 언제나 0개 또는 1개

**Files:**
- Modify: `miniapp/src/screens/Products.tsx` (제목 줄 · 「제품 추가」 버튼 · 빈 상태 블록)
- Test: `miniapp/src/screens/Products.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`describe('제품 추가', ...)` 앞에:

```tsx
describe('「제품 추가」 버튼은 늘 0개 또는 1개다', () => {
  it('제품이 있으면 제목 줄의 글자 버튼 하나다', () => {
    setup([p()]);
    const all = screen.getAllByRole('button', { name: '제품 추가' });
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toBe('추가');
  });

  it('비어 있으면 빈 상태 블록의 큰 버튼 하나다 — 첫 사용자가 놓칠 수 없어야 한다', () => {
    setup();
    const all = screen.getAllByRole('button', { name: '제품 추가' });
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toBe('제품 추가');
  });

  it('폼이 열리면 없다 — 둘을 동시에 열 수 없다', () => {
    setup([p()]);
    fireEvent.click(btn('제품 추가'));
    expect(screen.queryByRole('button', { name: '제품 추가' })).toBeNull();
  });
});
```

- [ ] **Step 2: Red 확인**

Run: `cd miniapp && npx vitest run src/screens/Products.test.tsx`
Expected: 첫 케이스 FAIL(textContent가 `제품 추가`), 둘째 PASS일 수 있음(지금도 하나), 셋째는 지금도
폼이 열리면 버튼이 사라져 PASS일 수 있다 — **첫 케이스가 빨간 것으로 족하다.**

- [ ] **Step 3: 구현**

`miniapp/src/screens/Products.tsx` 본문 JSX의 앞부분을 이렇게 바꾼다(`<h1>`부터 빈 상태 블록까지):

```tsx
    <main style={ui.page}>
      <div style={{ display: 'flex', alignItems: 'center', margin: '4px 0 20px' }}>
        <h1 style={{ ...ui.h1, margin: 0 }}>제품</h1>
        <span style={ui.spacer} />
        {/*
          추가는 글자 버튼이다(v4-1 §3-5) — 메인 페이지 맨 위를 파란 덩어리가 차지할 이유가 없다.
          목록이 비면 아래 빈 상태 블록의 큰 버튼이 대신 서고, 폼이 열리면 숨는다 — **언제나 0개
          또는 1개**다. 접근성 이름은 「제품 추가」로 고정한다(보이는 글자 「추가」를 포함한다).
        */}
        {!editing && products.length > 0 && (
          <button
            aria-label="제품 추가"
            style={{ ...ui.ghost, color: 'var(--blue)', fontWeight: 600, fontSize: 15 }}
            onClick={() => setEditing('new')}
          >
            추가
          </button>
        )}
      </div>

      <TodayStrip shot={Boolean(todayPhoto)} verdict={notes[date]} onShoot={onShoot} />

      {editing && (
        <ProductForm
          initial={editing === 'new' ? null : editing}
          today={date}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
          onEnd={editing === 'new' ? undefined : () => endToday(editing)}
          onRemove={editing === 'new' ? undefined : () => remove(editing)}
        />
      )}

      {products.length === 0 && !editing && (
        <div style={ui.empty}>
          <p style={{ margin: 0 }}>아직 등록한 제품이 없어요.</p>
          <p style={{ fontSize: 13, margin: '4px 0 0' }}>쓰고 있는 것을 등록하면 사진과 함께 기간이 남아요.</p>
          <button style={{ ...ui.primary, marginTop: 16 }} onClick={() => setEditing('new')}>
            제품 추가
          </button>
        </div>
      )}
```

(기존의 `{editing ? <ProductForm .../> : <button style={ui.primary}>제품 추가</button>}` 삼항은 사라진다.
`ui.empty`는 `textAlign: 'center'`라 큰 버튼도 가운데 선다.)

- [ ] **Step 4: Green 확인**

Run: `cd miniapp && npm test && npm run build`
Expected: 전부 PASS. `App.test`의 「제품을 더하면 저장소까지 간다」는 빈 목록에서 큰 버튼을 누르므로 그대로 통과.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
「제품 추가」를 제목 줄의 글자 버튼으로 — 빈 목록에서만 큰 버튼 (v4-1 Task 6)

메인 페이지 맨 위를 파란 덩어리가 차지할 이유가 없다. 목록이 비면 빈 상태 블록의
큰 버튼이 대신 서고, 폼이 열리면 숨는다 — 언제나 0개 또는 1개임을 테스트가 잠근다.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add miniapp/src/screens/Products.tsx miniapp/src/screens/Products.test.tsx
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
```

---

### Task 7: 전체 검증 + 운영 로그 sweep + PR

**Files:**
- Modify: `plan.md` (v4-1 절 신설 — 「v3-3 — 크라우드소싱 제품 DB」 절 **앞**에)
- Modify: `changeLog.md` (맨 위 항목)

- [ ] **Step 1: 전체 검증**

Run: `cd miniapp && npm test && npm run build`
Expected: 전부 PASS(기존 484 → 약 497). 빌드 통과. 번들 크기를 적어 둔다(PR 본문용).

Run: `cd miniapp && grep -c "D+" src/screens/Products.tsx`
Expected: `0` — 「D+」 표기가 코드에서 사라졌다. (ASCII 패턴이라 Git Bash grep으로 안전하다.)

- [ ] **Step 2: `plan.md`**

「### v3-3 — 크라우드소싱 제품 DB」 절 **앞**에 새 절:

```markdown
## v4-1 — 첫 화면을 「제품」으로 (🔜 진행 중)

> 설계 단일 출처: [첫 화면 설계](docs/2026-09-02-products-first-design.md) (2026-09-02 사용자 승인).
> 계기: 실기기 피드백 「들어가자마자 내 얼굴이 보인다」. 시안 A(오늘 한 줄) + C의 「n일째」 블록.

- [x] ✅ **1~6. 구현(TDD)** — `VERDICT_KO` 한 벌(storage) · `chevron`·`--blue-soft` · 사진 없는 오늘 상태 줄 ·
  탭 순서 제품·오늘·기록 + 시작 탭 products · 읽는 카드(「n일째」 블록, 시작 당일 = 1일째) + 종료·삭제를 폼 안으로 ·
  「추가」 글자 버튼(빈 목록에선 큰 버튼). 오늘 탭 0 변경. 어느 상태에도 `<img>`가 없음을 테스트가 잠근다
- [ ] ⬜ **7. 릴리스 + 실기기 검증** — 첫 화면이 제품 · 상태 줄 → 카메라 → 닫으면 제품 탭 복귀 · 카드 → 폼 · 폼에서
  종료/삭제 · 「오늘」 탭 사진 그대로 · `--blue-soft` 위 파랑 글자 가독성 → 검수 → sweep
```

- [ ] **Step 3: `changeLog.md`**

맨 위(머리말 인용 블록 아래)에:

```markdown
## 2026-09-02 · 첫 화면을 「제품」으로 — 얼굴은 부르기 전엔 안 보인다 (v4-1)

실기기 피드백 「들어가자마자 내 얼굴이 보인다」. 오늘 탭이 첫 화면이라 오늘 찍은 사진이 맨 위
가장 큰 표면이었다. 시안 셋(오늘 한 줄 · 대시보드 헤더 · 목록만+플로팅)을 보고 **A에 C의
「n일째」 숫자 블록을 섞기로** 했다.

- 탭 순서 제품 · 오늘 · 기록, 시작 탭 제품. **오늘 탭은 한 글자도 안 바뀐다** — 불만은
  「부르지 않았는데 보인다」이지 「보인다」가 아니다.
- 제품 탭 맨 위에 **사진 없는 오늘 상태 줄**(찍기 / 다시 찍기). 아침 알림을 받고 들어온 사람이
  한 번 눌러 촬영으로 간다. 어느 상태에도 `<img>`가 없음을 테스트가 잠근다.
- 카드는 버튼 셋을 잃고 **카드 자체가 버튼**이 됐다 — 「n일째」 블록(시작 당일 = 1일째, 종료면
  쓴 날수) + 메타 한 줄 + 셰브론. 종료·삭제는 카드를 눌러 연 폼 안으로.
- 「제품 추가」는 제목 줄의 글자 버튼. 빈 목록에서만 큰 버튼이 선다(언제나 0개 또는 1개).
- 겸사겸사 `VERDICT_KO`가 Home·History에 두 벌이던 것을 storage 한 벌로.

실기기 검증은 다음 번들에서 — 특히 `--blue-soft` 위 파랑 글자(대비 약 3.3:1)가 흐리면 `--blue-dark`로 내린다.
```

- [ ] **Step 4: 커밋 + 푸시 + PR**

```bash
cd "C:/Users/kimsa/ClodeProjects/facefit/.claude/worktrees/task-selection-d89649"
cat > .commit-msg-tmp <<'EOF'
v4-1 운영 로그 — plan·changeLog

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add plan.md changeLog.md
git commit -F .commit-msg-tmp && rm -f .commit-msg-tmp
git push -u origin feat/products-first
```

PR 본문을 UTF-8 파일(`.pr-body-tmp`, 작업 후 삭제)로 쓴다. 내용(한국어):

```markdown
## 왜
실기기 피드백 「들어가자마자 내 얼굴이 보인다」. 오늘 탭이 첫 화면이라 오늘 찍은 사진이 맨 위였다.
설계: docs/2026-09-02-products-first-design.md (시안 A + C의 「n일째」 블록 · 사용자 승인).

## 무엇을
- 탭 순서 제품 · 오늘 · 기록, 시작 탭 제품. 오늘 탭 0 변경
- 제품 탭 맨 위에 사진 없는 「오늘 상태 줄」(찍기 / 다시 찍기 · 행 전체가 버튼)
- 카드 자체가 버튼 — 「n일째」 블록(시작 당일 = 1일째 · 종료면 쓴 날수) + 메타 한 줄 + 셰브론. 종료·삭제는 폼 안으로
- 「제품 추가」는 제목 줄 글자 버튼, 빈 목록에서만 큰 버튼(언제나 0개 또는 1개)
- `VERDICT_KO` 두 벌(Home·History) → storage 한 벌 · `chevron` 아이콘 · `--blue-soft`

## 검증
- `npm test` N건 그린(기존 484 → N) · `npm run build` 통과(번들 X kB)
- 어느 상태에도 `<img>`가 없음 · 「제품 추가」 0/1개 · 카드 안 버튼 1개 · 1일째/29일째/11일 · 탭 순서를 테스트가 잠근다
- 실기기 미검증 — 다음 번들에서 §5 절차. `--blue-soft` 대비(약 3.3:1)는 실기기에서 판단

## 운영 로그
plan.md v4-1 절 · changeLog.md 항목 갱신. troubleshooting 신설 없음(1분+ 디버깅 없었음).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
gh pr create --base main --title "첫 화면을 「제품」으로 — 얼굴은 부르기 전엔 안 보인다 (v4-1)" --body-file .pr-body-tmp
rm -f .pr-body-tmp
```

**머지는 하지 않는다.** PR URL · 테스트 건수 · 번들 크기를 보고한다.

---

## 자체 점검(작성자)

- **설계 §3-1 탭** → Task 4. **§3-2 상태 줄** → Task 3(표의 세 상태 + `<img>` 부재 테스트). **§3-3 카드**
  → Task 5(블록·메타 줄·셰브론·aria-label). **§3-4 폼 줄** → Task 5(f). **§3-5 추가 버튼** → Task 6.
  **§3-6 순서** → Task 6의 JSX 순서(제목 줄 → 상태 줄 → 폼 → 빈 상태 → 섹션 → 캡션 → 백업).
  **§4-3 아이콘·변수** → Task 2. **§4-4 사전 한 벌** → Task 1. **§5 테스트** → 각 태스크 Step 1.
- 이름 일관성: `TodayStrip(shot, verdict, onShoot)` · `Card(product, date, onEdit)` · `ProductForm(onEnd?, onRemove?)` ·
  `dayBlockStyle` · `VERDICT_KO` · `--blue-soft` · `chevron` — 태스크 간 동일. `Icon` import는 Task 3(TodayStrip이 쓴다),
  Task 5(a)는 「이미 있으면 그대로」다.
