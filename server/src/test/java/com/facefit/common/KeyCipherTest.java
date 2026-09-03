package com.facefit.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 익명 키를 DB에 <b>평문으로 두지 않기 위한</b> 봉투 하나. 원 키가 곧 백업 열람 토큰이라
 * (`AnonKey` 주석), 알림 예약 때문에 그것을 평문으로 눕히면 DB 유출이 곧 전원의 백업 유출이 된다.
 *
 * <p>여기서 지킬 것은 셋이다 — <b>왕복이 같을 것</b>, <b>같은 평문이 매번 다른 바이트가 될 것</b>
 * (IV 재사용은 GCM에서 치명적이다), <b>한 바이트만 바뀌어도 열리지 않을 것</b>(인증 태그).
 */
class KeyCipherTest {

	/** 테스트용 고정 KEK — base64 32바이트(application-test.properties와 같은 값). */
	private static final String KEK = "ZmFjZWZpdC10ZXN0LWtlay0wMDAwMDAwMDAwMDAwMDA=";

	@Test
	@DisplayName("봉인한 뒤 열면 같은 문자열이 나온다")
	void seal_thenOpen_roundTrips() {
		KeyCipher cipher = new KeyCipher(KEK);

		assertThat(cipher.open(cipher.seal("anon-key-abc"))).isEqualTo("anon-key-abc");
	}

	@Test
	@DisplayName("같은 평문을 두 번 봉인하면 바이트가 다르다 — IV를 매번 새로 뽑는다는 뜻")
	void seal_twice_differsByIv() {
		KeyCipher cipher = new KeyCipher(KEK);

		assertThat(cipher.seal("anon-key-abc")).isNotEqualTo(cipher.seal("anon-key-abc"));
	}

	@Test
	@DisplayName("봉인 바이트에 원 키가 그대로 실려 있지 않다")
	void seal_doesNotContainPlaintext() {
		byte[] sealed = new KeyCipher(KEK).seal("anon-key-abc");

		assertThat(new String(sealed, StandardCharsets.ISO_8859_1)).doesNotContain("anon-key-abc");
	}

	@Test
	@DisplayName("한 바이트만 변조해도 열리지 않는다 — 인증 태그가 붙어 있다")
	void open_tamperedBytes_throws() {
		KeyCipher cipher = new KeyCipher(KEK);
		byte[] sealed = cipher.seal("anon-key-abc");
		sealed[sealed.length - 1] ^= 0x01;

		assertThatThrownBy(() -> cipher.open(sealed)).isInstanceOf(IllegalStateException.class);
	}

	@Test
	@DisplayName("다른 KEK로는 열리지 않는다 — 키가 실제로 쓰인다는 확인")
	void open_withOtherKek_throws() {
		byte[] sealed = new KeyCipher(KEK).seal("anon-key-abc");
		KeyCipher other = new KeyCipher("b3RoZXIta2V5LTAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=");

		assertThatThrownBy(() -> other.open(sealed)).isInstanceOf(IllegalStateException.class);
	}

	@Test
	@DisplayName("KEK가 비어 있으면 빈 상태로 기동한다 — 인증서·비밀 없이도 서버는 떠야 한다(다크런치)")
	void blankKek_isNotConfigured() {
		KeyCipher cipher = new KeyCipher("");

		assertThat(cipher.isConfigured()).isFalse();
	}

	@Test
	@DisplayName("KEK가 있으면 설정된 상태다")
	void presentKek_isConfigured() {
		assertThat(new KeyCipher(KEK).isConfigured()).isTrue();
	}

	@Test
	@DisplayName("길이가 32바이트가 아닌 KEK는 기동을 깨뜨린다 — 조용히 약한 키로 도는 것보다 낫다")
	void wrongLengthKek_failsFast() {
		// 16바이트 base64. 비어 있는 것(다크런치)과 잘못된 것(설정 실수)은 다르게 다룬다.
		assertThatThrownBy(() -> new KeyCipher("MDAwMDAwMDAwMDAwMDAwMA=="))
				.isInstanceOf(IllegalStateException.class);
	}
}
