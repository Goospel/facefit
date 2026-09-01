package com.facefit.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * 미니앱은 웹뷰(=브라우저) 안에서 돌기 때문에, 허용 오리진이 틀리면 서버가 멀쩡해도 앱에서는
 * 백업이 통째로 안 된다. 게다가 그 실패는 **무음**이다(모든 서버 경로가 무음 폴백) —
 * 잘못 열려 있어도 잘못 닫혀 있어도 조용해서, 테스트가 유일한 감지기다({@code CorsTest}).
 *
 * <p>오리진 목록을 코드가 아니라 프로퍼티에서 읽는다 — dev에서만 vite 서버를 더하기 위해서다.
 * 그 분리가 실제로 작동하는지는 {@code CorsTest}와 {@code CorsDevTest}가 <b>한 쌍으로</b> 지킨다.
 */
@Configuration
class CorsConfig implements WebMvcConfigurer {

	private final List<String> origins;

	CorsConfig(@Value("${facefit.cors.origins}") List<String> origins) {
		this.origins = origins;
	}

	@Override
	public void addCorsMappings(CorsRegistry registry) {
		registry.addMapping("/**")
				// ⚠️ `allowedOrigins`가 아니라 **패턴**이다. 정확한 오리진 이름을 맞히려다
				// 실기기에서 틀렸고(설계는 `private-web`, 실제는 `private-apps`), 그 결과가
				// 「모든 프리플라이트 403 + 앱에서는 무음」이었다(T-009). 이름 하나에 매달리는
				// 대신 **우리 앱 이름으로 시작하는 tossmini.com 하위 도메인**을 허용한다.
				.allowedOriginPatterns(origins.toArray(String[]::new))
				.allowedMethods("GET", "POST", "PUT", "DELETE")
				// 익명 키는 헤더로 온다(설계 §4-2). 쿠키를 안 쓰므로 allowCredentials는 켜지 않는다 —
				// 켜는 순간 오리진 실수의 대가가 「데이터가 안 옴」에서 「남의 세션이 실림」으로 커진다.
				.allowedHeaders("Content-Type", "X-Anon-Key")
				.maxAge(3600);
	}
}
