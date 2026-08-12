# 2026-08-12 · 프로젝트 전수 분석 및 문서 체계 구축

> ⚠️ **이 문서는 웹 전환 이전(v1.x, macOS 네이티브 앱) 시점의 기록이다.**
> 여기 기술된 구조·결함·수치는 현재 코드와 다르다. 현재 상태는 [웹 전환 (v2.0.0)](./2026-08-12-web-pivot.md)
> 과 [문서 인덱스](../README.md)를 참고한다. 이 문서는 이력 보존용으로만 유지한다.

## 1. 요청 사항

`project_analyzing_method.md` 의 11개 항목 실행:

1. 현재 레포 + 하위 서브모듈 레포 분석
2. 서비스 아키텍처 / 인프라 아키텍처 / 데이터베이스 / API 상세 분석 문서
3. DB 테이블 · API · 서비스 · 기능 간 상호 관련성 문서
4. 유저 시나리오
5. 전체 URL(API 포함) 테스트 — Playwright 로 테스트 계획 + 결과 확인
6. Backend / Frontend / Admin 전 레포 기능 테스트 커버리지 확인
7. 개발 완료 기능과 미개발 기능 정리
8. 모든 문서를 `docs/` 하위에 적절한 폴더·파일명으로 저장
9. 코드 변경 시 갱신할 문서를 찾아 변경하는 체계
10. 환경 변수 정리
11. 브랜치 전략 (main / dev / feature / bug) + Cloudflare Workers(dev/prod/local) 구성

## 2. 대상 파악 결과

| 항목 | 결과 |
|------|------|
| 서브모듈 | **없음** (`.gitmodules` 부재) — 단일 레포 |
| 백엔드 | **없음** |
| 어드민 | **없음** |
| 데이터베이스 | **없음** (인메모리 `Map` + 로컬 `.md` 파일이 전부) |
| HTTP API | **없음** (JS↔Swift 브리지가 유일한 프로세스 경계) |
| Cloudflare / Supabase | **미사용** |
| 실제 구성 | 웹 프론트엔드(TS 556줄) + macOS 네이티브 셸(Swift 214줄) |

요청 항목 중 DB·API·멀티 레포·Cloudflare 부분은 대상이 존재하지 않으므로, **부재를 근거와 함께 문서화하고 이 프로젝트의 실제 대응 계층으로 치환**해 작성했다.

| 원 요청 축 | 치환된 축 |
|------------|-----------|
| 데이터베이스 테이블 | 인메모리 `TabState` 스키마 + 파일시스템 영속 경계 |
| REST API 명세 | `postMessage` / `window._bridge` / `app://` 스킴 프로토콜 |
| 인프라 아키텍처 | 빌드·패키징·배포 파이프라인 (`build.sh` → Xcode → DMG) |
| 전체 URL 테스트 | Vite dev 서버 12개 URL + 네이티브 `app://` 대응 경로 |
| Backend/Frontend/Admin 커버리지 | 웹 프론트엔드 + Swift 셸 커버리지 |

## 3. 수행 내역

### 3.1 코드 분석
- `src/*.ts` 8개 파일 전수 읽기 (556줄)
- `MarkupEditorApp/**/*.swift` 3개 파일 전수 읽기 (214줄)
- 빌드 설정 (`vite.config.ts`, `tsconfig.json`, `build.sh`, `Info.plist`, entitlements) 확인
- 모듈 의존 그래프 · 상태 흐름 · 브리지 프로토콜 도출

### 3.2 테스트 인프라 신규 구축
- `@playwright/test`, `@vitest/coverage-v8`, `jsdom` 을 devDependency 로 추가
- `playwright.config.ts` 작성 (Chromium, dev 서버 자동 기동, 환경변수 재정의 지원)
- `vitest.config.ts` 작성 (단위/E2E 분리, v8 커버리지 설정)
- E2E 스펙 5개 신규 작성 — 총 **53 케이스**
  - `tests/e2e/urls.spec.ts` (13) — 전체 URL 응답 + 콘솔 에러 0건
  - `tests/e2e/editor.spec.ts` (8) — 프리뷰·GFM 렌더
  - `tests/e2e/toolbar.spec.ts` (16) — 툴바 14버튼 전수
  - `tests/e2e/tabs.spec.ts` (8) — 멀티 탭 상태 머신
  - `tests/e2e/bridge.spec.ts` (8) — 네이티브 브리지 프로토콜 (스텁 주입)
- `package.json` 스크립트 추가: `test:coverage`, `test:e2e`, `test:e2e:report`

### 3.3 문서 15종 작성 (`docs/`)

```
docs/
├── README.md                              문서 인덱스
├── architecture/
│   ├── service-architecture.md            서비스 구조 · 레이어 · 데이터 흐름
│   ├── infrastructure.md                  빌드/패키징 파이프라인 · app:// 스킴
│   ├── data-model.md                      TabState 스키마 · 상태 전이 · 정합성 규칙
│   └── traceability.md                    기능↔모듈↔상태↔API↔테스트 매트릭스
├── api/
│   └── bridge-api.md                      JS↔Swift 브리지 프로토콜 전문
├── features/
│   └── feature-status.md                  F-01~F-48 개발/미개발 현황
├── testing/
│   ├── test-plan.md                       테스트 계획 · URL 인벤토리
│   ├── test-results.md                    실행 결과 (57/57 PASS)
│   └── coverage.md                        커버리지 분석 · 개선 로드맵
├── operations/
│   ├── environment-variables.md           환경 변수 정리
│   ├── branch-strategy.md                 main/dev/feature/bug 전략
│   └── cloudflare-workers.md              CF 구성안 (미적용 사유 포함)
├── user-scenarios.md                      US-01~US-07 + 미충족 시나리오
└── history/
    ├── README.md                          히스토리 인덱스
    └── 2026-08-12-project-analysis.md     본 문서
```

