# troubleshooting 분할 시스템 — 새 프로젝트 설치

**항목 1건 = 파일 1개 + 자동생성 목차 + 검사기(fail-close) + pre-commit 훅.**

유래·근거: hospital-sim(2026-07-17) 실측 — 단일 `troubleshooting.md`가 Read 캡의 95%에 도달했고(다음 항목 하나면 최신 함정이 잘림), 목차가 4커밋 동안 stale로 방치됐다. 상세는 이 폴더의 스크립트·훅 상단 주석 참조.

## 이 폴더의 파일

| 파일 | 새 프로젝트에서의 배치 |
|---|---|
| `rebuild-troubleshooting-index.ps1` | `scripts/` |
| `pre-commit` | `.githooks/` |
| `troubleshooting.md` | `claude-docs/` (허브 골격) |
| `troubleshooting/` (항목 폴더) | `claude-docs/troubleshooting/` — 항목 `T-001.md`부터 |
| `T-001.example.md` | 항목 형식 예시 (복사하지 말고 참고만) |

> 경로 관례는 `claude-docs/`다. 다르게 두면 `pre-commit` 상단의 `HUB`·`SCRIPT`와 rebuild 호출의 `-HubPath`를 맞춰 고친다.

## 설치 (clone/신설 후 1회)

1. 위 표대로 파일을 배치하고 `claude-docs/troubleshooting/` 폴더를 만든다.

2. 훅 활성화:
   ```
   git config core.hooksPath .githooks
   ```
   ⚠️ **워크트리를 쓰면** `config.worktree`의 절대경로 hooksPath가 이 값을 이길 수 있다. 확인:
   ```
   git config --show-origin --get-all core.hooksPath
   ```
   워크트리에서 안 걸리면 `git config --worktree core.hooksPath .githooks`.

3. `.gitattributes`에 추가 (셸 훅이 CRLF로 풀리면 셔뱅 `#!/bin/sh\r`가 되어 훅이 통째로 죽는다):
   ```
   *.sh text eol=lf
   .githooks/** text eol=lf
   ```
   그리고 `.ps1`은 BOM+EOL 보존을 위해 binary 취급:
   ```
   *.ps1 -text
   ```

4. `.gitignore`에 `.commit-msg-tmp` (한글 커밋 메시지 파일 잔재 차단).

## 운영

- **항목 추가**: `claude-docs/troubleshooting/T-###.md` 신설(4필드 필수) → 목차 재생성 → 스테이징:
  ```
  powershell -ExecutionPolicy Bypass -File scripts/rebuild-troubleshooting-index.ps1 -HubPath claude-docs/troubleshooting.md
  git add claude-docs/troubleshooting.md
  ```
- **검사**: pre-commit이 목차 stale/형식 오류(4필드 누락·번호 불일치·summary 없음)면 커밋을 거부한다. 수동 확인은 위 명령에 `-Check`.

## ⚠️ 이걸 처음부터 깔지, 나중에 마이그레이션할지

hospital-sim 실측의 반전: **분할 자체는 뚱뚱함을 안 고친다**(총 바이트 +3%). 뚱뚱함의 진짜 답은 **4필드 스키마**(항목당 길이를 잠금 — 이 시스템에 이미 포함). 분할이 주는 건 "Read 캡 초과 방지 + 목차 drift 차단"이다.

- **처음부터 깔면**: 일관성. 항목이 몇 개든 목차·검사가 자동이라 나중에 손 볼 게 없다. "임계 도달 시 마이그레이션"은 소프트 규칙이라 아무도 그 임계를 안 보다가 늦는다(hospital-sim이 그렇게 캡 95%까지 갔다).
- **트레이드오프**: 항목 서너 개짜리 프로젝트엔 스크립트+훅 인프라가 과해 보일 수 있다. 그래도 처음부터 두는 쪽을 기본으로 한다 — 인프라는 이 폴더에서 **복사**라 비용이 거의 0이고, 판단을 미루면 그 판단 자체를 잊기 때문이다.
