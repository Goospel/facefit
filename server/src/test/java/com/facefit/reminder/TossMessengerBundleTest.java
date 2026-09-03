package com.facefit.reminder;

import com.facefit.common.KeyCipher;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * <b>등록됐다</b>와 <b>쓸 수 있다</b>는 다르다.
 *
 * <p>SSL 번들은 이름만 등록해 두고 실제 로딩은 미룬다. 그래서 「번들이 있는가」만 보면,
 * PEM 파일이 지워졌거나·권한이 막혔거나·형식이 틀린 상태에서도 {@code isConfigured()}가 true를
 * 준다 → 워커가 매분 행을 집어 {@code attempts}를 태우고, 3회를 채운 예약은 <b>영영 안 간다</b>
 * (사용자 화면엔 「예약됨」만 남는다). 그래서 판정은 <b>실제로 만들어 보는 것</b>이어야 한다.
 *
 * <p>여기서는 번들 이름은 등록하되 인증서 경로를 없는 파일로 준다 — 운영에서 PEM이 사라진 것과
 * 같은 상태다. 기대 동작은 「기동 실패」가 아니라 <b>다크런치</b>다: 서버는 뜨고 알림만 쉰다.
 */
@SpringBootTest(properties = {
		"facefit.reminder.template-set-code=facefit-oil-paper-reminder",
		"spring.ssl.bundle.pem.toss.keystore.certificate=file:./build/no-such-cert.pem",
		"spring.ssl.bundle.pem.toss.keystore.private-key=file:./build/no-such-key.pem"
})
@ActiveProfiles("test")
class TossMessengerBundleTest {

	@Autowired
	private TossMessenger messenger;

	@Autowired
	private ReminderRepository repository;

	@Autowired
	private KeyCipher cipher;

	@Autowired
	private JdbcTemplate jdbc;

	private static final Instant NOW = Instant.parse("2026-09-03T12:00:00Z");

	@Test
	@DisplayName("템플릿 코드는 있어도 PEM을 못 읽으면 미설정 — 번들 「존재」가 아니라 「로드 가능」을 본다")
	void brokenBundle_isNotConfigured() {
		assertThat(messenger.isConfigured()).isFalse();
	}

	@Test
	@DisplayName("그 상태에서 워커는 예약을 건드리지 않는다 — attempts를 헛되이 태우지 않는다")
	void worker_skipsWhenBundleIsBroken() {
		jdbc.update("DELETE FROM reminder");
		String hash = "c".repeat(64);
		repository.upsert(hash, cipher.seal("key-broken-bundle"), NOW.minus(1, ChronoUnit.MINUTES));

		new ReminderWorker(repository, cipher, messenger, Clock.fixed(NOW, ZoneOffset.UTC)).tick();

		assertThat(jdbc.queryForObject("SELECT attempts FROM reminder WHERE key_hash = ?",
				Integer.class, hash)).isZero();
	}
}
