# MarkdownEditor

바닐라 TypeScript로 만든 **웹 기반 마크다운 에디터**. 프레임워크 없이 순수 TypeScript + DOM API를 사용하며, Cloudflare Workers 로 배포한다.

설치가 필요 없고, **문서는 서버로 전송되지 않는다.** 모든 데이터는 사용자의 브라우저와 로컬 디스크에만 존재한다.

| 항목 | 값 |
|------|-----|
| 버전 | 2.0.0 (웹 전환) |
| 코드 규모 | TypeScript 약 900줄 (10개 모듈) |
| 테스트 | 단위 **431건** + E2E 258건 (전부 통과) |
| 기능 커버리지 | 38/41 자동 검증 · 라인 커버리지 **78.83%** |
| 번들 | 83.7 kB (gzip 28.0 kB) |
| 배포 (prod) | https://md-editor.devworld.co.kr |

> **v1.x 는 macOS 네이티브 앱(SwiftUI + WKWebView)이었다.** v2.0.0 에서 웹 전용으로 전환하며 Xcode 프로젝트·DMG·JS↔Swift 브리지를 제거했다. 전환 내역: [웹 전환 히스토리](./docs/history/2026-08-12-web-pivot.md)

## 📚 문서

전체 문서 인덱스: **[docs/README.md](./docs/README.md)**

| 분류 | 문서 |
|------|------|
| 아키텍처 | [서비스 아키텍처](./docs/architecture/service-architecture.md) · [인프라 아키텍처](./docs/architecture/infrastructure.md) · [데이터 모델](./docs/architecture/data-model.md) · [상호 관계 매트릭스](./docs/architecture/traceability.md) |
| API | [브라우저 API 명세](./docs/api/browser-apis.md) |
| 기능 | [사용자 시나리오](./docs/user-scenarios.md) · [기능 개발 현황](./docs/features/feature-status.md) |
| 테스트 | [테스트 계획](./docs/testing/test-plan.md) · [테스트 실행 결과](./docs/testing/test-results.md) · [커버리지 분석](./docs/testing/coverage.md) |
| 운영 | [Cloudflare Workers 구성](./docs/operations/cloudflare-workers.md) · [환경 변수](./docs/operations/environment-variables.md) · [브랜치 전략](./docs/operations/branch-strategy.md) |
| 기록 | [작업 히스토리](./docs/history/README.md) |

## 주요 기능

- 실시간 마크다운 프리뷰 (좌우 분할, 150ms 디바운스)
- **편집/프리뷰 영역 시각 구분 + 양방향 스크롤 동기화**
- **다크 모드** (OS 설정 추종)
- **단축키 안내** (툴바 버튼 또는 `Alt+/`)
- **문서 내 검색 · 치환** (`Cmd/Ctrl+F`)
- **분할 비율 조절** (드래그 또는 화살표 키)
- **보기 모드** — 분할 / 편집 전용 / 미리보기 전용 (`Alt+M`)
- **HTML 내보내기** — 스타일이 포함된 독립 실행 파일
- **인쇄 / PDF** — 인쇄 전용 스타일 (`Cmd/Ctrl+P`)
- **탭 재정렬** — 드래그 또는 `Alt+Shift+←/→`
- **편집 글꼴·크기 설정** (편집 영역에만 적용)
- **최근 파일 목록** (핸들 수명 안내 포함)
- **렌더 결과 클립보드 복사** (서식 유지 + 원문 대체본)
- **키보드 접근성** — 전 기능 키보드 도달, 스크린리더 지원
- GFM(GitHub Flavored Markdown) 지원 — 테이블·취소선·체크리스트
- **DOMPurify 로 HTML 정화** — 신뢰할 수 없는 문서를 안전하게 렌더
- 멀티 탭 (생성·전환·닫기, 탭별 커서·스크롤 보존)
- 로컬 파일 열기/저장 — File System Access API + 업로드/다운로드 폴백
- **세션 자동 저장·복원** (localStorage) + 미저장 이탈 경고 + 용량 초과 알림
- **PWA** — 설치형 앱, 서비스 워커 기반 오프라인 지원, 새 버전 갱신 알림, **오프라인 상태 표시**
- **CSP 및 보안 헤더** — `script-src 'self'`, `object-src 'none'` 등
- 서식 툴바 12종 + 파일 4종 + 보기·도움말 2종, 키보드 단축키 (앱 내 안내 포함)
- 720px 이하 반응형 (상하 분할)

## 브라우저별 파일 기능

