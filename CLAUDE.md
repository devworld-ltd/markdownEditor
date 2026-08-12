# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

바닐라 TypeScript로 만든 **웹 기반 마크다운 에디터**. 프레임워크 없이 순수 TypeScript + DOM API를 사용하며, `marked` + `DOMPurify` 로 마크다운을 안전한 HTML로 변환한다. Cloudflare Workers 에 정적 자산으로 배포한다.

서버·데이터베이스·네트워크 호출이 없는 **100% 클라이언트 앱**이다. 문서는 사용자 브라우저(localStorage)와 로컬 디스크에만 존재한다.

> **v2.0.0 에서 방향이 바뀌었다.** v1.x 는 macOS 네이티브 앱(SwiftUI + WKWebView)이었고, Xcode 프로젝트·`build.sh`·DMG·JS↔Swift 브리지(`window.webkit`/`window._bridge`)·`app://` 스킴이 있었다. 이 모두가 제거됐으므로 **오래된 문서나 커밋을 참고할 때 주의한다.** 전환 내역: `docs/history/2026-08-12-web-pivot.md`

## 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | Vite 개발 서버 (`http://127.0.0.1:5173`) |
| `npm run build` | TypeScript 컴파일 + Vite 빌드 (→ `dist/`) |
| `npm run preview` | 빌드 결과물 미리보기 |
| `npm test` | 단위 테스트 (vitest, jsdom) |
| `npm run test:watch` | 워치 모드 |
| `npm run test:coverage` | 단위 + v8 커버리지 |
| `npm run test:e2e` | E2E (playwright, dev 서버 자동 기동) |
| `npx vitest run tests/parser.test.ts` | 단일 단위 테스트 |
| `npx playwright test tests/e2e/tabs.spec.ts` | 단일 E2E 파일 |
| `npm run cf:dev` | 로컬 workerd 런타임으로 `dist/` 서빙 |
| `npm run deploy:dev` / `deploy:prod` | Cloudflare Workers 배포 |
| `npx wrangler deploy --env dev --dry-run` | 배포 설정 검증 |

## 아키텍처

좌우 분할 레이아웃(720px 이하는 상하): 왼쪽 textarea + 오른쪽 프리뷰 div.

**모듈 흐름:**
```
main.ts → editor.ts → preview.ts → parser.ts → marked → DOMPurify
        → tabs.ts (상태) → preview.ts / storage.ts
        → fileOps.ts → File System Access API | 업로드·다운로드 폴백
        → toolbar.ts / shortcuts.ts / notice.ts
```

- **`main.ts`** — 엔트리포인트. 초기화 순서가 중요하다: `initFileOps()` → `setCloseConfirm()` → `initTabs()`(세션 복원) → `setFileActions()` → `initToolbar()`. `beforeunload`/`visibilitychange` 가드도 여기서 등록한다.
- **`editor.ts`** — textarea `input` 을 150ms 디바운스해 프리뷰 갱신.
- **`preview.ts`** — 파싱 결과를 `innerHTML` 로 주입. **반드시 `parseMarkdown()` 을 거쳐야 한다.**
- **`parser.ts`** — `marked`(GFM + breaks) → **`DOMPurify.sanitize()`**. DOM 비의존 순수 모듈.
- **`tabs.ts`** — 멀티 탭 상태(`Map<string, TabState>`) + 탭바 렌더 + 타이틀 + localStorage 세션 영속화.
- **`storage.ts`** — localStorage 세션 저장/복원. 스키마 버전 검증·손상 데이터 필터·접근 불가 감지.
- **`fileOps.ts`** — 파일 I/O 2경로 분기. FS Access API(Chrome·Edge) ↔ `<input type=file>` + Blob 다운로드(Safari·Firefox).
- **`notice.ts`** — 사용자에게 보이는 성공·오류 알림(`#notice`).
- **`toolbar.ts`** — 버튼 16개(파일 4 + 서식 12). `execCommand("insertText")` 로 undo 스택 보존. `fileOps` 를 import 하지 않고 `setFileActions()` 콜백을 주입받는다.
- **`shortcuts.ts`** — `Cmd/Ctrl+O·S`, `Shift+S`, `Alt+N·W`.

## 반드시 알아야 할 함정

1. **활성 탭의 `TabState.content` 는 stale 하다.** 실제 본문은 항상 `editorEl.value`(= `getActiveContent()`)다. 저장·영속화·dirty 판정 전에는 `syncActiveTab()` 을 먼저 호출한다.
2. **`switchTab()` 은 선택 복원 전에 `editorEl.focus()` 를 해야 한다.** 포커스 없는 textarea 의 선택 영역은 클릭 이벤트가 끝나며 브라우저가 0,0 으로 되돌린다.
3. **툴바 버튼의 `editsText: true` 는 서식 액션에만 붙인다.** 파일 액션까지 `input` 이벤트를 재발행하면 방금 연 문서가 즉시 dirty 로 표시된다.
4. **`Cmd/Ctrl+W`·`Cmd/Ctrl+N` 은 쓸 수 없다.** 브라우저가 선점하며 `preventDefault()` 로도 막히지 않는다. `Alt+W`/`Alt+N` 을 쓴다. Alt 조합은 macOS 에서 `e.key` 가 특수문자가 되므로 **`e.code` 로 판별**한다.
5. **File System Access API 는 보안 컨텍스트에서만 동작한다.** LAN IP(`192.168.x.x`)로 접속하면 폴백 경로로 떨어져 관련 E2E 가 실패한다.
6. **파일 핸들은 직렬화할 수 없다.** 세션 복원 탭은 항상 `handle: null` 이며 저장 시 위치를 다시 묻는다.
7. **`vite.config.ts` 의 `base:"/"`** — v1.x 의 `"./"`·`modulePreload:false` 는 `app://` 스킴 호환용이었다. 되돌리지 말 것.

