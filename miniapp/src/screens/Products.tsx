import { useEffect, useState } from 'react';

import { daysBetween } from '../logic/calendar';
import { keepsSnapshot, searchProducts, type Suggestion } from '../logic/mfds';
import { CATEGORY_KO, isActive, sortProducts } from '../logic/products';
import { CATEGORIES, newId, type Category, type MfdsSnapshot, type Product } from '../storage';
import { ui } from '../ui';

/**
 * 제품 탭 — 수동 CRUD.
 *
 * **지금 쓰는 것과 끝낸 것을 눈으로 가르는 것**이 이 탭에 오는 이유다. 한 줄로 섞어 놓으면
 * 「내가 지금 뭘 쓰고 있나」를 사람이 매번 날짜로 재구성해야 한다.
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
  onShootProduct,
}: {
  products: Product[];
  /** 다음 목록 전체를 준다 — 저장은 App이 한다(화면은 저장소를 모른다). */
  onChange: (next: Product[]) => void;
  /** 오늘. 「사용 중」 판정과 「오늘까지 쓰고 종료」가 같은 값을 봐야 한다. */
  date: string;
  /** 임시 확인용 제품 촬영 화면을 연다. 없으면 버튼 자체가 안 선다(테스트가 안 걸린다). */
  onShootProduct?: () => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);

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
      <h1 style={ui.h1}>제품</h1>

      {editing ? (
        <ProductForm
          initial={editing === 'new' ? null : editing}
          today={date}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button style={ui.primary} onClick={() => setEditing('new')}>
          제품 추가
        </button>
      )}

      {/* 임시 — 웹뷰에서 사진 속 글자를 꾸욱 눌러 복사할 수 있는지 재는 버튼. 재고 나면 걷는다. */}
      {!editing && onShootProduct && (
        <button style={{ ...ui.secondary, marginTop: 8 }} onClick={onShootProduct}>
          제품 사진 찍기 (테스트)
        </button>
      )}

      {products.length === 0 && !editing && (
        <div style={ui.empty}>
          <p style={{ margin: 0 }}>아직 등록한 제품이 없어요.</p>
          <p style={{ fontSize: 13, margin: '4px 0 0' }}>쓰고 있는 것을 등록하면 사진과 함께 기간이 남아요.</p>
        </div>
      )}

      {active.length > 0 && (
        <Section title="사용 중" testId="section-active">
          {active.map((p) => (
            <Row key={p.id} product={p} date={date} onEdit={setEditing} onEnd={endToday} onRemove={remove} />
          ))}
        </Section>
      )}

      {ended.length > 0 && (
        <Section title="종료" testId="section-ended">
          {ended.map((p) => (
            <Row key={p.id} product={p} date={date} onEdit={setEditing} onEnd={endToday} onRemove={remove} />
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
    </main>
  );
}

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

function Row({
  product,
  date,
  onEdit,
  onEnd,
  onRemove,
}: {
  product: Product;
  date: string;
  onEdit: (p: Product) => void;
  onEnd: (p: Product) => void;
  onRemove: (p: Product) => void;
}) {
  const using = isActive(product, date);
  return (
    <div style={{ ...ui.card, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 15 }}>{product.name}</b>
        <span style={ui.chip}>{CATEGORY_KO[product.category]}</span>
        <span style={ui.spacer} />
        <span style={{ fontSize: 12, color: 'var(--text-sub)', fontVariantNumeric: 'tabular-nums' }}>
          {/* 끝난 제품에 D+n을 계속 붙이면 안 쓰는 제품의 숫자가 매일 자란다. */}
          {product.endDate ? `${md(product.startDate)} ~ ${md(product.endDate)}` : `D+${daysBetween(product.startDate, date)}`}
        </span>
      </div>
      {product.mfds && <MfdsMeta m={product.mfds} />}
      <div style={{ ...ui.row, marginTop: 8 }}>
        <button style={{ ...ui.secondary, flex: 1, padding: '8px 10px' }} onClick={() => onEdit(product)}>
          {`${product.name} 수정`}
        </button>
        {using && (
          <button style={{ ...ui.secondary, flex: 1, padding: '8px 10px' }} onClick={() => onEnd(product)}>
            {`${product.name} 종료`}
          </button>
        )}
        <button
          style={{ ...ui.secondary, flex: 1, padding: '8px 10px', color: 'var(--red)' }}
          onClick={() => onRemove(product)}
        >
          {`${product.name} 삭제`}
        </button>
      </div>
    </div>
  );
}

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {m.entpName && <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{m.entpName}</span>}
      {m.effects.map((e) => (
        <span key={e} style={ui.chip}>
          {e}
        </span>
      ))}
      {uv && <span style={ui.chip}>{uv}</span>}
    </div>
  );
}

/**
 * 추가·수정 겸용 인라인 폼. 둘을 가르는 것은 **종료일 칸의 유무**뿐이다 —
 * 추가하면서 이미 끝난 제품을 넣는 일은 드물어서 그때는 칸을 안 연다.
 */
function ProductForm({
  initial,
  today,
  onSubmit,
  onCancel,
}: {
  initial: Product | null;
  today: string;
  onSubmit: (p: Product) => void;
  onCancel: () => void;
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

  const ok = name.trim().length > 0;

  return (
    <div style={{ ...ui.card, display: 'grid', gap: 12 }}>
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
        <input type="date" style={{ ...ui.input, textAlign: 'left' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>

      {initial && (
        <label style={{ display: 'block' }}>
          <span style={ui.label}>종료일</span>
          <input type="date" style={{ ...ui.input, textAlign: 'left' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
    </div>
  );
}
