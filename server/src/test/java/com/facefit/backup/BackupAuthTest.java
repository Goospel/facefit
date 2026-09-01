package com.facefit.backup;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 인증 모델은 **소유 증명(capability)**이다 — 키를 아는 자가 소유자다(설계 §3-1).
 *
 * <p>서버는 키를 검증할 방법이 없고(토스에 익명 키 검증 API가 없다는 전제) 필요도 없다.
 * 고엔트로피 해시라면 추측 불가이고, 제시된 키의 백업만 돌려주므로 남의 데이터에 닿을 수 없다.
 * 그래서 여기서 지킬 것은 둘뿐이다 — <b>키가 없으면 아무것도 안 준다</b>는 것과,
 * <b>키를 저장하지 않는다</b>는 것.
 *
 * <p>후자가 특히 중요하다. 원 키가 곧 열람 토큰이라, DB가 새면 원 키도 같이 새는 순간
 * 모든 사용자의 백업이 열린다. sha256만 저장하면 DB 유출이 <b>열람 권한 유출로 번지지 않는다</b>.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BackupAuthTest {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbc;

	private static final String BLOB = """
			{"schemaVersion":1,"products":[],"notes":{},"clientSavedAt":"2026-09-01T00:00:00.000Z"}""";

	@Test
	@DisplayName("키가 없으면 PUT·GET·DELETE 전부 401")
	void missingKey_is401() throws Exception {
		mockMvc.perform(put("/v1/backup").contentType(MediaType.APPLICATION_JSON).content(BLOB))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(get("/v1/backup")).andExpect(status().isUnauthorized());
		mockMvc.perform(delete("/v1/backup")).andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("너무 짧은 키(8자 미만)는 401 — 쓸 수 있는 자격증명이 아니다")
	void tooShortKey_is401() throws Exception {
		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", "1234567"))
				.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("너무 긴 키(128자 초과)는 401 — 길이만 본다, 구조는 가정하지 않는다")
	void tooLongKey_is401() throws Exception {
		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", "k".repeat(129)))
				.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("빈 키도 401 — 헤더가 있는 것과 값이 있는 것은 다르다")
	void blankKey_is401() throws Exception {
		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", "   "))
				.andExpect(status().isUnauthorized());
	}

	@Test
	@DisplayName("다른 키는 다른 백업을 본다 — 남의 데이터에 닿을 수 없다는 것이 이 모델의 전부다")
	void differentKeys_areIsolated() throws Exception {
		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", "test-auth-alice")
				.contentType(MediaType.APPLICATION_JSON).content(BLOB));

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", "test-auth-bob"))
				.andExpect(status().isNotFound());
	}

	@Test
	@DisplayName("원 키를 저장하지 않는다 — DB에는 sha256만 있다(유출이 열람 권한 유출로 안 번진다)")
	void rawKey_isNeverStored() throws Exception {
		String raw = "test-auth-never-stored";
		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", raw)
						.contentType(MediaType.APPLICATION_JSON).content(BLOB))
				.andExpect(status().isOk());

		// 원 키로는 아무 행도 안 잡힌다.
		Integer byRaw = jdbc.queryForObject(
				"SELECT COUNT(*) FROM backup WHERE key_hash = ?", Integer.class, raw);
		assertThat(byRaw).isZero();

		// sha256(원 키)로는 정확히 한 행이 잡힌다 — 저장은 됐는데 형태만 다르다는 뜻이다.
		Integer byHash = jdbc.queryForObject(
				"SELECT COUNT(*) FROM backup WHERE key_hash = ?", Integer.class, sha256Hex(raw));
		assertThat(byHash).isOne();
	}

	@Test
	@DisplayName("키 하나로 저장하고 같은 키로 읽는다 — 해시가 결정적이라는 확인")
	void sameKey_readsItsOwnBackup() throws Exception {
		String k = "test-auth-determinism";
		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
				.contentType(MediaType.APPLICATION_JSON).content(BLOB));

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", k))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.schemaVersion").value(1));
	}

	private static String sha256Hex(String raw) throws Exception {
		MessageDigest md = MessageDigest.getInstance("SHA-256");
		return HexFormat.of().formatHex(md.digest(raw.getBytes(StandardCharsets.UTF_8)));
	}
}
