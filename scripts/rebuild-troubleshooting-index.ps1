# rebuild-troubleshooting-index.ps1
#
# ⚠️ 이 파일은 반드시 UTF-8 **BOM 포함**으로 저장해야 한다. PowerShell 5.1은 BOM 없는
#    UTF-8을 시스템 ANSI 코드페이지(CP949)로 잘못 읽어 아래 한글 리터럴이 깨지고 파싱
#    에러가 난다(T-026 계열). 편집기/도구로 다시 저장할 때 BOM이 떨어지면 재부착할 것.
#
# troubleshooting 허브의 목차를 각 항목 파일의 frontmatter에서 자동 재생성한다.
#
# 왜: 목차 한 줄과 본문이 같은 사실을 이중 기재해, 본문만 갱신되고 목차가 stale로 남는
# drift가 반복됐다. 실측(2026-07-17): 목차가 12에 얼어붙은 채 본문이 15→18까지 자랐고
# (b48e6e0·83b5217·e2c68ee·62450c8 — 4커밋·6항목), 규칙 감사 PR(#42)이 작정하고 뒤져서야
# 복구됐다. 게다가 그 감사조차 「이 프로젝트에서 이미 알고 있는 전제」 섹션을 못 잡았다
# — 검사기가 `^## T-`만 봤기 때문이다. **검사기가 있어도 검사기가 고른 축 바깥은 100%
# 준수로 보이면서 썩는다.** `ls`는 그 축을 고르지 않는다: 파일이 있으면 목록에 뜬다.
#
# 같은 병을 이미 한 번 고쳤다 — `~/.claude/hooks/rebuild-memory-index.ps1`(메모리 인덱스,
# 2026-07-10). 단일 출처 = 각 항목의 frontmatter. 사람이 목차를 손대지 않으므로 drift가
# 구조적으로 불가능해진다. 이 스크립트는 그 처방을 이 레포에 겨눈 것이다.
#
# 검증도 겸한다(fail-close, exit 1) — 규약에 검사기를 같이 만든다(T-041). 검사 항목:
#   1. 파일명 T-###.md ↔ H1 `# T-### · 제목`의 번호 일치
#   2. frontmatter에 summary 존재
#   3. 4필드(증상/원인/해결/재발방지) 존재 — 항목 길이의 브레이크(아래)
#   4. T번호 중복 없음
#
# (3)이 왜 검사인가: 실측상 4필드 스키마가 있는 troubleshooting은 T-027~T-046 스무 개가
# 전부 9줄 근처(9,9,9,9,9,9,9,9,9,9,9,10,9,9,11,9,9,9,9,6)인데, 스키마가 없는 changeLog는
# 항목당 중앙값이 555바이트 → 3,784바이트로 **6.8배** 자랐다. 같은 저자·같은 31시간·같은
# 단일 md인데 결과가 정반대다. 파일을 쪼개면 파일당 크기 압력이 사라지므로 스키마가 그
# 자리를 대신해야 한다. (스키마도 완전하진 않다 — 줄 수는 잠기지만 바이트는 1.6배 늘었다.
# 필드 개수는 잠그고 필드 길이는 안 잠근다.)
#
# 사용:
#   rebuild-troubleshooting-index.ps1 -HubPath claude-docs/troubleshooting.md
#   rebuild-troubleshooting-index.ps1 -HubPath claude-docs/troubleshooting.md -Check
#
# -Check 는 파일을 수정하지 않고 인덱스가 최신인지만 본다(stale이면 exit 1). pre-commit용.
#
# 한글 안전: 읽기·쓰기 모두 UTF-8(BOM 없음) 명시 — 대상 md 파일들의 기존 인코딩(T-026 정신).
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$HubPath,

    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$MARKER_START = '<!-- INDEX:START -->'
$MARKER_END   = '<!-- INDEX:END -->'

function Write-Problem {
    param([string]$Message)
    Write-Host "  ✗ $Message" -ForegroundColor Red
}

function Remove-YamlQuotes {
    <#
    YAML 인용부호(값 **전체**를 감싼 것)만 벗긴다.
    ⚠️ 순진한 .Trim('"')를 쓰면 안 된다 — T-040의 요약이 `"관계로 잠근다"면서 …`처럼
       **따옴표로 시작**하는데 Trim이 그 앞따옴표를 잘라먹는다(마이그레이션에서 실제로 났다).
       그래서 '앞뒤 둘 다 따옴표' + '중간에 따옴표 없음'일 때만 감싼 것으로 본다.
    #>
    param([string]$Value)
    if ($Value.Length -ge 2 -and $Value.StartsWith('"') -and $Value.EndsWith('"')) {
        $inner = $Value.Substring(1, $Value.Length - 2)
        if (-not $inner.Contains('"')) { return $inner }
    }
    return $Value
}

