// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isNotifySupported, requestNotifyAgreement } from '../notify';
import { listPhotos, type FacePhoto as Photo } from '../photoStore';
import type { Notes, Product } from '../storage';
import { Home } from './Home';

/**
 * 오늘 탭.
 *
 * **오늘 찍었는가**가 이 화면이 답하는 유일한 질문이다 — 나머지(제품 요약·관찰 답)는
 * 그 답에 딸린 맥락이다.
 *
 * ⚠️ 저장소는 목이다 — 사유는 [T-002]·[T-003]. 타이머를 안 쓰므로 `openPhotoDb`만 목이면 된다.
 */
vi.mock('../photoStore', async (orig) => ({
  ...(await orig<typeof import('../photoStore')>()),
  openPhotoDb: vi.fn(async () => ({ close: () => {} }) as unknown as import('../photoStore').PhotoDb),
  listPhotos: vi.fn(),
}));

/** 알림 동의는 토스 웹뷰 브릿지다 — 여기엔 없다. 래퍼 자체는 `notify.test.ts`가 잰다. */
vi.mock('../notify', () => ({ isNotifySupported: vi.fn(), requestNotifyAgreement: vi.fn() }));

afterEach(cleanup);

const TODAY = '2026-08-29';

const photo = (date: string): Photo => ({ date, blob: new Blob([date]), capturedAt: 1, width: 960, height: 1280 });

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: '토너',
  category: 'toner',
  startDate: '2026-08-01',
  ...over,
});

function setup(over: { photos?: string[]; products?: Product[]; notes?: Notes } = {}) {
  vi.mocked(listPhotos).mockResolvedValue((over.photos ?? []).map(photo));
  const onShoot = vi.fn();
  const view = render(
    <Home products={over.products ?? []} notes={over.notes ?? {}} date={TODAY} onShoot={onShoot} />,
  );
  return { onShoot, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:today');
  URL.revokeObjectURL = vi.fn();
  // 기본은 알림을 받을 수 있는 기기다 — 못 받는 기기는 아래에서 따로 잰다.
  vi.mocked(isNotifySupported).mockReturnValue(true);
});

describe('촬영 입구', () => {
  it('아직 안 찍었으면 찍자고 한다', async () => {
    setup();
    expect(await screen.findByRole('button', { name: '오늘 얼굴 찍기' })).toBeTruthy();
  });

  it('누르면 촬영 화면을 연다', async () => {
    const { onShoot } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '오늘 얼굴 찍기' }));
    expect(onShoot).toHaveBeenCalled();
  });

  it('오늘 찍었으면 그 사진을 보여주고 다시 찍기를 연다', async () => {
    setup({ photos: [TODAY] });

    expect(await screen.findByAltText('오늘 찍은 사진')).toBeTruthy();
    // 하루 1장이라 다시 찍으면 덮어쓴다 — 버튼 문구가 그걸 미리 말한다.
    expect(screen.getByRole('button', { name: '다시 찍기' })).toBeTruthy();
  });

  it('어제 사진은 「오늘 찍었다」로 안 센다', async () => {
    setup({ photos: ['2026-08-28'] });
    expect(await screen.findByRole('button', { name: '오늘 얼굴 찍기' })).toBeTruthy();
  });
});

describe('오늘의 관찰 답', () => {
  it('답한 날은 그 답을 보여준다', async () => {
    setup({ photos: [TODAY], notes: { [TODAY]: 'better' } });
    expect(await screen.findByText('좋아졌어요')).toBeTruthy();
  });

  it('건너뛴 날은 아무 말도 안 한다 — 「미응답」을 적으면 안 한 것이 실패로 보인다', async () => {
    setup({ photos: [TODAY] });
    await screen.findByAltText('오늘 찍은 사진');
    expect(screen.queryByTestId('today-note')).toBeNull();
  });
});

/**
 * 아침 알림 상시 진입점(설계 §3-2).
 *
 * **동의 상태를 앱이 추적하지 않는다** — 단일 출처는 토스다. 그래서 버튼은 늘 같은 자리에
 * 있고, 이미 동의한 사람이 눌러도 `alreadyAgreed`로 무해하게 끝나며(멱등), 토스 설정에서
 * **철회한 사람의 재동의 경로를 그대로 겸한다**(철회 감지 기능 없이).
 */
