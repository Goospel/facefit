package com.facefit.reminder;

import com.facefit.common.KeyCipher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 분마다 도는 워커. 여기서 지킬 것은 「보낸다」가 아니라 <b>안 보내는 경우들</b>이다.
 *
 * <p>① <b>시도를 먼저 기록한다</b>(claim). 보낸 뒤에 기록하면 크래시·타임아웃 창에서 같은 행이
 * 매분 다시 나가 사용자에겐 알림 폭탄이 된다 — at-most-once-per-attempt가 이 구조의 상한이다.
 * ② <b>성공해야 지운다</b>. 실패했는데 지우면 알림은 영영 안 가고, 사용자는 「예약됨」만 본다.
 * ③ <b>3회면 그만</b>. 영원히 재시도하는 행은 3시간짜리 테이블에 있을 자리가 없다.
 * ④ <b>미설정이면 아무것도 안 한다</b>(다크런치) — 인증서·템플릿 승인 전에도 서버는 돈다.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReminderWorkerTest {

	@Autowired
	private ReminderRepository repository;

	@Autowired
	private KeyCipher cipher;

	@Autowired
	private JdbcTemplate jdbc;

	/** 고정 시계 — 「지났다/안 지났다」를 실행 시각에 맡기지 않는다. */
	private static final Instant NOW = Instant.parse("2026-09-03T12:00:00Z");
	private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);

	private TossMessenger messenger;

	@BeforeEach
	void reset() {
		jdbc.update("DELETE FROM reminder");
		messenger = mock(TossMessenger.class);
		when(messenger.isConfigured()).thenReturn(true);
		when(messenger.send(anyString())).thenReturn(true);
	}

	private ReminderWorker worker() {
		return new ReminderWorker(repository, cipher, messenger, clock);
	}

	/** 예약 한 행을 직접 심는다 — 컨트롤러를 거치지 않아야 시각을 마음대로 둘 수 있다. */
	private String schedule(String rawKey, Instant dueAt) {
		String hash = "h" + Math.abs(rawKey.hashCode());
		hash = hash + "0".repeat(64 - hash.length());
		jdbc.update("INSERT INTO reminder (key_hash, key_enc, due_at, attempts, created_at) "
						+ "VALUES (?, ?, ?, 0, ?)",
				hash, cipher.seal(rawKey), Timestamp.from(dueAt), Timestamp.from(dueAt));
		return hash;
	}

	@Test
	@DisplayName("시각이 지난 행만 보내고, 아직인 행은 건드리지 않는다")
	void tick_sendsOnlyDueRows() {
		schedule("key-past", NOW.minus(1, ChronoUnit.MINUTES));
		String future = schedule("key-future", NOW.plus(1, ChronoUnit.HOURS));

		worker().tick();

		verify(messenger).send("key-past");
		verify(messenger, never()).send("key-future");
		assertThat(attemptsOf(future)).isZero();
	}

	@Test
	@DisplayName("메신저에 넘기는 값은 **복호화된 원 키**다 — 봉인 바이트를 그대로 보내면 아무에게도 안 간다")
	void tick_sendsDecryptedKey() {
		schedule("key-plain-abc", NOW.minus(1, ChronoUnit.MINUTES));

		worker().tick();

		verify(messenger).send("key-plain-abc");
	}

	@Test
	@DisplayName("성공하면 행을 지운다 — 알림 1회가 예약 1회를 소진한다(승인 게이트)")
	void tick_success_deletesRow() {
		schedule("key-ok", NOW.minus(1, ChronoUnit.MINUTES));

		worker().tick();

		assertThat(rowCount()).isZero();
	}

	@Test
	@DisplayName("실패하면 행이 남고 attempts가 1 — 다음 분에 다시 시도된다")
	void tick_failure_keepsRowAndCountsAttempt() {
		when(messenger.send(anyString())).thenReturn(false);
		String hash = schedule("key-fail", NOW.minus(1, ChronoUnit.MINUTES));

		worker().tick();

		assertThat(rowCount()).isOne();
		assertThat(attemptsOf(hash)).isOne();
	}

	@Test
	@DisplayName("보내기 **전에** 시도를 기록한다 — 크래시 창에서 같은 행이 매분 다시 나가지 않게")
	void tick_claimsBeforeSending() {
		String hash = schedule("key-claim", NOW.minus(1, ChronoUnit.MINUTES));
		List<Integer> attemptsSeenDuringSend = new ArrayList<>();
		when(messenger.send(anyString())).thenAnswer(invocation -> {
			attemptsSeenDuringSend.add(attemptsOf(hash));
			return true;
		});

		worker().tick();

		// 발송 시점에 이미 1이어야 한다. 순서가 뒤집히면 여기서 0이 잡힌다.
		assertThat(attemptsSeenDuringSend).containsExactly(1);
	}

	@Test
	@DisplayName("3회 실패한 행은 더 이상 안 보낸다 — 영원히 재시도하지 않는다")
	void tick_exhaustedRow_isNotSent() {
		String hash = schedule("key-exhausted", NOW.minus(1, ChronoUnit.MINUTES));
		jdbc.update("UPDATE reminder SET attempts = 3 WHERE key_hash = ?", hash);

		worker().tick();

		verify(messenger, never()).send(anyString());
		assertThat(attemptsOf(hash)).isEqualTo(3);
	}

	@Test
	@DisplayName("하루가 지난 행은 청소한다 — 3시간짜리 테이블에 남는 행이 없어야 한다")
	void tick_purgesRowsOlderThanOneDay() {
		schedule("key-stale", NOW.minus(25, ChronoUnit.HOURS));
		jdbc.update("UPDATE reminder SET attempts = 3");

		worker().tick();

		assertThat(rowCount()).isZero();
	}

	@Test
	@DisplayName("메신저가 미설정이면 아무것도 하지 않는다 — 인증서·템플릿 승인 전의 다크런치")
	void tick_messengerNotConfigured_doesNothing() {
		when(messenger.isConfigured()).thenReturn(false);
		String hash = schedule("key-dark", NOW.minus(1, ChronoUnit.MINUTES));

		worker().tick();

		verify(messenger, never()).send(anyString());
		assertThat(rowCount()).isOne();
		assertThat(attemptsOf(hash)).isZero();
	}

	@Test
	@DisplayName("KEK가 없으면 아무것도 하지 않는다 — 열 수 없는 봉인을 시도로 태우지 않는다")
	void tick_cipherNotConfigured_doesNothing() {
		String hash = schedule("key-nokek", NOW.minus(1, ChronoUnit.MINUTES));

		new ReminderWorker(repository, new KeyCipher(""), messenger, clock).tick();

		verify(messenger, never()).send(anyString());
		assertThat(attemptsOf(hash)).isZero();
	}

	private Integer attemptsOf(String keyHash) {
		return jdbc.queryForObject("SELECT attempts FROM reminder WHERE key_hash = ?", Integer.class, keyHash);
	}

	private Integer rowCount() {
		return jdbc.queryForObject("SELECT COUNT(*) FROM reminder", Integer.class);
	}
}
