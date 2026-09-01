# syntax=docker/dockerfile:1
#
# BookTimer의 Dockerfile과 같은 형태다(같은 호스트에 동거하니 운영자가 하나만 기억하면 된다).
# 빌드 컨텍스트는 **`server/`**다 — 레포 루트가 아니다(`docker build server/`).

# --- 빌드 스테이지: JDK 21로 부트 실행가능 jar 생성 ---
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# 의존성 캐시 레이어: 빌드 스크립트·래퍼를 먼저 복사해 소스 변경이 의존성 재다운로드를 안 부르게.
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x ./gradlew && ./gradlew dependencies --no-daemon || true

# 테스트는 CI가 별도 게이트로 돌린다(워크플로의 test job) — 이미지 빌드에서 또 돌리지 않는다.
COPY src src
RUN ./gradlew bootJar -x test --no-daemon

# --- 런타임 스테이지: 가벼운 JRE만 ---
FROM eclipse-temurin:21-jre
WORKDIR /app

# 부트 jar만 복사(plain jar는 build.gradle에서 비활성 — 안 그러면 `*.jar`가 둘이라 모호해진다)
COPY --from=build /app/build/libs/*.jar app.jar

# 비root로 돌린다 — 컨테이너 안에서 RCE가 나도 곧바로 root를 쥐지 못하게. jar는 root 소유
# 읽기전용으로 남겨 앱이 자기 코드를 덮어쓰지 못하게 한다(그래서 /app을 chown 하지 않는다).
# 이 앱은 파일을 쓰지 않으므로 쓰기가 필요한 곳이 없다.
# gid도 숫자로 못 박는다 — `useradd --user-group`은 그룹을 시스템 대역에 만들어 uid와 어긋난다.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin app
USER 10001:10001

# 호스트에 매핑하지 않는다(compose에 ports 없음) — Caddy가 도커 네트워크 안에서만 부른다.
EXPOSE 8080

# 프로파일을 안 켠다. **기본 프로파일이 곧 운영값**이고, dev 프로파일이 localhost CORS를
# 더하는 쪽이다(설계 §4-1) — 운영에서 뭔가를 켜야 안전해지는 구조를 만들지 않는다.
# 힙·GC·타임존은 compose의 JAVA_TOOL_OPTIONS가 준다(수치가 설계 §3-6과 한자리에 있어야 한다).
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
