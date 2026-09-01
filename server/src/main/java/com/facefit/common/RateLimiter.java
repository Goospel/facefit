package com.facefit.common;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 분 단위 고정 창 카운터. 서버가 열리면 누구나 부를 수 있는 무료 API가 되므로, 이것과
 * 「피해 상한」이 방어의 전부다(설계 §3-1 — 번들에 앱 토큰을 심는 것은 보안 연극이라 안 한다).
 *
 * <p>고정 창이라 창 경계에서 잠깐 2배가 통과한다. 슬라이딩 윈도우로 정밀하게 만들 수도 있지만,
 * 여기서 막으려는 것은 정밀한 초과가 아니라 <b>자릿수가 다른 남용</b>이라 값이 없다.
 *
 * <p>{@code // ponytail: 인메모리 — 단일 인스턴스 전제다. 수평 확장하는 날 Redis로.}
 */
@Component
public class RateLimiter {

	/** 버킷이 무한정 늘지 않게 하는 상한. 넘으면 통째로 비운다 — 지난 분의 카운터는 어차피 죽은 값이다. */
	private static final int MAX_BUCKETS = 10_000;

	private final Map<String, Window> windows = new ConcurrentHashMap<>();

	/** 이 요청을 통과시킬지. 상한을 넘으면 {@code false}이고, 호출자가 429로 바꾼다. */
	public boolean allow(String bucket, int limitPerMinute) {
		if (windows.size() > MAX_BUCKETS) {
			windows.clear();
		}
		long minute = System.currentTimeMillis() / 60_000L;
		Window window = windows.compute(bucket,
				(k, existing) -> existing != null && existing.minute == minute ? existing : new Window(minute));
		return window.count.incrementAndGet() <= limitPerMinute;
	}

	/** 전부 비운다. 테스트가 서로의 카운터를 물려받지 않게 하는 용도이자, 운영에서의 비상 리셋. */
	public void clear() {
		windows.clear();
	}

	private static final class Window {
		private final long minute;
		private final AtomicInteger count = new AtomicInteger();

		private Window(long minute) {
			this.minute = minute;
		}
	}
}
