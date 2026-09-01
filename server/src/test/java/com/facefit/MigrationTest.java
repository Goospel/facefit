package com.facefit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Flyway V1이 실제로 적용됐는지를 **테이블에 써 보고** 확인한다. information_schema를 뒤지는
 * 것보다 이쪽이 낫다 — 컬럼이 있는지뿐 아니라 「쓰고 읽을 수 있는지」까지 한 번에 걸린다.
 */
@SpringBootTest
@ActiveProfiles("test")
class MigrationTest {

	@Autowired
	private JdbcTemplate jdbc;

	/** sha256 hex는 항상 64자다 — 스키마가 CHAR(64)인 근거(설계 §4-2). */
	private static final String KEY_HASH = "a".repeat(64);

	@Test
	@DisplayName("backup 테이블에 쓰고 읽을 수 있다 — V1이 적용됐다는 뜻")
	void backupTable_roundTrips() {
		jdbc.update("INSERT INTO backup (key_hash, payload, client_saved_at, updated_at) VALUES (?, ?, ?, ?)",
				KEY_HASH, "{\"schemaVersion\":1}", "2026-09-01T00:00:00.000Z", LocalDateTime.now());

		String payload = jdbc.queryForObject(
				"SELECT payload FROM backup WHERE key_hash = ?", String.class, KEY_HASH);

		assertThat(payload).isEqualTo("{\"schemaVersion\":1}");
	}

	@Test
	@DisplayName("64KB를 넘는 페이로드가 잘리지 않는다 — TEXT가 아니라 MEDIUMTEXT여야 하는 이유")
	void backupTable_holdsPayloadLargerThanTextLimit() {
		// TEXT(64KB)로 되돌리는 변경을 잡으려는 테스트다. 상한이 512KB라 그 아래 크기를 넣는다.
		String big = "x".repeat(100_000);

		jdbc.update("INSERT INTO backup (key_hash, payload, updated_at) VALUES (?, ?, ?)",
				"b".repeat(64), big, LocalDateTime.now());

		Integer length = jdbc.queryForObject(
				"SELECT LENGTH(payload) FROM backup WHERE key_hash = ?", Integer.class, "b".repeat(64));

		assertThat(length).isEqualTo(100_000);
		// ponytail: H2는 MEDIUMTEXT도 TEXT도 CLOB으로 매핑해서, **이 테스트가 H2에서는
		// TEXT 회귀를 못 잡는다**(양쪽 다 통과한다). 진짜 관문은 실제 MySQL이다 —
		// 태스크 2의 512KB 경계 테스트에서 Testcontainers 승격을 판단한다(설계 §4-1).
	}

	@Test
	@DisplayName("같은 키로 두 번 저장할 수 없다 — 사용자 한 명당 블롭 하나(PK)")
	void backupTable_rejectsDuplicateKey() {
		jdbc.update("INSERT INTO backup (key_hash, payload, updated_at) VALUES (?, ?, ?)",
				"c".repeat(64), "{}", LocalDateTime.now());

		// 저장 폭탄의 피해 상한이 「키당 1블롭」인 근거가 이 제약이다(설계 §3-1).
		assertThat(
				org.junit.jupiter.api.Assertions.assertThrows(
						org.springframework.dao.DuplicateKeyException.class,
						() -> jdbc.update("INSERT INTO backup (key_hash, payload, updated_at) VALUES (?, ?, ?)",
								"c".repeat(64), "{}", LocalDateTime.now())))
				.isNotNull();
	}
}
