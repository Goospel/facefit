-- v3-1 태스크 1 — 백업 테이블 하나만. 크라우드소싱 계열(community_*)은 v3-3에서 V2로 붙인다.
-- 설계 §4-2.

-- ⚠️ payload가 JSON이 아니라 MEDIUMTEXT인 이유 — 둘 다 실질적이다:
--    ① MySQL의 JSON 타입은 저장 시 **정규화**한다(공백 제거·객체 키 재정렬). 그러면 「클라의
--       미지 필드를 있는 그대로 왕복 보존한다」는 규약(설계 §4-2)이 바이트 단위로 깨진다 —
--       v4 클라가 넣은 필드가 v3 서버를 거쳐 나올 때 모양이 달라진다.
--    ② TEXT는 64KB라 512KB 상한을 못 담는다. MEDIUMTEXT(16MB)가 담을 수 있는 최소 크기다.
--    서버가 블롭 내부를 질의하지 않으므로 JSON 타입의 이점은 애초에 없다.

-- ⚠️ ENGINE·CHARSET을 안 적는다. MySQL 8.4의 기본값이 이미 InnoDB + utf8mb4이고,
--    데이터베이스 자체를 utf8mb4로 만든다(설계 §5). 적어 봐야 중복인데 H2 테스트에서만 걸린다.
CREATE TABLE backup (
  -- sha256(익명 키)의 hex — 항상 64자다. 원 키는 저장하지 않는다(설계 §3-1):
  -- DB가 새도 열람 토큰(=원 키)은 안 새야 한다.
  key_hash        CHAR(64)    NOT NULL PRIMARY KEY,
  payload         MEDIUMTEXT  NOT NULL,
  -- 클라가 만든 문자열을 그대로 보관한다 — 복원 미리보기에 「언제 저장분」을 보여주는 재료.
  client_saved_at VARCHAR(32) NULL,
  -- UTC(설계 §4-1). MySQL TIMESTAMP는 세션 타임존으로 자동 변환돼 조용히 밀리므로 안 쓴다.
  updated_at      DATETIME(3) NOT NULL
);
