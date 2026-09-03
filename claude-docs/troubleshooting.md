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

- [T-020](troubleshooting/T-020.md) · 스모크가 성공에도 실패에도 같은 응답을 주면 계측기가 아니다 — 4010 하나로 「mTLS 확정」까지만 갔고 정작 최대 가정은 못 가렸다
- [T-019](troubleshooting/T-019.md) · 테스트 번들과 라이브 앱은 localStorage가 갈린다 — 익명 키는 같아서, 로컬 상태만 사라지고 서버 상태는 이어진다
- [T-018](troubleshooting/T-018.md) · vitest 기본 forks 풀이 워커 시작 타임아웃을 내 테스트 파일 25개 중 15개만 실행됐다 — 리포트는 그 15개 기준으로 정상 형태였고 총계만 572→290으로 조용히 줄었다
- [T-017](troubleshooting/T-017.md) · 테스트 주입용 생성자를 하나 더 달았더니 스프링 빈이 「No default constructor found」로 죽었다 — 생성자가 둘이면 스프링은 고르지 않고, 실패는 그 클래스가 아니라 애먼 테스트의 컨텍스트 로딩 실패로 나타난다
- [T-016](troubleshooting/T-016.md) · visibility hidden으로 자리만 지킨 스위치를 getByRole이 hidden true로도 못 찾았다 — 접근성 트리에서 빠진 요소는 이름 계산 자체가 빈 문자열이라 name 옵션과 영영 안 맞는다
- [T-015](troubleshooting/T-015.md) · <label> 안에 안내 한 줄을 넣었더니 그 칸의 접근성 이름이 「사용 빈도촬영할 때…」로 붙어 getByLabelText가 못 찾았다 — 스크린리더가 듣는 이름도 같이 오염된다
- [T-014](troubleshooting/T-014.md) · 성공 응답을 준 쓰기가 값을 안 바꿨다 — miniapp_update_basic_info가 에러 없이 no-op이라, 되읽지 않았으면 「고쳤다」고 보고할 뻔했다
- [T-013](troubleshooting/T-013.md) · 앱 밖에서 하라는 안내는 「어디서」까지 적어야 실행 가능하다 — 「토스 알림 설정에서 끌 수 있어요」만 적었더니 실기기에서 못 껐고, 앱에는 끌 수단이 아예 없었다
- [T-012](troubleshooting/T-012.md) · SDK가 준 세 갈래를 boolean으로 뭉개 「이미 켜져 있음」을 잃었다 — 상태 조회 API가 없는 API에서 그 값이 유일하게 진실을 아는 순간이었는데, 화면은 이미 켠 사용자에게 해 줄 말이 없었다
- [T-011](troubleshooting/T-011.md) · 가짜 타이머 예산을 「필요한 시간 + 조금」으로 잡으면 상태→effect→타이머 사슬에서 간헐 실패한다 — 타이머 등록 자체가 렌더·effect를 기다리므로 그 지연도 예산에 들어가야 한다
- [T-010](troubleshooting/T-010.md) · 토글 버튼에 행동만 적으면(「기록 백업 켜기」) 사용자가 그것을 상태로 읽는다 — 실기기에서 이미 켜진 줄 알고 안 눌렀고, 서버 로그에 요청이 없어 한참을 코드에서 원인을 찾았다
- [T-009](troubleshooting/T-009.md) · 미니앱 웹뷰의 실제 오리진은 `facefit.private-apps.tossmini.com`이다(설계가 적은 `private-web`이 아니다) — CORS 허용값을 문서에서 베끼면 전 요청이 403이 되고, 무음 폴백이라 앱에서는 아무 일도 안 일어난 것처럼 보인다
- [T-008](troubleshooting/T-008.md) · mysqldump 덤프에서 한 데이터베이스 구간만 잘라 복원하면 헤더의 `SET NAMES utf8mb4`가 빠져 한글이 조용히 깨진다 — 복구 리허설은 덤프를 통째로, 빈 MySQL에 넣어야 한다
- [T-007](troubleshooting/T-007.md) · GitHub OIDC의 `sub` 클레임이 레포마다 형식이 다르다(신규 레포는 `owner@id/repo@id`) — 옆 프로젝트의 IAM 신뢰 정책을 복사하면 「Not authorized」로 죽는다. 실제 클레임은 CloudTrail에서 확인한다
- [T-006](troubleshooting/T-006.md) · SSM Send-Command의 `--parameters file://` JSON에 한글을 넣으면 AWS CLI가 Windows 로케일로 읽어 `text contents could not be decoded`로 죽는다 — 원격 명령은 ASCII로만 쓴다
- [T-005](troubleshooting/T-005.md) · Git Bash `wc -m`은 C 로케일이라 한글을 바이트로 센다(535자를 1264로) — 글자 수 제한 검증은 PowerShell `.Length`로 잰다
- [T-004](troubleshooting/T-004.md) · 네이티브 confirm이 렌더러를 잡으면 CDP 입력·스크린샷·스크립트 주입이 전부 타임아웃돼 「탭 CDP 상함」과 같은 얼굴로 죽는다 — 전부 막히면 세션 상함이 아니라 다이얼로그 블로킹을 먼저 의심하고 사용자에게 화면 확인을 요청한다
- [T-003](troubleshooting/T-003.md) · 렌더 뒤에 `vi.useFakeTimers()`를 부르면 이미 걸린 `setTimeout`이 진짜 시계에 남아 「멈추는가」 테스트가 거짓 초록이 된다 — 타이머를 먼저 켜고 렌더하되, 그러면 fake-indexeddb가 붙잡히므로 저장소를 목으로 돌린다
- [T-002](troubleshooting/T-002.md) · jsdom + fake-indexeddb에서 Blob이 저장소를 왕복하며 평범한 객체가 돼 어휘 검증에 전부 걸린다 — 화면 테스트는 `listPhotos`를 목으로 갈아 끼운다(저장소 자체는 node 환경에서 진짜로 잰다)
- [T-001](troubleshooting/T-001.md) · 다른 레포에서 파일을 이식하면 줄끝(CRLF)이 새 파일(LF)과 섞여, 나중에 스크립트 제자리 치환이 조용히 0건이 된다 — `.gitattributes`에 `* text=auto eol=lf`를 먼저 박는다

<!-- INDEX:END -->