if (-not (Test-Path $HubPath)) {
    Write-Host 'INDEX-CHECK: INVALID (hub not found)'
    Write-Host "허브 파일이 없다: $HubPath" -ForegroundColor Red
    exit 1
}

$HubPath = (Resolve-Path $HubPath).Path
$hubDir  = Split-Path $HubPath -Parent
$itemsDirName = [System.IO.Path]::GetFileNameWithoutExtension($HubPath)   # troubleshooting.md → troubleshooting
$itemsDir = Join-Path $hubDir $itemsDirName

if (-not (Test-Path $itemsDir)) {
    Write-Host 'INDEX-CHECK: INVALID (items dir not found)'
    Write-Host "항목 디렉토리가 없다: $itemsDir" -ForegroundColor Red
    exit 1
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$problems = @()
$entries  = @()

$files = Get-ChildItem -Path $itemsDir -Filter '*.md' -File | Sort-Object Name

foreach ($f in $files) {
    $rel = "$itemsDirName/$($f.Name)"

    # ── 1. 파일명이 T-###.md 인가 ──────────────────────────────────────────
    if ($f.BaseName -notmatch '^(T-\d{3})$') {
        $problems += "$rel · 파일명이 T-###.md 형식이 아니다."
        continue
    }
    $fileId = $matches[1]

    $text  = [System.IO.File]::ReadAllText($f.FullName)
    $lines = [System.IO.File]::ReadAllLines($f.FullName)

    # ── 2. frontmatter 파싱 (첫 '---' ~ 두번째 '---') ──────────────────────
    $fmStart = -1; $fmEnd = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '---') {
            if ($fmStart -lt 0) { $fmStart = $i } else { $fmEnd = $i; break }
        }
    }
    if ($fmStart -lt 0 -or $fmEnd -lt 0) {
        $problems += "$rel · frontmatter(--- ... ---)가 없다."
        continue
    }

    $summary = ''; $promoted = ''
    for ($i = $fmStart + 1; $i -lt $fmEnd; $i++) {
        $line = $lines[$i]
        if     ($line -match '^summary:\s*(.+)$')  { $summary  = Remove-YamlQuotes $matches[1].Trim() }
        elseif ($line -match '^promoted:\s*(.+)$') { $promoted = Remove-YamlQuotes $matches[1].Trim() }
    }

    if (-not $summary) {
        $problems += "$rel · frontmatter에 summary가 없다(인덱스 한 줄의 단일 출처)."
        continue
    }

    # ── 3. H1 = '# T-### · 제목' 이고 번호가 파일명과 일치하는가 ───────────
    $h1 = $null
    for ($i = $fmEnd + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^#\s+(.+)$') { $h1 = $matches[1].Trim(); break }
    }
    if (-not $h1) {
        $problems += "$rel · H1(# T-### · 제목)이 없다."
        continue
    }
    if ($h1 -notmatch '^(T-\d{3})\s*·\s*(.+)$') {
        $problems += "$rel · H1 형식이 '# T-### · 제목'이 아니다: `"$h1`""
        continue
    }
    $h1Id = $matches[1]
    if ($h1Id -ne $fileId) {
        $problems += "$rel · 파일명($fileId)과 H1의 번호($h1Id)가 다르다."
        continue
    }

    # ── 4. 4필드 스키마 ────────────────────────────────────────────────────
    $missing = @()
    foreach ($field in @('증상', '원인', '해결', '재발방지')) {
        if ($text -notmatch "\*\*$field\*\*") { $missing += $field }
    }
    if ($missing.Count -gt 0) {
        $problems += "$rel · 필수 필드 누락: $($missing -join ', ') (형식: - **증상**: ...)"
        continue
    }

    $entries += [pscustomobject]@{
        Id       = $fileId
        Summary  = $summary
        Promoted = $promoted
        Rel      = $rel
    }
}

# ── 5. T번호 중복 ──────────────────────────────────────────────────────────
$dupes = $entries | Group-Object Id | Where-Object { $_.Count -gt 1 }
foreach ($d in $dupes) { $problems += "T번호 중복: $($d.Name)" }

if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host "INDEX-CHECK: INVALID ($($problems.Count) problem(s))"
    Write-Host "troubleshooting 항목 검사 실패 — $($problems.Count)건" -ForegroundColor Red
    foreach ($p in $problems) { Write-Problem $p }
    Write-Host ''
    exit 1
}

if ($entries.Count -eq 0) {
    Write-Host 'INDEX-CHECK: INVALID (no entries)'
    Write-Host "항목이 하나도 없다: $itemsDir" -ForegroundColor Red
    exit 1
}

# ── 6. 허브를 읽고 EOL을 감지한다 ─────────────────────────────────────────
# ⚠️ 글로벌 규칙: "파일 재생성 시 BOM·EOL 바이트 보존 — 안 지키면 한 줄 고치려다 파일
#    전체가 phantom diff". StringBuilder.AppendLine()은 Windows에서 **CRLF**를 내므로
#    LF 파일에 쓰면 혼합 EOL이 된다(실제로 이 마이그레이션 1차 시도에서 CRLF 26줄 +
#    LF 34줄이 나왔다 — 원본은 전부 LF였다). 그래서 파일의 기존 EOL을 감지해 맞춘다.
$hubText = [System.IO.File]::ReadAllText($HubPath)
$eol = if ($hubText.Contains("`r`n")) { "`r`n" } else { "`n" }

# ── 7. 인덱스 생성 (역순 — 최신이 위) ─────────────────────────────────────
# 왜 역순인가: 오름차순이면 파일이 커질 때 Read 캡에 걸려 **가장 최신 항목이 잘린다**.
# changeLog가 이미 캡을 46% 초과했는데(36,602토큰 > 25,000) 아무도 안 아픈 이유가 역순이라
# 잘리는 게 가장 오래된 항목이어서다. 허브는 이제 목차만 남아 작지만, 정렬 방향은 같은
# 이유로 최신 우선을 유지한다.
$idx = [System.Collections.ArrayList]@()
[void]$idx.Add($MARKER_START)
[void]$idx.Add('<!-- ⚙️ 자동 생성 — 직접 편집하지 마세요. scripts/rebuild-troubleshooting-index.ps1 이')
[void]$idx.Add('     각 항목의 frontmatter(summary)에서 재생성합니다. 내용을 바꾸려면 그 항목의')
[void]$idx.Add('     summary를 고치세요(단일 출처). 최신 항목이 위. -->')
[void]$idx.Add('')

foreach ($e in ($entries | Sort-Object Id -Descending)) {
    $line = "- [$($e.Id)]($($e.Rel)) · $($e.Summary)"
    if ($e.Promoted) { $line += " **→ $($e.Promoted)**" }
    [void]$idx.Add($line)
}

[void]$idx.Add('')
[void]$idx.Add($MARKER_END)
$newIndex = $idx -join $eol

# ── 8. 허브의 마커 구간 교체 ───────────────────────────────────────────────

$startIdx = $hubText.IndexOf($MARKER_START)
$endIdx   = $hubText.IndexOf($MARKER_END)
if ($startIdx -lt 0 -or $endIdx -lt 0 -or $endIdx -lt $startIdx) {
    Write-Host 'INDEX-CHECK: INVALID (markers missing)'
    Write-Host "허브에 인덱스 마커가 없다. 다음 두 줄을 목차 자리에 넣어라:" -ForegroundColor Red
    Write-Host "  $MARKER_START" -ForegroundColor DarkGray
    Write-Host "  $MARKER_END" -ForegroundColor DarkGray
    exit 1
}

$before = $hubText.Substring(0, $startIdx)
$after  = $hubText.Substring($endIdx + $MARKER_END.Length)
$newHub = $before + $newIndex + $after

# ── 9. -Check: 수정하지 않고 stale 여부만 ──────────────────────────────────
if ($Check) {
    if ($newHub -ne $hubText) {
        Write-Host ''
        Write-Host 'INDEX-CHECK: STALE'
        Write-Host 'troubleshooting 목차가 stale하다 — 항목과 인덱스가 어긋난다.' -ForegroundColor Red
        Write-Host '  고치기: powershell -ExecutionPolicy Bypass -File scripts/rebuild-troubleshooting-index.ps1 -HubPath claude-docs/troubleshooting.md' -ForegroundColor DarkGray
        Write-Host ''
        exit 1
    }
    Write-Host "INDEX-CHECK: OK ($($entries.Count) entries)"
    Write-Host "troubleshooting 목차 최신 — 항목 $($entries.Count)건" -ForegroundColor Green
    exit 0
}

[System.IO.File]::WriteAllText($HubPath, $newHub, $utf8NoBom)
Write-Host "INDEX-CHECK: REBUILT ($($entries.Count) entries)"
Write-Host "troubleshooting 목차 재생성 — 항목 $($entries.Count)건" -ForegroundColor Green
exit 0
