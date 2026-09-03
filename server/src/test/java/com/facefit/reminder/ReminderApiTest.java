package com.facefit.reminder;

import com.facefit.common.RateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 예약 엔드포인트 둘. <b>시각을 정하는 것은 서버다</b> — 클라는 본문 없이 부르고 {@code dueAt}을
 * 받아 저장한다(설계 §3-2). 그래서 「3시간」이라는 상수가 서버 프로퍼티 한 곳에만 산다.
 *
 * <p>여기서 지킬 것: ① 예약이 실제로 한 행이 되고 <b>키당 하나</b>일 것, ② DB에 남는 것은
 * 해시와 <b>봉인된</b> 키뿐일 것(원 키 평문 금지 — 그것이 백업 열람 토큰이다), ③ 삭제가
 * 멱등일 것(클라가 결과를 안 봐도 되게), ④ 백업과 <b>같은 401 규칙</b>일 것.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ReminderApiTest {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbc;

	@Autowired
	private RateLimiter rateLimiter;

	@BeforeEach
	void reset() {
		rateLimiter.clear();
		jdbc.update("DELETE FROM reminder");
	}

	@Test
	@DisplayName("PUT은 본문 없이 200 + dueAt — 서버 프로퍼티(180분) 뒤로 잡힌다")
	void put_returnsDueAtOneIntervalAhead() throws Exception {
		Instant before = Instant.now();

		MvcResult result = mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "test-rem-due"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.dueAt").exists())
				.andReturn();

		Instant dueAt = Instant.parse(dueAtOf(result));
		assertThat(dueAt).isBetween(before.plus(179, ChronoUnit.MINUTES),
				Instant.now().plus(181, ChronoUnit.MINUTES));
	}

	@Test
	@DisplayName("DB에는 sha256과 봉인된 키만 남는다 — 원 키가 평문으로 눕지 않는다")
	void put_storesHashAndSealedKeyOnly() throws Exception {
		String raw = "test-rem-sealed-key";
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", raw)).andExpect(status().isOk());

		Integer byRaw = jdbc.queryForObject(
				"SELECT COUNT(*) FROM reminder WHERE key_hash = ?", Integer.class, raw);
		assertThat(byRaw).isZero();

		byte[] enc = jdbc.queryForObject(
				"SELECT key_enc FROM reminder WHERE key_hash = ?", byte[].class, sha256Hex(raw));
		assertThat(enc).isNotNull();
		// 봉인 바이트 어디에도 원 키가 그대로 실려 있지 않다.
		assertThat(new String(enc, StandardCharsets.ISO_8859_1)).doesNotContain(raw);
		assertThat(enc).isNotEqualTo(raw.getBytes(StandardCharsets.UTF_8));
	}

	@Test
	@DisplayName("두 번 PUT하면 행은 하나로 덮어쓰고 attempts가 0으로 돌아간다 — 재체크는 새 예약이다")
	void put_twice_overwritesAndResetsAttempts() throws Exception {
		String raw = "test-rem-overwrite";
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", raw)).andExpect(status().isOk());
		jdbc.update("UPDATE reminder SET attempts = 2 WHERE key_hash = ?", sha256Hex(raw));

		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", raw)).andExpect(status().isOk());

		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reminder", Integer.class)).isOne();
		assertThat(jdbc.queryForObject("SELECT attempts FROM reminder WHERE key_hash = ?",
				Integer.class, sha256Hex(raw))).isZero();
	}

	@Test
	@DisplayName("다른 키는 각자 한 행 — 남의 예약을 덮어쓰지 않는다")
	void put_differentKeys_areIsolated() throws Exception {
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "test-rem-alice"))
				.andExpect(status().isOk());
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "test-rem-bob"))
				.andExpect(status().isOk());

		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reminder", Integer.class)).isEqualTo(2);
	}

	@Test
	@DisplayName("DELETE는 예약을 지우고, 없어도 204 — 멱등(클라는 결과를 안 봐도 된다)")
	void delete_isIdempotent() throws Exception {
		String raw = "test-rem-delete";
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", raw)).andExpect(status().isOk());

		mockMvc.perform(delete("/v1/reminder").header("X-Anon-Key", raw))
				.andExpect(status().isNoContent());
		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reminder WHERE key_hash = ?",
				Integer.class, sha256Hex(raw))).isZero();

		mockMvc.perform(delete("/v1/reminder").header("X-Anon-Key", raw))
				.andExpect(status().isNoContent());
	}

	@Test
	@DisplayName("키가 없거나 형식이 아니면 PUT·DELETE 전부 401 — 백업과 같은 규칙")
	void missingOrMalformedKey_is401() throws Exception {
		mockMvc.perform(put("/v1/reminder")).andExpect(status().isUnauthorized());
		mockMvc.perform(delete("/v1/reminder")).andExpect(status().isUnauthorized());
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "1234567"))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "k".repeat(129)))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "   "))
				.andExpect(status().isUnauthorized());
		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reminder", Integer.class)).isZero();
	}

	@Test
	@DisplayName("같은 키의 PUT이 분당 상한(6)을 넘으면 429 — 예약 폭탄의 속도를 깎는다")
	void put_exceedingPerKeyLimit_is429() throws Exception {
		String raw = "test-rem-ratelimit";
		for (int i = 0; i < 6; i++) {
			mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", raw)).andExpect(status().isOk());
		}

		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", raw))
				.andExpect(status().isTooManyRequests());
	}

	private static String dueAtOf(MvcResult result) throws Exception {
		String body = result.getResponse().getContentAsString();
		return body.replaceAll(".*\"dueAt\"\\s*:\\s*\"([^\"]+)\".*", "$1");
	}

	private static String sha256Hex(String raw) throws Exception {
		MessageDigest md = MessageDigest.getInstance("SHA-256");
		return HexFormat.of().formatHex(md.digest(raw.getBytes(StandardCharsets.UTF_8)));
	}
}