| 기능 | Chrome · Edge | Safari · Firefox |
|------|---------------|------------------|
| 편집 · 프리뷰 · 탭 · 세션 저장 | ✅ | ✅ |
| 파일 열기 | ✅ 파일 선택기 | ✅ 업로드 |
| 저장 (덮어쓰기) | ✅ | ❌ 매번 새 파일 다운로드 |
| 같은 파일 중복 열기 방지 | ✅ | ❌ |

폴백 브라우저에서는 첫 저장 시 이 차이를 안내한다(F-58).

File System Access API 는 **보안 컨텍스트(HTTPS 또는 localhost)** 에서만 동작한다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript (프레임워크 없음) |
| 마크다운 파싱 | [marked](https://github.com/markedjs/marked) (GFM + line breaks) |
| HTML 정화 | [DOMPurify](https://github.com/cure53/DOMPurify) |
| 번들러 | [Vite](https://vitejs.dev/) |
| 단위 테스트 | [Vitest](https://vitest.dev/) + jsdom |
| E2E 테스트 | [Playwright](https://playwright.dev/) (Chromium) |
| 호스팅 | [Cloudflare Workers](https://workers.cloudflare.com/) (정적 자산) |
| CI/CD | GitHub Actions |

## 프로젝트 구조

```
markdownEditor/
├── src/                      # TypeScript 소스
│   ├── main.ts               # 엔트리포인트 · 세션 복원 · 이탈 방지
│   ├── editor.ts             # 디바운스 입력 처리
│   ├── preview.ts            # 프리뷰 렌더링
│   ├── parser.ts             # marked + DOMPurify
│   ├── tabs.ts               # 멀티 탭 상태 + 세션 영속화
│   ├── fileOps.ts            # 파일 I/O (FS Access + 폴백)
│   ├── storage.ts            # localStorage 세션 저장/복원
│   ├── notice.ts             # 사용자 알림
│   ├── swUpdate.ts           # 서비스 워커 갱신 알림
│   ├── offline.ts            # 오프라인 상태 배지
│   ├── fsLimitNotice.ts      # 브라우저 한계 안내
│   ├── scrollSync.ts         # 에디터 ↔ 프리뷰 스크롤 동기화
│   ├── clipboardExport.ts    # 클립보드 복사
│   ├── recentFiles.ts        # 최근 파일 계산 (순수)
│   ├── recentFilesUi.ts      # 최근 파일 <dialog>
│   ├── editorPrefs.ts        # 편집 글꼴·크기 계산 (순수)
│   ├── editorSettings.ts     # 편집 설정 <dialog>
│   ├── tabOrder.ts           # 탭 재정렬 계산 (순수)
│   ├── htmlExport.ts         # HTML 내보내기 조립 (순수)
│   ├── viewMode.ts           # 보기 모드 (분할/편집/미리보기)
│   ├── splitLayout.ts        # 분할 비율 계산 (순수)
│   ├── splitter.ts           # 분할 리사이저
│   ├── searchEngine.ts       # 검색 계산 (순수)
│   ├── search.ts             # 문서 내 검색 UI
│   ├── shortcutDefs.ts       # 단축키 단일 출처 (판별 + 표기)
│   ├── shortcutHelp.ts       # 단축키 안내 <dialog>
│   ├── textEdit.ts           # 텍스트 조작 계산 (순수)
│   ├── toolbar.ts            # 툴바 16종
│   ├── shortcuts.ts          # 키보드 단축키
│   └── style.css
├── tests/
│   ├── parser.test.ts        # 단위 — 파싱 + sanitize
│   ├── storage.test.ts       # 단위 — 세션 저장소
│   ├── setup.ts              # jsdom Storage 셰임
│   └── e2e/                  # Playwright
│       ├── fixtures.ts       # File System Access API 목
│       ├── urls.spec.ts      # 전체 URL 응답
│       ├── editor.spec.ts    # 에디터 · 프리뷰 · 정화
│       ├── toolbar.spec.ts   # 서식 툴바
│       ├── tabs.spec.ts      # 멀티 탭
│       ├── fileaccess.spec.ts # 파일 I/O 2경로
│       ├── session.spec.ts   # 세션 자동 저장 · 복원
│       ├── hardening.spec.ts # CSP · PWA · 저장 실패
│       ├── swupdate.spec.ts  # 서비스 워커 갱신 (프리뷰 모드)
│       ├── offline.spec.ts   # 오프라인 상태 표시
│       ├── scrollsync.spec.ts # 시각 구분 · 스크롤 동기화
│       ├── darkmode.spec.ts  # 다크 모드
│       ├── icons.spec.ts     # PWA 아이콘
│       ├── shortcuthelp.spec.ts # 단축키 안내
│       ├── search.spec.ts    # 문서 내 검색
│       ├── splitter.spec.ts  # 분할 비율 조절
│       ├── viewmode.spec.ts  # 보기 모드
│       ├── htmlexport.spec.ts # HTML 내보내기
│       ├── print.spec.ts     # 인쇄 / PDF
│       ├── a11y.spec.ts      # 접근성 (axe + 키보드)
│       ├── taborder.spec.ts  # 탭 재정렬
│       ├── settings.spec.ts  # 편집 설정
│       ├── recent.spec.ts    # 최근 파일
│       └── clipboard.spec.ts # 클립보드 복사
├── public/                   # 정적 자산 (vite 가 dist/ 루트로 복사)
│   ├── _headers              # CSP · 보안 헤더 · 캐시 정책
│   ├── manifest.webmanifest  # PWA 매니페스트
│   ├── icon.svg              # 파비콘 + PWA 아이콘
│   └── sw.js                 # 서비스 워커 (오프라인)
├── scripts/
│   └── healthcheck.sh        # 배포 후 헬스체크 (CI + 로컬 공용)
├── docs/                     # 프로젝트 문서 (→ docs/README.md)
├── .github/workflows/        # CI (ci.yml) · CD (deploy.yml)
├── index.html
├── wrangler.jsonc            # Cloudflare Workers 설정
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts
```

## 아키텍처

```
[textarea] → input (디바운스 150ms)
    → editor.ts → preview.ts → parser.ts → marked → DOMPurify → [프리뷰]

[탭 바] → switchTab → 스냅샷 저장 → 값·포커스·커서 복원 → 프리뷰 갱신

[Cmd+O] → showOpenFilePicker() 또는 <input type=file> → createTab
[Cmd+S] → handle.createWritable() 또는 Blob 다운로드 → updateActiveTab

[모든 상태 변경] → 500ms 디바운스 → localStorage 세션 저장
[재방문 / 새로고침] → restoreSession() → 탭 복원
```

## 시작하기

### 요구사항

- Node.js 18+

### 개발 서버

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

### 테스트

```bash
npm test                 # 단위 테스트 (Vitest)
npm run test:watch       # 워치 모드
npm run test:coverage    # 단위 + 커버리지
npm run test:e2e         # E2E (Playwright, dev 서버 자동 기동)
E2E_PREVIEW=1 npx playwright test   # E2E (프로덕션 번들 — 서비스 워커 시나리오)
npm run test:e2e:report  # 직전 E2E HTML 리포트
```

서비스 워커는 프로덕션 빌드에서만 등록되므로 관련 시나리오는 `E2E_PREVIEW=1` 에서만 실행된다.

상세: [테스트 계획](./docs/testing/test-plan.md) · [실행 결과](./docs/testing/test-results.md)

### 빌드 · 배포

```bash
npm run icons        # public/icon.svg → PWA PNG 4종 재생성 (아이콘 변경 시에만)
npm run build        # tsc + vite build → dist/
npm run preview      # 빌드 결과 미리보기
npm run cf:dev       # 로컬 workerd 런타임으로 dist/ 서빙
npm run deploy:dev   # Cloudflare Workers dev 환경
npm run deploy:prod  # Cloudflare Workers prod 환경
npm run healthcheck:dev   # 배포 검증 (캐시 우회 + 재시도 + SHA 일치)
npm run healthcheck:prod
```

`dev` 브랜치 push → dev 환경(`*.workers.dev`), `main` 브랜치 push → prod 환경(`md-editor.devworld.co.kr`)으로 GitHub Actions 가 자동 배포한다.
상세: [Cloudflare Workers 구성](./docs/operations/cloudflare-workers.md)

## 단축키

| 단축키 | 동작 |
|--------|------|
| `Cmd/Ctrl + O` | 파일 열기 |
| `Cmd/Ctrl + S` | 저장 |
| `Cmd/Ctrl + Shift + S` | 다른 이름으로 저장 |
| `Alt + N` | 새 문서 |
| `Alt + W` | 탭 닫기 |
| `Alt + Shift + ←/→` | 탭 순서 옮기기 |
| `Cmd/Ctrl + F` | 문서 내 검색 · 치환 |
| `Cmd/Ctrl + P` | 인쇄 / PDF (브라우저 기본) |
| `Alt + M` | 분할 / 편집 전용 / 미리보기 전용 전환 |
| `Alt + /` | 단축키 목록 열기 / 닫기 |

`Cmd/Ctrl + N` 과 `Cmd/Ctrl + W` 는 브라우저가 선점해 사용할 수 없어 `Alt` 조합으로 대체했다.

이 표는 앱 안에서도 볼 수 있다 — 툴바의 키보드 아이콘 또는 `Alt + /`. 목록은 [`src/shortcutDefs.ts`](./src/shortcutDefs.ts) 에서 파생되므로 실제 동작과 어긋날 수 없다.
