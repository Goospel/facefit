import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 정적 SPA다. 앱인토스 CLI(`ait`)로 번들을 올리면 토스가 호스팅한다 — **우리가 운영하는
// 서버는 0대다.** 사진은 IndexedDB에, 제품·관찰 기록은 localStorage에 있다.
// 런타임 네트워크 호출은 v2-2에서 처음 생겼다 — 제품 검색의 식약처 공공 API 조회 하나뿐이고,
// 나가는 것은 검색어다(설계 §3-5).
export default defineConfig({
  plugins: [react()],
  // BookTimer 5300 · restfit 5310과 겹치지 않게 5320. 이 PC에서 5174 구간은 OS 예약이라 피한다(restfit T-197).
  server: { port: 5320 },
});
