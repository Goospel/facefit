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

# compose가 `image: ${FACEFIT_IMAGE}` 치환에 쓰는 값도 같은 파일에 담는다
# (compose는 프로젝트 디렉터리의 .env를 보간에 자동으로 쓴다).
printf 'FACEFIT_IMAGE=%s\n' "$FACEFIT_IMAGE" >> "$TMP"
install -m 600 "$TMP" .env

docker compose -f compose.facefit.yaml pull
docker compose -f compose.facefit.yaml up -d

# 옛 이미지가 쌓이면 30GB 볼륨을 잠식한다. BookTimer와 공유하는 디스크라 남의 문제가 된다.
docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true

docker compose -f compose.facefit.yaml ps
