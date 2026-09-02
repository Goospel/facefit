import { describe, expect, it } from 'vitest';

import { ICONS } from './Icon';

/**
 * 타입은 「이름이 존재한다」까지만 막는다. **이름만 있고 그림이 없는 아이콘은 컴파일을
 * 통과하고 화면에 빈 칸으로 뜬다** — 그걸 여기서 막는다.
 */
describe('아이콘', () => {
  it('탭 셋과 셰브론, 상태·촬영 아이콘이 모두 있다', () => {
    expect(Object.keys(ICONS).sort()).toEqual(['bottle', 'calendar', 'check', 'chevron', 'face', 'layers', 'timer']);
  });

  it('이름만 있고 그림이 빈 아이콘이 없다', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
    }
  });

  it('모든 path가 moveto로 시작한다 — 아니면 아무것도 안 그려진다', () => {
    // `d`에 시작점이 없으면 브라우저는 **에러 없이 그 path를 통째로 무시한다.**
    for (const [name, paths] of Object.entries(ICONS)) {
      for (const d of paths) expect(d.startsWith('M'), `${name}: ${d.slice(0, 20)}…`).toBe(true);
    }
  });
});
