#!/usr/bin/env bash
#
# 배포 후 헬스체크 (F-64, 이슈 #15)
#
# 사용법:
#   scripts/healthcheck.sh <URL> [EXPECTED_SHA]
#
#   URL           헬스체크 대상 배포 URL (끝에 슬래시 없이)
#   EXPECTED_SHA  /sw.js 의 VERSION 과 대조할 커밋 SHA 앞 7자리. 생략하면 SHA 일치
#                 검사를 건너뛴다 (플레이스홀더 검사는 항상 수행).
#
# 로컬 수동 실행 예:
#   scripts/healthcheck.sh https://md-editor-dev.devworld.co.kr
#   scripts/healthcheck.sh https://md-editor.devworld.co.kr $(git rev-parse --short=7 HEAD)
#
# 환경변수:
#   HEALTHCHECK_ATTEMPTS  재시도 횟수 (기본 12)
#   HEALTHCHECK_INTERVAL  재시도 간격 초 (기본 5) — 기본값 기준 최대 약 1분(12*5s) 대기.
#                         첫 prod 커스텀 도메인 배포 때 관측된 인증서 프로비저닝
#                         구간(약 1분)을 흡수하기 위한 값이다 (이슈 #15 배경).
#
# 검증 항목:
#   1. GET / → 200 + text/html + Content-Security-Policy 헤더 존재
#   2. HTML 이 참조하는 /assets/*.js, *.css → 각각 200
#   3. GET /sw.js → VERSION 이 플레이스홀더(__BUILD_ID__) 가 아님
#      (+ EXPECTED_SHA 지정 시 그 값과 일치)
#
# 캐시 우회: 모든 GET 요청에 매번 새로운 쿼리스트링(cb=<나노초 타임스탬프>-<난수>)을
# 붙인다. 배포 직후 엣지 캐시(cf-cache-status: HIT)가 구버전을 반환하는 것을
# 두 차례 실측했기 때문이다 (CSP 배포 PR #5, F-69 dev 배포).
#
# 재시도: 개별 요청이 아니라 "전체 검증 시퀀스"를 통째로 재시도한다. 실패 사유가
# 캐시/전파 지연인지 실제 회귀인지 배포 스크립트 단계에서는 구분할 수 없으므로,
# 첫 실패로 즉시 실패 처리하지 않고 마지막 시도의 실패 사유만 최종 로그에 남긴다.

set -uo pipefail

URL="${1:?사용법: $0 <URL> [EXPECTED_SHA]}"
EXPECTED_SHA="${2:-}"
URL="${URL%/}"

MAX_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-12}"
INTERVAL="${HEALTHCHECK_INTERVAL:-5}"

log() { echo "[healthcheck] $*" >&2; }

cache_bust() {
  echo "cb=$(date +%s%N 2>/dev/null || date +%s)-$RANDOM"
}

