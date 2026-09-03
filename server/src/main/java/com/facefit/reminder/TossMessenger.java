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

	/** 번들을 못 만든 이유는 한 번만 남긴다 — 분마다 같은 줄을 쌓으면 진짜 오류가 묻힌다. */
	private volatile boolean warnedBundleUnusable;

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
	 * 보낼 준비가 됐는가 — <b>승인된 템플릿 코드</b>와 <b>실제로 만들어지는 mTLS 클라이언트</b>.
	 *
	 * <p>번들이 <b>등록됐는지</b>가 아니라 <b>로드되는지</b>를 본다. SSL 번들은 이름만 먼저 잡히고
	 * 실제 로딩은 미뤄지기 때문에, PEM이 지워졌거나·권한이 막혔거나·형식이 틀려도 「등록됨」은
	 * 그대로 true다. 그걸 믿으면 워커가 매분 행을 집어 {@code attempts}를 태우고, 3회를 채운
	 * 예약은 <b>영영 안 간다</b> — 사용자 화면엔 「예약됨」만 남는다. 그래서 여기서 한 번
	 * 만들어 본다(성공하면 그 클라이언트가 그대로 재사용되므로 낭비도 아니다).
	 *
	 * <p>실패는 기억하지 않는다 — 인증서가 나중에 채워지면 다음 분에 저절로 살아난다.
	 */
	boolean isConfigured() {
		if (templateSetCode == null || templateSetCode.isBlank()) {
			return false;
		}
		try {
			restClient();
			return true;
		} catch (RuntimeException e) {
			if (!warnedBundleUnusable) {
				warnedBundleUnusable = true;
				// 왜 못 쓰는지는 여기에만 남는다(파일 없음·권한·형식) — 워커의 경고는 「미설정」까지만 안다.
				log.warn("토스 mTLS 클라이언트를 만들지 못했다 (bundle={}): {}", sslBundleName, e.toString());
			}
			return false;
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
		JsonNode root = objectMapper.readTree(body);
		// ⚠️ 최상위만 본다. {@code findValue}는 트리 전체를 훑어서, 응답 어딘가에 같은 이름의
		// 필드가 끼면(중첩 결과·에러 상세 등) 엉뚱한 값을 성공으로 읽을 수 있다.
		if ("SUCCESS".equals(string(root.path("resultType")))) {
			return true;
		}

		// 실패 이유는 코드와 사유만 남긴다 — 응답을 통째로 실으면 나중에 토스가 본문에 무엇을
		// 넣든 그대로 로그에 눕는다(수신자 식별자가 섞여 들어올 자리를 만들지 않는다).
		JsonNode error = root.path("error");
		String code = string(error.path("errorCode"));
		String reason = string(error.path("reason"));
		if (!code.isEmpty() || !reason.isEmpty()) {
			log.warn("기름종이 알림 발송 거부 (template={}, errorCode={}, reason={})",
					templateSetCode, code, reason);
		} else {
			// 모르는 형태의 응답 — 진단은 해야 하니 앞부분만 자른다.
			log.warn("기름종이 알림 발송 거부 (template={}): {}", templateSetCode, abbreviate(body));
		}
		return false;
	}

	/** 문자열 노드가 아니면 빈 문자열 — 없는 필드·숫자·객체를 모두 「값 없음」으로 다룬다. */
	private static String string(JsonNode node) {
		return node.isString() ? node.stringValue() : "";
	}

	private static String abbreviate(String body) {
		return body.length() <= 200 ? body : body.substring(0, 200) + "…(생략)";
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