describe('아침 알림 진입점', () => {
  const ASK = '아침 알림 받기';
  const DONE = '아침 알림 켜짐';

  /** 눌러서 토스가 준 결과를 흘려 넣는다. 이 셋이 SDK가 주는 전부다(+ 우리가 만든 `unavailable`). */
  async function press(result: 'newAgreement' | 'alreadyAgreed' | 'agreementRejected' | 'unavailable') {
    fireEvent.click(await screen.findByRole('button', { name: ASK }));
    const [onDone] = vi.mocked(requestNotifyAgreement).mock.calls[0];
    act(() => onDone(result));
  }

  const sub = () => screen.getByTestId('notify-sub').textContent ?? '';

  it('오늘 찍었든 안 찍었든 늘 같은 자리에 있다 — 재동의 경로를 겸한다', async () => {
    setup();
    expect(await screen.findByRole('button', { name: ASK })).toBeTruthy();

    cleanup();
    setup({ photos: [TODAY] });
    expect(await screen.findByRole('button', { name: ASK })).toBeTruthy();
  });

  it('알림을 못 받는 기기(구버전 토스·토스 밖)에서는 버튼 자체가 없다', async () => {
    // 눌러도 열 수 없는 시트다 — 죽은 버튼을 남기면 사용자는 「눌렀는데 아무 일도 없다」를 본다(설계 §3-2).
    vi.mocked(isNotifySupported).mockReturnValue(false);
    setup();
    await screen.findByRole('button', { name: '오늘 얼굴 찍기' });

    expect(screen.queryByRole('button', { name: ASK })).toBeNull();
  });

  it('누르면 토스 동의 화면을 연다', async () => {
    setup();

    fireEvent.click(await screen.findByRole('button', { name: ASK }));

    expect(requestNotifyAgreement).toHaveBeenCalledTimes(1);
  });

  it('언제 오는지 말한다 — 「받겠다」를 고르는 데 필요한 유일한 정보다', async () => {
    setup();

    expect((await screen.findByTestId('notify-sub')).textContent).toContain('아침 8시');
  });

  /*
    ⚠️ **누른 결과가 화면에 안 보이면 그건 무음 폴백이 아니라 깜깜한 것이다**(T-010의 두 번째
    결함). 실기기에서 「받기」를 눌렀는데 아무 변화가 없어 **켜진 건지 아닌 건지 알 수 없다**는
    보고를 받았다(2026-09-01).

    상태를 물어보는 API가 없어서(SDK 실측: `Notification`에는 `requestAgreement` 하나뿐)
    렌더 시점에는 여전히 모른다. 하지만 **누르는 순간만큼은 토스가 진실을 준다** —
    `newAgreement`(방금 켜짐)와 `alreadyAgreed`(원래 켜져 있음)를 구별해서. 그 순간을
    화면에 그대로 옮기는 것이 이 앱이 할 수 있는 최선이고, 옛 코드는 그걸 boolean으로
    뭉개 버려 **이미 켠 사용자에게 해 줄 말이 없었다.**
  */
  it('방금 켜졌으면 켰다고 말한다', async () => {
    setup();

    await press('newAgreement');

    expect(sub()).toContain('알림을 켰어요');
    expect(screen.getByRole('button', { name: DONE })).toBeTruthy();
  });

  it('이미 켜져 있었으면 그렇다고 말한다 — 「켜진 건지 모르겠다」에 답하는 유일한 줄이다', async () => {
    setup();

    await press('alreadyAgreed');

    expect(sub()).toContain('이미 켜져 있어요');
    expect(screen.getByRole('button', { name: DONE })).toBeTruthy();
  });

  /*
    ⚠️ **「앱 밖에서 끌 수 있어요」만으로는 못 끈다.** 실기기에서 그 문구를 보고도 끄지
    못했다는 보고를 받았다(2026-09-01) — 끄는 곳이 어디인지를 안 적었기 때문이다.
    앱에는 끌 수단이 없고(SDK에 철회 API가 없다) 토스 설정은 **여러 단계 안쪽**이라,
    경로를 글자로 안 주면 사실상 못 끄는 것과 같다.

    경로는 토스 공식 문서의 값이다(스마트 발송 가이드) — 짐작해 적으면 안 되는 값이라
    출처를 여기 남긴다. 같은 문서가 「알림 동의문에 철회 경로를 명확히 포함하는 걸
    권장」한다고 적고 있다.
  */
  it('끄는 경로를 **단계까지** 적는다 — 「앱 밖에서」만으로는 못 끈다', async () => {
    setup();

    // 어느 줄에 적히든 상관없다 — 잠그는 것은 **경로가 화면에 있는가**다.
    expect(await screen.findByText(/전체 → 설정 → 알림 → 서비스별 알림/)).toBeTruthy();
  });

  /*
    ⚠️ **끄는 경로를 「켜짐」 결과 뒤에 숨기면 안 된다.** 처음엔 그렇게 짰는데, 실기기에서
    요청이 `unavailable`로 실패하자 **경로가 아예 안 보였다**(2026-09-01 · 스크린샷).
    끄고 싶은 사람에게 「먼저 켜기에 성공해야 끄는 법을 알려준다」는 앞뒤가 안 맞는다.

    게다가 앱은 **켜졌는지 알지도 못한다**(조회 API 없음 — T-012). 즉 「켜짐일 때만 보여준다」는
    조건 자체가 성립하지 않는다 — 몇 주 전에 켠 사람은 앱을 열어도 그 조건에 영영 안 걸린다.
    상태와 무관하게 늘 보이는 것이 유일하게 맞는 답이다(켜기 전에 보이는 것도 이롭다 —
    빠져나갈 길을 알고 켜게 된다).
  */
  it.each(['agreementRejected', 'unavailable'] as const)(
    '%s로 끝나도 끄는 경로는 그대로 보인다 — 켜기에 성공해야 끄는 법을 알려주는 건 앞뒤가 안 맞는다',
    async (result) => {
      setup();

      await press(result);

      expect(screen.getByText(/전체 → 설정 → 알림 → 서비스별 알림/)).toBeTruthy();
    },
  );

  it('거절하면 안 켜졌다고 말하고 다시 누를 수 있게 둔다 — 안 된 것을 됐다고 하지 않는다', async () => {
    setup();

    await press('agreementRejected');

    expect(sub()).toContain('켜지 않았어요');
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    expect(screen.queryByRole('button', { name: DONE })).toBeNull();
  });

  /*
    ⚠️ **거절과 갈라서 말한다.** 브릿지가 죽어 못 물어본 것을 「안 켰어요」로 적으면 거짓말이고,
    사용자는 자기가 거절한 줄 알고 다시 안 누른다. 색까지 바꾸는 이유는 이게 **앱 쪽 고장**이라
    사용자가 할 일이 「다시 눌러 보기」밖에 없기 때문이다.
  */
  it('열지 못했으면 거절과 다르게 말한다 — 못 물어본 것을 거절로 적지 않는다', async () => {
    setup();

    await press('unavailable');

    expect(sub()).toContain('열 수 없어요');
    expect(screen.getByTestId('notify-sub').getAttribute('style')).toContain('--amber');
  });

  /*
    ⚠️ **이 행은 스위치가 아니라 행동이다**(위 주석). 그런데 백업 스위치와 같은 카드 가족이라
    오른쪽 작은 글자만으로는 구별이 안 됐다 — 알약(테두리 두른 캡슐)은 「누르면 무언가
    열린다」를 그림으로 말한다. 반대로 **이미 켜진 뒤에는 알약을 걷는다**: 켜진 상태에 알약을
    두면 도로 「눌러야 할 것」으로 읽힌다.
  */
  it('아직 안 켠 상태의 오른쪽은 누를 것처럼 생긴 알약이다', async () => {
    setup();

    const right = await screen.findByTestId('notify-right');
    expect(right.textContent).toContain('받기');
    expect(right.getAttribute('style')).toContain('999');
  });

  it('켜진 뒤에는 알약이 아니라 체크 표식과 「켜짐」이다 — 켜진 것을 또 누르라고 하지 않는다', async () => {
    setup();

    await press('newAgreement');

    const right = screen.getByTestId('notify-right');
    expect(right.textContent).toContain('켜짐');
    expect(right.querySelector('svg')).toBeTruthy();
    expect(right.getAttribute('style')).not.toContain('999');
  });

  it('열지 못했으면 알약을 그대로 둔다 — 다시 누르라는 뜻이 맞다', async () => {
    setup();

    await press('unavailable');

    expect(screen.getByTestId('notify-right').getAttribute('style')).toContain('999');
  });
});

describe('사용 중 제품 요약', () => {
  it('오늘 쓰고 있는 제품만 센다', async () => {
    setup({
      products: [product({ id: 'a' }), product({ id: 'b', name: '옛세럼', endDate: '2026-08-10' })],
      photos: [],
    });

    expect(await screen.findByText('토너')).toBeTruthy();
    expect(screen.queryByText('옛세럼')).toBeNull();
  });

  it('제품이 없으면 등록을 권한다 — 제품이 없으면 이 앱의 절반이 빈다', async () => {
    setup();
    expect(await screen.findByText(/제품 탭에서 등록/)).toBeTruthy();
  });
});
