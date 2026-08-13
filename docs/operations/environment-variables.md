# 환경 변수 정리

> 최종 갱신: 2026-08-12 · 대상: 웹 전환 (v2.0.0)

## 0. 결론

**애플리케이션 런타임이 읽는 환경 변수는 없다.** `import.meta.env` / `process.env` 참조가 소스에 존재하지 않고 `.env` 파일도 없다. 서버·DB·외부 API 가 없으므로 애플리케이션 시크릿도 없다.

존재하는 변수는 **배포 파이프라인용 2개 + 도구용 4개**뿐이다.

## 1. 배포 시크릿 (GitHub Actions)

| 키 | 저장 위치 | 시크릿 | 용도 |
|----|-----------|--------|------|
| `CLOUDFLARE_API_TOKEN` | GitHub Repository/Environment Secrets | ✅ | `wrangler deploy` 권한 (Workers Scripts:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Repository/Environment Secrets | ✅ | 대상 Cloudflare 계정 |

`.github/workflows/deploy.yml` 에서만 참조한다. **등록 전까지 배포 잡은 실패한다.**

## 2. Worker 환경 변수 (`wrangler.jsonc` `vars`)

| 키 | dev | prod | 시크릿 | 용도 |
|----|-----|------|--------|------|
| `APP_ENV` | `dev` | `prod` | ❌ 평문 | 환경 식별용 바인딩 |

> 현재 `APP_ENV` 를 **읽는 코드는 없다.** 정적 자산 전용 Worker 라 서버 로직이 없기 때문이다. 배포 환경 구분과 향후 서버 로직 도입을 위한 자리표시자로 유지한다. 클라이언트 번들에서는 접근할 수 없다.

## 3. 개발·테스트 도구 변수

### 3.1 E2E 테스트 (`playwright.config.ts`)

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `E2E_HOST` | `127.0.0.1` | dev 서버 바인딩 호스트 |
| `E2E_PORT` | `5173` | dev 서버 포트 |
| `E2E_BASE_URL` | `http://${E2E_HOST}:${E2E_PORT}` | 테스트 대상 URL |
| `CI` | (미설정) | 설정 시 `forbidOnly`, 재시도 1회, `reuseExistingServer: false` |

```bash
E2E_PORT=5200 npm run test:e2e
E2E_BASE_URL=https://md-editor-dev.devworld.co.kr npm run test:e2e
```

> ⚠️ **LAN IP 로 테스트할 때 주의**: File System Access API 는 보안 컨텍스트(HTTPS 또는 `localhost`/`127.0.0.1`)에서만 노출된다. `E2E_HOST=192.168.50.79` 로 띄우면 앱이 폴백 경로로 동작해 `fileaccess.spec.ts` 의 FS Access 그룹이 실패한다.

### 3.2 표준 도구 변수 (사용 가능하나 프로젝트에서 설정하지 않음)

| 변수 | 도구 | 비고 |
|------|------|------|
| `NODE_ENV` | Vite | 모드에 따라 자동 설정. 직접 참조하는 코드 없음 |
| `VITE_*` | Vite | `import.meta.env` 노출 접두사. **현재 사용 없음** |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright | 브라우저 캐시 경로 |
| `CLOUDFLARE_API_TOKEN` | Wrangler CLI | 로컬에서 수동 배포할 때 |

## 4. 제거된 변수

| 변수 | 사유 |
|------|------|
| `DEVELOPER_DIR` | `build.sh`(Xcode 빌드)와 함께 제거 |
| Xcode 빌드 설정(`$(PRODUCT_NAME)` 등) | Xcode 프로젝트 제거 |

## 5. 향후 도입 시 규약

### 5.1 파일 구성

| 파일 | 커밋 | 용도 |
|------|------|------|
| `.env.example` | ✅ | 키 목록과 설명. 값은 더미 |
| `.env.local` | ❌ | 개인 로컬 값 |
| `.env.development` / `.env.production` | ❌ | 환경별 값 |

도입 시 `.gitignore` 에 `.env*` 를 추가하고 `!.env.example` 로 예시만 예외 처리한다.

### 5.2 명명 규칙

- **`VITE_` 접두사가 붙은 값은 빌드 산출물에 평문으로 포함된다.** 공개돼도 무방한 값만 붙인다.
- 시크릿은 Vite 를 거치지 않는 경로로만 다룬다: GitHub Actions Secrets → `wrangler secret put` → Worker 런타임.
- **클라이언트 전용 앱에 진짜 시크릿을 넣을 방법은 없다.** 시크릿이 필요하다면 그 시점에 서버 로직(Worker `main`)이 필요하다는 신호다.

### 5.3 도입이 예상되는 값

| 키 | local | dev | prod | 시크릿 | 관련 기능 |
|----|-------|-----|------|--------|-----------|
| `VITE_APP_VERSION` | `dev` | 커밋 SHA | 태그 | ❌ | 배포 추적 ([인프라 §7](../architecture/infrastructure.md#7-개선-권고)) |
| `VITE_SENTRY_DSN` | — | dev DSN | prod DSN | ❌ | 오류 수집 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | — | — | — | 일부 ✅ | 문서 동기화 도입 시 ([CF §6](./cloudflare-workers.md#6-아직-하지-않은-것)) |

## 6. 시크릿 관리 현황

| 항목 | 상태 |
|------|------|
| 커밋된 시크릿 | **없음** |
| 애플리케이션 런타임 시크릿 | 없음 (구조적으로 불필요) |
| 배포 시크릿 | GitHub Secrets 2개 (**미등록 상태**) |
| `.env*` 파일 | 없음 |

## 7. 관련 문서

- [Cloudflare Workers 구성](./cloudflare-workers.md)
- [인프라 아키텍처](../architecture/infrastructure.md)
- [브랜치 전략](./branch-strategy.md)
