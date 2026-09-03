package com.facefit.reminder;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Instant;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * <b>야간 상한은 없다</b>(사용자 결정 2026-09-03 · 설계 §3-3). 밤을 막는 장치는 「다음 알림 승인」
 * 게이트 하나이고, 밤에 울릴지는 사용자가 체크하는 순간 스스로 정한다.
 *
 * <p>이 테스트는 그 결정의 <b>회귀 가드</b>다 — 설계 초안에 있던 「22:00~07:00이면 예약 거부」가
 * 되살아나면 여기서 깨진다. 23:00 KST에 눌러도 응답은 거부가 아니라 세 시간 뒤 시각이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ReminderNightTest {

	@Autowired
	private MockMvc mockMvc;

	@MockitoBean
	private Clock clock;

	/** 2026-09-03T14:00:00Z = 2026-09-03 23:00 KST. 3시간 뒤는 새벽 2시다. */
	private static final Instant ELEVEN_PM_KST = Instant.parse("2026-09-03T14:00:00Z");

	@BeforeEach
	void fixClock() {
		Mockito.when(clock.instant()).thenReturn(ELEVEN_PM_KST);
	}

	@Test
	@DisplayName("23:00 KST에 눌러도 그대로 새벽 2시로 예약된다 — 야간 상한을 두지 않는다는 결정")
	void put_atNight_stillSchedules() throws Exception {
		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "test-rem-night"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.dueAt").value("2026-09-03T17:00:00Z"));
	}
}
