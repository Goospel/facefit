# facefit — 그화장품효과있나

매일 같은 각도로 얼굴을 찍어 **내가 쓰는 화장품이 효과가 있는지** 관찰하는 앱인토스 미니앱.
restfit의 눈바디 + 고스트 엑스레이 시스템을 얼굴·화장품 관찰로 옮긴다.

| 문서 | 무엇이 있나 |
|---|---|
| [plan.md](plan.md) | 앞으로 할 일 (살아있는 계획) |
| [changeLog.md](changeLog.md) | 완료 기록 (역순) |
| [claude-docs/troubleshooting.md](claude-docs/troubleshooting.md) | 함정 + 승격 (항목 1건 = 파일 1개) |

- 구상 문서: [docs/2026-08-29-service-concept.md](docs/2026-08-29-service-concept.md)
- v1 설계: [docs/2026-08-29-v1-design.md](docs/2026-08-29-v1-design.md)

## 개발

```
cd miniapp
npm install
npm run dev     # http://localhost:5320
npm test        # vitest
```

⚠️ **사진은 이 기기를 떠나지 않는다** — 서버는 0대다. 사진은 IndexedDB(`facefit-photos`),
제품·관찰 기록은 localStorage에 있고 런타임 네트워크 호출이 없다.
