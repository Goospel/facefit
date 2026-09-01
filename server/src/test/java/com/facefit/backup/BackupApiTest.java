package com.facefit.backup;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 백업의 왕복. 프로토콜은 **동기화가 아니라 백업·복원**이라, 전체 블롭을 통째로 덮어쓰는
 * 것이 전부다(설계 §3-3) — 그래서 여기 걸 계약이 적다.
 *
 * <p>가장 값진 테스트는 마지막의 「미지 필드 보존」이다. 서버가 제품 필드를 화이트리스트하면
 * v4 클라가 넣은 필드가 백업을 한 번 왕복하는 것만으로 **증발한다** — 그리고 그 증발은
 * 복원한 다음에야, 그것도 조용히 드러난다(설계 §4-2).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BackupApiTest {

	@Autowired
	private MockMvc mockMvc;

	private static final String BLOB = """
			{"schemaVersion":1,"products":[],"notes":{},"clientSavedAt":"2026-09-01T00:00:00.000Z"}""";

	/** 테스트마다 다른 키를 쓴다 — 같은 키를 나눠 쓰면 한 테스트의 저장이 다른 테스트에 새어 든다. */
	private static String key(String name) {
		return "test-key-" + name;
	}

	@Test
	@DisplayName("PUT → 200, 저장 시각을 돌려준다")
	void put_returnsSavedAt() throws Exception {
		mockMvc.perform(put("/v1/backup")
						.header("X-Anon-Key", key("put"))
						.contentType(MediaType.APPLICATION_JSON)
						.content(BLOB))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.savedAt").isNotEmpty());
	}

	@Test
	@DisplayName("PUT한 블롭을 GET으로 그대로 돌려받는다")
	void putThenGet_roundTrips() throws Exception {
		String k = key("roundtrip");
		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
				.contentType(MediaType.APPLICATION_JSON).content(BLOB));

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", k))
				.andExpect(status().isOk())
				.andExpect(content().json(BLOB));
	}

	@Test
	@DisplayName("백업이 없으면 404 — 신규 사용자의 정상 상태다")
	void get_withoutBackup_is404() throws Exception {
		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", key("empty")))
				.andExpect(status().isNotFound());
	}

	@Test
	@DisplayName("두 번째 PUT이 이긴다 — LWW(설계 §3-3)")
	void put_overwrites() throws Exception {
		String k = key("lww");
		String second = """
				{"schemaVersion":1,"products":[],"notes":{"2026-09-01":"good"},"clientSavedAt":"2026-09-02T00:00:00.000Z"}""";

		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
				.contentType(MediaType.APPLICATION_JSON).content(BLOB));
		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
				.contentType(MediaType.APPLICATION_JSON).content(second));

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", k))
				.andExpect(jsonPath("$.notes['2026-09-01']").value("good"));
	}

	@Test
	@DisplayName("DELETE → 204, 그 뒤 GET은 404 — 「백업 끄기」가 곧 즉시 삭제다")
	void delete_removesBackup() throws Exception {
		String k = key("delete");
		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
				.contentType(MediaType.APPLICATION_JSON).content(BLOB));

		mockMvc.perform(delete("/v1/backup").header("X-Anon-Key", k))
				.andExpect(status().isNoContent());

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", k))
				.andExpect(status().isNotFound());
	}

	@Test
	@DisplayName("백업이 없어도 DELETE는 204 — 멱등이라 클라가 결과를 안 봐도 된다")
	void delete_withoutBackup_isStill204() throws Exception {
		mockMvc.perform(delete("/v1/backup").header("X-Anon-Key", key("delete-empty")))
				.andExpect(status().isNoContent());
	}

	@Test
	@DisplayName("products 안의 모르는 필드가 왕복에서 살아남는다 — 서버가 화이트리스트하면 v4 필드가 증발한다")
	void putThenGet_preservesUnknownProductFields() throws Exception {
		String k = key("opaque");
		String withFuture = """
				{"schemaVersion":1,"products":[{"id":"p1","name":"토리든 다이브인 세럼",\
				"futureFieldFromV4":{"nested":"살아야 한다"}}],"notes":{},\
				"clientSavedAt":"2026-09-01T00:00:00.000Z"}""";

		mockMvc.perform(put("/v1/backup").header("X-Anon-Key", k)
				.contentType(MediaType.APPLICATION_JSON).content(withFuture));

		mockMvc.perform(get("/v1/backup").header("X-Anon-Key", k))
				.andExpect(jsonPath("$.products[0].futureFieldFromV4.nested").value("살아야 한다"));
	}
}
