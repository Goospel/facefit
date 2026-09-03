package com.facefit.reminder;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * KEK가 아직 없는 동안(인증서·비밀 발급 전) 서버는 <b>뜨고, 알림만 쉰다</b>.
 *
 * <p>예약을 받아 두고 못 보내는 것이 최악이다 — 사용자는 「예약됨」을 보는데 알림은 영영 안 온다.
 * 그래서 봉인할 수 없으면 <b>받지 않는다</b>(503). 클라는 서버 실패를 무음 폴백으로 다루므로
 * 「지금은 예약할 수 없어요」가 화면에 뜬다(설계 §3-5).
 */
@SpringBootTest(properties = "facefit.reminder.kek=")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ReminderDarkLaunchTest {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbc;

	@Test
	@DisplayName("KEK가 없으면 PUT은 503이고 행도 안 생긴다 — 못 보낼 예약을 받아 두지 않는다")
	void put_withoutKek_is503() throws Exception {
		jdbc.update("DELETE FROM reminder");

		mockMvc.perform(put("/v1/reminder").header("X-Anon-Key", "test-rem-nokek"))
				.andExpect(status().isServiceUnavailable());

		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reminder", Integer.class)).isZero();
	}

	@Test
	@DisplayName("KEK가 없어도 서버는 살아 있다 — 알림만 쉬고 나머지 기능은 그대로다")
	void health_stillOk() throws Exception {
		mockMvc.perform(get("/health")).andExpect(status().isOk());
	}
}
