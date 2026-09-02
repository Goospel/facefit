import { useEffect, useState } from 'react';

import { Icon } from '../components/Icon';
import { formatBackupTime } from '../logic/backup';
import { daysBetween } from '../logic/calendar';
import { keepsSnapshot, searchProducts, type Suggestion } from '../logic/mfds';
import { CATEGORY_KO, isActive, sortProducts } from '../logic/products';
import { CATEGORIES, newId, VERDICT_KO, type Category, type MfdsSnapshot, type Notes, type Product, type Verdict } from '../storage';
import { ui } from '../ui';
import { usePhotos } from './usePhotos';

/**
 * 제품 탭 — 수동 CRUD.
 *
 * **지금 쓰는 것과 끝낸 것을 눈으로 가르는 것**이 이 탭에 오는 이유다. 한 줄로 섞어 놓으면
 * 「내가 지금 뭘 쓰고 있나」를 사람이 매번 날짜로 재구성해야 한다.
 *
 * **v4-1부터 이 탭이 첫 화면이다.** 맨 위 상태 줄이 「오늘 찍었나」에 사진 없이 답하고,
 * 카드는 읽는 카드(카드 자체가 버튼)다 — 수정·종료·삭제는 폼 안에 산다.
 *
 * 검색은 안 만든다 — 개인 목록은 수십 개를 넘지 않는다(설계 §5-2). 날짜는 네이티브
 * `<input type="date">`가 받는다. 달력 위젯을 손으로 만들 이유가 없다.
 */

/** 폼이 열려 있는 상태. `null`이면 닫힘, `'new'`면 추가, 제품이면 그것을 수정 중. */
type Editing = null | 'new' | Product;

export function Products({
  products,
  onChange,
  date,
  notes,
  onShoot,
  backup,
}: {
  products: Product[];
  /** 다음 목록 전체를 준다 — 저장은 App이 한다(화면은 저장소를 모른다). */
  onChange: (next: Product[]) => void;
  /** 오늘. 「사용 중」 판정과 「오늘까지 쓰고 종료」가 같은 값을 봐야 한다. */
  date: string;
  /** 오늘의 관찰 답. 상태 줄이 「찍었어요」 아래에 이 문구를 단다. */
  notes: Notes;
  /** 상태 줄의 유일한 행동 — 촬영 전체화면을 연다(닫으면 이 탭으로 돌아온다). */
  onShoot: () => void;
  /**
   * 기록 백업(v3 §3-4). **`undefined`면 표면 자체가 없다** — 쓸 수 없는 기기에 스위치만
   * 남기면 「눌렀는데 아무 일도 없다」가 된다(알림 버튼과 같은 규율). 그 판단은 App이 한다.
   */
  backup?: { enabled: boolean; lastBackupAt: string | null; onToggle: () => void };
}) {
  const [editing, setEditing] = useState<Editing>(null);

  /** 「오늘 찍었나」만 묻는다. 사진 DB 수명은 이 화면 수명에 갇힌다(App 설계 §1-4). */
  const { photos } = usePhotos();
  const todayPhoto = photos.find((p) => p.date === date);

  const sorted = sortProducts(products, date);
  const active = sorted.filter((p) => isActive(p, date));
  const ended = sorted.filter((p) => !isActive(p, date));

  function submit(draft: Product) {
    // id로 지목한다 — 인덱스로 하면 정렬된 목록과 원본 배열의 순서가 달라 엉뚱한 줄이 바뀐다.
    const exists = products.some((p) => p.id === draft.id);
    onChange(exists ? products.map((p) => (p.id === draft.id ? draft : p)) : [...products, draft]);
    setEditing(null);
  }

  function endToday(p: Product) {
    // ⚠️ **오늘까지 쓴 것으로 센다**(`isActive`가 종료일 당일을 포함한다). 어제로 넣으면
    // 오늘 찍은 사진에 그 제품이 안 붙는다.
    submit({ ...p, endDate: date });
  }

  function remove(p: Product) {
    // 되돌릴 수 없다. 잘못 등록한 것을 치우는 용도라 confirm 한 번이면 족하다.
    if (!window.confirm(`「${p.name}」을(를) 삭제할까요? 되돌릴 수 없어요.`)) return;
    onChange(products.filter((x) => x.id !== p.id));
    setEditing(null);
  }

  return (
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

      {active.length > 0 && (
        <Section title="사용 중" testId="section-active">
          {active.map((p) => (
            <Card key={p.id} product={p} date={date} onEdit={setEditing} />
          ))}
        </Section>
      )}

      {ended.length > 0 && (
        <Section title="종료" testId="section-ended">
          {ended.map((p) => (
            <Card key={p.id} product={p} date={date} onEdit={setEditing} />
          ))}
        </Section>
      )}

      {/*
        출처 캡션은 **목록에 한 줄뿐이다**(설계 §4-2) — 카드마다 반복하면 소음이고, 뱃지가
        선 카드가 하나도 없으면 아예 안 뜬다. 뱃지는 앱의 주장이 아니라 **보고 사실의 인용**이고,
        인용에는 출처가 따라야 한다(§3-4).
      */}
      {products.some((p) => p.mfds) && (
        <p data-testid="mfds-source" style={{ ...ui.sub, fontSize: 12, margin: '16px 0 0' }}>
          기능성 표시는 식약처 기능성화장품 보고정보 기준이에요
        </p>
      )}

      {backup && <BackupToggle {...backup} />}
    </main>
  );
}

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

