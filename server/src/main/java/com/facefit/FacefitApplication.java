package com.facefit;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * facefit API 서버 진입점.
 *
 * <p>이 서버가 하는 일은 둘뿐이다 — 제품·관찰 기록의 백업·복원과, 수기 등록 제품명의 익명
 * 수집(크라우드소싱). 설계 단일 출처는 {@code docs/2026-08-30-server-design.md}.
 *
 * <p><b>불변식</b>: 사진 바이트는 어떤 경로로도 서버에 올라오지 않는다. 클라이언트는 사진을
 * 페이로드에 넣을 코드 자체가 없고, 서버는 본문 크기 상한과 재귀 문자열 길이 상한으로
 * 밀반입을 이중 차단한다(설계 §3-2·§4-2). 이 불변식이 깨지면 앱의 온보딩 고지와 검수 이력이
 * 동시에 거짓이 된다.
 */
@SpringBootApplication
public class FacefitApplication {

	public static void main(String[] args) {
		SpringApplication.run(FacefitApplication.class, args);
	}
}
