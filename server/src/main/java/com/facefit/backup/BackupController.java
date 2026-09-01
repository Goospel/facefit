package com.facefit.backup;

import com.facefit.common.AnonKey;
import com.facefit.common.RateLimiter;
import com.facefit.common.TooManyRequestsException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

/**
 * 백업·복원. <b>동기화가 아니다</b> — 시나리오는 「기기 이전」 하나이고, 전체 블롭을 통째로
 * 덮어쓴다(설계 §3-3). 그래서 엔드포인트가 셋뿐이고 충돌 해소·삭제 마커·머지 코드가 0줄이다.
 *
 * <p>컨트롤러는 얇다 — 순서만 정한다: <b>키 → 레이트리밋 → 검증 → 저장</b>.
 * 레이트리밋이 검증보다 앞인 것이 의도다. 잘못된 본문을 쏟아붓는 것도 남용이라,
 * 파싱까지 간 뒤에 세면 그 파싱 비용을 이미 치른 뒤다.
 */
@RestController
@RequestMapping("/v1/backup")
class BackupController {

	private final BackupRepository repository;
	private final RateLimiter rateLimiter;
	private final ObjectMapper mapper;
	private final int putPerKeyPerMinute;

	BackupController(BackupRepository repository, RateLimiter rateLimiter, ObjectMapper mapper,
			@Value("${facefit.ratelimit.backup-put-per-key-per-minute}") int putPerKeyPerMinute) {
		this.repository = repository;
		this.rateLimiter = rateLimiter;
		this.mapper = mapper;
		this.putPerKeyPerMinute = putPerKeyPerMinute;
	}

	/** PUT 응답. 클라는 이 값을 「마지막 백업 시각」 표시에 쓴다. */
	record SavedAt(String savedAt) {
	}

	/**
	 * 본문을 {@code String}이 아니라 <b>{@code byte[]}로 받는다</b>. 이유 둘:
	 * ① 512KB 상한을 문자 수가 아니라 <b>실제 바이트</b>로 재야 한다(한글은 문자당 3바이트라
	 * 문자 수로 재면 상한이 3배로 늘어난다). ② {@code StringHttpMessageConverter}의 기본
	 * 문자셋에 운을 맡기지 않고 UTF-8로 직접 해독한다 — application/json은 규격상 UTF-8이다.
	 */
	@PutMapping
	SavedAt put(@RequestHeader(name = "X-Anon-Key", required = false) String rawKey,
			@RequestBody(required = false) byte[] body) {
		AnonKey key = AnonKey.fromHeader(rawKey);
		if (!rateLimiter.allow("backup-put:" + key.hash(), putPerKeyPerMinute)) {
			throw new TooManyRequestsException();
		}

		JsonNode root = BlobValidator.validate(body, mapper);
		JsonNode clientSavedAt = root.get("clientSavedAt");
		Instant now = Instant.now();

		// **원본 바이트를 그대로** 저장한다. 파싱한 트리를 다시 직렬화하면 공백과 키 순서가
		// 바뀌어, 「클라의 미지 필드를 있는 그대로 왕복 보존한다」는 계약이 깨진다(설계 §4-2).
		repository.save(key.hash(), new String(body, StandardCharsets.UTF_8),
				clientSavedAt != null && clientSavedAt.isString() ? clientSavedAt.stringValue() : null, now);

		return new SavedAt(now.toString());
	}

	/** 404는 오류가 아니라 <b>신규 사용자의 정상 상태</b>다 — 클라가 이걸 「백업 없음」으로 읽는다. */
	@GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<String> get(@RequestHeader(name = "X-Anon-Key", required = false) String rawKey) {
		AnonKey key = AnonKey.fromHeader(rawKey);
		return repository.find(key.hash())
				.map(ResponseEntity::ok)
				.orElseGet(() -> ResponseEntity.notFound().build());
	}

	/** 「백업 끄기」 = 즉시 삭제. 삭제권 이행이자, 문구를 믿을 수 있게 하는 근거다(설계 §3-3). */
	@DeleteMapping
	ResponseEntity<Void> delete(@RequestHeader(name = "X-Anon-Key", required = false) String rawKey) {
		AnonKey key = AnonKey.fromHeader(rawKey);
		repository.delete(key.hash());
		return ResponseEntity.noContent().build();
	}
}
