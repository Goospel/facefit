import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE } from './backup';
import { cancelOilReminder, formatHm, oilState, scheduleOilReminder } from './reminder';

/**
 * 기름종이 알림의 순수 로직 + 서버 클라이언트(v5 설계 §3-2·§5-2 C-1).
 *
 * 규율은 `backup.ts`와 **동형**이다 — 어떤 실패도 밖으로 던지지 않고 `null`·`false`로 끝난다.
 * 서버가 죽어도 앱의 다른 기능은 그대로 돌아야 한다(설계 §0의 무음 폴백).
 *
 * 여기서 잠그는 것: **상태의 단일 출처는 `oilNextAt` 하나다**(화면은 서버를 조회하지 않는다) ·
 * **날짜가 바뀌면 자동으로 미예약**(그날 첫 기름종이가 다시 시작점이다) ·
 * **서버가 시각을 정한다**(3시간 상수는 서버에만 산다 — 클라는 받은 문자열을 그릴 뿐이다).
 */

const KEY = 'anon-hash-abcdef0123456789';
const ENDPOINT = `${API_BASE}/v1/reminder`;

/** 응답 하나짜리 가짜 fetch — `backup.test.ts`와 같은 관용구다. */
function fakeFetch(init: { status: number; body?: string } | Error) {
  if (init instanceof Error) return vi.fn().mockRejectedValue(init);
  return vi.fn().mockResolvedValue({
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    text: async () => init.body ?? '',
  } as unknown as Response);
}

beforeEach(() => vi.clearAllMocks());

describe('oilState — 상태의 단일 출처는 기기의 nextAt 하나다', () => {
  const now = new Date('2026-09-03T06:20:00Z'); // 2026-09-03 15:20 KST

  it('예약한 적이 없으면 미예약이다', () => {
    expect(oilState(null, now)).toBe('idle');
  });

  it('해석 안 되는 값은 미예약으로 친다 — 손상된 저장소 때문에 카드가 죽으면 안 된다', () => {
    expect(oilState('어제쯤', now)).toBe('idle');
    expect(oilState('', now)).toBe('idle');
  });

  it('아직 안 온 시각이면 예약됨이다', () => {
    expect(oilState('2026-09-03T09:20:00Z', now)).toBe('scheduled');
  });

  it('지난 시각이면 승인 대기다 — 알림이 갔으니 다음을 받을지 물을 차례다', () => {
    expect(oilState('2026-09-03T03:20:00Z', now)).toBe('awaiting');
  });

  /*
    ⚠️ **날짜 리셋은 지난 예약에만 건다.** 밤 11시 50분에 체크하면 예약은 자정을 넘겨 다음 날
    새벽 2시 50분이 되는데, 여기에도 날짜 비교를 걸면 **예약하자마자 「미예약」으로 보인다** —
    방금 누른 것이 없던 일이 되고, 사용자는 될 때까지 다시 누른다(누를 때마다 서버 행이
    덮어써지고 레이트리밋만 먹는다). 미래는 날짜와 무관하게 예약됨이다.
  */
  it('자정을 넘겨 잡힌 예약도 예약됨이다 — 방금 누른 것이 없던 일이 되면 안 된다', () => {
    // 2026-09-03 23:50 KST에 체크 → 09-04 02:50 KST 예약.
    expect(oilState('2026-09-03T17:50:00Z', new Date('2026-09-03T14:50:00Z'))).toBe('scheduled');
  });

  /*
    ⚠️ **날짜 리셋이 이 함수의 존재 이유다**(설계 §3-2). 어젯밤 알림에 응답하지 않은 사람에게
    다음 날 아침까지 「다음도 받을까요」를 들이밀면, 승인 게이트가 사실상 무기한 열려 있는
    것과 같다. 「그날 첫 기름종이」가 다시 시작점이라야 게이트가 하루짜리로 닫힌다.
  */
  it('어제 예약분은 미예약으로 되돌아간다 — 승인 게이트는 하루짜리다', () => {
    // 2026-09-02 23:50 KST. 지났지만 **어제**다.
    expect(oilState('2026-09-02T14:50:00Z', new Date('2026-09-03T00:30:00Z'))).toBe('idle');
  });

  /*
    ⚠️ 시간대를 인자로 받는 이유는 **테스트를 위해서다**(`todayKey`와 같은 사유). 개발 기계가
    한국 시간이라 `timeZone` 옵션을 통째로 빼도 결과가 같아, 이 케이스가 없으면 「KST 기준」
    이라는 규칙이 공허해진다.
  */
  it('날짜 경계는 KST로 자른다 — UTC로 자르면 밤 시간대가 통째로 어제로 밀린다', () => {
    const nextAt = '2026-09-02T13:00:00Z'; // KST 09-02 22:00 · UTC 09-02
    const at = new Date('2026-09-02T16:00:00Z'); // KST 09-03 01:00 · UTC 09-02

    expect(oilState(nextAt, at)).toBe('idle'); // KST로는 어제 것
    expect(oilState(nextAt, at, 'UTC')).toBe('awaiting'); // UTC로는 같은 날
  });
});

