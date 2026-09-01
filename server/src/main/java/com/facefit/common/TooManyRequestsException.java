package com.facefit.common;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 분당 상한 초과(설계 §3-1). 클라는 이걸 실패로 보고 조용히 다음 기회에 재시도한다. */
@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
public class TooManyRequestsException extends RuntimeException {
}
