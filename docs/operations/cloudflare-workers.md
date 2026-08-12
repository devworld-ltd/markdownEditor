# Cloudflare Workers 구성

> 최종 갱신: 2026-08-12 · 상태: **적용됨 (v2.0.0)**
> 이전 버전에서는 "미적용 설계안" 이었다. 웹 전환과 함께 실제로 도입했다.

## 1. 개요

정적 자산 전용 Worker 로 `dist/` 를 서빙한다. 서버 코드(`main` 엔트리)가 없으므로 콜드 스타트와 요청당 실행 비용이 사실상 없다.

| 항목 | 값 |
|------|-----|
| 설정 파일 | `wrangler.jsonc` |
| Worker 유형 | Static Assets (server-less) |
| `compatibility_date` | `2026-08-12` |
| 관측 | `observability.enabled = true` |
| 404 처리 | `single-page-application` (알 수 없는 경로 → `index.html`) |

## 2. 환경 매핑

| 환경 | 소스 브랜치 | 배포 트리거 | Worker 이름 | `APP_ENV` | 데이터베이스 |
|------|-------------|-------------|-------------|-----------|--------------|
| **local** | 작업 브랜치 | `npm run dev` / `npm run cf:dev` | — | — | 없음 |
| **dev** | `dev` | `dev` push → GitHub Actions | `markdown-editor-dev` | `dev` | 없음 |
| **prod** | `main` | `main` push → GitHub Actions | `markdown-editor-prod` | `prod` | 없음 |

```mermaid
flowchart LR
  F["feature/* · bug/*"] --> D["dev 브랜치"]
  D --> M["main 브랜치"]
  F -.수동.-> L["npm run dev<br/>127.0.0.1:5173"]
  D -- "ci.yml 통과 후<br/>deploy.yml" --> WD["markdown-editor-dev"]
  M -- "ci.yml 통과 후<br/>deploy.yml" --> WP["markdown-editor-prod"]
```

> **데이터베이스 없음** — 조직 표준 워크플로는 환경별 Supabase(local/dev/prod) 를 전제하지만, 이 앱은 문서를 서버로 보내지 않는다. 모든 데이터는 사용자 브라우저와 로컬 디스크에만 존재한다 ([데이터 모델](../architecture/data-model.md)). DB 가 필요해지는 시나리오는 §6 참고.

## 3. 설정 (`wrangler.jsonc`)

```jsonc
{
  "name": "markdown-editor",
  "compatibility_date": "2026-08-12",
  "observability": { "enabled": true },
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  },
  "env": {
    "dev": {
      "name": "markdown-editor-dev",
      "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
      "vars": { "APP_ENV": "dev" }
    },
    "prod": {
      "name": "markdown-editor-prod",
      "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
      "vars": { "APP_ENV": "prod" }
    }
  }
}
```

> `env.*` 블록은 최상위 설정을 상속하지 않는 항목이 있어 `assets` 를 환경마다 명시한다.

## 4. 배포

### 4.1 수동

```bash
npm run deploy:dev     # build + wrangler deploy --env dev
npm run deploy:prod    # build + wrangler deploy --env prod
npm run cf:dev         # 로컬 workerd 런타임으로 dist/ 서빙
```

### 4.2 자동 (GitHub Actions)

`.github/workflows/deploy.yml` — `dev`/`main` push 시 실행.

- `concurrency: deploy-${{ github.ref }}` + `cancel-in-progress` 로 같은 브랜치의 중복 배포 취소
- GitHub Environment 를 `dev`/`prod` 로 분리해 승인 규칙·시크릿을 환경별로 관리 가능
- `cloudflare/wrangler-action@v3` 사용

### 4.3 검증

```bash
npx wrangler deploy --env dev --dry-run
```

실제 배포 없이 설정 파싱·자산 수집·바인딩을 확인한다. 2026-08-12 실행 결과: 자산 5개 인식, `env.APP_ENV ("dev")` 바인딩 확인.

## 5. 필요한 시크릿

| 키 | 저장 위치 | 용도 |
|----|-----------|------|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions Secrets | 배포 권한 (Workers Scripts:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions Secrets | 대상 계정 |

애플리케이션 런타임 시크릿은 **없다**. `APP_ENV` 는 시크릿이 아닌 평문 `vars` 다. 자세한 규약: [환경 변수 정리](./environment-variables.md).

## 6. 아직 하지 않은 것

| 항목 | 상태 | 참조 |
|------|------|------|
| 커스텀 도메인 연결 | prod 가 `*.workers.dev` | [F-63](../features/feature-status.md) |
| CSP `_headers` | 미설정 | [F-62](../features/feature-status.md) |
| 배포 후 헬스체크 / prod smoke E2E | `deploy.yml` 에 미포함 | [F-64](../features/feature-status.md) |
| 실제 배포 실행 | 시크릿 미등록 상태 — `--dry-run` 까지만 검증 | — |
| `dev` 브랜치 | 미생성 → 워크플로가 아직 트리거되지 않음 | [F-66](../features/feature-status.md) |

### 서버·DB 가 필요해지는 시나리오

현재는 불필요하지만 아래 기능을 도입하면 Worker 에 서버 로직이 생긴다.

| 시나리오 | 필요 리소스 |
|----------|-------------|
| 문서 공유 링크 퍼블리시 (F-60) | Worker `main` + KV/R2 |
| 클라우드 문서 동기화 | Worker + 인증 + Postgres(Supabase) |
| 사용 통계·오류 수집 | Worker + Analytics Engine |

이때 §2 의 "데이터베이스 없음" 항목이 환경별 Supabase 매핑으로 대체된다.

## 7. 롤백

| 방법 | 절차 |
|------|------|
| 대시보드 | Cloudflare Workers → 해당 Worker → Deployments → 이전 버전 롤백 |
| Git | `main` 에서 문제 커밋 revert → push → 자동 재배포 |
| CLI | 이전 커밋 체크아웃 후 `npm run deploy:prod` |

정적 자산만 배포하므로 마이그레이션 되돌리기 같은 부수 작업이 없다.

## 8. 결정 기록

| 일자 | 결정 | 사유 |
|------|------|------|
| 2026-08-12 (오전) | Cloudflare Workers **미도입** | 당시 macOS 네이티브 앱이라 서버 사이드 요구가 전무 |
| 2026-08-12 (오후) | Cloudflare Workers **도입** | 웹 전환으로 정적 자산 호스팅이 필수가 됨. 조직 표준(dev/prod 브랜치 매핑)에 맞춰 구성 |

## 9. 관련 문서

- [인프라 아키텍처](../architecture/infrastructure.md)
- [환경 변수 정리](./environment-variables.md)
- [브랜치 전략](./branch-strategy.md)
