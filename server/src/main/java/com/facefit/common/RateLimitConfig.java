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
				if (!rateLimiter.allow("ip:" + request.getRemoteAddr(), ipPerMinute)) {
					throw new TooManyRequestsException();
				}
				return true;
			}
		}).addPathPatterns("/v1/**");
	}
}
