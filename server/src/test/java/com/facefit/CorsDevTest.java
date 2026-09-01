package com.facefit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * dev 프로파일에서만 vite dev 서버(5320)가 열린다.
 *
 * <p>{@link CorsTest}가 「운영에서 localhost는 막힌다」를 지키고, 이 클래스가 「dev에서는
 * 열린다」를 지킨다 — <b>둘이 한 쌍이어야</b> 프로파일 분리가 실제로 작동하는지 알 수 있다.
 * 하나만 있으면 「그냥 항상 열려 있음」과 구분되지 않는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "dev"})
class CorsDevTest {

	@Autowired
	private MockMvc mockMvc;

	@Test
	@DisplayName("dev 프로파일에서는 localhost:5320이 열린다")
	void preflight_allowsLocalhostInDev() throws Exception {
		mockMvc.perform(options("/health")
						.header("Origin", "http://localhost:5320")
						.header("Access-Control-Request-Method", "GET"))
				.andExpect(status().isOk())
				.andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5320"));
	}

	@Test
	@DisplayName("dev에서도 모르는 오리진은 막힌다 — dev가 전부 여는 스위치가 아니다")
	void preflight_stillRejectsUnknownOriginInDev() throws Exception {
		mockMvc.perform(options("/health")
						.header("Origin", "https://evil.example")
						.header("Access-Control-Request-Method", "GET"))
				.andExpect(status().isForbidden());
	}
}
