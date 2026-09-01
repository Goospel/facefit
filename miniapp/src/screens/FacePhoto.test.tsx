// @vitest-environment jsdom
// ⚠️ 전역으로 켜지 않는다 — 순수 로직 테스트는 node 환경이 빠르고, `photoStore.test.ts`는
//    jsdom의 Blob이 구조화 복제를 못 견뎌서(T-002) 반드시 node에서 돌아야 한다.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureJpeg } from '../logic/capture';
import { isNotifySupported, requestNotifyAgreement } from '../notify';
import { listPhotos, openPhotoDb, savePhoto, type FacePhoto as Photo } from '../photoStore';
import { isNotifyPrompted, saveNotifyPrompted, todayKey } from '../storage';
import { FacePhoto } from './FacePhoto';

/**
 * 얼굴 촬영 화면.
 *
 * 브라우저만 가진 것을 목으로 갈아 끼운다 — `getUserMedia`(jsdom에 없다) · 캔버스 프레임
 * 캡처(2D 컨텍스트가 없다) · 사진 목록과 저장.
 *
 * ⚠️ **`listPhotos`까지 목인 이유는 게을러서가 아니다.** jsdom + fake-indexeddb에서는 Blob이
 * 왕복하며 **평범한 객체로 바뀌어**(구조화 복제가 jsdom의 Blob을 모른다) 저장소의 어휘 검증에
 * 통째로 걸린다 — 진짜 왕복을 태우면 목록이 **항상 빈다**(T-002). 저장소 자체는
 * `photoStore.test.ts`가 node 환경에서 진짜로 잰다. **`openPhotoDb`는 진짜를 쓴다** —
 * 「IDB가 없으면 안내로 빠진다」는 이 화면의 분기라서 그렇다.
 *
 * 여기서 잠그는 것: **첫 촬영과 이후 촬영이 다른 화면이다**(얼굴 가이드 ↔ 고스트) ·
 * **실패 세 갈래가 각각 다른 안내다**(심사자가 권한 거부부터 눌러 본다) · **닫으면 카메라가
 * 꺼진다** · **셔터가 화면을 먼저 하얗게 밝히고 나서 찍는다**(조명 통제) · **저장에 성공해야만
 * 관찰 1문항으로 넘어간다**(사진 없는 관찰만 남는 상태를 안 만든다).
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  listPhotos: vi.fn(),
  savePhoto: vi.fn(),
}));

/** jsdom에는 2D 컨텍스트가 없다. **화면이 아니라 모듈을 갈아 끼운다** — 테스트 전용 prop을 두면 제품 표면이 하나 는다. */
vi.mock('../logic/capture', async (orig) => ({
  ...(await orig<typeof import('../logic/capture')>()),
  captureJpeg: vi.fn(),
}));

/** 알림 동의는 토스 웹뷰 브릿지다 — 여기엔 없다. 래퍼 자체는 `notify.test.ts`가 잰다. */
vi.mock('../notify', () => ({ isNotifySupported: vi.fn(), requestNotifyAgreement: vi.fn() }));

afterEach(cleanup);
// ⚠️ 가짜 타이머를 쓰는 테스트가 **실패하면** 복구 줄까지 못 가고, 그 뒤 파일 전체가
// 5초 타임아웃으로 무너진다 — 빨간불 하나가 수십 개로 보인다. 되돌리기는 여기서 보장한다.
afterEach(() => vi.useRealTimers());

const OK = (s: MediaStream) => async () => s;
const DENIED = async () => {
  throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
};

/**
 * 트랙 하나짜리 가짜 스트림. `stop`이 불렸는지가 「카메라가 꺼졌는가」의 유일한 관측점이고,
 * `kill`은 **다른 앱이 카메라를 가져간 순간**을 흉내 낸다.
 */
function fakeStream() {
  const stop = vi.fn();
  const on: Record<string, (() => void)[]> = {};
  const track = {
    readyState: 'live',
    muted: false,
    stop: () => {
      track.readyState = 'ended';
      stop();
    },
    addEventListener: (type: string, f: () => void) => {
      (on[type] ??= []).push(f);
    },
    removeEventListener: (type: string, f: () => void) => {
      on[type] = (on[type] ?? []).filter((g) => g !== f);
    },
  };
  const kill = (type: 'ended' | 'mute') => {
    if (type === 'ended') track.readyState = 'ended';
    else track.muted = true;
    (on[type] ?? []).forEach((f) => f());
  };
  /** 이벤트 없이 죽는다. 백그라운드에서 끊기면 신호를 못 받고 지나가는 경우가 실제로 있다. */
  const silentlyDie = () => void (track.readyState = 'ended');
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, stop, kill, silentlyDie };
}

const shot = { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 960, height: 1280 };

function setup(over: Partial<Parameters<typeof FacePhoto>[0]> = {}) {
  const onClose = vi.fn();
  const onNote = vi.fn();
  const props = {
    onClose,
    onNote,
    media: { getUserMedia: OK(fakeStream().stream) },
    idb: new IDBFactory() as IDBFactory,
    ...over,
  };
  const view = render(<FacePhoto {...props} />);
  return { onClose, onNote, capture: vi.mocked(captureJpeg), ...view };
}

