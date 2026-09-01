package com.facefit.common;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 살아 있는지만 답한다. UptimeRobot의 5분 감시와 배포 직후 검증이 이걸 읽는다(설계 §5).
 *
 * <p><b>바디를 안 붙인다.</b> 무언가를 적어 두면 그것이 계약이 되고, 다음 사람이 거기에 DB
 * 상태 같은 걸 실으려 든다 — 그러면 그 계산이 실패할 때 헬스체크가 같이 죽어서,
 * 「앱은 멀쩡한데 감시만 빨간불」이나 그 반대가 생긴다. 액추에이터를 안 쓴 이유도 같다:
 * 이 한 줄에 스타터 하나와 그 메모리를 얹을 이유가 없다(설계 §3-6 메모리 예산).
 */
@RestController
class HealthController {

	@GetMapping("/health")
	ResponseEntity<Void> health() {
		return ResponseEntity.ok().build();
	}
}