/**
 * 기록 백업 스위치(v3 §3-4).
 *
 * **목록 뒤에 선다** — 한 번 켜면 다시 만질 일이 없는 설정이라 이 탭의 주 행동(제품 추가)
 * 위에 상주할 이유가 없다. 못 찾을 일도 없다: 첫 등록 때 1회 제안 카드가 같은 탭에서 뜬다.
 * 「오늘」 탭이 아닌 이유는 그 화면이 **오늘 찍었는가**에만 답하기 때문이고, 백업이 지키는
 * 것이 제품과 관찰이라 여기가 그 대상 옆이다.
 *
 * ⚠️ 상태는 **스위치가** 말한다(`role="switch"` + `aria-checked` + 손잡이 위치). 처음엔 버튼
 * 라벨 하나로 뒀다가, 실기기에서 「기록 백업 켜기」를 보고 **이미 켜진 줄 안** 사례가 있었다
 * (T-010) — 라벨에 행동만 적으면 상태로 읽힌다. 스위치에는 행동 문구 자체가 없다.
 *
 * 아래 줄은 그래서 상태를 되풀이하지 않고 **왜 켜는지**를 말한다. 단 하나 **켜 놓고 안 되는
 * 상태**만은 색까지 바꾼다 — 사용자는 지켜진다고 믿는데 실제로는 아무것도 안 올라간,
 * 이 기능에서 제일 위험한 상태라 회색으로 두면 정상처럼 읽힌다.
 */
function BackupToggle({
  enabled,
  lastBackupAt,
  onToggle,
}: {
  enabled: boolean;
  lastBackupAt: string | null;
  onToggle: () => void;
}) {
  const at = enabled ? formatBackupTime(lastBackupAt) : null;
  const failing = enabled && !at;

  return (
    <>
      {/* 목록과 설정 사이의 선. 없으면 마지막 제품 카드에 붙어 목록의 일부로 읽힌다. */}
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '24px 0 16px' }} />
      <button
        // 누르는 자리는 **행 전체**다 — 51px 스위치만 노리게 하면 엄지로 자주 빗나간다.
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        style={{ ...ui.card, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}
      >
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>기록 백업</span>
          <span
            data-testid="backup-state"
            style={{ display: 'block', fontSize: 13, marginTop: 2, color: failing ? 'var(--amber)' : 'var(--text-sub)' }}
          >
            {enabled
              ? at
                ? `마지막 백업 ${at}`
                : '아직 백업하지 못했어요'
              : '기기를 바꿔도 제품과 관찰이 남아요'}
          </span>
        </span>
        {/* 상태는 위의 `aria-checked`가 이미 말한다 — 여기서 또 읽히면 같은 말이 두 번 난다. */}
        <span aria-hidden style={{ ...trackStyle, background: enabled ? 'var(--blue)' : 'var(--line-strong)' }}>
          <span style={{ ...thumbStyle, transform: enabled ? 'translateX(20px)' : 'none' }} />
        </span>
      </button>
    </>
  );
}