describe('formatHm — 서버가 준 시각을 그대로 한국 시간으로 읽는다', () => {
  it('ISO 문자열을 시:분으로 자른다', () => {
    expect(formatHm('2026-09-03T06:20:00Z')).toBe('15:20');
  });

  it('한국 시간으로 읽는다 — 기계 시간대를 따라가면 다른 시간대의 사용자에게 거짓말이 된다', () => {
    expect(formatHm('2026-09-03T06:20:00Z', 'UTC')).toBe('06:20');
  });
});

describe('scheduleOilReminder — 서버가 시각을 정한다', () => {
  it('서버가 준 dueAt을 그대로 돌려준다 — 3시간 상수는 서버에만 산다', async () => {
    const f = fakeFetch({ status: 200, body: '{"dueAt":"2026-09-03T09:20:00Z"}' });

    expect(await scheduleOilReminder(KEY, f)).toEqual({ dueAt: '2026-09-03T09:20:00Z' });
  });

  it('익명 키를 헤더로 싣고 본문 없이 PUT 한다 — 간격을 클라가 정하지 않는다', async () => {
    const f = fakeFetch({ status: 200, body: '{"dueAt":"2026-09-03T09:20:00Z"}' });

    await scheduleOilReminder(KEY, f);

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['X-Anon-Key']).toBe(KEY);
    expect(init.body).toBeUndefined();
  });

  it('서버가 거절하면 null이다 — 예약 안 됐는데 예약됨으로 그리면 거짓말이다', async () => {
    expect(await scheduleOilReminder(KEY, fakeFetch({ status: 500 }))).toBeNull();
    expect(await scheduleOilReminder(KEY, fakeFetch({ status: 401 }))).toBeNull();
  });

  it('네트워크가 끊겨도 던지지 않는다 — 오늘 탭이 서버 때문에 죽으면 주객전도다', async () => {
    expect(await scheduleOilReminder(KEY, fakeFetch(new TypeError('offline')))).toBeNull();
  });

  it('모양이 어긋난 응답도 null이다 — 못 믿을 값을 저장하면 화면이 빈 시각을 그린다', async () => {
    expect(await scheduleOilReminder(KEY, fakeFetch({ status: 200, body: '{"dueAt":null}' }))).toBeNull();
    expect(await scheduleOilReminder(KEY, fakeFetch({ status: 200, body: 'not json' }))).toBeNull();
  });
});

describe('cancelOilReminder — 그만 받기', () => {
  it('204면 지워졌다고 답한다', async () => {
    const f = fakeFetch({ status: 204 });

    expect(await cancelOilReminder(KEY, f)).toBe(true);

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['X-Anon-Key']).toBe(KEY);
  });

  it('실패해도 던지지 않는다 — 로컬은 어차피 지운다(무음 폴백)', async () => {
    expect(await cancelOilReminder(KEY, fakeFetch({ status: 500 }))).toBe(false);
    expect(await cancelOilReminder(KEY, fakeFetch(new TypeError('offline')))).toBe(false);
  });
});
