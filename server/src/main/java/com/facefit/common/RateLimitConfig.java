package com.facefit.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * IP당 전역 상한. {@code /v1/**}에만 건다 — <b>{@code /health}는 일부러 제외</b>한다.
 * 감시 도구가 5분마다 부르는 엔드포인트가 자기 때문에 429가 되면, 서버는 멀쩡한데 알림만
 * 울리는 최악의 계측기가 된다.
 *
 * <p>키당 상한은 여기가 아니라 컨트롤러에 있다 — 키를 꺼내 검증한 뒤에야 셀 수 있기 때문이다.
 * 둘은 서로를 대신하지 않는다: 키당 상한만 있으면 가짜 키를 대량 생성해 우회할 수 있고,
 * IP 상한만 있으면 한 사용자가 자기 몫을 다 태워 남을 막는다.
 */
@Configuration
class RateLimitConfig implements WebMvcConfigurer {

	private final RateLimiter rateLimiter;
	private final int ipPerMinute;

	RateLimitConfig(RateLimiter rateLimiter, @Value("${facefit.ratelimit.ip-per-minute}") int ipPerMinute) {
		this.rateLimiter = rateLimiter;
		this.ipPerMinute = ipPerMinute;
	}

	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		registry.addInterceptor(new HandlerInterceptor() {
			@Override
			public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
				if (!rateLimiter.allow("ip:" + clientIp(request), ipPerMinute)) {
					throw new TooManyRequestsException();
				}
				return true;
			}
		}).addPathPatterns("/v1/**");
	}

	/**
	 * 이 서버는 Caddy 뒤에 있다. 그래서 {@code getRemoteAddr()}는 <b>언제나 Caddy 컨테이너의
	 * IP</b>이고, 그걸로 세면 「IP당 상한」이 사실은 <b>전체 합계 상한</b>이 된다 — 한 사람이
	 * 몫을 다 태우면 나머지 전원이 429를 받고, 앱은 무음 폴백이라 아무도 이유를 모른다.
	 *
	 * <p>그래서 {@code X-Forwarded-For}의 <b>맨 앞</b>(원 클라이언트)을 쓴다. 이 헤더를 믿을 수
	 * 있는 이유는 <b>Caddy가 클라이언트가 심어 보낸 값을 리셋하고 자기가 다시 넣기</b> 때문이다
	 * (BookTimer가 같은 자리에서 확인한 성질 — 그 레포 Caddyfile 주석).
	 * ⚠️ 프록시 없이 이 서버를 직접 노출하는 순간 이 가정이 깨진다 — 그래서 compose에
	 * {@code ports}가 없고, Caddy를 우회하는 입구를 만들지 않는 것이 이 코드의 전제다.
	 */
	private static String clientIp(HttpServletRequest request) {
		String forwarded = request.getHeader("X-Forwarded-For");
		if (forwarded == null || forwarded.isBlank()) {
			return request.getRemoteAddr();
		}
		int comma = forwarded.indexOf(',');
		String first = (comma >= 0 ? forwarded.substring(0, comma) : forwarded).trim();
		return first.isEmpty() ? request.getRemoteAddr() : first;
	}
}
