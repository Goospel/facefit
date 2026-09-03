#!/usr/bin/env bash
# facefit 배포 (BookTimer EC2 동거 — 설계 §3-6).
#
# GitHub Actions가 SSM Send-Command로 EC2에서 이 스크립트를 실행한다.
#
# **blue/green을 안 한다**(설계 §5). 이유는 게을러서가 아니라 메모리다 — blue/green은 전환
# 순간 컨테이너를 2개 띄우는데, 이 박스는 BookTimer가 이미 그 짓을 하는 동안 물리 메모리를
# 넘긴다. facefit까지 2개가 되면 그 창이 더 나빠진다. 대신 재시작 수 초의 공백은 앱이 흡수한다:
# 모든 서버 경로가 무음 폴백이고, 백업 실패는 클라가 dirty 플래그를 세워 다음 실행에 재시도한다.
#
# 그래서 **이 스크립트에는 헬스 게이트가 없다** — 검증은 워크플로의 마지막 스텝이
# `https://facefit-api.booktimer.app/health`로 한다(Caddy를 통과하는 진짜 경로라 더 정확하다).
set -euo pipefail

cd "$(dirname "$0")"

REGION="${AWS_REGION:-ap-northeast-2}"
: "${FACEFIT_IMAGE:?FACEFIT_IMAGE가 필요합니다 (워크플로가 넘깁니다)}"

# 시크릿을 EC2 디스크에 영구 보관하지 않기 위해 배포 때마다 SSM에서 다시 만든다
# (BookTimer의 render-env.sh와 같은 습관). 파라미터 이름이 곧 환경변수 이름이라 매핑이 없다 —
# Spring의 relaxed binding이 SPRING_DATASOURCE_URL을 spring.datasource.url로 읽는다.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for name in SPRING_DATASOURCE_URL SPRING_DATASOURCE_USERNAME SPRING_DATASOURCE_PASSWORD; do
    value="$(aws ssm get-parameter --name "/facefit/${name}" --with-decryption \
        --region "$REGION" --query Parameter.Value --output text)"
    # 빈 값이 그대로 실리면 컨테이너는 뜨고 DB 인증만 조용히 실패한다 — 여기서 끊는다.
    [ -n "$value" ] && [ "$value" != "None" ] || {
        echo "[deploy] SSM /facefit/${name} 이 비어 있습니다" >&2
        exit 1
    }
    printf '%s=%s\n' "$name" "$value" >> "$TMP"
done

# ── 기름종이 알림(설계 `docs/2026-09-03-oil-paper-reminder-design.md` §4) ──────────────
#
# 위 셋과 달리 **전부 선택**이다. 콘솔 mTLS 인증서와 템플릿 검수가 아직 안 끝났는데 여기서
# 배포를 끊으면, 알림과 무관한 백업까지 같이 죽는다. 없으면 경고만 남기고 넘어간다 —
# 서버는 그대로 뜨고 알림만 쉰다(다크런치: PUT은 503, 워커는 1회 경고 후 스킵).

optional_ssm() {  # $1=파라미터 이름 → 값(없으면 빈 문자열)
    aws ssm get-parameter --name "/facefit/$1" --with-decryption \
        --region "$REGION" --query Parameter.Value --output text 2>/dev/null || true
}

for name in FACEFIT_REMINDER_KEK FACEFIT_REMINDER_TEMPLATE_SET_CODE; do
    value="$(optional_ssm "$name")"
    if [ -n "$value" ] && [ "$value" != "None" ]; then
        printf '%s=%s\n' "$name" "$value" >> "$TMP"
    else
        echo "[deploy] SSM /facefit/${name} 없음 — 기름종이 알림은 쉰다" >&2
    fi
done

# mTLS 인증서는 환경변수가 아니라 **파일**로 떨어뜨린다(BookTimer deploy/render-env.sh와 같은 방식).
# compose가 이 디렉터리를 /etc/facefit/toss 로 읽기전용 마운트하고, 아래 SPRING_SSL_BUNDLE_* 두 줄이
# 짝이다. ⚠️ PEM은 600이라 소유자만 읽는데 이 배포는 root로 돈다(SSM Run Command) — 그대로 두면
# 비root 컨테이너(uid 10001)가 못 읽고, SSL 번들은 지연 생성이라 **앱은 뜨고 발송만 조용히 죽는다**.
TOSS_DIR="./toss"
APP_UID="${APP_UID:-10001}"
cert="$(optional_ssm FACEFIT_TOSS_MTLS_CERT_PEM)"
key="$(optional_ssm FACEFIT_TOSS_MTLS_KEY_PEM)"
if [ -n "$cert" ] && [ "$cert" != "None" ] && [ -n "$key" ] && [ "$key" != "None" ]; then
    mkdir -p "$TOSS_DIR"
    printf '%s\n' "$cert" > "$TOSS_DIR/client-cert.pem"
    printf '%s\n' "$key" > "$TOSS_DIR/client-key.pem"
    chmod 600 "$TOSS_DIR/client-cert.pem" "$TOSS_DIR/client-key.pem"
    # ⚠️ `[ ... ] && chown` 한 줄로 쓰면 root가 아닐 때 마지막 상태가 1이라 `set -e`가 배포를 죽인다.
    if [ "$(id -u)" = 0 ]; then
        chown "$APP_UID:$APP_UID" "$TOSS_DIR/client-cert.pem" "$TOSS_DIR/client-key.pem"
    fi
    # 두 장이 **모두** 있을 때만 번들을 켠다 — 반쪽 번들은 기동 실패로 이어진다.
    {
        echo 'SPRING_SSL_BUNDLE_PEM_TOSS_KEYSTORE_CERTIFICATE=file:/etc/facefit/toss/client-cert.pem'
        echo 'SPRING_SSL_BUNDLE_PEM_TOSS_KEYSTORE_PRIVATE_KEY=file:/etc/facefit/toss/client-key.pem'
    } >> "$TMP"
else
    echo "[deploy] 토스 mTLS PEM 미비 — 발송 클라이언트는 미설정으로 둔다" >&2
    rm -f "$TOSS_DIR/client-cert.pem" "$TOSS_DIR/client-key.pem"
fi

# compose가 `image: ${FACEFIT_IMAGE}` 치환에 쓰는 값도 같은 파일에 담는다
# (compose는 프로젝트 디렉터리의 .env를 보간에 자동으로 쓴다).
printf 'FACEFIT_IMAGE=%s\n' "$FACEFIT_IMAGE" >> "$TMP"
install -m 600 "$TMP" .env

docker compose -f compose.facefit.yaml pull
docker compose -f compose.facefit.yaml up -d

# 옛 이미지가 쌓이면 30GB 볼륨을 잠식한다. BookTimer와 공유하는 디스크라 남의 문제가 된다.
docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true

docker compose -f compose.facefit.yaml ps
