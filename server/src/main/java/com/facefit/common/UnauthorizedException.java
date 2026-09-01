package com.facefit.common;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 쓸 수 있는 익명 키가 없다 — 없는 것과 형식이 이상한 것을 가르지 않는다({@link AnonKey}). */
@ResponseStatus(HttpStatus.UNAUTHORIZED)
public class UnauthorizedException extends RuntimeException {
}
