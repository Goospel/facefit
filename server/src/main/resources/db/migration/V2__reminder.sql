-- v5 태스크 S-1 — 기름종이 알림 예약 한 줄(설계 `docs/2026-09-03-oil-paper-reminder-design.md` §3-4).
--
-- 이 테이블은 **큐가 아니라 예약 한 줄**이다. 키 하나당 최대 한 행이고, 다시 체크하면 덮어쓰며,
-- 발송되면 지운다 — 행 수명이 약 3시간이라 이력도 통계도 여기 남지 않는다(비목표, 설계 §1).

CREATE TABLE reminder (
  -- backup 테이블과 같은 축 — sha256(익명 키)의 hex, 항상 64자.
  key_hash   CHAR(64)       NOT NULL PRIMARY KEY,
  -- ⚠️ 원 키를 **평문으로 두지 않는다**. 발송 API(`x-anon-key`)가 원 키를 요구하는데,
  --    그 키는 동시에 백업 열람 토큰이다(`AnonKey` 주석). 그래서 AES-GCM으로 봉인해 둔다 —
  --    DB만 새서는 남의 백업이 열리지 않는다(`KeyCipher`). IV 12B가 앞에 붙어 있다.
  key_enc    VARBINARY(512) NOT NULL,
  -- UTC(설계 §4-1). MySQL TIMESTAMP는 세션 타임존으로 조용히 밀리므로 안 쓴다.
  due_at     DATETIME(3)    NOT NULL,
  -- 발송 시도 횟수. 3이 되면 워커가 더 안 집고, 청소 쿼리가 하루 뒤 지운다.
  attempts   TINYINT        NOT NULL DEFAULT 0,
  created_at DATETIME(3)    NOT NULL
);

-- 워커가 분마다 `due_at <= now`를 훑는다 — 전체 행이 적어도 스캔을 습관으로 두지 않는다.
CREATE INDEX idx_reminder_due ON reminder (due_at);
