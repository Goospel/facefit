import { useCallback, useEffect, useState } from 'react';

import { listPhotos, openPhotoDb, type FacePhoto as Photo, type PhotoDb } from '../photoStore';

/**
 * 사진을 쓰는 화면 셋(촬영·타임랩스·기록)이 나눠 쓰는 것 — DB 수명 · blob URL 수명 · 고지 문구.
 */

/**
 * 카메라·사진을 다루는 화면에 **상시** 붙는 한 줄. 사실이다 — 서버는 0대다.
 *
 * ⚠️ **restfit 검수를 통과한 문장 그대로다.** 검수와 사용자에게 같은 문장으로 답한다
 * (설계 §6). 화면마다 문구를 따로 적으면 그중 하나가 조용히 달라지고, 그때부터
 * 「어느 쪽이 사실인가」가 된다.
 */
export const LOCAL_ONLY = '사진은 이 기기에만 저장되며 어디로도 전송되지 않습니다.';

/**
 * 사진 목록을 쓰는 화면들이 나눠 쓰는 수명 관리.
 *
 * 화면마다 따로 열고 따로 닫으면 **닫는 쪽만 빠뜨리기 쉽다** — IDB 연결은 안 닫아도 에러가
 * 안 나고, 열린 채로 쌓이다가 다른 탭의 버전 변경을 막는 형태로 뒤늦게 드러난다. 그래서
 * 「열고 · 읽고 · 언마운트에 닫는다」를 한 곳에 둔다.
 *
 * ⚠️ **늦게 도착한 DB도 닫는다.** cleanup이 먼저 돌고 나서 `openPhotoDb`가 끝나는 순서가
 * 실제로 있다(화면을 빨리 닫는 경우) — 그때 그냥 두면 붙일 화면도 없는 연결이 살아남는다.
 */
export function usePhotos(idb?: IDBFactory) {
  /** `undefined`는 로딩, `null`은 「이 기기에서는 못 쓴다」. 둘을 합치면 화면이 안내와 로딩을 못 가른다. */
  const [db, setDb] = useState<PhotoDb | null | undefined>(undefined);
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    let dead = false;
    let mine: PhotoDb | null = null;
    void openPhotoDb(idb).then(async (opened) => {
      mine = opened;
      if (dead) return opened?.close();
      const list = opened ? await listPhotos(opened) : [];
      if (dead) return;
      setDb(opened);
      setPhotos(list);
    });
    return () => {
      dead = true;
      mine?.close();
    };
  }, [idb]);

  /**
   * 저장소를 **다시 읽는다.** 삭제 뒤에 로컬 배열에서 한 장 빼는 것으로 대신하면, 삭제가
   * 조용히 실패해도 화면은 지워진 것처럼 보인다 — 사용자는 지워졌다고 믿고, 사진은 남는다.
   */
  const reload = useCallback(async (open: PhotoDb) => setPhotos(await listPhotos(open)), []);

  return { db, photos, reload };
}

/**
 * blob URL 하나의 수명. **만든 곳이 revoke까지 책임진다** — 화면을 닫거나 원본이 바뀌면
 * 즉시 놓아준다. 안 놓으면 사진을 넘길 때마다 새고, 조용히 메모리만 자란다.
 */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [blob]);
  return url;
}
