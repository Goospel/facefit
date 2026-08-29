import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 미니앱에서 화면 확대는 필요 없는데, 실제로는 핀치나 빠른 연속 탭(+/− 버튼)이 확대로 잡혀
 * 화면이 잘린다. 막는 곳이 두 파일로 나뉘어 있어서(뷰포트 메타 · CSS) 되돌려도 조용해진다 —
 * 그래서 소스 파일을 직독해 두 방어선이 다 서 있는지 잠근다.
 */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf-8');

describe('확대 금지', () => {
  it('뷰포트 메타가 핀치 줌을 막는다', () => {
    const viewport = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1];
    expect(viewport).toBeDefined();
    expect(viewport).toContain('maximum-scale=1.0');
    expect(viewport).toContain('user-scalable=no');
  });

  it('html, body에 touch-action: manipulation이 있어 더블탭 확대가 안 잡힌다', () => {
    const block = /html,\s*body\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(block).toBeDefined();
    expect(block).toContain('touch-action: manipulation');
  });
});
