package com.facefit.common;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 백업 페이로드가 계약을 벗어났다. 클라가 만들 수 없는 모양이라 **사실상 어뷰즈 신호**이고,
 * 정상 클라는 이 응답을 볼 일이 없다(설계 §3-3).
 */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class InvalidBlobException extends RuntimeException {

	public InvalidBlobException(String message) {
		super(message);
	}
}
