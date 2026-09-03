package com.facefit.common;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 이 기능에 필요한 비밀이 아직 없다(KEK 미설정 — 설계 §3-4). 서버는 살아 있고 이 표면만 쉰다.
 *
 * <p>받아 두고 못 보내는 것보다 <b>안 받는 것</b>이 낫다 — 클라는 실패를 무음 폴백으로 다뤄
 * 「예약됨」을 그리지 않는다.
 */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class ServiceUnavailableException extends RuntimeException {
}
