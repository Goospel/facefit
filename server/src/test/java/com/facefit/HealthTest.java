package com.facefit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code /health}는 **사람이 아니라 기계가 읽는다** — UptimeRobot의 5분 간격 감시와 배포
 * 직후의 검증이 이 응답 하나로 「살아 있나」를 판정한다(설계 §5).
 *
 * <p>그래서 바디를 안 붙인다. 무언가를 적어 두면 그것이 계약이 되고, 다음 사람이 거기에
 * 상태를 실으려 든다 — 상태를 실으면 그 계산이 실패할 때 헬스체크가 같이 죽는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HealthTest {

	@Autowired
	private MockMvc mockMvc;

	@Test
	@DisplayName("GET /health → 200")
	void health_returns200() throws Exception {
		mockMvc.perform(get("/health"))
				.andExpect(status().isOk());
	}

	@Test
	@DisplayName("/health는 바디가 없다 — 감시 도구가 상태 코드만 본다")
	void health_hasNoBody() throws Exception {
		mockMvc.perform(get("/health"))
				.andExpect(content().string(""));
	}
}
