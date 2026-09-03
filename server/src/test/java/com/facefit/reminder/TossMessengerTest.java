package com.facefit.reminder;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * 앱인토스 메신저로 한 통 보낸다. 여기서 잡는 실패는 둘이다.
 *
 * <p>① <b>요청 형태가 틀려 토스가 못 알아듣는 것</b> — 특히 수신자 헤더. 이 앱은 로그인이
 * 없어서 {@code x-anon-key}(익명 키)로 보내고, 문서가 「두 헤더를 동시에 전달하지 마세요」라고
 * 못 박았다(설계 §2-1). 그래서 {@code x-toss-user-key}가 <b>없다는 것</b>까지 잰다.
 *
 * <p>② <b>실패가 예외로 새는 것</b> — 워커는 분마다 도는 배경 작업이라, 발송 실패가 위로
 * 튀면 그 분의 나머지 행이 통째로 밀린다. 어떤 실패든 로그 + {@code false}로 끝나야 한다.
 * 특히 토스는 <b>200으로도 {@code resultType: FAIL}</b>을 준다(미승인 템플릿 5004 등) —
 * 상태코드만 보면 「보냈다」고 오인하고 예약 행을 지워, 알림은 영영 안 간다.
 *
 * <p>mTLS 핸드셰이크 자체는 대상 밖이다(인증서 = 운영 게이트, 설계 §4 절차 4·7).
 */
class TossMessengerTest {

	private static final String BASE = "https://apps-in-toss-api.example.test";
	private static final String SEND_URL = BASE + "/api-partner/v1/apps-in-toss/messenger/send-message";
	private static final String TEMPLATE = "facefit-oil-paper-reminder";

	private RestClient.Builder builder;
	private MockRestServiceServer server;

	@BeforeEach
	void setUp() {
		builder = RestClient.builder();
		server = MockRestServiceServer.bindTo(builder).build();
	}

	private TossMessenger messenger() {
		return new TossMessenger(BASE, TEMPLATE, builder.build());
	}

	@Test
	@DisplayName("익명 키 헤더로 템플릿 한 통 — x-anon-key는 있고 x-toss-user-key는 없다")
	void send_usesAnonKeyHeaderOnly() {
		server.expect(requestTo(SEND_URL))
				.andExpect(method(HttpMethod.POST))
				.andExpect(header("x-anon-key", "anon-key-abc"))
				.andExpect(headerDoesNotExist("x-toss-user-key"))
				.andExpect(jsonPath("$.templateSetCode").value(TEMPLATE))
				.andExpect(jsonPath("$.context").exists())
				.andRespond(withSuccess("{\"resultType\":\"SUCCESS\",\"success\":{\"sentPushCount\":1}}",
						MediaType.APPLICATION_JSON));

		assertThat(messenger().send("anon-key-abc")).isTrue();
		server.verify();
	}

	@Test
	@DisplayName("200이어도 resultType=FAIL이면 false — 미승인 템플릿을 성공으로 오인하지 않는다")
	void send_resultTypeFail_isFalse() {
		server.expect(requestTo(SEND_URL))
				.andRespond(withSuccess("{\"resultType\":\"FAIL\","
						+ "\"error\":{\"errorCode\":\"5004\",\"reason\":\"승인되지 않은 메시지 템플릿\"}}",
						MediaType.APPLICATION_JSON));

		assertThat(messenger().send("anon-key-abc")).isFalse();
	}

	@Test
	@DisplayName("5xx면 던지지 않고 false — 발송 실패가 워커의 그 분을 통째로 날리지 않는다")
	void send_serverError_isFalseWithoutThrowing() {
		server.expect(requestTo(SEND_URL)).andRespond(withServerError());

		assertThat(messenger().send("anon-key-abc")).isFalse();
	}

	@Test
	@DisplayName("4xx(잘못된 익명 키 등)도 예외 없이 false")
	void send_clientError_isFalseWithoutThrowing() {
		server.expect(requestTo(SEND_URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST));

		assertThat(messenger().send("anon-key-abc")).isFalse();
	}

	@Test
	@DisplayName("응답이 비어 있으면 false — 성공의 증거가 없으면 성공이 아니다")
	void send_emptyBody_isFalse() {
		server.expect(requestTo(SEND_URL)).andRespond(withSuccess("", MediaType.APPLICATION_JSON));

		assertThat(messenger().send("anon-key-abc")).isFalse();
	}

	@Test
	@DisplayName("템플릿 코드가 비어 있으면 미설정 — 콘솔 승인 전에는 조용히 쉰다(다크런치)")
	void blankTemplateCode_isNotConfigured() {
		assertThat(new TossMessenger(BASE, "", builder.build()).isConfigured()).isFalse();
		assertThat(messenger().isConfigured()).isTrue();
	}
}
