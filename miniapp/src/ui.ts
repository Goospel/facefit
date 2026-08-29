import type { CSSProperties } from 'react';

/**
 * 화면들이 나눠 쓰는 스타일. restfit에서 검증된 값을 그대로 가져왔다.
 *
 * 색·간격은 `index.css`의 CSS 변수를 참조한다 — 값을 여기에 직접 박으면
 * 화면마다 미묘하게 달라진다.
 */

type S = Record<string, CSSProperties>;

export const ui: S = {
  // ── 레이아웃
  // 하단 패딩은 탭바가 실제로 차지하는 높이(캡슐 + 띄운 거리)를 그대로 따라간다 — 한쪽만 고치면
  // 콘텐츠 끝이 탭바에 조용히 가린다. 그래서 `--tab-lift`를 양쪽이 같은 출처로 본다.
  page: { padding: '16px 20px calc(var(--tab-h) + var(--tab-lift) + 24px)', minHeight: '100vh' },
  pageFull: { padding: '16px 20px calc(var(--safe-b) + 24px)', minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  h1: { fontSize: 22, fontWeight: 700, margin: '4px 0 20px' },
  h2: { fontSize: 17, fontWeight: 700, margin: '0 0 4px' },
  sub: { fontSize: 13, color: 'var(--text-sub)', margin: '0 0 16px' },
  card: { background: 'var(--bg-sub)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 },
  row: { display: 'flex', gap: 8 },
  spacer: { flex: 1 },

  // ── 버튼
  primary: {
    width: '100%',
    padding: '15px 12px',
    fontSize: 16,
    fontWeight: 700,
    color: '#fff',
    background: 'var(--blue)',
    border: 0,
    borderRadius: 12,
  },
  secondary: {
    width: '100%',
    padding: '13px 12px',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-sub)',
    background: 'var(--bg-sub)',
    border: '1px solid var(--line)',
    borderRadius: 12,
  },
  ghost: {
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--text-weak)',
    background: 'none',
    border: 0,
    borderRadius: 8,
  },
  disabled: { background: 'var(--line-strong)', color: '#fff' },

  // ── 입력
  input: {
    width: '100%',
    padding: '13px 14px',
    fontSize: 17,
    fontWeight: 600,
    textAlign: 'center',
    color: 'var(--text)',
    background: '#fff',
    border: '1px solid var(--line-strong)',
    borderRadius: 12,
  },
  label: { fontSize: 12, color: 'var(--text-sub)', display: 'block', marginBottom: 6 },

  // ── 조각
  /**
   * ⚠️ 테두리를 **shorthand(`border`)로 쓰지 않는다.** 쓰는 쪽이 `borderColor`만 덮으면
   * React가 리렌더에서 그 non-shorthand 값을 지워 버린다("Removing borderColor") —
   * 클래스가 아니라 인라인 스타일을 합치는 구조라서 생기는 함정이고, **첫 렌더에는 멀쩡히
   * 보이다가 리렌더에서만 색이 풀려서** 눈으로 잡기 어렵다. 쪼개 두면 덮어쓰기가 안전하다.
   */
  chip: {
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-sub)',
    background: 'var(--bg-sub)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--line)',
    borderRadius: 999,
  },
  empty: { padding: '48px 20px', textAlign: 'center', color: 'var(--text-weak)', fontSize: 14 },

  /**
   * 화면 밑에 붙어 따라오는 버튼 자리.
   *
   * 내용이 길어지면 확정 버튼이 화면 밖으로 밀려 **한 번 더 스크롤해야 보인다.**
   * 온보딩에서 「시작하기」를 못 찾는 건 그대로 이탈이다.
   *
   * ⚠️ 좌우 여백을 음수 마진으로 뚫어 화면 끝까지 덮는다 — 안 그러면 스크롤되는 콘텐츠가
   * 버튼 **옆으로 비쳐 지나간다.**
   */
  stickyFooter: {
    position: 'sticky',
    bottom: 0,
    margin: '16px -20px 0',
    padding: '12px 20px calc(var(--safe-b) + 12px)',
    background: 'var(--bg)',
    borderTop: '1px solid var(--line)',
  },
};
