import { useState } from 'react';

import { daysBetween } from '../logic/calendar';
import { CATEGORY_KO, isActive, sortProducts } from '../logic/products';
import { CATEGORIES, newId, type Category, type Product } from '../storage';
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
}: {
  products: Product[];
  /** 다음 목록 전체를 준다 — 저장은 App이 한다(화면은 저장소를 모른다). */
  onChange: (next: Product[]) => void;
  /** 오늘. 「사용 중」 판정과 「오늘까지 쓰고 종료」가 같은 값을 봐야 한다. */
  date: string;
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

  const ok = name.trim().length > 0;

  return (
    <div style={{ ...ui.card, display: 'grid', gap: 12 }}>
      <label style={{ display: 'block' }}>
        <span style={ui.label}>제품 이름</span>
        <input
          style={{ ...ui.input, textAlign: 'left' }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 세라마이드 토너"
        />
      </label>

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
              // 빈 칸은 **「사용 중」이지 빈 문자열이 아니다** — 저장소의 날짜 검증에 걸려
              // 조용히 떨어지는 대신 필드 자체를 뺀다.
              ...(endDate ? { endDate } : {}),
            })
          }
        >
          저장
        </button>
      </div>
    </div>
  );
}
