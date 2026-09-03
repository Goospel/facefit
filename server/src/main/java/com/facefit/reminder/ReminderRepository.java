package com.facefit.reminder;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

/**
 * 키 하나당 예약 한 줄. 큐가 아니다 — 다시 체크하면 <b>덮어쓰고</b>, 보내면 지운다(설계 §3-4).
 *
 * <p>덮어쓰기를 {@code INSERT ... ON DUPLICATE KEY UPDATE} 대신 <b>지우고 넣기</b>로 한 것은
 * {@code BackupRepository}와 같은 이유다(MySQL 방언을 피하고, 의미 자체가 전체 덮어쓰기다).
 * 덤으로 {@code attempts}가 0으로 돌아간다 — 재체크는 새 예약이지 옛 시도의 연장이 아니다.
 */
@Repository
class ReminderRepository {

	/** 발송 시도 상한. 넘으면 워커가 더 안 집고, {@link #purge} 가 하루 뒤 치운다(설계 §3-4). */
	static final int MAX_ATTEMPTS = 3;

	private final JdbcTemplate jdbc;

	ReminderRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 보낼 차례가 된 한 행 — 워커가 원 키를 되찾으려면 봉인 바이트가 필요하다. */
	record Due(String keyHash, byte[] keyEnc) {
	}

	@Transactional
	void upsert(String keyHash, byte[] keyEnc, Instant dueAt) {
		jdbc.update("DELETE FROM reminder WHERE key_hash = ?", keyHash);
		jdbc.update("INSERT INTO reminder (key_hash, key_enc, due_at, attempts, created_at) "
				+ "VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)", keyHash, keyEnc, Timestamp.from(dueAt));
	}

	/** 시각이 됐고 아직 상한에 안 닿은 행들. 오래된 것부터 — 밀리면 밀린 순서대로 나간다. */
	List<Due> findDue(Instant now, int limit) {
		return jdbc.query("SELECT key_hash, key_enc FROM reminder "
						+ "WHERE due_at <= ? AND attempts < " + MAX_ATTEMPTS + " ORDER BY due_at LIMIT ?",
				(rs, rowNum) -> new Due(rs.getString("key_hash"), rs.getBytes("key_enc")),
				Timestamp.from(now), limit);
	}

	/**
	 * 시도 횟수를 <b>보내기 전에</b> 올린다. 발송 뒤에 올리면 크래시·타임아웃이 시도를 0으로
	 * 남겨, 다음 분에 같은 행이 다시 나가고 그게 무한히 반복된다 — 사용자에겐 알림 폭탄이다.
	 */
	void claim(String keyHash) {
		jdbc.update("UPDATE reminder SET attempts = attempts + 1 WHERE key_hash = ?", keyHash);
	}

	/** 없어도 조용히 지나간다 — 「그만 받기」는 멱등이어야 클라가 결과를 안 봐도 된다. */
	void delete(String keyHash) {
		jdbc.update("DELETE FROM reminder WHERE key_hash = ?", keyHash);
	}

	/** 상한까지 실패한 행을 방치하지 않는다. 이 테이블에 오래 사는 행은 없어야 한다(설계 §3-4). */
	void purge(Instant before) {
		jdbc.update("DELETE FROM reminder WHERE due_at < ?", Timestamp.from(before));
	}
}
