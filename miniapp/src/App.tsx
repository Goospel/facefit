import { useEffect, useRef, useState } from 'react';

import { Icon, type IconName } from './components/Icon';
import {
  buildBackupBlob,
  deleteBackup,
  getBackupKey,
  isBackupSupported,
  uploadBackup,
  type BackupBlob,
} from './logic/backup';
import { FacePhoto } from './screens/FacePhoto';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Products } from './screens/Products';
import { Restore } from './screens/Restore';
import { Timelapse } from './screens/Timelapse';
import { ui } from './ui';
import {
  isBackupDirty,
  isBackupEnabled,
  isBackupPrompted,
  isOnboarded,
  loadNotes,
  loadProducts,
  saveBackupDirty,
  saveBackupEnabled,
  saveBackupPrompted,
  saveLastBackupAt,
  saveNote,
  saveNotes,
  saveOnboarded,
  saveProducts,
  todayKey,
  type Notes,
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

/**
 * 저장 뒤 업로드까지의 대기(v3 §3-3). 제품을 연달아 고치는 동안 매번 올리지 않게 묶는다 —
 * 전체 블롭을 덮어쓰는 프로토콜이라 **중간 상태는 값이 없다.**
 */
const BACKUP_DEBOUNCE_MS = 5000;

export function App() {
  const [onboarded, setOnboarded] = useState(isOnboarded);
  const [tab, setTab] = useState<Tab>('home');
  /**
   * 전체화면. **값 하나가 「촬영이냐 타임랩스냐 아니냐」를 다 말한다** — boolean 둘로 두면
   * 둘 다 켜진 상태가 생기고, 그때 무엇을 그릴지 화면이 정해야 한다.
   *
   * 닫으면 `null`로 돌아갈 뿐이라 **보던 탭이 그대로 복원된다**(`tab`을 안 건드린다).
   */
  const [view, setView] = useState<'shoot' | 'timelapse' | 'restore' | null>(null);
  const [products, setProducts] = useState(loadProducts);
  const [notes, setNotes] = useState(loadNotes);

  /**
   * 백업(v3 §3-4). **쓸 수 있는가**는 렌더마다 안 바뀌므로 한 번만 묻는다 — 이 값이 거짓이면
   * 제안도 버튼도 복원 링크도 **아예 안 그린다**(눌러도 아무 일 없는 표면을 안 만든다).
   */
  const backupSupported = useRef(isBackupSupported()).current;
  const [backupEnabled, setBackupEnabled] = useState(isBackupEnabled);
  /** 제품 첫 등록 직후의 1회 제안. 켜짐 여부와 **별개**다 — 물어본 적이 있는가만 본다. */
  const [askBackup, setAskBackup] = useState(false);
  /**
   * 디바운스 효과가 **마운트 직후 한 번은 그냥 지나가게** 한다. 안 그러면 앱을 열기만 해도
   * 5초 뒤에 안 바뀐 상태를 올린다. 백업을 켜는 순간에도 같은 이유로 다시 세운다
   * (켤 때는 즉시 한 번 올리므로, 디바운스까지 돌면 같은 것을 두 번 올린다).
   */
  const skipDebounce = useRef(true);

  const date = todayKey();

  /**
   * 지금 상태를 통째로 올린다. **어떤 실패도 던지지 않는다** — 실패는 `backupDirty`에만
   * 남고, 다음 앱 시작이 곧 재시도다(백오프 루프를 안 만드는 이유 — 설계 §3-3).
   */
  async function pushBackup(nextProducts: Product[], nextNotes: Notes) {
    const key = await getBackupKey();
    if (!key) return;

    const ok = await uploadBackup(key, buildBackupBlob(nextProducts, nextNotes, new Date().toISOString()));
    saveBackupDirty(!ok);
    if (ok) saveLastBackupAt(new Date().toISOString());
  }

  /** 켤 때는 **즉시 한 번** 올린다 — 켠 직후 서버가 비어 있으면 켠 보람이 없다. */
  function enableBackup() {
    saveBackupEnabled(true);
    skipDebounce.current = true;
    setBackupEnabled(true);
    void pushBackup(products, notes);
  }

  /** 끄기는 곧 **서버 데이터 삭제**다(설계 §3-3) — 그래야 문구를 믿을 수 있다. */
  function disableBackup() {
    saveBackupEnabled(false);
    saveBackupDirty(false);
    setBackupEnabled(false);
    void (async () => {
      const key = await getBackupKey();
      if (key) await deleteBackup(key);
    })();
  }

  /** 화면 state와 저장소를 **한 함수에서** 바꾼다 — 갈라 두면 한쪽만 부르는 자리가 생긴다. */
  function saveProductsAnd(next: Product[]) {
    // 「기록이 쌓이기 시작한」 순간이 제안의 유일한 방아쇠다(설계 §3-4).
    const firstEver = products.length === 0 && next.length > 0;
    setProducts(next);
    saveProducts(next);
    if (firstEver && backupSupported && !isBackupPrompted()) setAskBackup(true);
  }

  function saveNoteAnd(day: string, verdict: Verdict) {
    setNotes(saveNote(day, verdict));
  }

  /** 복원은 저장소에 쓴 뒤 **다시 읽어서** 화면에 올린다 — 로더의 방어를 그대로 태운다. */
  function applyRestore(blob: BackupBlob) {
    saveProducts(blob.products);
    saveNotes(blob.notes);
    setProducts(loadProducts());
    setNotes(loadNotes());

    // 복원했다는 것은 백업을 쓰겠다는 뜻이다 — 새 기기에서 다시 켜게 만들지 않는다.
    saveBackupEnabled(true);
    skipDebounce.current = true;
    setBackupEnabled(true);
    // 이미 물어본 것으로 친다 — 방금 복원한 사람에게 「백업할까요?」는 소음이다.
    saveBackupPrompted();

    saveOnboarded();
    setOnboarded(true);
    setView(null);
  }

  /** 밀린 업로드는 **앱을 여는 행위**가 재시도한다(설계 §3-3). */
  useEffect(() => {
    if (!isBackupEnabled() || !isBackupDirty()) return;
    void pushBackup(loadProducts(), loadNotes());
    // 마운트에서 한 번만. products/notes를 의존성에 넣으면 아래 디바운스와 겹친다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 저장이 멎은 뒤에 올린다. 연달아 고치는 동안은 타이머가 계속 갈아 끼워진다. */
  useEffect(() => {
    if (!backupEnabled) return;
    if (skipDebounce.current) {
      skipDebounce.current = false;
      return;
    }
    const timer = setTimeout(() => void pushBackup(products, notes), BACKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, notes, backupEnabled]);

  // 복원은 온보딩 **앞**에 온다 — 새 기기의 첫 화면에서 들어오는 경로라 아직 온보딩 전이다.
  if (view === 'restore') return <Restore onClose={() => setView(null)} onRestored={applyRestore} />;

  // 온보딩이 가장 앞이다. **권한 고지를 못 본 채로 카메라를 여는 경로가 없어야 한다.**
  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          saveOnboarded();
          setOnboarded(true);
        }}
        onRestore={backupSupported ? () => setView('restore') : undefined}
      />
    );
  }

  // 전체화면에서는 탭바가 없다 — 카메라를 켜 놓고 딴 화면으로 샐 이유가 없다.
  if (view === 'shoot') return <FacePhoto onClose={() => setView(null)} onNote={saveNoteAnd} />;
  if (view === 'timelapse') return <Timelapse products={products} onClose={() => setView(null)} />;

  return (
    <>
      {tab === 'home' && (
        <Home
          products={products}
          notes={notes}
          date={date}
          onShoot={() => setView('shoot')}
          backup={
            backupSupported
              ? { enabled: backupEnabled, onToggle: backupEnabled ? disableBackup : enableBackup }
              : undefined
          }
        />
      )}
      {tab === 'products' && <Products products={products} onChange={saveProductsAnd} date={date} />}
      {tab === 'history' && <History notes={notes} onOpenTimelapse={() => setView('timelapse')} />}

      {/*
        제품 첫 등록 직후의 1회 제안(설계 §3-4). 탭 위에 떠 있는 카드다 — 제품 탭에서
        저장한 직후라 **그 자리에서 답할 수 있어야** 한다(설정 화면으로 보내면 아무도 안 간다).
        어느 버튼을 눌러도 「물어봤다」로 기록해 다시 묻지 않는다.
      */}
      {askBackup && (
        <div data-testid="backup-prompt" style={promptStyle}>
          <p style={{ ...ui.h2, margin: 0, fontSize: 15 }}>기록이 쌓이기 시작했어요</p>
          <p style={{ ...ui.sub, margin: '6px 0 0' }}>
            기기를 바꿔도 잃지 않게 백업할까요? 제품과 관찰만 저장되고, <b>사진은 올라가지 않아요.</b>
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              style={{ ...ui.primary, flex: 1 }}
              onClick={() => {
                saveBackupPrompted();
                setAskBackup(false);
                enableBackup();
              }}
            >
              백업 켜기
            </button>
            <button
              style={{ ...ui.secondary, flex: 1 }}
              onClick={() => {
                saveBackupPrompted();
                setAskBackup(false);
              }}
            >
              나중에
            </button>
          </div>
        </div>
      )}

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

/**
 * 1회 제안 카드. 탭바 **바로 위**에 뜬다 — 저장한 그 자리에서 답할 수 있어야 하고,
 * 탭바를 가리면 답하지 않고는 못 빠져나가는 모양이 된다(그건 모달이지 제안이 아니다).
 */
const promptStyle: React.CSSProperties = {
  position: 'fixed',
  left: 'var(--tab-side)',
  right: 'var(--tab-side)',
  bottom: 'calc(var(--tab-lift) + var(--tab-h) + 8px)',
  padding: 16,
  background: 'var(--bg)',
  borderRadius: 16,
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
