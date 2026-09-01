package com.facefit.backup;

import com.facefit.common.InvalidBlobException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.Set;

/**
 * <b>불변식의 서버측 집행자.</b> 「사진 바이트는 어떤 경로로도 서버에 올라가지 않는다」를
 * 여기가 구조적으로 보장한다(설계 §3-2·§4-2).
 *
 * <p>핵심은 {@link #MAX_STRING_CHARS}다. 사진 1장의 base64는 약 27만 자라, 2,000자 상한이면
 * <b>어떤 필드 이름으로 위장하든, 얼마나 깊이 숨기든 통과할 수 없다</b> — 검사가 재귀이고
 * 값뿐 아니라 키까지 보기 때문이다. 이 상한을 지우는 변경은 곧 앱의 온보딩 고지와 검수
 * 통과 문구를 거짓으로 만드는 변경이다.
 *
 * <p>본문 크기 상한과 문자열 길이 상한은 <b>서로를 대신하지 않는다</b>. 짧은 문자열 수천 개로
 * 총량만 넘길 수도, 하나의 긴 문자열로 길이만 넘길 수도 있어서 둘 다 필요하다.
 */
final class BlobValidator {

	/** 제품 200건 상한 × ~1KB + 관찰 수년치에 8배 여유(설계 §3-3). */
	static final int MAX_BODY_BYTES = 512 * 1024;
	/** 사진 base64(약 27만 자)가 구조적으로 못 들어오게 하는 값. **이 수를 올리면 불변식이 열린다.** */
	static final int MAX_STRING_CHARS = 2_000;
	static final int MAX_PRODUCTS = 200;
	/** 하루 1키라 10년치가 넘는다. */
	static final int MAX_NOTES = 4_000;
	/** 스키마의 VARCHAR(32)와 짝. 안 막으면 DB가 500으로 거절한다 — 400이어야 할 것이 500이 되면 안 된다. */
	static final int MAX_CLIENT_SAVED_AT_CHARS = 32;

	/**
	 * 최상위 키 화이트리스트. 여기 없는 키를 허용하면 블롭이 <b>임의 저장소</b>가 된다 —
	 * 사진이든 뭐든 새 키에 담아 보내면 그만이다.
	 */
	private static final Set<String> ALLOWED_TOP_LEVEL =
			Set.of("schemaVersion", "products", "notes", "clientSavedAt");

	private BlobValidator() {
	}

	/**
	 * 통과하면 파싱된 트리를 돌려준다(호출자가 {@code clientSavedAt}을 꺼내 쓴다).
	 * <b>저장은 이 트리가 아니라 원본 바이트로 한다</b> — 다시 직렬화하면 공백·키 순서가
	 * 바뀌어 「있는 그대로 왕복 보존」이 깨진다.
	 */
	static JsonNode validate(byte[] body, ObjectMapper mapper) {
		if (body == null || body.length == 0) {
			throw new InvalidBlobException("본문이 없다");
		}
		if (body.length > MAX_BODY_BYTES) {
			throw new InvalidBlobException("본문이 " + MAX_BODY_BYTES + "바이트를 넘는다");
		}

		JsonNode root;
		try {
			root = mapper.readTree(body);
		} catch (JacksonException e) {
			// 파싱 실패는 클라의 잘못이지 서버의 장애가 아니다 — 500으로 새면 안 된다.
			throw new InvalidBlobException("JSON이 아니다");
		}

		if (root == null || !root.isObject()) {
			throw new InvalidBlobException("최상위가 객체가 아니다");
		}

		for (String field : root.propertyNames()) {
			if (!ALLOWED_TOP_LEVEL.contains(field)) {
				throw new InvalidBlobException("모르는 최상위 키: " + field);
			}
		}

		JsonNode products = root.get("products");
		if (products != null && !products.isNull()) {
			if (!products.isArray()) {
				throw new InvalidBlobException("products가 배열이 아니다");
			}
			if (products.size() > MAX_PRODUCTS) {
				throw new InvalidBlobException("products가 " + MAX_PRODUCTS + "건을 넘는다");
			}
		}

		JsonNode notes = root.get("notes");
		if (notes != null && !notes.isNull()) {
			if (!notes.isObject()) {
				throw new InvalidBlobException("notes가 객체가 아니다");
			}
			if (notes.size() > MAX_NOTES) {
				throw new InvalidBlobException("notes가 " + MAX_NOTES + "키를 넘는다");
			}
		}

		JsonNode clientSavedAt = root.get("clientSavedAt");
		if (clientSavedAt != null && !clientSavedAt.isNull()) {
			if (!clientSavedAt.isString() || clientSavedAt.stringValue().length() > MAX_CLIENT_SAVED_AT_CHARS) {
				throw new InvalidBlobException("clientSavedAt이 문자열이 아니거나 너무 길다");
			}
		}

		checkStrings(root);
		return root;
	}

	/**
	 * 트리 전체를 훑어 **값과 키 양쪽**의 문자열 길이를 본다. 값만 보면 반쪽 검사다 —
	 * 긴 문자열을 객체의 키 자리에 넣는 것을 못 막는다.
	 *
	 * <p>재귀 깊이는 Jackson의 파서 제약({@code StreamReadConstraints}, 기본 1,000)이 이미
	 * 막아 두어 스택이 터질 깊이가 애초에 도착하지 않는다.
	 */
	private static void checkStrings(JsonNode node) {
		if (node.isString()) {
			if (node.stringValue().length() > MAX_STRING_CHARS) {
				throw new InvalidBlobException("문자열이 " + MAX_STRING_CHARS + "자를 넘는다");
			}
			return;
		}
		if (node.isArray()) {
			for (JsonNode child : node) {
				checkStrings(child);
			}
			return;
		}
		if (node.isObject()) {
			for (Map.Entry<String, JsonNode> entry : node.properties()) {
				if (entry.getKey().length() > MAX_STRING_CHARS) {
					throw new InvalidBlobException("객체 키가 " + MAX_STRING_CHARS + "자를 넘는다");
				}
				checkStrings(entry.getValue());
			}
		}
	}
}
