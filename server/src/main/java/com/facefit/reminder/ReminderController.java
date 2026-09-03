package com.facefit.reminder;

import com.facefit.common.AnonKey;
import com.facefit.common.KeyCipher;
import com.facefit.common.RateLimiter;
import com.facefit.common.ServiceUnavailableException;
import com.facefit.common.TooManyRequestsException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * 기름종이 알림 예약 — 엔드포인트 둘, 본문 0바이트.
 *
 * <p><b>시각을 정하는 것은 서버다.</b> 클라는 「썼어요」를 누른 사실만 알리고 {@code dueAt}을
 * 받아 저장한다(설계 §3-2). 그래서 「3시간」이라는 상수가 {@code facefit.reminder.interval-minutes}
 * 한 곳에만 살고, 바꾸려면 이 프로퍼티 하나만 만지면 된다(캘리브레이션 노브).
 *
 * <p><b>야간 상한은 없다</b>(사용자 결정 2026-09-03 · 설계 §3-3). 밤에 울릴지는 사용자가
 * 체크하는 순간 스스로 정하고, 다음 알림은 승인 게이트를 통과해야만 생긴다. 되살릴 자리는
 * 여기 한 곳이다({@code ReminderNightTest}가 그 결정의 회귀 가드).
 *
 * <p>순서는 백업과 같다 — <b>키 → 레이트리밋 → 설정 확인 → 저장</b>.
 */
@RestController
@RequestMapping("/v1/reminder")
class ReminderController {

	private final ReminderRepository repository;
	private final RateLimiter rateLimiter;
	private final KeyCipher cipher;
	private final Clock clock;
	private final int intervalMinutes;
	private final int putPerKeyPerMinute;

	ReminderController(ReminderRepository repository, RateLimiter rateLimiter, KeyCipher cipher, Clock clock,
			@Value("${facefit.reminder.interval-minutes}") int intervalMinutes,
			@Value("${facefit.ratelimit.reminder-put-per-key-per-minute}") int putPerKeyPerMinute) {
		this.repository = repository;
		this.rateLimiter = rateLimiter;
		this.cipher = cipher;
		this.clock = clock;
		this.intervalMinutes = intervalMinutes;
		this.putPerKeyPerMinute = putPerKeyPerMinute;
	}

	/** PUT 응답. 클라는 이 값을 그대로 저장하고 화면에 KST로 포맷만 한다(자기 시계로 계산하지 않는다). */
	record Due(String dueAt) {
	}

	/**
	 * 「썼어요」 = 알림 1회 예약. 같은 키로 다시 부르면 <b>덮어쓴다</b> — 예약은 언제나 최대 하나다.
	 *
	 * <p>KEK가 없으면 봉인할 수 없고, 봉인 못 한 예약은 보낼 수도 없다 → 받지 않는다(503).
	 * 「예약됨」을 그려 놓고 알림이 영영 안 오는 것이 최악의 실패라 여기서 끊는다.
	 */
	@PutMapping
	Due put(@RequestHeader(name = "X-Anon-Key", required = false) String rawKey) {
		AnonKey key = AnonKey.fromHeader(rawKey);
		if (!rateLimiter.allow("reminder-put:" + key.hash(), putPerKeyPerMinute)) {
			throw new TooManyRequestsException();
		}
		if (!cipher.isConfigured()) {
			throw new ServiceUnavailableException();
		}

		// DATETIME(3)이 담을 수 있는 정밀도까지만 — 응답 문자열과 DB 값이 어긋나지 않게.
		Instant dueAt = clock.instant().plus(intervalMinutes, ChronoUnit.MINUTES)
				.truncatedTo(ChronoUnit.MILLIS);
		repository.upsert(key.hash(), cipher.seal(rawKey), dueAt);
		return new Due(dueAt.toString());
	}

	/** 「그만 받기」·「오늘은 그만」. 없어도 204 — 멱등이라 클라는 결과를 안 봐도 된다. */
	@DeleteMapping
	ResponseEntity<Void> delete(@RequestHeader(name = "X-Anon-Key", required = false) String rawKey) {
		AnonKey key = AnonKey.fromHeader(rawKey);
		repository.delete(key.hash());
		return ResponseEntity.noContent().build();
	}
}
