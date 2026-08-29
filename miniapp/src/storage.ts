/**
 * localStorage 영속. **서버가 없으므로 여기가 유일한 저장소다**(사진만 IndexedDB —
 * `photoStore.ts`).
 *
 * 읽기는 전부 방어적이다 — 프라이빗 모드에서 저장소가 막히거나, 옛 버전이 남긴 형태가
 * 달라도 앱이 죽으면 안 된다. 죽는 대신 빈 값으로 시작한다.
 *
 * ⚠️ 기기를 바꾸면 기록이 날아간다. 클라우드 동기화는 의도적 보류(설계 §7).
 */

/**
 * 한국 시간 기준 `YYYY-MM-DD`. **사진 키이자 제품 시작일·관찰 기록 키다.**
 *
 * UTC로 자르면 한국의 오전 9시 이전이 전날로 찍혀 **오늘 찍은 사진이 어제 칸에 들어간다.**
 * `sv-SE` 로케일이 `YYYY-MM-DD` 형태를 준다.
 *
 * ⚠️ `timeZone`이 인자인 이유는 **테스트를 위해서다.** 개발 기계가 한국 시간이라
 * 옵션을 통째로 빼도 결과가 같아 테스트가 공허해진다(restfit에서 돌연변이가 살아남아 발각됐다).
 * 다른 시간대를 넣었을 때 답이 달라지는지로 옵션이 실제로 쓰이는지 검증한다.
 */
export function todayKey(date: Date = new Date(), timeZone = 'Asia/Seoul'): string {
  return date.toLocaleDateString('sv-SE', { timeZone });
}
