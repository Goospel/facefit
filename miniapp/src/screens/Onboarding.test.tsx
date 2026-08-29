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

  it('카메라를 무엇에 쓰는지 권한 프롬프트가 뜨기 전에 말한다', () => {
    // 심사 관점의 요건이다 — 프롬프트가 먼저 뜨면 「왜 필요한가」에 답하는 문장이 없다.
    render(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText(/카메라는 얼굴 사진을 찍는 데에만/)).toBeTruthy();
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
