# troubleshooting — 함정 + 승격

> 1분+ 디버깅했으면 원인 잡힌 직후 한 항목을 추가한다: **증상 / 원인 / 해결 / 재발방지**.
> 각 항목은 **파일 1개**(`troubleshooting/T-###.md`)다. 아래 목차는 **자동 생성** — 손대지 않는다.

## 규칙

- **항목 1건 = 파일 1개**: `troubleshooting/T-###.md`. T번호는 프로젝트 전역 시퀀스(빈 번호 없이 이어붙인다).
- **4필드 필수**: `- **증상**:` / `- **원인**:` / `- **해결**:` / `- **재발방지**:`. 검사기가 강제한다(누락 시 커밋 거부). 이 스키마가 항목당 길이를 잠근다.
- **frontmatter `summary:`**: 목차 한 줄의 **단일 출처**. 본문 H1은 `# T-### · 제목`(파일명과 번호 일치).
- **승격**: 같은 함정을 2회+ 다른 맥락에서 만나면 프로젝트 로컬 → 글로벌 CLAUDE.md → 훅 하드가드. 승격 후 본문은 지우지 말고 frontmatter에 `promoted: <대상>`을 달아 이력을 보존한다.
- **목차는 자동 생성**: 손으로 고치지 말고 `scripts/rebuild-troubleshooting-index.ps1`을 돌린다. pre-commit 훅이 stale이면 커밋을 거부한다.

## 왜 이 구조인가 (분할 + 자동목차 + 검사기)

단일 파일에 T-###를 쌓으면 (1) 파일이 Read 캡에 근접해 **최신 항목이 잘리고** (2) 목차 한 줄과 본문이 이중 기재라 **목차가 stale로 썩는다**. 목차를 `ls`(파일=항목)로 만들면 파일시스템이 축을 고를 수 없어 drift가 구조적으로 불가능해진다. 검사기(fail-close)를 규약과 함께 둔다 — **검사기 없는 규약은 100% 준수되면서 목적만 증발한다**. 설치·근거: [`SETUP.md`](SETUP.md).

## 항목 목차 (자동 생성 — 직접 편집 금지)

<!-- INDEX:START -->
<!-- ⚙️ 자동 생성 — 직접 편집하지 마세요. scripts/rebuild-troubleshooting-index.ps1 이
     각 항목의 frontmatter(summary)에서 재생성합니다. 내용을 바꾸려면 그 항목의
     summary를 고치세요(단일 출처). 최신 항목이 위. -->

- [T-006](troubleshooting/T-006.md) · SSM Send-Command의 `--parameters file://` JSON에 한글을 넣으면 AWS CLI가 Windows 로케일로 읽어 `text contents could not be decoded`로 죽는다 — 원격 명령은 ASCII로만 쓴다
- [T-005](troubleshooting/T-005.md) · Git Bash `wc -m`은 C 로케일이라 한글을 바이트로 센다(535자를 1264로) — 글자 수 제한 검증은 PowerShell `.Length`로 잰다
- [T-004](troubleshooting/T-004.md) · 네이티브 confirm이 렌더러를 잡으면 CDP 입력·스크린샷·스크립트 주입이 전부 타임아웃돼 「탭 CDP 상함」과 같은 얼굴로 죽는다 — 전부 막히면 세션 상함이 아니라 다이얼로그 블로킹을 먼저 의심하고 사용자에게 화면 확인을 요청한다
- [T-003](troubleshooting/T-003.md) · 렌더 뒤에 `vi.useFakeTimers()`를 부르면 이미 걸린 `setTimeout`이 진짜 시계에 남아 「멈추는가」 테스트가 거짓 초록이 된다 — 타이머를 먼저 켜고 렌더하되, 그러면 fake-indexeddb가 붙잡히므로 저장소를 목으로 돌린다
- [T-002](troubleshooting/T-002.md) · jsdom + fake-indexeddb에서 Blob이 저장소를 왕복하며 평범한 객체가 돼 어휘 검증에 전부 걸린다 — 화면 테스트는 `listPhotos`를 목으로 갈아 끼운다(저장소 자체는 node 환경에서 진짜로 잰다)
- [T-001](troubleshooting/T-001.md) · 다른 레포에서 파일을 이식하면 줄끝(CRLF)이 새 파일(LF)과 섞여, 나중에 스크립트 제자리 치환이 조용히 0건이 된다 — `.gitattributes`에 `* text=auto eol=lf`를 먼저 박는다

<!-- INDEX:END -->
