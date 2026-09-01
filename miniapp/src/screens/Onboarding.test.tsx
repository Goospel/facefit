// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Onboarding } from './Onboarding';

/**
 * 온보딩 한 화면.
 *
 * ⚠️ 여기서 잠그는 것은 예쁨이 아니라 **검수 요건**이다(설계 §5-5·§6): 카메라 권한
 * 프롬프트가 뜨기 **전에** 목적을 말해 두고, 사진이 기기를 안 떠난다고 적고, 그리고
 * **어디서도 「효과가 있다」를 단정하지 않는다.**
 */
afterEach(cleanup);

describe('온보딩', () => {
  it('무엇을 하는 앱인지 말한다', () => {
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/매일 같은 각도로 찍어/)).toBeTruthy();
  });

  it('어떻게 찍어야 비교가 되는지 말한다', () => {
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/아침 세안 직후/)).toBeTruthy();
  });

  it('사진이 기기를 안 떠난다고 적는다 — 검수와 사용자에게 같은 문장', () => {
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText('사진은 이 기기에만 저장되며 어디로도 전송되지 않습니다.')).toBeTruthy();
  });

  it('제품 검색이 밖으로 나가는 유일한 호출임을 먼저 말한다', () => {
    /*
      ⚠️ v2-2에서 「런타임 네트워크 호출 0」이 처음 깨진다(설계 §3-5). 사진 이야기(`LOCAL_ONLY`)는
      여전히 참이지만, 그 문장만 두면 **부분적으로 낡은 고지**가 된다 — 검수자가 번들에서
      네트워크 호출을 발견하고 묻기 전에 먼저 말한다.
    */
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/제품을 검색할 때만 식약처 공공 데이터를 조회해요/)).toBeTruthy();
  });

  it('카메라를 무엇에 쓰는지 권한 프롬프트가 뜨기 전에 말한다', () => {
    // 심사 관점의 요건이다 — 프롬프트가 먼저 뜨면 「왜 필요한가」에 답하는 문장이 없다.
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/카메라는 얼굴 사진을 찍는 데에만/)).toBeTruthy();
  });

  it('백업을 켜면 무엇이 나가는지 말한다 — 서버가 생긴 계단에서 먼저 말한다(v3 §3-8)', () => {
    /*
      v3에서 「서버 0」이 끝난다. `LOCAL_ONLY`(사진 문장)는 **글자 하나 안 바뀌고 여전히
      참이지만**, 그것만 두면 부분적으로 낡은 고지가 된다 — 백업을 켜면 제품·관찰이 나간다.
      검수자가 번들에서 발견하고 묻기 전에 먼저 말한다(v2-2와 같은 관례).
    */
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/기록 백업을 켜면/)).toBeTruthy();
    expect(screen.getByText(/얼굴 사진은 올라가지 않아요/)).toBeTruthy();
  });

  it('**낡은 단정이 남아 있지 않다** — 서버가 생겼는데 「서버도 없어요」가 남으면 거짓말이 된다', () => {
    /*
      이 테스트가 잡는 것은 새 문구가 아니라 **안 지운 옛 문구**다. 문구를 더하는 것은
      기억나지만 지우는 것은 잘 잊는다 — 그리고 남은 옛 문장이 새 문장과 정면으로 모순된다.
      「나가는 건 검색어뿐이에요」도 백업이 생긴 순간 거짓이다.
    */
    const { container } = render(<Onboarding onDone={vi.fn()} />);
    const text = container.textContent ?? '';
    for (const stale of ['계정도 서버도 없어요', '나가는 건 검색어뿐']) {
      expect(text.includes(stale), stale).toBe(false);
    }
  });

  it('로그인이 없다는 사실은 그대로 말한다 — 서버가 생긴 것과 계정이 생긴 것은 다르다', () => {
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/로그인도 계정도 없어요/)).toBeTruthy();
  });

  it('효과가 있다고 단정하지 않는다 — 관찰을 돕는 앱이지 판정하는 앱이 아니다', () => {
    const { container } = render(<Onboarding onDone={vi.fn()} />);
    const text = container.textContent ?? '';
    for (const claim of ['효과가 있어', '효과를 알려', '좋아집니다', '좋아져요']) {
      expect(text.includes(claim), claim).toBe(false);
    }
  });

  it('시작하기를 누르면 끝난다', () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    expect(onDone).toHaveBeenCalled();
  });
});
