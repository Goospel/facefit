import { useState } from 'react';

import { Icon, type IconName } from './components/Icon';
import { FacePhoto } from './screens/FacePhoto';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Products } from './screens/Products';
import { Timelapse } from './screens/Timelapse';
import {
  isOnboarded,
  loadNotes,
  loadProducts,
  saveNote,
  saveOnboarded,
  saveProducts,
  todayKey,
  type Product,
  type Verdict,
} from './storage';

/**
 * 배선. **라우터도 컨텍스트도 안 들인다** — 값 하나(`tab`)와 값 하나(`view`)가
 * 「지금 무슨 화면인가」를 다 말한다(설계 §1-4·§5-6).
 *
 * 사진은 각 화면이 `usePhotos`로 직접 연다 — DB 수명을 **화면 수명에 가둔다.**
 * 반대로 제품·관찰은 App이 들고 저장 함수와 함께 내려보낸다(탭을 넘나들어도 같은 값이어야 한다).
 */

type Tab = 'home' | 'products' | 'history';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: '오늘', icon: 'face' },
  { key: 'products', label: '제품', icon: 'bottle' },
  { key: 'history', label: '기록', icon: 'calendar' },
];

export function App() {
  const [onboarded, setOnboarded] = useState(isOnboarded);
  const [tab, setTab] = useState<Tab>('home');
  /**
   * 전체화면. **값 하나가 「촬영이냐 타임랩스냐 아니냐」를 다 말한다** — boolean 둘로 두면
   * 둘 다 켜진 상태가 생기고, 그때 무엇을 그릴지 화면이 정해야 한다.
   *
   * 닫으면 `null`로 돌아갈 뿐이라 **보던 탭이 그대로 복원된다**(`tab`을 안 건드린다).
   */
  const [view, setView] = useState<'shoot' | 'timelapse' | null>(null);
  const [products, setProducts] = useState(loadProducts);
  const [notes, setNotes] = useState(loadNotes);

  const date = todayKey();

  /** 화면 state와 저장소를 **한 함수에서** 바꾼다 — 갈라 두면 한쪽만 부르는 자리가 생긴다. */
  function saveProductsAnd(next: Product[]) {
    setProducts(next);
    saveProducts(next);
  }

  function saveNoteAnd(day: string, verdict: Verdict) {
    setNotes(saveNote(day, verdict));
  }

  // 온보딩이 가장 앞이다. **권한 고지를 못 본 채로 카메라를 여는 경로가 없어야 한다.**
  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          saveOnboarded();
          setOnboarded(true);
        }}
      />
    );
  }

  // 전체화면에서는 탭바가 없다 — 카메라를 켜 놓고 딴 화면으로 샐 이유가 없다.
  if (view === 'shoot') return <FacePhoto onClose={() => setView(null)} onNote={saveNoteAnd} />;
  if (view === 'timelapse') return <Timelapse products={products} onClose={() => setView(null)} />;

  return (
    <>
      {tab === 'home' && <Home products={products} notes={notes} date={date} onShoot={() => setView('shoot')} />}
      {tab === 'products' && <Products products={products} onChange={saveProductsAnd} date={date} />}
      {tab === 'history' && <History notes={notes} onOpenTimelapse={() => setView('timelapse')} />}

      <nav style={navStyle}>
        {TABS.map((t) => (
          <button
            key={t.key}
            style={{ ...tabStyle, color: tab === t.key ? 'var(--blue)' : 'var(--text-weak)' }}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            <Icon name={t.icon} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

/**
 * **떠 있는 캡슐이어야 한다** — 토스 브랜딩 가이드가 지정한 형태이고, restfit이 밑변에 꽉
 * 붙은 형태로 냈다가 **두 번** 반려됐다(T-224).
 *
 * 밑변에 붙고 윗선이 있으면 토스 앱 자체의 하단 탭과 형태가 겹쳐, 사용자가 지금 토스에
 * 있는지 미니앱에 있는지 헷갈린다. 그래서 좌우를 띄우고(`--tab-side`) 밑에서도 띄우고
 * (`--tab-lift`) 완전한 pill(`borderRadius: 999`)로 만든다.
 *
 * ⚠️ safe-area에 더하는 것만으로는 부족하다 — 웹뷰가 `safe-area-inset-bottom`을 0으로 주면
 * 그 값이 그대로 띄운 거리가 되어 여전히 「붙은 바」로 읽힌다. `index.css`의 `--tab-lift`가
 * `max()`로 바닥값을 보장한다. **수치를 손대지 않는다.**
 */
const navStyle: React.CSSProperties = {
  position: 'fixed',
  left: 'var(--tab-side)',
  right: 'var(--tab-side)',
  bottom: 'var(--tab-lift)',
  display: 'flex',
  height: 'var(--tab-h)',
  background: 'var(--bg)',
  borderRadius: 999,
  // 좌우가 트여 컨텐츠가 옆으로 지나가므로, 그림자가 없으면 떠 있는 것으로 안 보인다.
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06)',
};

const tabStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  background: 'none',
  border: 0,
};
