import { describe, expect, it } from 'vitest';

import { todayKey } from './storage';

describe('todayKey', () => {
  it('한국 시간 기준 YYYY-MM-DD를 준다', () => {
    // UTC 2026-08-29 00:30 → KST로는 이미 09:30, 같은 날이다.
    expect(todayKey(new Date('2026-08-29T00:30:00Z'))).toBe('2026-08-29');
  });

  it('UTC로 자르면 전날이 되는 시각도 한국 날짜로 찍는다', () => {
    // ⚠️ 여기가 이 함수의 존재 이유다. UTC 2026-08-28 20:00은 KST로 **다음 날 새벽 5시**다.
    // UTC로 자르면 사진 키가 하루 밀려, 「오늘 찍은 사진」이 어제 칸에 들어간다.
    expect(todayKey(new Date('2026-08-28T20:00:00Z'))).toBe('2026-08-29');
  });

  it('시간대를 바꾸면 답이 달라진다 — 옵션이 실제로 쓰인다는 유일한 증거', () => {
    /*
      ⚠️ 개발 기계가 KST라 `timeZone` 옵션을 통째로 빼도 위 두 테스트가 그대로 통과한다
      (restfit에서 돌연변이가 살아남아 발각됐다). 다른 시간대를 주입해 값이 갈리는지로
      옵션이 죽지 않았음을 잠근다.
    */
    const t = new Date('2026-08-28T20:00:00Z');
    expect(todayKey(t, 'UTC')).toBe('2026-08-28');
    expect(todayKey(t, 'Asia/Seoul')).toBe('2026-08-29');
  });
});
