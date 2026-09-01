package com.facefit.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 익명 키의 **해시**. 원 키는 이 클래스 밖으로 나가지 않고, 어디에도 저장·기록되지 않는다.
 *
 * <p>원 키가 곧 열람 토큰이라(설계 §3-1의 capability 모델), 저장하는 순간 DB 유출이
 * <b>모든 사용자 백업의 열람 권한 유출</b>로 번진다. sha256만 남기면 유출된 해시로는
 * 아무것도 못 연다.
 *
 * <p>키 형식은 **불투명하게** 다룬다 — 길이만 보고 구조는 가정하지 않는다(설계 §8-4:
 * 엔트로피가 미실측이라, 형식을 가정한 코드는 토스가 형식을 바꾸는 날 조용히 깨진다).
 */
public record AnonKey(String hash) {

	private static final int MIN_LENGTH = 8;
	private static final int MAX_LENGTH = 128;

	/**
	 * 헤더 값에서 키를 만든다. 쓸 수 있는 자격증명이 아니면 401이다 — 없는 것과 이상한 것을
	 * 가르지 않는다. 둘 다 「이 요청으로는 아무것도 못 준다」는 같은 결론이고, 갈라 봐야
	 * 공격자에게 어느 쪽이 틀렸는지 알려 줄 뿐이다.
	 */
	public static AnonKey fromHeader(String raw) {
		if (raw == null || raw.isBlank() || raw.length() < MIN_LENGTH || raw.length() > MAX_LENGTH) {
			throw new UnauthorizedException();
		}
		return new AnonKey(sha256Hex(raw));
	}

	private static String sha256Hex(String raw) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			return HexFormat.of().formatHex(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException e) {
			// SHA-256은 모든 JVM이 반드시 제공한다 — 여기 오면 런타임이 망가진 것이다.
			throw new IllegalStateException("SHA-256 unavailable", e);
		}
	}
}
