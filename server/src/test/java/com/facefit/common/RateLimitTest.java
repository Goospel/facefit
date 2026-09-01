package com.facefit.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 서버가 열리면 **누구나 부를 수 있는 무료 API**가 된다. 번들에 앱 토큰을 심는 것은 추출
 * 가능한 장식이라 안 하고(보안 연극), 진짜 방어는 레이트리밋 + 피해 상한이다(설계 §3-1).
 *
 * <p>여기서 상한을 아주 낮게 덮어써서 잰다. 다른 테스트들은 {@code application-test.properties}가
 * IP 상한을 크게 올려 둬서 이 관문에 안 걸린다 — <b>안 그러면 테스트가 늘어날수록 무관한
 * 테스트가 429로 깨진다</b>(테스트 전체가 같은 가짜 IP에서 온다).
 */
@SpringBootTest(properties = {
		"facefit.ratelimit.ip-per-minute=4",
		"facefit.ratelimit.backup-put-per-key-per-minute=2"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RateLimitTest {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private RateLimiter rateLimiter;

	private static final String BLOB = """
			{"schemaVersion":1,"products":[],"notes":{},"clientSavedAt":"2026-09-01T00:00:00.000Z"}""";

	/**
	 * 카운터는 분 단위 창이라 **테스트 사이에 살아남는다** — 비우지 않으면 먼저 돈 테스트가
	 * 상한을 태워, 나중 테스트가 첫 요청부터 429를 받는다(그리고 실행 순서에 따라 결과가 바뀐다).
	 */
	@org.junit.jupiter.api.BeforeEach
	void resetCounters() {
		rateLimiter.clear();
	}

	@Test
	@DisplayName("같은 키의 PUT이 분당 상한을 넘으면 429 — 저장 폭탄의 속도를 깎는다")
	void put_exceedingPerKeyLimit_is429() throws Exception {
		String k = "test-rate-perkey";

		for (int i = 0; i < 2; i++) {
			mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
							.contentType(MediaType.APPLICATION_JSON).content(BLOB))
					.andExpect(status().isOk());
		}

		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
						.contentType(MediaType.APPLICATION_JSON).content(BLOB))
				.andExpect(status().isTooManyRequests());
	}

	@Test
	@DisplayName("IP 상한은 키와 무관하게 걸린다 — 가짜 키를 대량 생성해도 속도가 안 는다")
	void ipLimit_appliesAcrossDifferentKeys() throws Exception {
		// 매번 다른 키를 쓴다. 키당 상한만 있으면 이 공격이 그대로 통과한다 —
		// 두 상한이 서로를 대신하지 않는다는 것을 이 테스트가 지킨다.
		for (int i = 0; i < 4; i++) {
			mockMvc.perform(get("/v1/backup").header("X-Anon-Key", "test-rate-ip-" + i))
					.andExpect(status().isNotFound());
		}

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", "test-rate-ip-last"))
				.andExpect(status().isTooManyRequests());
	}

	@Test
	@DisplayName("X-Forwarded-For가 다르면 다른 버킷 — 안 그러면 Caddy 뒤에서 IP 상한이 전역 상한이 된다")
	void ipLimit_separatesByForwardedFor() throws Exception {
		// 리버스 프록시 뒤에서는 모든 요청의 getRemoteAddr()가 **프록시 컨테이너 IP**다.
		// 그대로 세면 상한이 사용자별이 아니라 전체 합계가 되어, 한 사람이 몫을 다 태우면
		// 나머지 전원이 429를 받는다 — 그리고 앱은 무음 폴백이라 아무도 이유를 모른다.
		for (int i = 0; i < 4; i++) {
			mockMvc.perform(get("/v1/backup")
							.header("X-Anon-Key", "test-xff-a").header("X-Forwarded-For", "1.2.3.4"))
					.andExpect(status().isNotFound());
		}

		// 다른 클라이언트는 영향을 안 받는다.
		mockMvc.perform(get("/v1/backup")
						.header("X-Anon-Key", "test-xff-b").header("X-Forwarded-For", "5.6.7.8"))
				.andExpect(status().isNotFound());

		// 같은 클라이언트는 막힌다.
		mockMvc.perform(get("/v1/backup")
						.header("X-Anon-Key", "test-xff-a").header("X-Forwarded-For", "1.2.3.4"))
				.andExpect(status().isTooManyRequests());
	}

	@Test
	@DisplayName("X-Forwarded-For에 여러 홉이 실리면 맨 앞(원 클라이언트)을 쓴다")
	void ipLimit_usesFirstHopOfForwardedFor() throws Exception {
		for (int i = 0; i < 4; i++) {
			mockMvc.perform(get("/v1/backup")
							.header("X-Anon-Key", "test-xff-hop").header("X-Forwarded-For", "9.9.9.9, 10.0.0.1"))
					.andExpect(status().isNotFound());
		}

		// 뒤 홉만 다른 요청은 **같은 클라이언트**다 — 맨 앞을 안 보면 상한을 우회할 수 있다.
		mockMvc.perform(get("/v1/backup")
						.header("X-Anon-Key", "test-xff-hop").header("X-Forwarded-For", "9.9.9.9, 10.0.0.2"))
				.andExpect(status().isTooManyRequests());
	}

	@Test
	@DisplayName("/health는 레이트리밋 밖이다 — 감시가 자기 때문에 빨간불이 되면 안 된다")
	void health_isNotRateLimited() throws Exception {
		for (int i = 0; i < 10; i++) {
			mockMvc.perform(get("/health")).andExpect(status().isOk());
		}
	}
}
