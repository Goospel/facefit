import { useMemo, useState } from 'react';

import { addMonth, formatYm, monthCells, monthOf, type Ym } from '../logic/calendar';
import { clearPhotos, deletePhoto, type FacePhoto, type PhotoDb } from '../photoStore';
import { todayKey, VERDICT_KO, type Notes, type Verdict } from '../storage';
import { ui } from '../ui';
import { LOCAL_ONLY, useObjectUrl, usePhotos } from './usePhotos';

/**
 * 기록 탭 — **월간 캘린더**.
 *
 * 리스트가 아니라 달력이 주인이다. 리스트는 「언제 찍었나」를 스크롤로 재구성하게 만드는데,
 * 사람이 기록에서 실제로 찾는 것은 **빈 칸**(며칠 걸렀나)이라 달력이 그걸 한눈에 답한다.
 * 내용은 날짜를 눌렀을 때 뜨는 바텀시트가 담당한다.
 *
 * ⚠️ 사진·기록은 이 기기에만 있다 — **기기를 바꾸면 날아간다.** 클라우드 백업은 의도적
 * 보류(설계 §7)라 숨기지 않고 화면에 적어 둔다.
 */

/** 일요일 시작 — 국내 달력 관례다. `monthCells`의 앞 빈칸도 같은 기준으로 센다. */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function History({
  notes,
  onOpenTimelapse,
  idb,
}: {
  notes: Notes;
  onOpenTimelapse: () => void;
  /** 테스트가 fake-indexeddb를 넣는 자리. 없으면 `globalThis.indexedDB`. */
  idb?: IDBFactory;
}) {
  /** 상태는 둘뿐이다 — 보는 달, 열린 날. 셋째가 생기면 셋의 조합을 화면이 정해야 한다. */
  const [ym, setYm] = useState<Ym>(() => monthOf(todayKey()));
  const [selected, setSelected] = useState<string | null>(null);
  const { db, photos, reload } = usePhotos(idb);

  // 날짜 키가 전부 `YYYY-MM-DD`라 셀 ↔ 사진 ↔ 관찰 대조가 문자열 비교 하나로 끝난다.
  const photoByDate = useMemo(() => new Map(photos.map((p) => [p.date, p])), [photos]);
  const cells = useMemo(() => monthCells(ym), [ym]);
  const today = todayKey();

  const shotDays = cells.filter((c) => c !== null && photoByDate.has(c)).length;

  /**
   * 지우고 **다시 읽는다.** 로컬 배열에서 한 장 빼는 것으로 대신하면, 삭제가 조용히
   * 실패해도 화면은 지워진 것처럼 보인다 — 사용자는 지워졌다고 믿고, 사진은 남는다.
   */
  async function removeOne(open: PhotoDb, date: string) {
    if (!window.confirm('이 사진을 삭제할까요? 되돌릴 수 없어요.')) return;
    await deletePhoto(open, date);
    // 방금 사라진 사진의 자리를 시트가 빈 채로 들고 있지 않게 먼저 닫는다.
    setSelected(null);
    await reload(open);
  }

  async function removeAll(open: PhotoDb) {
    if (!window.confirm('사진을 모두 삭제할까요? 되돌릴 수 없어요.')) return;
    await clearPhotos(open);
    setSelected(null);
    await reload(open);
  }

  return (
    <main style={ui.page}>
      <h1 style={ui.h1}>기록</h1>

      <div style={ui.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <button style={arrow} aria-label="지난달" onClick={() => setYm((v) => addMonth(v, -1))}>
            ‹
          </button>
          {/* 기록 이전 달도 막지 않는다 — 빈 달력을 보는 것도 답이다(「그때는 안 했구나」). */}
          <b style={{ fontSize: 16, minWidth: 108, textAlign: 'center' }}>{formatYm(ym)}</b>
          <button style={arrow} aria-label="다음달" onClick={() => setYm((v) => addMonth(v, 1))}>
            ›
          </button>
        </div>

        <div style={grid}>
          {WEEKDAYS.map((w) => (
            <div key={w} style={{ fontSize: 11, color: 'var(--text-weak)', textAlign: 'center' }}>
              {w}
            </div>
          ))}
        </div>

        <div style={{ ...grid, marginTop: 4 }}>
          {cells.map((c, i) => {
            if (c === null) return <div key={`pad-${i}`} style={cellStyle(false)} />;

            const pic = photoByDate.get(c);
            const note = notes[c];
            const body = (
              <>
                <span>{Number(c.slice(8))}</span>
                <span style={{ display: 'flex', gap: 3, height: 5, marginTop: 3 }}>
                  {/* 순서 고정 — 자리가 바뀌면 색만으로 다시 읽어야 한다. */}
                  {pic && <span data-mark="photo" style={dot('var(--green)')} />}
                  {note && <span data-mark="note" style={dot('var(--amber)')} />}
                </span>
              </>
            );

            /*
              내용이 없는 날은 **버튼이 아니다.** 눌러도 아무 일 없는 버튼을 만드는 대신
              처음부터 누를 수 없게 둔다. ⚠️ 조건이 사진**과** 관찰 둘 다인 이유: 관찰은
              사진과 독립 저장이라, 사진만 지운 날에도 답이 남는다 — 그 날을 못 열게 하면
              남아 있는 기록에 닿을 길이 없어진다.
            */
            if (!pic && !note) {
              return (
                <div key={c} data-day={c} style={cellStyle(c === today)}>
                  {body}
                </div>
              );
            }
            return (
              <button
                key={c}
                data-day={c}
                // 점 두 개는 화면 낭독기에 아무것도 아니다 — 이름으로 다시 말한다.
                aria-label={`${ym.month}월 ${Number(c.slice(8))}일${pic ? ', 사진' : ''}${note ? ', 관찰 기록' : ''}`}
                style={{ ...cellStyle(c === today), background: 'none' }}
                onClick={() => setSelected(c)}
              >
                {body}
              </button>
            );
          })}
        </div>

        {/* 색 둘에만 기대면 색각 이상인 사람에게는 아무 표시도 없는 것과 같다. */}
        <div style={legend}>
          <span style={legendItem}>
            <span style={dot('var(--green)')} />
            <span>사진</span>
          </span>
          <span style={legendItem}>
            <span style={dot('var(--amber)')} />
            <span>관찰 기록</span>
          </span>
        </div>
      </div>

      <p style={{ ...ui.sub, margin: '12px 0 0', textAlign: 'center' }}>{`${ym.month}월 · ${shotDays}일 찍음`}</p>

      <TimelapseRow photos={photos} onOpen={onOpenTimelapse} />

      <p style={{ ...ui.sub, marginTop: 24, marginBottom: 8 }}>{LOCAL_ONLY}</p>

      {/*
        ⚠️ **프라이버시 기능이라 v1에서 뺄 수 없다**(설계 §1-6). restfit에서는 비교 화면에
        있던 것을 여기로 옮겨 왔다 — 얼굴 사진을 한 번에 지울 방법이 앱 안에 없으면
        「앱을 지우세요」밖에 답할 말이 없다.
      */}
      {db && photos.length > 0 && (
        <button style={{ ...ui.ghost, color: 'var(--red)' }} onClick={() => void removeAll(db)}>
          사진 모두 삭제
        </button>
      )}

      {selected && (
        <DayCard
          date={selected}
          photo={photoByDate.get(selected)}
          verdict={notes[selected]}
          onDelete={db ? () => void removeOne(db, selected) : undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

/**
 * 하루치 바텀시트 — 딤 + 시트.
 *
 * 시트는 화면 **밑변부터** 덮는다(`position: fixed`) — 탭바 위에 얹는 게 아니라 가린다.
 * 딤이 탭바까지 덮으므로 탭을 누르면 **먼저 시트가 닫힌다**(모달 관례). 탭바는 restfit에서
 * 두 번 반려된 표면이라 z-index로 뚫는 대신 이 동작을 스펙으로 받는다.
 */
function DayCard({
  date,
  photo,
  verdict,
  onDelete,
  onClose,
}: {
  date: string;
  photo: FacePhoto | undefined;
  verdict: Verdict | undefined;
  onDelete: (() => void) | undefined;
  onClose: () => void;
}) {
  const { month } = monthOf(date);
  const day = Number(date.slice(8));
  // 요일은 `Date`로 읽되 **UTC로 통일**한다 — 로컬 메서드를 섞으면 자정 근처에서 하루가 밀린다.
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

  return (
    <>
      <div data-dim style={dim} onClick={onClose} />
      <div data-sheet style={sheet}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 16 }}>{`${month}월 ${day}일 ${weekday}요일`}</b>
          <span style={ui.spacer} />
          <button style={{ ...ui.ghost, fontSize: 18, padding: '4px 8px' }} aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>

        {photo && <DayPhoto date={date} blob={photo.blob} />}

        {/* 답이 없으면 **줄 자체가 없다.** 「없음」을 적으면 안 한 것이 실패처럼 보인다. */}
        {/* 색점만으로는 색각 이상인 사람에게 아무 표시도 없는 것과 같다 — 시트에서는 반드시 글자로 다시 말한다. */}
        {verdict && (
          <p data-testid="sheet-note" style={{ ...ui.sub, margin: '12px 0 0' }}>
            {VERDICT_KO[verdict]}
          </p>
        )}

        {photo && onDelete && (
          <button style={{ ...ui.secondary, color: 'var(--red)', marginTop: 12 }} onClick={onDelete}>
            이 사진 삭제
          </button>
        )}
      </div>
    </>
  );
}

/** 시트 안의 사진. blob URL은 **만든 곳이 revoke까지 책임진다**(`useObjectUrl`). */
function DayPhoto({ date, blob }: { date: string; blob: Blob }) {
  const url = useObjectUrl(blob);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={`${date} 얼굴 사진`}
      style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 10, marginTop: 12, background: 'var(--bg-sub)' }}
    />
  );
}

/**
 * 타임랩스로 가는 **유일한 문**.
 *
 * 사진이 0장이면 로우 자체가 없다 — 빈 화면으로 보내는 버튼을 만들지 않는다.
 * 1장이면 왜 아직인지 말한다 — 「재생」을 눌렀더니 정지 화면 하나가 뜨는 것보다 낫다.
 */
function TimelapseRow({ photos, onOpen }: { photos: FacePhoto[]; onOpen: () => void }) {
  // 거는 얼굴은 **최신**이다. 기준(가장 오래된 것)을 걸면 몇 달 전 얼굴이 계속 걸려 있다.
  const latest = photos[photos.length - 1];
  const thumbUrl = useObjectUrl(latest?.blob);
  if (!latest) return null;

  if (photos.length < 2) {
    return <p style={{ ...ui.sub, margin: '16px 0 0', textAlign: 'center' }}>사진이 2장 모이면 재생할 수 있어요.</p>;
  }

  const [, m, d] = latest.date.split('-');

  return (
    <div style={{ ...ui.card, display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, padding: 12 }}>
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt="최근 얼굴 사진"
          style={{ width: 40, height: 52, objectFit: 'cover', borderRadius: 8, background: 'var(--bg-sub)' }}
        />
      ) : null}
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-sub)' }}>
        {`사진 ${photos.length}장 · 최근 ${Number(m)}/${Number(d)}`}
      </span>
      <button style={{ ...ui.secondary, width: 'auto', padding: '9px 16px' }} onClick={onOpen}>
        재생
      </button>
    </div>
  );
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginTop: 12 };

