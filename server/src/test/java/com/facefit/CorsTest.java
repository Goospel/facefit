package com.facefit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * CORS는 이 서버에서 **기능이 아니라 관문**이다 — 미니앱은 브라우저(웹뷰) 안에서 돌기 때문에,
 * 허용 오리진이 틀리면 서버가 멀쩡해도 앱에서는 백업이 통째로 안 된다. 그리고 그 실패는
 * 무음이다(모든 서버 경로가 무음 폴백이라 사용자에게 아무 에러도 안 보인다) —
 * **잘못 열려 있어도, 잘못 닫혀 있어도 조용하다.** 그래서 양방향으로 못 박는다.
 *
 * <p>허용 오리진은 미니앱이 실려 있는 곳이라 <b>서버 도메인이 바뀌어도 안 바뀐다</b>(설계 §4-1).
 * 이 테스트가 값을 자기 손으로 정의하지 않고 운영 프로퍼티를 그대로 쓰는 이유다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CorsTest {

	private static final String LIVE = "https://facefit.web.tossmini.com";
	private static final String CONSOLE_QR = "https://facefit.private-web.tossmini.com";

	@Autowired
	private MockMvc mockMvc;

	@Test
	@DisplayName("실서비스 오리진의 프리플라이트를 허용한다")
	void preflight_allowsLiveOrigin() throws Exception {
		mockMvc.perform(options("/health")
						.header("Origin", LIVE)
						.header("Access-Control-Request-Method", "GET"))
				.andExpect(status().isOk())
				.andExpect(header().string("Access-Control-Allow-Origin", LIVE));
	}

	@Test
	@DisplayName("콘솔 QR 오리진의 프리플라이트를 허용한다 — 실기기 검증이 여기로 들어온다")
	void preflight_allowsConsoleQrOrigin() throws Exception {
		mockMvc.perform(options("/health")
						.header("Origin", CONSOLE_QR)
						.header("Access-Control-Request-Method", "GET"))
				.andExpect(status().isOk())
				.andExpect(header().string("Access-Control-Allow-Origin", CONSOLE_QR));
	}

	@Test
	@DisplayName("실제 요청에도 허용 헤더가 붙는다 — 프리플라이트만 통과하면 브라우저가 응답을 버린다")
	void actualRequest_carriesAllowOriginHeader() throws Exception {
		mockMvc.perform(get("/health").header("Origin", LIVE))
				.andExpect(status().isOk())
				.andExpect(header().string("Access-Control-Allow-Origin", LIVE));
	}

	@Test
	@DisplayName("모르는 오리진은 막는다 — 공개 API라 여기가 유일한 오리진 관문이다")
	void preflight_rejectsUnknownOrigin() throws Exception {
		mockMvc.perform(options("/health")
						.header("Origin", "https://evil.example")
						.header("Access-Control-Request-Method", "GET"))
				.andExpect(status().isForbidden());
	}

	@Test
	@DisplayName("localhost는 운영 프로파일에서 막힌다 — 개발 편의가 운영으로 새면 안 된다")
	void preflight_rejectsLocalhostOutsideDev() throws Exception {
		mockMvc.perform(options("/health")
						.header("Origin", "http://localhost:5320")
						.header("Access-Control-Request-Method", "GET"))
				.andExpect(status().isForbidden());
	}
}
