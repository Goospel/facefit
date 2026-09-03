package com.facefit.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * 익명 키를 DB에 눕히기 전에 씌우는 봉투 — AES/GCM/NoPadding, IV 12바이트를 <b>선두에 붙인다</b>.
 *
 * <p>{@link AnonKey}의 「원 키는 어디에도 저장되지 않는다」를 <b>「평문으로는」</b>으로 좁히는
 * 장치다(설계 §3-4). 알림을 보내려면 원 키가 필요한데(발송 API 헤더 {@code x-anon-key}),
 * 그 키는 동시에 백업 열람 토큰이라 평문으로 두면 DB 유출이 곧 전원의 백업 유출이 된다.
 * KEK는 DB가 아니라 SSM 파라미터 → 환경변수로만 산다.
 *
 * <p><b>KEK가 없으면 빈 상태로 기동한다</b>({@link #isConfigured()} false). 인증서·KEK가
 * 아직 없는 동안에도 서버는 떠야 하고, 알림만 조용히 쉰다(다크런치). 반대로 <b>있는데 길이가
 * 틀리면 기동을 깨뜨린다</b> — 설정 실수를 약한 키로 도는 것으로 흡수하면 안 된다.
 */
@Component
public class KeyCipher {

	private static final int IV_BYTES = 12;
	private static final int TAG_BITS = 128;
	private static final int KEY_BYTES = 32;

	private final SecretKeySpec key;
	private final SecureRandom random = new SecureRandom();

	public KeyCipher(@Value("${facefit.reminder.kek:}") String kekBase64) {
		if (kekBase64 == null || kekBase64.isBlank()) {
			this.key = null;
			return;
		}
		byte[] raw;
		try {
			raw = Base64.getDecoder().decode(kekBase64.trim());
		} catch (IllegalArgumentException e) {
			throw new IllegalStateException("facefit.reminder.kek 이 base64가 아니다", e);
		}
		if (raw.length != KEY_BYTES) {
			throw new IllegalStateException(
					"facefit.reminder.kek 은 base64 32바이트여야 한다 (실제 " + raw.length + ")");
		}
		this.key = new SecretKeySpec(raw, "AES");
	}

	/** KEK가 실려 있는가. false면 예약을 받지 않고(503) 워커도 쉰다. */
	public boolean isConfigured() {
		return key != null;
	}

	/** IV(12B) + 암호문 + 태그. 같은 평문도 매번 다른 바이트가 된다 — GCM에서 IV 재사용은 치명적이다. */
	public byte[] seal(String plain) {
		byte[] iv = new byte[IV_BYTES];
		random.nextBytes(iv);
		try {
			Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
			cipher.init(Cipher.ENCRYPT_MODE, requireKey(), new GCMParameterSpec(TAG_BITS, iv));
			byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
			byte[] out = new byte[iv.length + sealed.length];
			System.arraycopy(iv, 0, out, 0, iv.length);
			System.arraycopy(sealed, 0, out, iv.length, sealed.length);
			return out;
		} catch (Exception e) {
			throw new IllegalStateException("봉인 실패", e);
		}
	}

	/** 변조·다른 KEK·잘린 바이트는 모두 같은 결론이다 — 못 연다. */
	public String open(byte[] sealed) {
		if (sealed == null || sealed.length <= IV_BYTES) {
			throw new IllegalStateException("봉인 바이트가 너무 짧다");
		}
		try {
			Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
			cipher.init(Cipher.DECRYPT_MODE, requireKey(),
					new GCMParameterSpec(TAG_BITS, Arrays.copyOf(sealed, IV_BYTES)));
			return new String(cipher.doFinal(sealed, IV_BYTES, sealed.length - IV_BYTES),
					StandardCharsets.UTF_8);
		} catch (Exception e) {
			throw new IllegalStateException("개봉 실패", e);
		}
	}

	private SecretKeySpec requireKey() {
		if (key == null) {
			throw new IllegalStateException("facefit.reminder.kek 이 없다");
		}
		return key;
	}
}