### 3.4 기존 파일 갱신
- `README.md` — 전 문서 상대경로 링크 추가, 테스트 명령 갱신
- `CLAUDE.md` — 문서 동기화 규칙(요청 9번) 추가
- `.gitignore` — `coverage/`, `playwright-report/`, `test-results/` 추가

## 4. 검증 결과

| 항목 | 결과 |
|------|------|
| `npm run build` (`tsc && vite build`) | ✅ 성공 (11 모듈, 82ms, JS 48.57kB) |
| `npm test` (Vitest) | ✅ **4/4 PASS** (131ms) |
| `npm run test:e2e` (Playwright) | ✅ **53/53 PASS** (2.81s) |
| 전체 URL 12개 응답 | ✅ 전부 200 |
| 페이지 로드 콘솔 에러 | ✅ 0건 |
| 단위 커버리지 | ⚠️ 0.91% (`parser.ts` 만 100%) |
| E2E 기능 커버리지 | ✅ 13/14 (F-13 네이티브 패키징만 수동) |

상세: [테스트 실행 결과](../testing/test-results.md)

## 5. 발견 사항

### 5.1 애플리케이션 설계 갭 (우선순위순)

| # | 심각도 | 내용 |
|---|--------|------|
| 1 | 높음 | **미저장 문서를 확인 없이 닫음** — `closeTab()` 에 `isDirty` 가드 없음 → 데이터 유실 |
| 2 | 높음 | **XSS** — `preview.ts` 가 sanitize 없이 `innerHTML` 주입. 악성 `.md` 가 브리지를 통해 파일 접근 가능 |
| 3 | 중간 | **저장 실패가 사용자에게 안 보임** — `onFileError` 가 `console.error` 만 수행 |
| 4 | 중간 | **"다른 이름으로 저장" 접근 불가** — `saveFileAs()` 가 어떤 UI 에도 연결되지 않음 |
| 5 | 낮음 | 브리지 경로 이스케이프가 작은따옴표만 처리 (백슬래시·개행 미처리) |
| 6 | 낮음 | 활성 탭 `TabState.content` 가 항상 stale — 암묵적 규칙에 의존 |

### 5.2 엔지니어링 인프라 갭

- CI 파이프라인 없음 (F-41)
- 코드 서명·공증 미적용 → Gatekeeper 차단 (F-42)
- App Sandbox entitlements 비어 있음 (F-43)
- 린터/포매터 설정 없음 (F-45)
- Swift XCTest 타깃 없음 (F-46)
- `MarkdownEditor.dmg` (2.1MB) 가 Git 에 커밋됨
- 버전이 `package.json`·`Info.plist` 로 이원화 (F-48)
- `dev` 브랜치 미생성 → 요청된 브랜치 전략 미적용 상태

### 5.3 테스트 작성 중 정정한 사전 가정

| 가정 | 실제 |
|------|------|
| 툴바 버튼 15개 | **14개** |
| `/src/style.css` → `text/css` | Vite dev 서버는 HMR 위해 **JS 모듈**로 서빙 |

둘 다 테스트 코드 측 오류였고 앱 결함이 아니다.

## 6. 남은 과제

| # | 과제 | 참조 |
|---|------|------|
| 1 | F-15 미저장 닫기 확인 다이얼로그 | [기능 현황](../features/feature-status.md) |
| 2 | F-18 HTML sanitize 적용 | [API 명세 §8](../api/browser-apis.md#8-보안-노트) |
| 3 | F-14 사용자 대상 오류 UI | [기능 현황](../features/feature-status.md) |
| 4 | `dev` 브랜치 생성 + 보호 규칙 | [브랜치 전략 §6](../operations/branch-strategy.md#6-적용-준비-작업-미완료) |
| 5 | CI 게이트 구성 (tsc + vitest + playwright) | [기능 현황 F-41](../features/feature-status.md) |
| 6 | 단위 커버리지 60% 달성 (jsdom 도입) | [커버리지 §4](../testing/coverage.md#4-개선-로드맵) |
| 7 | 네이티브 앱 수동 회귀 검증 | [테스트 계획 §7](../testing/test-plan.md#7-수동-회귀-체크리스트-네이티브-릴리즈-전) |
| 8 | 코드 서명·공증, `.dmg` 를 Releases 로 이전 | [인프라 §7](../architecture/infrastructure.md#7-개선-권고) |

## 7. 범위에서 제외한 것

- **코드 수정 없음** — 본 작업은 분석·문서화·테스트 추가에 한정했다. §5.1 의 결함들은 문서로만 기록했고 소스는 변경하지 않았다.
- **Cloudflare Workers 실제 구성 없음** — 요구사항이 없어 설계안만 문서화 ([사유](../operations/cloudflare-workers.md#5-결정-기록)).
- **`dev` 브랜치 생성 없음** — 브랜치 구조 변경은 사용자 승인이 필요한 저장소 수준 변경이라 절차만 문서화했다.
