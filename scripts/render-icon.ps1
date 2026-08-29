# render-icon.ps1
#
# ⚠️ 이 파일은 UTF-8 **BOM 포함**으로 저장한다. PowerShell 5.1은 BOM 없는 UTF-8을
#    CP949로 잘못 읽어 아래 한글 리터럴이 깨진다(글로벌 「Windows 셸 원칙」 3번).
#
# assets/icon/icon.svg 를 헤드리스 Chrome으로 래스터화해 PNG를 만든다.
#
# 왜 스크립트인가: 앱인토스·스토어가 요구하는 크기는 언제든 바뀌는데, 원본이 벡터라
# 크기 목록만 고치면 전부 다시 뽑힌다. **PNG는 산출물이고 단일 출처는 icon.svg다** —
# PNG를 직접 편집하지 말 것(다음 렌더에 덮어써진다).
#
# 왜 Chrome인가: 이 머신에 SVG 래스터라이저가 따로 없다. Chrome은 이미 깔려 있고
# 브라우저와 같은 엔진이라 **실제로 보이는 것과 같게** 렌더된다(별도 의존성 0).
#
# 사용법:
#   powershell -NoProfile -File scripts/render-icon.ps1
#   powershell -NoProfile -File scripts/render-icon.ps1 -Sizes 1024,512

[CmdletBinding()]
param(
    # 600은 앱인토스 콘솔 「앱 로고」가 요구하는 크기다(600 x 600px). 나머지는 범용 여분.
    [int[]]$Sizes = @(1024, 600, 512, 256, 192, 128, 64),
    [string]$Svg = "assets/icon/icon.svg",
    [string]$OutDir = "assets/icon/png"
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
$svgPath = Join-Path $repo $Svg
$outPath = Join-Path $repo $OutDir

if (-not (Test-Path $svgPath)) { throw "원본 SVG가 없습니다: $svgPath" }

$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { throw "Chrome을 찾을 수 없습니다. 설치 경로를 확인하세요." }

if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Force $outPath | Out-Null }

# 스크린샷은 창 크기로 결정되므로 크기마다 래퍼 HTML을 만들어 이미지를 그 크기에 맞춘다.
# 여백·스크롤바가 1px이라도 끼면 정사각이 깨지므로 margin 0 + overflow hidden을 강제한다.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("icon-render-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item $svgPath (Join-Path $tmp "icon.svg")

try {
    foreach ($size in $Sizes) {
        $html = Join-Path $tmp "shot-$size.html"
        $png = Join-Path $outPath "icon-$size.png"

        $body = '<!doctype html><meta charset="utf-8">' +
                '<style>html,body{margin:0;padding:0;overflow:hidden}' +
                "img{display:block;width:${size}px;height:${size}px}</style>" +
                '<img src="icon.svg">'
        [System.IO.File]::WriteAllText($html, $body, (New-Object System.Text.UTF8Encoding($false)))

        if (Test-Path $png) { Remove-Item $png -Force }

        $url = "file:///" + ($html -replace '\\', '/')

        # ⚠️ PowerShell 5.1은 native exe의 stderr를 ErrorRecord로 감싸서, exit code가 0이어도
        #    $ErrorActionPreference='Stop' 아래서는 NativeCommandError로 죽는다. Chrome은
        #    정상 동작 중에도 stderr로 진행 상황을 뱉으므로 이 구간만 Continue로 낮춘다.
        #    성공 판정은 종료코드가 아니라 **산출된 파일**로 한다(아래).
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $chrome --headless --disable-gpu --hide-scrollbars `
                --screenshot="$png" --window-size="$size,$size" $url 2>&1 | Out-Null
        }
        finally { $ErrorActionPreference = $prevEAP }

        # ⚠️ Chrome은 실패해도 종료코드가 0인 경우가 있다. 파일과 실제 크기로 검증한다.
        if (-not (Test-Path $png)) { throw "렌더 실패: icon-$size.png 가 생성되지 않았습니다." }

        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile($png)
        $w = $img.Width; $h = $img.Height
        $img.Dispose()
        if ($w -ne $size -or $h -ne $size) {
            throw "크기 불일치: icon-$size.png 가 ${w}x${h} 입니다 (기대 ${size}x${size})."
        }

        Write-Host "  icon-$size.png  ${w}x${h}"
    }
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "완료 — $($Sizes.Count)개 PNG를 $OutDir 에 만들었습니다."
