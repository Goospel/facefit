import { useEffect, useMemo, useState } from 'react';

import { barSegments, dateFrac, frameDelay } from '../logic/timelapse';
import type { Product, Usage } from '../storage';
import { ui } from '../ui';
import { LOCAL_ONLY, useObjectUrls, usePhotos } from './usePhotos';

/**
 * 타임랩스 — 저장된 사진을 순서대로 넘긴다.
 *
 * 프레임은 **저장된 사진 그 자체**라 빠진 날은 자연히 건너뛴다(빈 날을 검게 채우면 재생이
 * 자꾸 끊긴다). 루프는 없다 — 끝에서 멈춰야 「언제부터 언제까지 봤나」가 남는다.
 *
 * 아래 **제품 구간 바**가 이 화면의 요점이다. 이 앱이 답하려는 질문은 「얼굴이 달라졌나」가
 * 아니라 「**무엇을 쓰는 동안** 달라졌나」라, 사진만 흐르면 절반만 보여 주는 셈이다.
 */

/** 막대 한 줄의 높이 + 줄 간격(px). 겹치는 제품이 늘면 바가 이만큼씩 세로로 자란다. */
const LANE_H = 18;

export function Timelapse({
  products,
  usage,
  onClose,
}: {
  products: Product[];
  /** 사용 로그(v4-2 §4-6). 프레임 배지가 「이 사진 전에 쓴 것」을 여기서 읽는다. */
  usage: Usage;
  onClose: () => void;
}) {
  // ⚠️ `idb` 주입 구멍을 안 둔다 — 이 화면의 테스트는 `openPhotoDb`를 통째로 목으로
  // 돌린다(T-003: 가짜 타이머가 fake-indexeddb의 이벤트 루프를 붙잡는다).
  const { photos } = usePhotos();
  const [index, setIndex] = useState(0);
  /** 진입하자마자 돈다 — 「재생」을 한 번 더 누르게 하는 화면이 아니다. */
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2>(1);

  // ⚠️ `photos`가 새 배열이면 URL을 다시 만든다. `useMemo`로 blob 배열을 고정해 두지 않으면
  // 매 렌더마다 만들고 놓아주기를 반복한다.
  const blobs = useMemo(() => photos.map((p) => p.blob), [photos]);
  const urls = useObjectUrls(blobs);

  const last = photos.length - 1;

  /**
   * 전진. **`index`가 deps에 있어서 한 장에 타이머 하나**다 — 화면을 닫거나 멈추거나 속도를
   * 바꾸면 cleanup이 그 하나를 끊는다. `setInterval`로 두면 속도를 바꿀 때 옛 주기가 남는다.
   */
  useEffect(() => {
    if (!playing || index >= last) return;
    const t = setTimeout(() => setIndex((i) => i + 1), frameDelay(speed));
    return () => clearTimeout(t);
  }, [playing, index, speed, last]);

  if (photos.length < 2) {
    return (
      <main style={{ ...ui.pageFull, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        <p style={ui.h2}>사진이 2장 모이면 재생할 수 있어요.</p>
        <p style={ui.sub}>매일 같은 구도로 한 장씩 쌓이면 그때부터 변화가 보여요.</p>
        <button style={ui.ghost} onClick={onClose}>
          닫기
        </button>
      </main>
    );
  }

  const current = photos[Math.min(index, last)];
  const first = photos[0].date;
  const lastDate = photos[last].date;
  const segments = barSegments(products, first, lastDate);

  /**
   * 이 사진 직전에 쓴 것(§4-6). **3상을 셋 다 다르게 적는다** — 썼다 / 「쓴 것 없음」 /
   * 아무 말도 안 함. 안 쓴 날과 안 물어본 날이 같은 글자로 뜨면, 안 쓴 날의 사진이 대조군
   * 노릇을 못 한다(그 대조가 이 기능의 존재 이유다 — §0).
   *
   * 지운 제품의 id는 이름을 못 찾아 빠진다 — 전부 빠지면 「쓴 것 없음」으로 읽히는데,
   * 그 사진 전에 쓴 제품이 **이제 목록에 없다**는 뜻이라 받아들인다(§4-9).
   */
  const usedIds = usage[current.date];
  const usedNames = usedIds?.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean) ?? [];
  const usedTag = usedIds === undefined ? '' : usedNames.length ? ` · ${usedNames.join(', ')}` : ' · 쓴 것 없음';
  const lanes = segments.length === 0 ? 0 : Math.max(...segments.map((s) => s.lane)) + 1;

  /**
   * 끝에 닿았다. **state가 아니라 파생값이다** — 「끝나면 `playing`을 끈다」를 effect로 두면
   * 사진이 아직 안 온 첫 렌더(`last`가 −1)에서 그 effect가 먼저 돌아 **재생이 시작도 못 하고
   * 죽는다.** 실제로 그렇게 짰다가 테스트에 걸렸다.
   */
  const ended = index >= last;

  function toggle() {
    // 끝에 서 있는데 그냥 `playing`만 켜면 **아무 일도 안 일어난다** — 처음으로 되감는다.
    if (ended) {
      setIndex(0);
      return setPlaying(true);
    }
    setPlaying((v) => !v);
  }

  return (
    <main style={{ ...ui.pageFull, background: '#000', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>타임랩스</span>
        <span style={ui.spacer} />
        <button style={{ ...ui.ghost, color: '#fff' }} onClick={onClose}>
          닫기
        </button>
      </div>

      {/* 화면 아무 데나 눌러 멈춘다 — 작은 버튼을 겨냥하게 하면 그 사이에 프레임이 지나간다. */}
      <div data-stage style={stageStyle} onClick={toggle}>
        {urls[Math.min(index, last)] && (
          <img src={urls[Math.min(index, last)]} alt={`${current.date} 얼굴 사진`} style={fillStyle} />
        )}
        <span style={dateBadge}>
          {`${Number(current.date.slice(5, 7))}월 ${Number(current.date.slice(8))}일${usedTag}`}
        </span>
      </div>

      <div style={{ ...ui.row, alignItems: 'center', marginTop: 12 }}>
        <button style={{ ...ui.secondary, width: 'auto', padding: '9px 16px' }} onClick={toggle}>
          {playing && !ended ? '일시정지' : '재생'}
        </button>
        <input
          type="range"
          aria-label="프레임"
          min={0}
          max={last}
          value={Math.min(index, last)}
          // 손으로 잡은 프레임이 곧바로 흘러가면 볼 수가 없다 — 끌면 멈춘다.
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          style={{ flex: 1 }}
        />
        <button
          style={{ ...ui.secondary, width: 'auto', padding: '9px 14px', ...(speed === 2 ? activeChip : null) }}
          onClick={() => setSpeed(speed === 1 ? 2 : 1)}
        >
          2×
        </button>
      </div>

      {/*
        제품 구간 바. 전체 폭이 [첫 사진, 마지막 사진]이고, 막대 하나가 제품 하나다.
        제품이 없으면 **바 자체가 없다** — 빈 띠가 자리만 먹는다.
      */}
      {segments.length > 0 && (
        <div data-testid="segment-bar" style={{ position: 'relative', height: lanes * LANE_H + 4, marginTop: 10 }}>
          {segments.map((s) => (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                top: s.lane * LANE_H,
                left: `${s.startFrac * 100}%`,
                width: `${Math.max(s.endFrac - s.startFrac, 0) * 100}%`,
                height: LANE_H - 4,
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 6,
                // 폭이 좁은 막대에서 이름이 잘려도 막대 자체는 남는다 — 자리는 보여야 한다.
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                fontSize: 11,
                color: '#fff',
                background: 'var(--blue)',
                borderRadius: 4,
              }}
            >
              {s.name}
            </div>
          ))}
          {/* 지금 보는 프레임이 그 구간의 어디쯤인지. 이 선이 없으면 막대와 사진이 따로 논다. */}
          <div
            data-testid="playhead"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${dateFrac(current.date, first, lastDate) * 100}%`,
              width: 2,
              background: '#fff',
            }}
          />
        </div>
      )}

      <p style={{ ...ui.sub, color: '#8b95a1', textAlign: 'center', margin: '12px 0 0' }}>{LOCAL_ONLY}</p>
    </main>
  );
}

const stageStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  marginTop: 12,
  borderRadius: 14,
  overflow: 'hidden',
  background: '#111',
};

const fillStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const dateBadge: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 12,
  padding: '4px 10px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.5)',
  borderRadius: 999,
};

const activeChip: React.CSSProperties = { color: '#fff', background: 'var(--blue)', borderColor: 'var(--blue)' };