# 실패 시 사유를 stdout 에 출력하고 1을 반환한다. 성공 시 0을 반환한다.
attempt() {
  local tmp_headers tmp_body
  tmp_headers="$(mktemp)"
  tmp_body="$(mktemp)"
  trap 'rm -f "$tmp_headers" "$tmp_body"' RETURN

  # 1) GET / → 200 + text/html + CSP 헤더
  if ! curl -sS -m 15 -D "$tmp_headers" -o "$tmp_body" "${URL}/?$(cache_bust)"; then
    echo "GET / 네트워크 오류(연결 실패/타임아웃)"
    return 1
  fi
  local root_status
  root_status=$(head -1 "$tmp_headers" | awk '{print $2}')
  if [[ "$root_status" != "200" ]]; then
    echo "GET / 상태코드 ${root_status:-없음} (기대 200)"
    return 1
  fi
  if ! grep -qi '^content-type:.*text/html' "$tmp_headers"; then
    echo "GET / content-type 이 text/html 이 아님: $(grep -i '^content-type:' "$tmp_headers" | tr -d '\r')"
    return 1
  fi
  if ! grep -qi '^content-security-policy:' "$tmp_headers"; then
    echo "GET / 응답에 Content-Security-Policy 헤더가 없음"
    return 1
  fi

  # 2) HTML 이 참조하는 /assets/*.js, *.css → 각각 200
  local assets asset asset_status
  assets=$(grep -oE '/assets/[A-Za-z0-9_.-]+\.(js|css)' "$tmp_body" | sort -u)
  if [[ -z "$assets" ]]; then
    echo "HTML 에서 /assets/*.js|*.css 참조를 찾지 못함"
    return 1
  fi
  while IFS= read -r asset; do
    asset_status=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${URL}${asset}?$(cache_bust)")
    if [[ "$asset_status" != "200" ]]; then
      echo "GET ${asset} 상태코드 ${asset_status} (기대 200)"
      return 1
    fi
  done <<<"$assets"

  # 3) /sw.js VERSION — 플레이스홀더 아님 + (옵션) SHA 일치
  local sw_body sw_version
  if ! sw_body=$(curl -sS -m 15 "${URL}/sw.js?$(cache_bust)"); then
    echo "GET /sw.js 네트워크 오류"
    return 1
  fi
  sw_version=$(echo "$sw_body" | grep -oE 'VERSION *= *"[^"]*"' | head -1 | sed -E 's/VERSION *= *"(.*)"/\1/')
  if [[ -z "$sw_version" ]]; then
    echo "/sw.js 에서 VERSION 을 찾지 못함 (서비스 워커 파일 자체가 바뀌었을 수 있음)"
    return 1
  fi
  if [[ "$sw_version" == "__BUILD_ID__" ]]; then
    echo "/sw.js VERSION 이 플레이스홀더(__BUILD_ID__) 그대로 배포됨 — F-69 갱신 알림이 죽는다"
    return 1
  fi
  if [[ -n "$EXPECTED_SHA" && "$sw_version" != "$EXPECTED_SHA" ]]; then
    echo "/sw.js VERSION(${sw_version}) 이 기대 SHA(${EXPECTED_SHA}) 와 불일치 — 옛 배포를 보고 있을 가능성"
    return 1
  fi

  # --- F-60 공유 API -------------------------------------------------------
  #
  # 이 검사는 **실제로 배포된 Worker 에서만 드러나는 결함**을 잡는다. 정적 자산
  # 계층이 Worker 보다 먼저 요청을 가로채기 때문에, run_worker_first 설정이
  # 빠지면 GET /api/share/<id> 가 마크다운 대신 앱 HTML 을 돌려준다. 단위·E2E
  # 테스트는 API 를 목으로 대체하므로 이걸 절대 잡지 못한다 — 실제로 그렇게
  # 절반만 동작하는 상태로 배포됐던 적이 있다.
  #
  # 내용 주소 지정이라 같은 문자열은 항상 같은 객체가 되어 R2 가 증가하지 않는다.
  local probe='{"content":"# healthcheck probe\n\n이 문서는 배포 검증용입니다."}'
  local create_body
  if ! create_body=$(curl -fsS -X POST "${URL}/api/share" \
      -H 'content-type: application/json' -d "$probe" 2>&1); then
    echo "POST /api/share 실패: ${create_body}"
    return 1
  fi

  local share_id
  share_id=$(printf '%s' "$create_body" | sed -nE 's/.*"id":"([0-9a-f]+)".*/\1/p')
  if [[ -z "$share_id" ]]; then
    echo "POST /api/share 응답에 id 가 없다: ${create_body}"
    return 1
  fi

  local read_type read_body
  # 캐시 우회가 **필수**다. 공유 응답은 내용 주소 지정이라 immutable 로 캐시되는데,
  # 그러면 Worker 가 아니라 엣지 캐시가 답해 라우팅이 깨져도 통과해 버린다
  # (실제로 그렇게 잘못 통과한 적이 있다 — CLAUDE.md 트랩 #19 의 공유 API 판).
  read_type=$(curl -fsS -H 'cache-control: no-cache' -o /tmp/hc-share.$$ -w '%{content_type}' \
    "${URL}/api/share/${share_id}?cb=${RANDOM}${RANDOM}" 2>&1) || {
    echo "GET /api/share/${share_id} 실패"
    rm -f /tmp/hc-share.$$
    return 1
  }
  read_body=$(cat /tmp/hc-share.$$ 2>/dev/null || true)
  rm -f /tmp/hc-share.$$

  if [[ "$read_type" != text/markdown* ]]; then
    echo "GET /api/share/${share_id} 의 content-type 이 ${read_type} — Worker 가 아니라 정적 자산이 응답했다(run_worker_first 확인)"
    return 1
  fi
  if [[ "$read_body" != *"healthcheck probe"* ]]; then
    echo "GET /api/share/${share_id} 본문이 올려둔 내용과 다르다"
    return 1
  fi

  local bad_status
  bad_status=$(curl -sS -o /dev/null -w '%{http_code}' \
    "${URL}/api/share/ZZZZZZZZZZZZZZZZ?cb=${RANDOM}${RANDOM}")
  if [[ "$bad_status" != "404" ]]; then
    echo "잘못된 공유 ID 가 ${bad_status} 를 반환 — 404 여야 한다(ID 검증이 Worker 에 닿지 않았다)"
    return 1
  fi

  echo "통과 — / 200(html+CSP), 자산 $(echo "$assets" | wc -l | tr -d ' ')건 200, /sw.js VERSION=${sw_version}, 공유 API 왕복 OK(${share_id})"
  return 0
}

log "대상: ${URL} (기대 SHA: ${EXPECTED_SHA:-검사 생략}, 최대 ${MAX_ATTEMPTS}회 x ${INTERVAL}s 간격)"

for ((i = 1; i <= MAX_ATTEMPTS; i++)); do
  if result=$(attempt); then
    log "시도 ${i}/${MAX_ATTEMPTS}: ${result}"
    exit 0
  fi
  log "시도 ${i}/${MAX_ATTEMPTS} 실패: ${result}"
  if ((i < MAX_ATTEMPTS)); then
    sleep "$INTERVAL"
  fi
done

log "최종 실패 — ${MAX_ATTEMPTS}회 재시도 후에도 통과하지 못함: ${result}"
exit 1
