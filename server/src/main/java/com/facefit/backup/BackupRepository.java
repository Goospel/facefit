package com.facefit.backup;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 키 하나당 블롭 하나. 프로토콜이 <b>전체 덮어쓰기(LWW)</b>라 부분 갱신이라는 개념 자체가
 * 없다(설계 §3-3) — 그래서 여기 메서드가 셋뿐이다.
 */
@Repository
class BackupRepository {

	private final JdbcTemplate jdbc;

	BackupRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/**
	 * 덮어쓴다. {@code INSERT ... ON DUPLICATE KEY UPDATE} 대신 <b>지우고 넣는다</b> —
	 * 그 구문은 MySQL 방언이라 H2 테스트와 갈라질 여지가 있는데, 얻는 것은 왕복 한 번뿐이다.
	 * 전체 덮어쓰기가 곧 이 연산의 의미이기도 해서 「지우고 넣기」가 오히려 정직하다.
	 */
	@Transactional
	void save(String keyHash, String payload, String clientSavedAt, Instant now) {
		jdbc.update("DELETE FROM backup WHERE key_hash = ?", keyHash);
		jdbc.update("INSERT INTO backup (key_hash, payload, client_saved_at, updated_at) VALUES (?, ?, ?, ?)",
				keyHash, payload, clientSavedAt, Timestamp.from(now));
	}

	Optional<String> find(String keyHash) {
		List<String> found = jdbc.queryForList(
				"SELECT payload FROM backup WHERE key_hash = ?", String.class, keyHash);
		return found.stream().findFirst();
	}

	/** 없어도 조용히 지나간다 — 「백업 끄기」는 멱등이어야 클라가 결과를 안 봐도 된다. */
	void delete(String keyHash) {
		jdbc.update("DELETE FROM backup WHERE key_hash = ?", keyHash);
	}
}
