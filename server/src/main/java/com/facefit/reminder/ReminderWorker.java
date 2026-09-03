package com.facefit.reminder;

import com.facefit.common.KeyCipher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * 분마다 「시각이 된 예약」을 훑어 한 통씩 보낸다(설계 §3-4). 초 단위 정확도는 목표가 아니다 —
 * 3시간 뒤 알림에서 1분은 아무도 못 느낀다.
 *
 * <p>순서가 이 클래스의 전부다: <b>claim(시도 기록) → 개봉 → 발송 → 성공이면 삭제</b>.
 * 시도를 먼저 기록하는 이유는 크래시 창 때문이다 — 발송 뒤에 기록하면 타임아웃·재시작이 시도를
 * 0으로 남겨 같은 행이 매분 다시 나가고, 사용자에겐 알림 폭탄이 된다. 반대로 성공을 못 봤는데
 * 지우면 알림은 영영 안 간다. 그래서 <b>claim은 앞, delete는 뒤</b>다.
 *
 * <p><b>미설정이면 아무것도 하지 않는다</b>(다크런치). 콘솔 인증서·템플릿 승인·KEK 중 하나라도
 * 없으면 이 서버는 알림만 쉬고 나머지 기능은 그대로 돈다 — 경고는 <b>한 번만</b> 남긴다
 * (분마다 같은 줄을 쌓으면 진짜 오류가 그 안에 묻힌다).
 *
 * <p>{@code // ponytail: 단일 인스턴스 · at-most-once-per-attempt 상한 — 크래시 창에서 한 행이
 * 최대 3회까지 중복 발송될 수 있다(claim은 됐는데 발송 결과를 못 본 경우). 수평 확장하는 날
 * SELECT ... FOR UPDATE SKIP LOCKED로 바꾼다.}
 */
@Component
class ReminderWorker {

	private static final Logger log = LoggerFactory.getLogger(ReminderWorker.class);

	/** 한 번에 집는 최대 행 수. 밀려도 서버가 한 분에 하는 일의 상한을 정한다. */
	private static final int BATCH = 100;

	private final ReminderRepository repository;
	private final KeyCipher cipher;
	private final TossMessenger messenger;
	private final Clock clock;

	/** 미설정 경고는 한 번만 — 분마다 쌓으면 진짜 오류가 묻힌다. */
	private boolean warnedNotConfigured;

	ReminderWorker(ReminderRepository repository, KeyCipher cipher, TossMessenger messenger, Clock clock) {
		this.repository = repository;
		this.cipher = cipher;
		this.messenger = messenger;
		this.clock = clock;
	}

	@Scheduled(fixedDelay = 60_000)
	void tick() {
		if (!messenger.isConfigured() || !cipher.isConfigured()) {
			if (!warnedNotConfigured) {
				warnedNotConfigured = true;
				log.warn("기름종이 알림이 미설정 상태다 — 예약을 보내지 않고 쉰다"
						+ " (템플릿·mTLS 번들={}, KEK={})", messenger.isConfigured(), cipher.isConfigured());
			}
			return;
		}

		Instant now = clock.instant();
		List<ReminderRepository.Due> due = repository.findDue(now, BATCH);
		for (ReminderRepository.Due row : due) {
			// 먼저 시도를 태운다. 이 아래 어디서 죽어도 같은 행이 무한히 다시 나가지 않는다.
			repository.claim(row.keyHash());
			String anonKey;
			try {
				anonKey = cipher.open(row.keyEnc());
			} catch (RuntimeException e) {
				// KEK를 바꿨거나 행이 상했다. 열 수 없는 봉인은 재시도해도 안 열린다 —
				// 시도만 쌓다가 청소 쿼리가 지운다(키·해시는 로그에 안 남긴다).
				log.warn("예약 키를 열지 못했다: {}", e.toString());
				continue;
			}
			// 한 통의 실패가 다음 통을 막지 않는다 — 실패한 행만 남아 다음 분에 다시 시도된다.
			if (messenger.send(anonKey)) {
				repository.delete(row.keyHash());
			}
		}

		// 상한까지 실패한 행·잊힌 행을 남기지 않는다. 이 테이블에 오래 사는 행은 없어야 한다.
		repository.purge(now.minus(1, ChronoUnit.DAYS));
	}
}