/**
 * 이미 저장돼 있는 사진들. **`listPhotos`가 주는 순서 그대로 준다**(날짜 오름차순 —
 * 저장소가 스펙으로 보장하고 `photoStore.test.ts`가 잰다).
 */
function seed(dates: string[]) {
  const list: Photo[] = dates.map((date) => ({
    date,
    blob: new Blob([date]),
    capturedAt: 1,
    width: 960,
    height: 1280,
  }));
  vi.mocked(listPhotos).mockResolvedValue(list);
}

const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

/**
 * `IDBDatabase.close`를 지켜본다. **프로토타입에 건다** — 화면이 연 연결의 핸들은 밖에서
 * 잡을 수 없다.
 */
async function spyOnDbClose() {
  const db = await openPhotoDb(new IDBFactory() as IDBFactory);
  return vi.spyOn(Object.getPrototypeOf(db!) as IDBDatabase, 'close');
}

beforeEach(() => {
  // ⚠️ 목이 **모듈 수준**이라 호출 기록이 파일 전체에 누적된다 — 안 지우면 「몇 번 불렸나」를
  // 재는 테스트가 앞선 테스트의 호출까지 세서 통과·실패가 실행 순서에 달린다.
  vi.clearAllMocks();
  vi.mocked(captureJpeg).mockResolvedValue(shot);
  vi.mocked(savePhoto).mockResolvedValue('ok');
  vi.mocked(listPhotos).mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => 'blob:ghost');
  URL.revokeObjectURL = vi.fn();
  visibility('visible');
  vi.mocked(isNotifySupported).mockReturnValue(true);
  // 기본은 **알림을 이미 한 번 권한 뒤**의 상태다 — 관찰 답이 곧 종료인 흐름을 나머지
  // 테스트가 그대로 재게 둔다. 제안 스텝 자체는 「내일 알림 제안」 describe가 잰다.
  localStorage.clear();
  saveNotifyPrompted();
});

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function comeBack() {
  visibility('hidden');
  fireEvent(document, new Event('visibilitychange'));
  visibility('visible');
  fireEvent(document, new Event('visibilitychange'));
}

/**
 * 플래시가 끝날 때까지 시간을 민다.
 *
 * ⚠️ **250ms씩 쪼개서 민다**(restfit T-242). `act()` 안에서 한 번에 길게 전진하면 여러 틱이
 * 한 렌더로 합쳐져, 「플래시가 떠 있는 중간 상태」가 아예 관측되지 않는다.
 */
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) await vi.advanceTimersByTimeAsync(Math.min(250, left));
}