const legend: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  justifyContent: 'center',
  marginTop: 12,
  fontSize: 12,
  color: 'var(--text-sub)',
};

const legendItem: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5 };

const arrow: React.CSSProperties = {
  padding: '4px 14px',
  fontSize: 20,
  color: 'var(--text-sub)',
  background: 'none',
  border: 0,
  borderRadius: 8,
};

/**
 * 달력 한 칸. 오늘만 테두리를 두른다.
 *
 * ⚠️ 테두리는 **shorthand를 통째로 갈아 끼운다**(`ui.ts` 머리말) — 기본 스타일에 `border`를
 * 두고 `borderColor`만 덮으면 React가 리렌더에서 그 값을 지워, 첫 렌더에만 색이 보인다.
 */
const cellStyle = (isToday: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 40,
  padding: 0,
  fontSize: 13,
  color: 'var(--text)',
  border: isToday ? '2px solid var(--blue)' : '1px solid transparent',
  borderRadius: 10,
});

const dot = (color: string): React.CSSProperties => ({
  width: 5,
  height: 5,
  borderRadius: 999,
  backgroundColor: color,
});

const dim: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  zIndex: 40,
};

const sheet: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 41,
  maxHeight: '72vh',
  overflowY: 'auto',
  padding: '16px 20px calc(var(--safe-b) + 20px)',
  background: 'var(--bg)',
  borderRadius: '16px 16px 0 0',
  boxShadow: '0 -6px 24px rgba(0, 0, 0, 0.16)',
};
