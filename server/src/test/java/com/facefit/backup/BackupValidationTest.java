package com.facefit.backup;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * <b>이 설계의 제1 규칙을 서버가 집행하는 자리다.</b>
 *
 * <p>불변식: 「사진 바이트는 어떤 경로로도 서버에 올라가지 않는다」. 앱의 온보딩 고지와 검수
 * 통과 문구(「사진은 이 기기에만 저장되며 어디로도 전송되지 않습니다」)가 글자 그대로 계속
 * 참이어야 한다 — 클라가 사진을 넣을 코드를 갖지 않는 것이 1차 방어이고, <b>여기가 2차</b>다.
 *
 * <p>핵심은 {@link #reject_stringLongerThan2000Chars()}이다. 사진 1장의 base64는 약 27만 자라,
 * 재귀 문자열 길이 상한 2,000자면 <b>구조적으로 통과할 수 없다</b> — 어떤 필드 이름으로
 * 숨겨 오든 상관없다. 이 상한을 지우는 변경이 곧 불변식을 지우는 변경이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BackupValidationTest {

	@Autowired
	private MockMvc mockMvc;

	private static String key(String name) {
		return "test-val-" + name;
	}

	private org.springframework.test.web.servlet.ResultActions putBlob(String name, String body) throws Exception {
		return mockMvc.perform(put("/v1/backup")
				.header("X-Anon-Key", key(name))
				.contentType(MediaType.APPLICATION_JSON)
				.content(body));
	}

	@Test
	@DisplayName("2,000자를 넘는 문자열은 400 — 사진 base64(약 27만 자)가 구조적으로 못 들어온다")
	void reject_stringLongerThan2000Chars() throws Exception {
		// 필드 이름을 위장해도, 얼마나 깊이 숨겨도 걸린다 — 검사가 **재귀**이기 때문이다.
		String smuggled = "{\"schemaVersion\":1,\"products\":[{\"id\":\"p1\",\"memo\":\""
				+ "A".repeat(2001) + "\"}],\"notes\":{},\"clientSavedAt\":\"2026-09-01T00:00:00.000Z\"}";

		putBlob("smuggle", smuggled).andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("정확히 2,000자는 통과한다 — 경계를 못 박아 상한이 조용히 줄어드는 것도 막는다")
	void accept_stringOfExactly2000Chars() throws Exception {
		String atLimit = "{\"schemaVersion\":1,\"products\":[{\"id\":\"p1\",\"memo\":\""
				+ "A".repeat(2000) + "\"}],\"notes\":{},\"clientSavedAt\":\"2026-09-01T00:00:00.000Z\"}";

		putBlob("at-limit", atLimit).andExpect(status().isOk());
	}

	@Test
	@DisplayName("객체 키에 숨긴 긴 문자열도 400 — 값만 보면 반쪽 검사다")
	void reject_longStringHiddenInObjectKey() throws Exception {
		String inKey = "{\"schemaVersion\":1,\"products\":[],\"notes\":{\""
				+ "K".repeat(2001) + "\":\"x\"},\"clientSavedAt\":\"2026-09-01T00:00:00.000Z\"}";

		putBlob("smuggle-key", inKey).andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("본문이 512KB를 넘으면 400 — 클라가 만들 수 없는 크기라 사실상 어뷰즈 신호다")
	void reject_bodyLargerThan512KB() throws Exception {
		// 2,000자짜리 문자열을 여러 개로 나눠 담아 **길이 상한은 통과하되 총량만** 넘긴다.
		// 두 관문이 서로를 대신하지 않는다는 것을 이 테스트가 지킨다.
		String chunk = "\"" + "A".repeat(2000) + "\"";
		String products = IntStream.range(0, 300)
				.mapToObj(i -> "{\"id\":\"p" + i + "\",\"name\":" + chunk + "}")
				.collect(Collectors.joining(","));
		String tooBig = "{\"schemaVersion\":1,\"products\":[" + products
				+ "],\"notes\":{},\"clientSavedAt\":\"2026-09-01T00:00:00.000Z\"}";

		putBlob("too-big", tooBig).andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("최상위에 모르는 키가 있으면 400 — 블롭이 임의 저장소가 되는 것을 막는다")
	void reject_unknownTopLevelKey() throws Exception {
		String extra = """
				{"schemaVersion":1,"products":[],"notes":{},"clientSavedAt":"2026-09-01T00:00:00.000Z",\
				"photos":"어디로도 전송되지 않는다더니"}""";

		putBlob("extra-key", extra).andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("products가 200건을 넘으면 400 — 클라의 상한과 같은 수다")
	void reject_tooManyProducts() throws Exception {
		String products = IntStream.range(0, 201)
				.mapToObj(i -> "{\"id\":\"p" + i + "\"}")
				.collect(Collectors.joining(","));

		putBlob("many-products", "{\"schemaVersion\":1,\"products\":[" + products
				+ "],\"notes\":{},\"clientSavedAt\":\"2026-09-01T00:00:00.000Z\"}")
				.andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("notes가 4,000키를 넘으면 400 — 하루 1키라 10년치가 넘는다")
	void reject_tooManyNotes() throws Exception {
		String notes = IntStream.range(0, 4001)
				.mapToObj(i -> "\"d" + i + "\":\"good\"")
				.collect(Collectors.joining(","));

		putBlob("many-notes", "{\"schemaVersion\":1,\"products\":[],\"notes\":{" + notes
				+ "},\"clientSavedAt\":\"2026-09-01T00:00:00.000Z\"}")
				.andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("JSON이 아니면 400 — 파싱 실패가 500으로 새면 안 된다")
	void reject_malformedJson() throws Exception {
		putBlob("malformed", "{\"schemaVersion\":1,").andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("최상위가 객체가 아니면 400 — 배열·문자열도 유효한 JSON이다")
	void reject_nonObjectRoot() throws Exception {
		putBlob("array-root", "[1,2,3]").andExpect(status().isBadRequest());
	}
}