describe('촬영 화면 — 카메라 실패 세 갈래', () => {
  it('카메라가 없는 웹뷰는 「쓸 수 없어요」다', async () => {
    setup({ media: undefined });
    expect(await screen.findByText('이 환경에서는 카메라를 쓸 수 없어요')).toBeTruthy();
  });

  it('권한 거부는 「설정에서 허용해 주세요」다 — 심사자가 가장 먼저 눌러 보는 경로', async () => {
    setup({ media: { getUserMedia: DENIED } });
    expect(await screen.findByText('카메라 권한이 꺼져 있어요. 토스 앱 설정에서 허용해 주세요')).toBeTruthy();
  });

  it('무응답(타임아웃)은 「잠시 후 다시 시도」다', async () => {
    vi.useFakeTimers();
    setup({ media: { getUserMedia: () => new Promise<MediaStream>(() => {}) } });

    await vi.advanceTimersByTimeAsync(10000);
    vi.useRealTimers();

    expect(await screen.findByText('카메라를 여는 데 실패했어요. 잠시 후 다시 시도해 주세요')).toBeTruthy();
  });

  it('어느 실패든 원문을 작은 글씨로 병기한다 — 문의 대응의 유일한 단서', async () => {
    setup({ media: { getUserMedia: DENIED } });
    expect(await screen.findByText(/NotAllowedError: Permission denied/)).toBeTruthy();
  });

  it('실패해도 닫기로 멀쩡히 돌아간다 — 앱이 죽지 않는다', async () => {
    const { onClose } = setup({ media: undefined });
    await screen.findByText('이 환경에서는 카메라를 쓸 수 없어요');

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('촬영 화면 — 첫 촬영(사진 0장)', () => {
  it('얼굴 가이드를 그리고 고스트는 없다', async () => {
    const { container } = setup();

    expect(await screen.findByRole('img', { name: '얼굴 가이드' })).toBeTruthy();
    expect(screen.queryByAltText('기준 사진')).toBeNull();
    expect(container.querySelector('[data-grid]')).toBeTruthy();
  });

  it('이 구도가 기준이 된다고 미리 알린다', async () => {
    setup();
    expect(await screen.findByText(/이 구도가 기준이 됩니다/)).toBeTruthy();
  });

  it('아침 세안 직후·같은 자리를 안내한다 — 조건 통제가 이 앱의 전부다', async () => {
    setup();
    expect(await screen.findByText(/아침 세안 직후/)).toBeTruthy();
  });

  it('사진이 이 기기를 안 떠난다고 화면에 적는다 — 심사·사용자에게 같은 문장', async () => {
    setup();
    expect(await screen.findByText('사진은 이 기기에만 저장되며 어디로도 전송되지 않습니다.')).toBeTruthy();
  });
});

describe('촬영 화면 — 고스트(사진 1장 이상)', () => {
  it('가장 오래된 사진이 고스트다 — 직전 사진이면 어긋남이 누적된다', async () => {
    // 셋 중 **첫 장**이어야 한다. 최신(마지막)을 겹치면 하루 1~2px의 어긋남이 누적돼
    // 한 달 뒤 구도가 처음과 딴판이 된다(복사기의 복사본을 다시 복사하는 문제).
    // 얼굴은 전신보다 프레임 점유가 커서 그 드리프트가 더 빨리 눈에 띈다.
    seed(['2026-01-05', '2026-02-01', '2026-03-02']);
    setup();

    const ghost = (await screen.findByAltText('기준 사진')) as HTMLImageElement;
    expect(ghost.src).toBe('blob:ghost');
    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0] as [Blob];
    expect(await blob.text()).toBe('2026-01-05');
  });

  it('사진이 있으면 얼굴 가이드는 안 그린다 — 고스트가 그 일을 더 잘한다', async () => {
    seed(['2026-01-05']);
    setup();

    await screen.findByAltText('기준 사진');
    expect(screen.queryByRole('img', { name: '얼굴 가이드' })).toBeNull();
  });

  it('토글로 잠깐 끌 수 있다 — 정렬 중에 내 얼굴이 안 보이는 순간이 있다', async () => {
    seed(['2026-01-05']);
    setup();

    fireEvent.click(await screen.findByRole('button', { name: '고스트 끄기' }));

    expect(screen.queryByAltText('기준 사진')).toBeNull();
    expect(btn('고스트 켜기')).toBeTruthy();
  });

  it('닫으면 고스트 blob URL을 놓아준다 — 안 놓으면 조용히 메모리만 자란다', async () => {
    seed(['2026-01-05']);
    const { unmount } = setup();
    await screen.findByAltText('기준 사진');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ghost');
  });
});

/**
 * 조명이 최대 교란 변수다(설계 §1-2). 웹뷰에서 화면 밝기 자체는 못 올리니, 흰 픽셀이
 * 낼 수 있는 최대 광량이 우리가 가진 전부다.
 */
describe('촬영 화면 — 셔터 플래시', () => {
  it('셔터를 누르면 화면이 먼저 하얘지고, 그동안은 아직 안 찍는다', async () => {
    const { capture, container } = setup();
    await screen.findByRole('button', { name: '촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(250);

    // ⚠️ **전면 카메라의 자동 노출 보정이 따라올 시간**을 주는 것이 이 지연의 전부다.
    // 0ms로 찍으면 흰 화면이 뜨기도 전의 어두운 프레임이 저장돼 플래시가 통째로 무의미해진다.
    const overlay = container.querySelector('[data-flash]');
    expect(overlay).toBeTruthy();
    expect(capture).not.toHaveBeenCalled();

    /*
      ⚠️ **흰 화면이 맨 위에 있어야 화면이 밝아진다.** 프리뷰·고스트 아래에 깔리면 요소는
      있는데 광량이 0이라, 「플래시가 있다」만 재는 테스트는 그대로 통과한다(리뷰 실측:
      `zIndex: -1` 돌연변이가 살아남았다). 위로 오는 수단은 **DOM 순서**다 — 형제들이
      z-index를 안 쓰므로 마지막 자식이 이긴다. 그래서 둘 다 잠근다.
    */
    expect(overlay!.parentElement!.lastElementChild).toBe(overlay);
    expect(Number(getComputedStyle(overlay!).zIndex) || 0).toBeGreaterThanOrEqual(0);
  });

  it('플래시가 끝나면 찍고 흰 화면을 걷는다', async () => {
    const { capture, container } = setup();
    await screen.findByRole('button', { name: '촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-flash]')).toBeNull();
    expect(await screen.findByRole('button', { name: '저장' })).toBeTruthy();
  });

  it('플래시가 도는 동안에는 셔터가 안 눌린다 — 두 번 눌러 두 장이 겹치지 않는다', async () => {
    const { capture } = setup();
    await screen.findByRole('button', { name: '촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(250);
    expect(btn('촬영').disabled).toBe(true);
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('3초 후 촬영도 카운트가 끝나면 같은 플래시를 탄다', async () => {
    const { capture, container } = setup();
    await screen.findByRole('button', { name: '3초 후 촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('3초 후 촬영'));
    expect(screen.getByText('3')).toBeTruthy();
    // 3000이 카운트 0에 닿는 지점이고, 캡처는 그로부터 FLASH_MS(500) 뒤다 — 그 사이를 본다.
    await advance(3250);

    // 카운트 0 → 플래시 on → 500ms → 캡처. 카운트가 끝나자마자 찍으면 플래시가 없는 것과 같다.
    expect(container.querySelector('[data-flash]')).toBeTruthy();
    expect(capture).not.toHaveBeenCalled();

    await advance(600);
    vi.useRealTimers();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('화면을 닫으면 플래시 타이머가 따라 죽는다 — 사라진 화면에 대고 캡처하지 않는다', async () => {
    const { capture, unmount } = setup();
    await screen.findByRole('button', { name: '촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(250);
    unmount();
    await advance(600);
    vi.useRealTimers();

    expect(capture).not.toHaveBeenCalled();
  });
});

describe('촬영 화면 — 카메라 수명', () => {
  it('프리뷰는 거울상이다 — 저장본도 같은 방향이라야 고스트가 맞는다', async () => {
    const { container } = setup();
    await screen.findByRole('button', { name: '촬영' });

    expect(container.querySelector('video')!.style.transform).toBe('scaleX(-1)');
  });

  it('화면을 닫으면 카메라가 꺼진다', async () => {
    const { stream, stop } = fakeStream();
    const { unmount } = setup({ media: { getUserMedia: OK(stream) } });
    await screen.findByRole('button', { name: '촬영' });

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('열리기 전에 닫아도 뒤늦게 온 스트림을 꺼서 놓아준다', async () => {
    const { stream, stop } = fakeStream();
    let allow!: (s: MediaStream) => void;
    const { unmount } = setup({ media: { getUserMedia: () => new Promise<MediaStream>((r) => (allow = r)) } });

    unmount();
    allow(stream);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it('화면을 닫으면 DB 연결도 닫는다 — 안 닫으면 열어 둔 연결만 쌓인다', async () => {
    const close = await spyOnDbClose();
    const { unmount } = setup();
    await screen.findByRole('button', { name: '촬영' });

    unmount();

    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });
});

/**
 * restfit 실기기에서 실제로 터진 구멍이다(아이폰 · 토스 iOS 앱, 촬영 화면을 연 채
 * **화면 녹화 시작** → 프리뷰가 얼어붙는다).
 */
describe('촬영 화면 — 카메라 중단과 복구', () => {
  const DOWN = '카메라가 중단됐어요';
  const BUSY = Object.assign(new Error('camera in use'), { name: 'NotReadableError' });
  const DENIED_ERR = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });

  /** 순서대로 답하는 카메라. **여러 번 열리는** 경로를 재려면 취득이 매번 같은 답이면 안 된다. */
  function opens(...results: (MediaStream | Error)[]) {
    let i = 0;
    return {
      getUserMedia: async () => {
        const r = results[Math.min(i++, results.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
    };
  }

  it.each(['ended', 'mute'] as const)('트랙이 %s로 끊기면 얼어붙은 프리뷰를 살아 있는 척 두지 않는다', async (how) => {
    // `mute`는 `readyState`를 'live'로 남긴다 — 그것만 보고 판정하면 실기기 버그가 그대로 남는다.
    const a = fakeStream();
    const { container } = setup({ media: opens(a.stream) });
    await screen.findByRole('button', { name: '촬영' });

    act(() => a.kill(how));

    expect(screen.getByText(DOWN)).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: '촬영' })).toBeNull();
  });

  it.each(['ended', 'mute'] as const)('앱에서 돌아오면 같은 경로로 다시 열어 붙이고 옛 스트림은 놓아준다 (%s)', async (how) => {
    const a = fakeStream();
    const b = fakeStream();
    const { container } = setup({ media: opens(a.stream, b.stream) });
    await screen.findByRole('button', { name: '촬영' });
    act(() => a.kill(how));

    comeBack();

    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(b.stream));
    expect(a.stop).toHaveBeenCalledTimes(1);
  });

  it('다시 연 뒤에는 옛 트랙의 뒤늦은 신호에 안 속는다', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const { container } = setup({ media: opens(a.stream, b.stream) });
    await screen.findByRole('button', { name: '촬영' });
    act(() => a.kill('ended'));
    comeBack();
    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(b.stream));

    act(() => a.kill('mute'));

    expect(screen.queryByText(DOWN)).toBeNull();
    expect(btn('촬영')).toBeTruthy();
  });

  it('죽은 트랙에서 캡처가 빈손이면 그때는 중단으로 넘긴다', async () => {
    // 여기서 「다시 시도해 주세요」는 거짓말이다 — 영영 안 되는 셔터를 권하는 셈이다.
    vi.mocked(captureJpeg).mockResolvedValue(null);
    const a = fakeStream();
    setup({ media: opens(a.stream) });
    await screen.findByRole('button', { name: '촬영' });
    a.silentlyDie();

    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();

    expect(await screen.findByText(DOWN)).toBeTruthy();
    expect(screen.queryByText('사진을 찍지 못했어요. 다시 시도해 주세요')).toBeNull();
  });

  it('재취득한 스트림마저 죽어 있어도 무한히 다시 열지 않는다 — 수동 폴백에 안착한다', async () => {
    /*
      ⚠️ `reconnect()`가 `cam`을 바꾸고 그 effect의 deps가 `cam`이라, 가드가 없으면
      판정 → 재취득 → 판정으로 영영 돈다(restfit 리뷰 실측 5초에 463회). 그동안 `down`이
      진동해 **「다시 연결」 버튼조차 못 누른다** — 수동 폴백이 있으나 마나가 된다.
    */
    const a = fakeStream();
    const stillDead = fakeStream();
    stillDead.kill('mute');
    const gum = vi.fn(async () => (gum.mock.calls.length === 1 ? a.stream : stillDead.stream));
    setup({ media: { getUserMedia: gum } });
    await screen.findByRole('button', { name: '촬영' });
    act(() => a.kill('mute'));

    comeBack();
    expect(await screen.findByRole('button', { name: '다시 연결' })).toBeTruthy();
    await act(async () => {});

    expect(gum).toHaveBeenCalledTimes(2);
    expect(screen.getByText(DOWN)).toBeTruthy();
  });

  it('살아 있는 스트림을 다시 잡으면 자동 재연결이 다시 쓸 수 있게 풀린다', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const c = fakeStream();
    const { container } = setup({ media: opens(a.stream, b.stream, c.stream) });
    await screen.findByRole('button', { name: '촬영' });

    act(() => a.kill('mute'));
    comeBack();
    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(b.stream));

    act(() => b.kill('mute'));
    comeBack();

    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(c.stream));
  });

  it('재연결이 권한 거부로 실패하면 그 원인을 말한다 — 사용자가 고칠 수 있는 유일한 실패다', async () => {
    const a = fakeStream();
    setup({ media: opens(a.stream, DENIED_ERR) });
    await screen.findByRole('button', { name: '촬영' });
    act(() => a.kill('ended'));

    comeBack();

    expect(await screen.findByText('카메라 권한이 꺼져 있어요. 토스 앱 설정에서 허용해 주세요')).toBeTruthy();
    expect(screen.getByText(DOWN)).toBeTruthy();
  });

  it('숨어 있는 동안에는 다시 열지 않는다 — 보이지도 않는 화면에 카메라만 켜는 셈이다', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const { container } = setup({ media: opens(a.stream, b.stream) });
    await screen.findByRole('button', { name: '촬영' });
    act(() => a.kill('ended'));

    visibility('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {});

    expect(screen.getByText(DOWN)).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('다시 열기에 실패하면 「다시 연결」로 사람이 고른다', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const { container } = setup({ media: opens(a.stream, BUSY, b.stream) });
    await screen.findByRole('button', { name: '촬영' });
    act(() => a.kill('ended'));

    comeBack();

    expect(await screen.findByRole('button', { name: '다시 연결' })).toBeTruthy();
    expect(screen.getByText(DOWN)).toBeTruthy();

    fireEvent.click(btn('다시 연결'));

    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(b.stream));
  });

  it('카운트다운 중에 끊기면 카운트다운이 죽는다 — 얼어붙은 프레임을 찍어 저장하는 사고를 막는다', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const { capture } = setup({ media: opens(a.stream, b.stream) });
    await screen.findByRole('button', { name: '3초 후 촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('3초 후 촬영'));
    expect(screen.getByText('3')).toBeTruthy();

    act(() => a.kill('ended'));
    fireEvent.click(btn('다시 연결'));
    await advance(4000);
    vi.useRealTimers();

    expect(capture).not.toHaveBeenCalled();
    expect(btn('촬영')).toBeTruthy();
  });

  it('확인 화면에서는 끊겨도 저장 흐름을 안 건드린다 — 사진은 이미 손에 있다', async () => {
    const a = fakeStream();
    setup({ media: opens(a.stream) });
    await screen.findByRole('button', { name: '촬영' });
    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();
    await screen.findByRole('button', { name: '저장' });

    act(() => a.kill('ended'));
    comeBack();

    expect(screen.queryByText(DOWN)).toBeNull();
    fireEvent.click(btn('저장'));

    expect(await screen.findByText('오늘 피부, 어때 보였나요?')).toBeTruthy();
  });

  it('다시 찍기로 프리뷰에 돌아갈 때 비로소 다시 연다', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const { container } = setup({ media: opens(a.stream, b.stream) });
    await screen.findByRole('button', { name: '촬영' });
    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();
    await screen.findByRole('button', { name: '저장' });
    act(() => a.kill('ended'));

    fireEvent.click(btn('다시 찍기'));

    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(b.stream));
  });
});

describe('촬영 화면 — 3초 타이머', () => {
  it('카운트다운을 3·2·1로 보여준 뒤 찍는다 — 폰을 세우고 물러선 사람의 유일한 경로', async () => {
    const { capture } = setup();
    await screen.findByRole('button', { name: '3초 후 촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('3초 후 촬영'));
    expect(screen.getByText('3')).toBeTruthy();

    await advance(1000);
    expect(screen.getByText('2')).toBeTruthy();
    await advance(1000);
    expect(screen.getByText('1')).toBeTruthy();
    expect(capture).not.toHaveBeenCalled();

    /*
      ⚠️ 예산을 넉넉히 준다(필요한 가짜 시간은 1000 + FLASH_MS = 1500이다).

      셔터까지가 **상태 → effect → 상태 → effect → 타이머** 사슬이라, 카운트가 0에 닿은
      뒤 플래시 타이머가 **등록되기까지** 렌더·effect가 두 번 돈다. 각 단계가 `advance`의
      플러시를 한 박자씩 먹으므로 등록 시점이 밀릴 수 있고, 1600으로 재면 밀린 만큼
      셔터가 예산 밖으로 나가 **간헐적으로만** 실패한다(로컬 5회 중 1회 · T-011).
    */
    await advance(2400);
    vi.useRealTimers();

    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe('촬영 화면 — 확인과 저장', () => {
  async function shoot(over: Partial<Parameters<typeof FacePhoto>[0]> = {}) {
    const r = setup(over);
    await screen.findByRole('button', { name: '촬영' });
    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();
    await screen.findByRole('button', { name: '저장' });
    return r;
  }

  it('찍은 사진을 보여주고 저장/다시 찍기를 묻는다', async () => {
    await shoot();
    expect(screen.getByAltText('방금 찍은 사진')).toBeTruthy();
    expect(btn('다시 찍기')).toBeTruthy();
  });

  it('다시 찍기를 누르면 프리뷰로 돌아간다', async () => {
    await shoot();
    fireEvent.click(btn('다시 찍기'));

    expect(btn('촬영')).toBeTruthy();
    expect(screen.queryByAltText('방금 찍은 사진')).toBeNull();
  });

  it('다시 찍기 뒤에도 프리뷰에 스트림이 붙어 있다 — 안 붙이면 까만 화면이다', async () => {
    // 확인 화면으로 갈 때 `<video>`가 통째로 사라졌다가 새 노드로 돌아온다 —
    // 스트림을 처음 한 번만 붙이면 **돌아온 프리뷰는 영영 까맣다.**
    const { stream } = fakeStream();
    const { container } = await shoot({ media: { getUserMedia: OK(stream) } });

    fireEvent.click(btn('다시 찍기'));

    await waitFor(() => expect(container.querySelector('video')!.srcObject).toBe(stream));
  });

  it('저장하면 오늘 날짜로 넣는다', async () => {
    await shoot();

    fireEvent.click(btn('저장'));

    await waitFor(() => expect(savePhoto).toHaveBeenCalled());
    const [, saved] = vi.mocked(savePhoto).mock.calls[0];
    expect(saved.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect({ w: saved.width, h: saved.height }).toEqual({ w: 960, h: 1280 });
    expect(saved.blob).toBe(shot.blob);
  });

  it('쿼터 초과는 「공간이 부족해요」다 — 화면은 안 닫힌다', async () => {
    vi.mocked(savePhoto).mockResolvedValue('quota');
    const { onClose } = await shoot();

    fireEvent.click(btn('저장'));

    expect(await screen.findByText('공간이 부족해요 — 오래된 사진을 지워 주세요')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('그 밖의 실패는 「다시 시도해 주세요」다 — 쿼터와 문구가 갈린다', async () => {
    vi.mocked(savePhoto).mockResolvedValue('fail');
    await shoot();

    fireEvent.click(btn('저장'));

    expect(await screen.findByText('저장하지 못했어요. 다시 시도해 주세요')).toBeTruthy();
    expect(screen.queryByText('공간이 부족해요 — 오래된 사진을 지워 주세요')).toBeNull();
  });

  it('캡처가 실패해도 카메라가 멀쩡하면 안내만 하고 프리뷰를 지킨다', async () => {
    /*
      빈손인 경로 셋 중 둘은 **트랙이 살아 있다**(0×0 프레임 · 2D 컨텍스트 없음 · toBlob 실패).
      한 번 삐끗한 캡처로 멀쩡한 카메라 세션을 철거하면 틀린 안내까지 얹게 된다.
    */
    vi.mocked(captureJpeg).mockResolvedValue(null);
    setup();
    await screen.findByRole('button', { name: '촬영' });

    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();

    expect(await screen.findByText('사진을 찍지 못했어요. 다시 시도해 주세요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(btn('촬영')).toBeTruthy();
    expect(screen.queryByText('카메라가 중단됐어요')).toBeNull();
  });

  it('저장하는 동안에는 다시 찍기도 안 눌린다 — 눌러도 조용히 무시되는 창을 안 남긴다', async () => {
    vi.mocked(savePhoto).mockReturnValue(new Promise(() => {}));
    await shoot();

    fireEvent.click(btn('저장'));

    await waitFor(() => expect(btn('다시 찍기').disabled).toBe(true));
  });

  it('다시 찍기를 누르면 실패 문구가 프리뷰까지 따라오지 않는다', async () => {
    vi.mocked(savePhoto).mockResolvedValue('fail');
    await shoot();

    fireEvent.click(btn('저장'));
    await screen.findByText('저장하지 못했어요. 다시 시도해 주세요');
    fireEvent.click(btn('다시 찍기'));

    expect(screen.queryByText('저장하지 못했어요. 다시 시도해 주세요')).toBeNull();
  });

  it('닫으면 방금 찍은 사진의 blob URL도 놓아준다', async () => {
    const { unmount } = await shoot();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

/**
 * 저장 직후 1문항(설계 §1-1). **사진을 방금 찍은 순간이 이 질문에 답할 수 있는 유일한
 * 순간이고**, 별도 진입 동선이 0이다. 문구는 질문형이다 — 이 앱은 어디서도 「좋아졌다」를
 * 단정하지 않는다.
 */
describe('촬영 화면 — 저장 직후 관찰 1문항', () => {
  async function saveOk(over: Partial<Parameters<typeof FacePhoto>[0]> = {}) {
    const r = setup(over);
    await screen.findByRole('button', { name: '촬영' });
    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();
    await screen.findByRole('button', { name: '저장' });
    fireEvent.click(btn('저장'));
    return r;
  }

  it('저장에 성공하면 닫는 대신 오늘 피부를 묻는다', async () => {
    const { onClose } = await saveOk();

    expect(await screen.findByText('오늘 피부, 어때 보였나요?')).toBeTruthy();
    // 아직 닫히면 안 된다 — 물어놓고 화면이 사라지면 답할 자리가 없다.
    expect(onClose).not.toHaveBeenCalled();
    expect(btn('좋아졌어요')).toBeTruthy();
    expect(btn('그대로예요')).toBeTruthy();
    expect(btn('나빠졌어요')).toBeTruthy();
  });

  it('답을 고르면 오늘 날짜로 기록하고 닫는다', async () => {
    const { onClose, onNote } = await saveOk();
    await screen.findByText('오늘 피부, 어때 보였나요?');

    fireEvent.click(btn('좋아졌어요'));

    expect(onNote).toHaveBeenCalledTimes(1);
    const [date, verdict] = onNote.mock.calls[0];
    /*
      ⚠️ **날짜 「형태」가 아니라 오늘 그 자체여야 한다.** 설계 §1-1이 소급 입력을 막는 이유가
      「관찰은 그날의 눈으로만 성립한다」인데, 형태만 재면 아무 날짜나 통과한다(리뷰 실측:
      `'2020-01-01'` 고정 돌연변이가 살아남았다). 저장하는 사진의 키와 같은 값이라야
      캘린더에서 사진과 관찰이 같은 칸에 선다.
    */
    expect(date).toBe(todayKey());
    expect(verdict).toBe('better');
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['그대로예요', 'same'],
    ['나빠졌어요', 'worse'],
  ])('%s는 %s로 기록한다', async (label, verdict) => {
    const { onNote } = await saveOk();
    await screen.findByText('오늘 피부, 어때 보였나요?');

    fireEvent.click(btn(label));

    expect(onNote.mock.calls[0][1]).toBe(verdict);
  });

  it('건너뛰면 아무것도 기록하지 않고 닫는다 — 답 없음이 정상 경로다', async () => {
    // 여기에 기본값을 채우면 아무 말도 안 한 사람의 답이 v2 추천 재료에 섞인다.
    const { onClose, onNote } = await saveOk();
    await screen.findByText('오늘 피부, 어때 보였나요?');

    fireEvent.click(btn('건너뛰기'));

    expect(onNote).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('저장에 실패하면 관찰 단계로 안 넘어간다 — 사진 없는 관찰만 남는 상태를 안 만든다', async () => {
    vi.mocked(savePhoto).mockResolvedValue('quota');
    await saveOk();

    expect(await screen.findByText('공간이 부족해요 — 오래된 사진을 지워 주세요')).toBeTruthy();
    expect(screen.queryByText('오늘 피부, 어때 보였나요?')).toBeNull();
  });

  it('관찰 단계에서는 카메라를 이미 놓아줬다 — 답을 고르는 동안 켜 둘 이유가 없다', async () => {
    const { stream, stop } = fakeStream();
    await saveOk({ media: { getUserMedia: OK(stream) } });
    await screen.findByText('오늘 피부, 어때 보였나요?');

    expect(stop).toHaveBeenCalled();
  });
});

/**
 * 관찰까지 끝낸 직후의 알림 제안(설계 §3-2).
 *
 * 「방금 찍었다 → 내일도 이 시간에」가 이 제안이 성립하는 유일한 순간이다. **자동 제안은
 * 딱 한 번**이고, 어느 버튼을 눌렀든 그 사실을 기록해 다시 자동으로 묻지 않는다.
 *
 * ⚠️ 여기서 잠그는 것 중 절반은 **안 뜨는 조건**이다 — 촬영 흐름을 푸시가 방해하는 순간
 * 주객전도라, 이미 물어봤거나 이 기기가 알림을 못 받으면 스텝 자체가 없어야 한다.
 */
describe('촬영 화면 — 내일 알림 제안', () => {
  const ASK = '내일도 이 시간에 알려드릴까요?';

  beforeEach(() => localStorage.clear());

  async function answer(label = '좋아졌어요') {
    const r = setup();
    await screen.findByRole('button', { name: '촬영' });
    vi.useFakeTimers();
    fireEvent.click(btn('촬영'));
    await advance(600);
    vi.useRealTimers();
    await screen.findByRole('button', { name: '저장' });
    fireEvent.click(btn('저장'));
    await screen.findByText('오늘 피부, 어때 보였나요?');
    fireEvent.click(btn(label));
    return r;
  }

  it('관찰까지 끝내면 닫는 대신 내일 알림을 한 번 권한다', async () => {
    const { onClose, onNote } = await answer();

    expect(await screen.findByText(ASK)).toBeTruthy();
    // 관찰 답은 이미 기록됐다 — 제안은 그 뒤에 얹히는 것이지 답을 가로채지 않는다.
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(btn('알림 받기')).toBeTruthy();
    expect(btn('괜찮아요')).toBeTruthy();
  });

  it('관찰을 건너뛴 사람에게도 권한다 — 답을 안 한 것과 알림은 별개다', async () => {
    await answer('건너뛰기');
    expect(await screen.findByText(ASK)).toBeTruthy();
  });

  it('「알림 받기」는 토스 동의 화면을 열고, 결과가 와야 닫는다', async () => {
    const { onClose } = await answer();
    await screen.findByText(ASK);

    fireEvent.click(btn('알림 받기'));

    expect(requestNotifyAgreement).toHaveBeenCalledTimes(1);
    // 시트가 뜨기도 전에 닫으면 사용자는 무엇에 답하는지 모른 채 남는다.
    expect(onClose).not.toHaveBeenCalled();

    const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls[0];
    act(() => onDone(true));

    expect(onClose).toHaveBeenCalled();
  });

  it('동의하지 않고 끝나도(거절·오류) 촬영 흐름은 그대로 끝난다', async () => {
    // 설계 §3-2: 실패는 조용히 접는다 — 알림이 안 되는 것이 촬영을 붙잡는 이유가 될 수 없다.
    const { onClose } = await answer();
    await screen.findByText(ASK);
    fireEvent.click(btn('알림 받기'));

    const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls[0];
    act(() => onDone(false));

    expect(onClose).toHaveBeenCalled();
  });

  it('「괜찮아요」는 동의 화면을 안 열고 그냥 닫는다', async () => {
    const { onClose } = await answer();
    await screen.findByText(ASK);

    fireEvent.click(btn('괜찮아요'));

    expect(requestNotifyAgreement).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it.each(['알림 받기', '괜찮아요'])('%s — 어느 쪽을 눌러도 물어본 것으로 기록한다', async (label) => {
    // 거절한 사람에게 내일도 모레도 다시 묻는 앱이 되면 안 된다(재요청 규율).
    await answer();
    await screen.findByText(ASK);

    fireEvent.click(btn(label));

    expect(isNotifyPrompted()).toBe(true);
  });

  it('이미 한 번 물어봤으면 스텝 없이 곧장 닫는다', async () => {
    saveNotifyPrompted();
    const { onClose } = await answer();

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it('알림을 못 받는 기기(구버전 토스)에서는 스텝 자체가 안 뜬다', async () => {
    // 물어봐야 열 수 없는 시트다 — 묻는 것 자체가 촬영 흐름에 낀 군더더기가 된다.
    vi.mocked(isNotifySupported).mockReturnValue(false);
    const { onClose } = await answer();

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText(ASK)).toBeNull();
    // 물어보지도 못한 것을 「물어봤다」로 남기면, 나중에 앱을 업데이트해도 영영 안 묻는다.
    expect(isNotifyPrompted()).toBe(false);
  });
});

describe('촬영 화면 — 안내 문구는 어느 화면에나 있다', () => {
  // 설계 §6은 **화면 안 상시 고지**를 요구한다. 심사자는 권한을 거부부터 눌러 보는데,
  // 그 화면에 고지가 없으면 「카메라를 왜 쓰는가」에 답하는 문장이 심사자 눈에 안 띈다.
  const NOTICE = '사진은 이 기기에만 저장되며 어디로도 전송되지 않습니다.';

  it('권한 거부 화면에도 적는다', async () => {
    setup({ media: { getUserMedia: DENIED } });
    await screen.findByText('카메라 권한이 꺼져 있어요. 토스 앱 설정에서 허용해 주세요');

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('카메라를 켜는 중에도 적는다', () => {
    setup({ media: { getUserMedia: () => new Promise<MediaStream>(() => {}) } });

    expect(screen.getByText('카메라를 켜는 중이에요…')).toBeTruthy();
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('저장할 수 없는 기기 안내에도 적는다', async () => {
    setup({ idb: undefined });
    await screen.findByText('이 기기에서는 사진을 저장할 수 없어요');

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });
});

describe('촬영 화면 — 저장할 수 없는 환경', () => {
  it('IDB가 없으면 찍기 전에 알린다 — 찍고 나서 못 넣는 것보다 낫다', async () => {
    setup({ idb: undefined });

    expect(await screen.findByText('이 기기에서는 사진을 저장할 수 없어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '촬영' })).toBeNull();
  });
});