## 테스트

- **단위**: `tests/*.test.ts` (Vitest + jsdom). `parser.ts`(100%)·`storage.ts`(88.6%)만 커버. 나머지는 0%.
- **E2E**: `tests/e2e/*.spec.ts` (Playwright, Chromium) 73건.
- `vitest.config.ts` 가 `tests/e2e/**` 를 제외한다. **새 E2E 는 `.spec.ts`, 단위는 `.test.ts`.**
- `tests/setup.ts` 는 Node 22+ 의 `localStorage` 전역 예약 때문에 필요한 Storage 셰임이다. 지우면 `storage.test.ts` 가 깨진다.
- 파일 I/O 는 `tests/e2e/fixtures.ts` 의 `installFsMock()` / `installFallbackMode()` 로 검증한다. 목 핸들은 이름별로 재사용되므로 `isSameEntry()` 중복 방지까지 실제와 같이 동작한다.
- Playwright 는 테스트마다 새 컨텍스트를 쓰므로 localStorage 가 자동 격리된다.

## 배포

| 브랜치 | 환경 | Worker | URL |
|--------|------|--------|-----|
| `dev` | dev | `markdown-editor-dev` | `*.workers.dev` |
| `main` | prod | `markdown-editor-prod` | `md-editor.devworld.co.kr` |

`.github/workflows/ci.yml` 한 파일에 `verify`(빌드+단위+E2E) → `deploy`(needs: verify) 두 잡. **CI 는 Node 24 를 써야 한다** — jsdom 30 → undici 8 이 Node >=22.19 를 요구해 Node 20 에서는 vitest 가 기동하지 못한다. 배포는 `cloudflare/wrangler-action` 대신 `npx wrangler` 직접 호출 (액션 번들 wrangler 3.x 는 `wrangler.jsonc` 를 못 읽는다). `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 시크릿은 등록 완료. **커스텀 도메인은 첫 prod 배포 때 생성되므로 `main` 에 병합되기 전까지 서비스되지 않는다.**

## 문서 관리 (필수)

모든 프로젝트 문서는 `docs/` 하위에 있으며 인덱스는 `docs/README.md` 다.

**코드를 변경하면 같은 작업 안에서 대응 문서를 반드시 갱신한다.** 판단 기준은 `docs/architecture/traceability.md` 의 "변경 영향도" 표다. 요약:

| 변경 대상 | 갱신 문서 |
|-----------|-----------|
| `src/tabs.ts` (`TabState`) · `src/storage.ts` (세션 스키마) | `docs/architecture/data-model.md`, `docs/architecture/traceability.md` |
| `src/fileOps.ts` · `src/shortcuts.ts` · `src/notice.ts` | `docs/api/browser-apis.md` |
| `src/toolbar.ts` (버튼 증감) | `docs/features/feature-status.md`, `tests/e2e/toolbar.spec.ts` 버튼 개수 단언 |
| `src/parser.ts` (marked 옵션 · sanitize 정책) | `docs/architecture/service-architecture.md`, `docs/api/browser-apis.md` §8, `tests/parser.test.ts` |
| `vite.config.ts` · `wrangler.jsonc` · `.github/workflows/*` | `docs/architecture/infrastructure.md`, `docs/operations/cloudflare-workers.md` |
| `index.html` (DOM id) | 전 E2E 셀렉터, `docs/architecture/service-architecture.md` |
| 기능 추가/삭제 | `docs/features/feature-status.md` (F-ID 부여, 제거는 🗑 로 남김) |
| 테스트 변경 | `docs/testing/test-plan.md`, `docs/testing/test-results.md` |

작업 완료 시 `docs/history/` 에 `YYYY-MM-DD-<요약>.md` 로 요청 사항과 처리 결과를 기록하고 `docs/history/README.md` 목록에 한 줄 추가한다.

문서 상단에는 `> 최종 갱신: YYYY-MM-DD · 대상: <버전>` 을 유지한다.

## 알려진 설계 갭

상세: `docs/features/feature-status.md`

1. **`dev` 브랜치 미생성** — CI/CD 워크플로가 아직 한 번도 실행되지 않았다 (F-66).
2. localStorage 저장 실패(용량 초과)를 사용자에게 알리지 않는다 (F-54).
3. CSP 헤더 미설정 (F-62).
4. Safari·Firefox 는 덮어쓰기·중복 탭 방지가 불가능하나 이를 안내하는 UI 가 없다 (F-11, F-58).
5. 단위 커버리지 8.11% — DOM 결합 모듈이 전부 미검증 (F-47).
