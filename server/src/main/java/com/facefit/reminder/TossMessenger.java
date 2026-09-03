package com.facefit.reminder;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ssl.SslBundle;
import org.springframework.boot.ssl.SslBundles;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

/**
 * 앱인토스 메신저(서버 발송 푸시) 클라이언트 — 토스 앱의 네이티브 알림으로 한 통 보낸다.
 * 구조는 BookTimer의 {@code TossMessengerClient}를 그대로 옮긴 것이다(같은 API·같은 mTLS).
 *
 * <p>다른 점 하나: 수신자 헤더가 {@code x-toss-user-key}가 아니라 <b>{@code x-anon-key}</b>다.
 * 이 앱에는 로그인이 없고, 백업이 이미 쓰는 그 익명 키로 보낸다(설계 §2-1·§3-1). 문서가
 * 「두 헤더를 동시에 전달하지 마세요」라고 못 박아서, 로그인 키는 <b>넣지 않는다</b>.
 *
 * <p><b>절대 던지지 않는다.</b> 호출자는 분마다 도는 워커라, 한 통의 실패가 예외로 새면 그 분의
 * 나머지 예약이 통째로 밀린다. 모든 실패는 로그 + {@code false}로 끝난다 — 그러면 행이 남고
 * 다음 분에 다시 시도된다.
 *
 * <p>mTLS 클라이언트는 <b>첫 호출 때 만든다</b>. 인증서가 없어도 서버는 떠야 하기 때문이다
 * (다크런치 — {@link #isConfigured()}가 false면 워커가 애초에 부르지 않는다).
 */
@Component
class TossMessenger {

	private static final Logger log = LoggerFactory.getLogger(TossMessenger.class);

	private static final String SEND_PATH = "/api-partner/v1/apps-in-toss/messenger/send-message";

	private final String apiBaseUrl;
	private final String templateSetCode;
	private final String sslBundleName;
	private final SslBundles sslBundles;
	private final ObjectMapper objectMapper = JsonMapper.builder().build();

	/** 지연 생성한 mTLS RestClient(인증서 없이도 기동해야 하므로 첫 호출 때 만든다). */
	private volatile RestClient restClient;

	@Autowired
	TossMessenger(@Value("${facefit.toss.api-base-url}") String apiBaseUrl,
			@Value("${facefit.reminder.template-set-code}") String templateSetCode,
			@Value("${facefit.toss.ssl-bundle}") String sslBundleName,
			SslBundles sslBundles) {
		this.apiBaseUrl = apiBaseUrl;
		this.templateSetCode = templateSetCode;
		this.sslBundleName = sslBundleName;
		this.sslBundles = sslBundles;
	}

	/** 테스트 전용 — {@code MockRestServiceServer}로 바인딩한 RestClient 주입(mTLS는 운영 게이트). */
	TossMessenger(String apiBaseUrl, String templateSetCode, RestClient restClient) {
		this.apiBaseUrl = apiBaseUrl;
		this.templateSetCode = templateSetCode;
		this.sslBundleName = null;
		this.sslBundles = null;
		this.restClient = restClient;
	}

	/**
	 * 보낼 준비가 됐는가 — <b>승인된 템플릿 코드</b>와 <b>mTLS 인증서</b> 둘 다 있어야 한다.
	 * 콘솔 절차(인증서 발급·템플릿 검수)가 끝나기 전에는 false이고, 워커는 조용히 쉰다.
	 */
	boolean isConfigured() {
		if (templateSetCode == null || templateSetCode.isBlank()) {
			return false;
		}
		if (sslBundles == null) {
			return true; // 테스트 주입 경로 — 인증서 대신 목 서버가 붙어 있다.
		}
		try {
			sslBundles.getBundle(sslBundleName);
			return true;
		} catch (RuntimeException e) {
			return false; // 번들 미등록 = 인증서 아직 없음(로컬·다크런치).
		}
	}

	/**
	 * 익명 키 한 명에게 승인된 템플릿을 보낸다. {@code context}는 비어 있다 — 이 템플릿에는
	 * 변수가 없다(문구는 콘솔에서 검수 승인된 것만 나간다, 설계 §3-5).
	 *
	 * @return 토스가 {@code resultType=SUCCESS}를 준 경우에만 true. 그 외 모든 경우
	 *         (네트워크·인증서·4xx·5xx·미승인 템플릿)는 로그만 남기고 false.
	 */
	boolean send(String anonKey) {
		try {
			String body = restClient().post()
					.uri(apiBaseUrl + SEND_PATH)
					.header("x-anon-key", anonKey)
					.contentType(MediaType.APPLICATION_JSON)
					.body(Map.of("templateSetCode", templateSetCode, "context", Map.of()))
					.retrieve()
					.body(String.class);
			return isSuccess(body);
		} catch (Exception e) {
			// ⚠️ 익명 키·해시는 로그에 남기지 않는다 — 그 키가 곧 백업 열람 토큰이다.
			log.warn("기름종이 알림 발송 실패 (template={}): {}", templateSetCode, e.toString());
			return false;
		}
	}

	/** 토스는 2xx로도 {@code resultType=FAIL}(미승인 템플릿 5004 등)을 준다 — 상태코드만 보면 오인한다. */
	private boolean isSuccess(String body) {
		if (body == null || body.isBlank()) {
			log.warn("기름종이 알림 발송 응답이 비어 있다 (template={})", templateSetCode);
			return false;
		}
		JsonNode resultType = objectMapper.readTree(body).findValue("resultType");
		if (resultType != null && "SUCCESS".equals(resultType.asString())) {
			return true;
		}
		log.warn("기름종이 알림 발송 거부 (template={}): {}", templateSetCode, body);
		return false;
	}

	private RestClient restClient() {
		RestClient local = this.restClient;
		if (local == null) {
			synchronized (this) {
				local = this.restClient;
				if (local == null) {
					local = buildMutualTlsClient();
					this.restClient = local;
				}
			}
		}
		return local;
	}

	private RestClient buildMutualTlsClient() {
		SslBundle bundle = sslBundles.getBundle(sslBundleName);
		HttpClient httpClient = HttpClient.newBuilder()
				.sslContext(bundle.createSslContext())
				.connectTimeout(Duration.ofSeconds(2))
				.build();
		JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
		factory.setReadTimeout(Duration.ofSeconds(3));
		return RestClient.builder().requestFactory(factory).build();
	}
}
