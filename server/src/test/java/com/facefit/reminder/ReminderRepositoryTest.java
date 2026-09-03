package com.facefit.reminder;

import com.facefit.common.KeyCipher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.TimeZone;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 시각을 <b>JVM 기본 타임존과 무관하게</b> 쓴다는 것 하나를 잰다.
 *
 * <p>운영 컨테이너는 UTC로 뜨지만({@code -Duser.timezone=UTC}) 그건 compose 한 줄에 걸린
 * 전제일 뿐이다. {@code Timestamp.from(instant)}는 드라이버가 <b>JVM 기본 타임존의 벽시계</b>로
 * 바꿔 쓰기 때문에, 그 한 줄이 빠지거나 로컬에서 돌리는 순간 {@code due_at}이 9시간 밀린다 —
 * 그러면 워커의 {@code due_at <= now} 비교가 통째로 어긋나 알림이 세 시간이 아니라 열두 시간
 * 뒤에 가거나, 넣자마자 나간다. 그래서 저장은 <b>UTC {@code LocalDateTime}</b>으로 못 박는다.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReminderRepositoryTest {

	@Autowired
	private ReminderRepository repository;

	@Autowired
	private KeyCipher cipher;

	@Autowired
	private JdbcTemplate jdbc;

	private static final String HASH = "f".repeat(64);

	@BeforeEach
	void reset() {
		jdbc.update("DELETE FROM reminder");
	}

	@Test
	@DisplayName("JVM이 KST여도 due_at은 UTC 벽시계로 저장된다 — 타임존이 바뀌어도 예약이 안 밀린다")
	void upsert_storesDueAtInUtc() {
		TimeZone original = TimeZone.getDefault();
		try {
			TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"));

			repository.upsert(HASH, cipher.seal("key-tz"), Instant.parse("2026-09-03T17:00:00Z"));

			String stored = jdbc.queryForObject(
					"SELECT due_at FROM reminder WHERE key_hash = ?", String.class, HASH);
			// KST 벽시계로 쓰였다면 여기서 02:00(다음 날)이 나온다.
			assertThat(stored).startsWith("2026-09-03 17:00");
		} finally {
			TimeZone.setDefault(original);
		}
	}

	@Test
	@DisplayName("KST에서 저장한 행도 UTC 기준 findDue에 제때 잡힌다 — 저장과 조회가 같은 축이다")
	void findDue_matchesRowsStoredUnderAnotherTimeZone() {
		Instant due = Instant.parse("2026-09-03T17:00:00Z");
		TimeZone original = TimeZone.getDefault();
		try {
			TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"));
			repository.upsert(HASH, cipher.seal("key-tz"), due);
		} finally {
			TimeZone.setDefault(original);
		}

		// 1분 전에는 안 잡히고, 1분 뒤에는 잡힌다.
		assertThat(repository.findDue(due.minus(1, ChronoUnit.MINUTES), 10)).isEmpty();
		assertThat(repository.findDue(due.plus(1, ChronoUnit.MINUTES), 10))
				.extracting(ReminderRepository.Due::keyHash).containsExactly(HASH);
	}
}