/** iOS 스위치 치수. 토스 안에서 도는 앱이라 사용자가 이미 아는 형태를 그대로 쓴다. */
const trackStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  flexShrink: 0,
  width: 51,
  height: 31,
  padding: 2,
  borderRadius: 999,
  transition: 'background 0.2s',
};

const thumbStyle: React.CSSProperties = {
  display: 'block',
  width: 27,
  height: 27,
  borderRadius: 999,
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
  transition: 'transform 0.2s',
};

function Section({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} style={{ marginTop: 20 }}>
      <h2 style={{ ...ui.h2, fontSize: 14, color: 'var(--text-sub)' }}>{title}</h2>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>{children}</div>
    </section>
  );
}

/** `8월 1일` — 종료한 제품의 기간 표시용. 연도는 안 적는다(같은 줄이 길어지기만 한다). */
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`;

/**
 * 제품 카드(v4-1 §3-3). **카드 전체가 버튼이고 안에 다른 버튼은 없다** — 메인 페이지에
 * 카드마다 버튼 셋이 깔리면 목록이 아니라 조작판으로 읽힌다. 수정·종료·삭제는 폼 안에 산다.
 *
 * 왼쪽 숫자 블록이 카드의 얼굴이다. 사용 중이면 「n일째」(**시작 당일이 1일째** — 0일째는 말이
 * 안 된다), 종료면 쓴 날수 「n일」이 회색으로 선다. 끝난 제품의 숫자는 **자라지 않는다.**
 *
 * ⚠️ 접근성 이름은 `${name} 수정` 한 마디다 — 본문을 이어 붙이면 스크린리더가 칩까지 버튼
 * 이름으로 읽는다.
 *
 * ⚠️ 다만 `aria-label`은 이름을 **대체**한다 — 그대로 두면 스크린리더가 「토너 수정」 한 마디만
 * 듣고 며칠째인지는 못 듣는다(리뷰 2026-09-02). `aria-describedby`로 숫자 블록과 본문을
 * **설명**으로 잇는다 — 이름은 그대로라 `getByRole('button', { name })` 계측기가 안 흔들린다.
 */
function Card({ product, date, onEdit }: { product: Product; date: string; onEdit: (p: Product) => void }) {
  const using = isActive(product, date);
  const ended = product.endDate;
  const days = daysBetween(product.startDate, ended ?? date) + 1;
  // 문서 안 다른 id와 부딪히지 않게 접두어를 단다. 순서가 곧 읽히는 순서다 — 「29 일째 토너 …」.
  const bodyId = `product-${product.id}`;
  const daysId = `${bodyId}-days`;
  return (
    <button
      aria-label={`${product.name} 수정`}
      aria-describedby={`${daysId} ${bodyId}`}
      onClick={() => onEdit(product)}
      style={{ ...ui.card, padding: 12, display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}
    >
      <span
        id={daysId}
        style={{
          ...dayBlockStyle,
          background: using ? 'var(--blue-soft)' : 'var(--bg-sub)',
          borderColor: using ? 'var(--blue-soft)' : 'var(--line)',
          // ⚠️ `--blue`는 `--blue-soft` 위에서 3.3:1이라 16px/700(= 보통 글자) AA 4.5:1에 못 미친다.
          // `--blue-dark`가 4.8:1이다.
          color: using ? 'var(--blue-dark)' : 'var(--text-sub)',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>{days}</span>
        <span style={{ fontSize: 10, lineHeight: 1.1 }}>{ended ? '일' : '일째'}</span>
      </span>
      <span id={bodyId} style={{ flex: 1, minWidth: 0 }}>
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

/**
 * 등록할 때 박제한 식약처 메타(설계 §4-2·§3-4).
 *
 * ⚠️ **명사만 선다.** 뱃지는 식약처가 부여한 법정 분류의 인용이고, 앱이 「미백에 효과 있어요」
 * 같은 문장을 만드는 순간 화장품법 표시·광고 규제와 v1 §5-3 규율을 동시에 어긴다.
 * 고시 문구(「…도움을 준다.」)를 그대로 싣지 않는 이유도 같다 — 문장은 앱의 목소리로 읽힌다.
 *
 * 이미지 슬롯은 없다 — 어떤 무료 소스에도 제품 이미지가 없어(리서치 확정) 텍스트만으로
 * 서는 카드가 전제다. 뱃지·칩이 그 밀도를 채운다.
 */
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

/**
 * 추가·수정 겸용 인라인 폼. 둘을 가르는 것은 **종료일 칸과 종료·삭제 줄의 유무**다 —
 * 추가하면서 이미 끝난 제품을 넣는 일은 드물고, 아직 없는 제품을 종료·삭제할 수도 없다.
 *
 * 날짜는 오늘까지만 받는다(`min`/`max` + `ok`).
 */
function ProductForm({
  initial,
  today,
  onSubmit,
  onCancel,
  onEnd,
  onRemove,
}: {
  initial: Product | null;
  today: string;
  onSubmit: (p: Product) => void;
  onCancel: () => void;
  /** 수정일 때만. 카드에서 걷어낸 두 행동의 새 집이다(v4-1 §3-4). */
  onEnd?: () => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<Category>(initial?.category ?? 'etc');
  // 대부분 **오늘 쓰기 시작한 것**을 등록한다 — 기본값이 오늘이면 대개 손댈 일이 없다.
  const [startDate, setStartDate] = useState(initial?.startDate ?? today);
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  /**
   * 붙일 스냅샷. **명시로 고른 것만 여기 들어온다**(설계 §4-2) — 타이핑 도중 스친 제안이
   * 조용히 붙으면 사용자는 자기가 뭘 저장했는지 모른다.
   */
  const [snapshot, setSnapshot] = useState<MfdsSnapshot | undefined>(initial?.mfds);
  /**
   * 검색을 쉬어야 할 이름. **고른 직후와 수정 폼을 연 직후**가 그렇다 — 안 두면 고르자마자
   * 그 이름으로 다시 검색해 목록이 도로 열리고, 수정하러 열기만 해도 쿼터가 나간다.
   */
  const [settledName, setSettledName] = useState(initial?.name ?? null);

  useEffect(() => {
    const q = name.trim();
    // 20만 건에 한 글자는 검색이 아니다.
    if (q.length < 2 || q === settledName) return void setSuggestions([]);

    const ctrl = new AbortController();
    // ⚠️ 매 글자마다 부르면 등록 한 번에 요청이 수십 개다(2요청 전략이라 곱절이다).
    const t = setTimeout(() => {
      // ⚠️ 실패는 전부 무음이다 — 배너를 띄우는 순간 등록 흐름을 검색이 방해한다(설계 §3-2).
      searchProducts(q, ctrl.signal).then(setSuggestions, () => setSuggestions([]));
    }, 300);
    // 이전 요청을 끊지 않으면 늦게 온 응답이 새 검색 결과를 덮는다.
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [name, settledName]);

  function pick(s: Suggestion) {
    setName(s.itemName);
    setSnapshot(s.snapshot);
    // 목록은 이걸로 닫힌다 — 위 effect가 「쉬는 이름」을 보고 제안을 비운다(여기서 또 비우면
    // 어떤 입력으로도 안 밟히는 죽은 줄이 된다).
    setSettledName(s.itemName);
  }

  /**
   * 저장 가능 조건. 이름이 있고 **날짜가 오늘까지**여야 한다(v4-1 후속). 미래 시작일은 카드에
   * 「-6일째」로, 미래 종료일은 아직 안 온 날수로 섰다 — 이 앱의 기록은 「오늘까지 쓴 것」이라
   * 미래는 애초에 값이 아니다. 피커는 `min`/`max`가 막지만 데스크톱 타이핑은 여기까지 온다.
   * 빈 시작일도 막는다 — 저장소가 다시 읽을 때 `DATE_RE`로 레코드째 버려서 제품이 조용히 사라진다.
   */
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const ok =
    name.trim().length > 0 &&
    dateOk(startDate) &&
    startDate <= today &&
    (endDate === '' || (dateOk(endDate) && startDate <= endDate && endDate <= today));

  return (
    <div style={{ ...ui.card, display: 'grid', gap: 12, marginTop: 16 }}>
      <label style={{ display: 'block' }}>
        <span style={ui.label}>제품 이름</span>
        <input
          style={{ ...ui.input, textAlign: 'left' }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          /*
            예시 자체가 검색 축을 가르친다(v2-3 §3-7) — 「브랜드 제품명」으로 쳐 보라는 시범이다.
            ⚠️ 「브랜드로 검색돼요」류 약속 문장은 안 쓴다 — 브랜드명≠법인명인 하우스 브랜드
            (설화수→(주)아모레퍼시픽)는 여전히 0건일 수 있어 약속하면 거짓이 되는 케이스가 실재한다.
          */
          placeholder="예: 토리든 다이브인 세럼"
        />
      </label>

      {suggestions.length > 0 && (
        /* 카드 안 인라인이다 — 포털·팝오버를 만들 이유가 없다(설계 §4-2). */
        <div data-testid="mfds-suggestions" style={{ display: 'grid', gap: 4, marginTop: -6 }}>
          {suggestions.map((s, i) => (
            <button
              key={`${s.snapshot.reportSeq}-${i}`}
              style={{ ...ui.secondary, textAlign: 'left', padding: '10px 12px' }}
              onClick={() => pick(s)}
            >
              <span style={{ display: 'block', fontSize: 14, color: 'var(--text)' }}>{s.itemName}</span>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 500 }}>{s.snapshot.entpName}</span>
            </button>
          ))}
        </div>
      )}

      <label style={{ display: 'block' }}>
        <span style={ui.label}>카테고리</span>
        <select style={{ ...ui.input, textAlign: 'left' }} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_KO[c]}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block' }}>
        <span style={ui.label}>시작일</span>
        <input
          type="date"
          max={today}
          style={{ ...ui.input, textAlign: 'left' }}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </label>

      {initial && (
        <label style={{ display: 'block' }}>
          <span style={ui.label}>종료일</span>
          <input
            type="date"
            min={startDate}
            max={today}
            style={{ ...ui.input, textAlign: 'left' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      )}

      <div style={ui.row}>
        <button style={{ ...ui.secondary, flex: 1 }} onClick={onCancel}>
          취소
        </button>
        <button
          style={{ ...ui.primary, flex: 1, ...(ok ? null : ui.disabled) }}
          disabled={!ok}
          onClick={() =>
            onSubmit({
              ...(initial ?? {}),
              id: initial?.id ?? newId(),
              name: name.trim(),
              category,
              startDate,
              /*
                빈 칸은 **「사용 중」이지 빈 문자열이 아니다** — 빈 문자열로 넘기면 저장소의
                날짜 검증에 걸려 조용히 떨어진다.

                ⚠️ **`undefined`를 명시로 넣는다.** 조건부 스프레드(`...(endDate ? {endDate} : {})`)
                로 두면 위의 `...initial`이 남긴 옛 종료일을 **못 덮어써서**, 종료일을 지우고
                저장해도 아무 일이 안 일어난다 — 종료를 실수로 눌렀을 때 되돌릴 방법이 앱 안에
                없어진다(제품을 지우고 다시 넣으면 새 id라 기간 기록이 끊긴다).
                `undefined`는 `JSON.stringify`가 떨구므로 저장소 왕복도 깨끗하다.
              */
              endDate: endDate || undefined,
              /*
                고른 적이 없으면 `undefined`다 — 수기 등록 그대로다(위 `endDate`와 같은 이유로 명시한다).

                ⚠️ **유지는 조건부다**(설계 §3-2): 줄여 쓰기는 살고 갈아치우기는 죽는다.
                무조건 유지하면 남의 업소명·기능성 뱃지가 다른 제품 카드에 조용히 선다.
                추가·수정 폼이 같은 저장 지점을 지나므로 판정도 여기 한 곳이면 된다.
              */
              mfds: snapshot && keepsSnapshot(name.trim(), snapshot) ? snapshot : undefined,
            })
          }
        >
          저장
        </button>
      </div>

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
    </div>
  );
}
