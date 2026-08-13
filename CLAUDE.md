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
        → swUpdate.ts ⇄ public/sw.js (갱신 알림)
```

- **`main.ts`** — 엔트리포인트. 초기화 순서가 중요하다: `initFileOps()` → `setCloseConfirm()` → `initTabs()`(세션 복원) → `setFileActions()` → `initToolbar()`. `beforeunload`/`visibilitychange` 가드도 여기서 등록한다.
- **`editor.ts`** — textarea `input` 을 150ms 디바운스해 프리뷰 갱신.
- **`preview.ts`** — 파싱 결과를 `innerHTML` 로 주입. **반드시 `parseMarkdown()` 을 거쳐야 한다.**
- **`parser.ts`** — `marked`(GFM + breaks) → **`DOMPurify.sanitize()`**. DOM 비의존 순수 모듈.
- **`tabs.ts`** — 멀티 탭 상태(`Map<string, TabState>`) + 탭바 렌더 + 타이틀 + localStorage 세션 영속화.
- **`storage.ts`** — localStorage 세션 저장/복원. 스키마 버전 검증·손상 데이터 필터·접근 불가 감지.
- **`fileOps.ts`** — 파일 I/O 2경로 분기. FS Access API(Chrome·Edge) ↔ `<input type=file>` + Blob 다운로드(Safari·Firefox).
- **`notice.ts`** — 사용자에게 보이는 성공·오류 알림(`#notice`).
- **`swUpdate.ts`** — 서비스 워커 갱신 감지·알림·리로드(F-69). `SwUpdateHost` 주입형 **리프**라 앱 모듈을 import 하지 않는다(`tabs → notice → tabs` 순환 방지).
- **`offline.ts`** — 오프라인 상태 배지(F-70). 같은 주입형 리프 패턴(`OfflineHost`).
- **`fsLimitNotice.ts`** — 폴백 브라우저의 저장 동작 차이 안내(F-58). 같은 패턴. `fileOps.saveFileAs()` 폴백 분기에서 세션당 1회 호출된다.
- **`textEdit.ts`** — 툴바 텍스트 조작의 **문자열 계산만** 담당하는 순수 리프. DOM 삽입은 `toolbar.ts` 가 `execCommand` 로 한다.
- **`scrollSync.ts`** — 에디터 ↔ 프리뷰 양방향 스크롤 동기화(F-25). 주입형 리프. `tabs.ts` 는 `setScrollSyncHooks()` 로, `editor.ts` 는 `onAfterRender` 콜백으로 연결된다 — 양쪽 다 import 하지 않는다.
- **`public/`** — vite 가 `dist/` 루트로 복사한다. `_headers`(CSP·캐시), `manifest.webmanifest`, `icon.svg`, `sw.js`(서비스 워커).
- **`toolbar.ts`** — 버튼 16개(파일 4 + 서식 12). `execCommand("insertText")` 로 undo 스택 보존. `fileOps` 를 import 하지 않고 `setFileActions()` 콜백을 주입받는다.
- **`viewMode.ts`** — 보기 모드(F-33). 주입형 리프. **버튼 클릭은 듣지 않는다** — 툴바가 이미 다루므로 중복하면 한 번 눌러 두 단계 넘어간다.
- **`splitLayout.ts`** — 분할 비율 계산만 담당하는 순수 리프(F-32).
- **`splitter.ts`** — 분할 리사이저 배선(F-32). 주입형 리프. **경계선은 이 요소가 그린다** — `#editor` 에 테두리를 되살리면 1px 이 두 줄로 겹친다.
- **`searchEngine.ts`** — 문서 내 검색의 **계산만** 담당하는 순수 리프(F-22). 일치 탐색·순환·서수 보존.
- **`search.ts`** — 검색 바 배선(F-22). 주입형 리프. 스크롤 측정(`measureOffsetTop`)이 주입 경계다.
- **`shortcutDefs.ts`** — 단축키 **단일 출처**(조합 판별 + 표시용 키 캡). DOM 비의존 순수 모듈. `shortcuts.ts`(디스패치)와 `shortcutHelp.ts`(안내)가 둘 다 여기서 읽는다.
- **`shortcutHelp.ts`** — 단축키 안내 `<dialog>`(F-58). 주입형 리프.
- **`shortcuts.ts`** — `Cmd/Ctrl+O·S`, `Shift+S`, `Alt+N·W`.

## 반드시 알아야 할 함정

1. **활성 탭의 `TabState.content` 는 stale 하다.** 실제 본문은 항상 `editorEl.value`(= `getActiveContent()`)다. 저장·영속화·dirty 판정 전에는 `syncActiveTab()` 을 먼저 호출한다.
2. **`switchTab()` 은 선택 복원 전에 `editorEl.focus()` 를 해야 한다.** 포커스 없는 textarea 의 선택 영역은 클릭 이벤트가 끝나며 브라우저가 0,0 으로 되돌린다.
3. **툴바 버튼의 `editsText: true` 는 서식 액션에만 붙인다.** 파일 액션까지 `input` 이벤트를 재발행하면 방금 연 문서가 즉시 dirty 로 표시된다.
4. **`Cmd/Ctrl+W`·`Cmd/Ctrl+N` 은 쓸 수 없다.** 브라우저가 선점하며 `preventDefault()` 로도 막히지 않는다. `Alt+W`/`Alt+N` 을 쓴다. Alt 조합은 macOS 에서 `e.key` 가 특수문자가 되므로 **`e.code` 로 판별**한다.
5. **File System Access API 는 보안 컨텍스트에서만 동작한다.** LAN IP(`192.168.x.x`)로 접속하면 폴백 경로로 떨어져 관련 E2E 가 실패한다.
6. **파일 핸들은 직렬화할 수 없다.** 세션 복원 탭은 항상 `handle: null` 이며 저장 시 위치를 다시 묻는다.
7. **`vite.config.ts` 의 `base:"/"`** — v1.x 의 `"./"`·`modulePreload:false` 는 `app://` 스킴 호환용이었다. 되돌리지 말 것.
8. **`tsc` 는 타입 검사 전용이다** (`tsc --noEmit && vite build`). tsconfig 에 `outDir`/`declaration` 을 되살리면 `tsc` 가 `dist/` 에 `.js`/`.d.ts` 를 쏟아내고, 타입 오류로 멈출 때 중간 산출물이 남는다.
9. **`_headers` 와 서비스 워커는 로컬에서 동작하지 않는다.** `_headers` 는 Cloudflare 가, 서비스 워커는 `import.meta.env.PROD` 조건이 가른다. 관련 E2E 는 원격 baseURL 일 때만 실행되고 로컬에서는 skip 된다.
10. **CSP `script-src` 에 `'unsafe-inline'`/`'unsafe-eval'` 을 절대 넣지 말 것.** E2E 가 단언한다. 인라인 스크립트가 필요하면 외부 파일로 뺀다.
11. **서비스 워커 캐시 전략을 뒤집지 말 것.** HTML 은 network-first(새 배포 반영), `/assets/*` 는 cache-first(해시 불변). 반대로 하면 업데이트가 영원히 안 보이거나 오프라인 이점이 사라진다.
12. **`sw.js` 의 `__BUILD_ID__` 플레이스홀더를 지우지 말 것.** `vite.config.ts` 의 `writeBundle` 훅이 치환한다. 없으면 `/sw.js` 바이트가 배포마다 같아져 갱신 알림이 **한 번도 뜨지 않는다**(조용한 무동작). 그래서 미발견 시 빌드가 실패한다.
13. **`install` 에서 `skipWaiting()` 을 되살리지 말 것.** 새 워커가 대기 상태에 머물러야 갱신을 감지할 수 있다. 활성화는 `SKIP_WAITING` 메시지로만.
14. **`postMessage` 대상은 `registration.waiting`.** `controller` 로 보내면 구 워커에게 간다.
15. **커버리지를 올리려면 테스트를 더 쓰지 말고 의존 방향을 정리하라.** 이 저장소에서 여섯 번 검증됐다 — DI 주입형 리프(`swUpdate.ts` 79%, `offline.ts` 79%, `fsLimitNotice.ts` 100%), 순수 함수 분리(`textEdit.ts` 100%), 가짜 DOM 주입(`tabs.ts` 97%), 플랫폼 API 만 주입 경계로 분리(`fileOps.ts` 5% → 90%). 전역(`navigator` 등)을 직접 읽는 순간 테스트가 전역 패치에 의존하게 된다.
    - 다만 **완전한 리프화가 항상 답은 아니다.** `fileOps.ts` 는 본질적으로 탭 상태를 바꾸는 모듈이라 `tabs.ts` 의존을 끊으면 호출부만 복잡해진다. 검증에 필요한 경계만 빼라.
16. **단언을 추가하면 그것이 실제로 회귀를 잡는지 확인하라.** 프로덕션 코드에 의도적 버그를 주입해 테스트가 실패하는지 본다. F-69 에서 `MutationObserver` 단언이 마이크로태스크 타이밍 때문에 **vacuous** 였던 전례가 있다.
17. **스크롤 동기화의 세 가지 순서 제약을 깨지 말 것.** (a) 프로그램적 스크롤 판별은 **불리언이 아니라 `expectedTop` 값 비교** — `scrollTop` 대입은 scroll 을 동기 발화하지 않아 플래그는 이벤트 도착 시 이미 내려가 있다. (b) `switchTab()` 의 억제 해제는 **`rAF`**, `setTimeout(…,0)` 은 순서 보장이 없어 F-06/F-51 이 회귀한다. (c) scroll 리스너는 **패널에 직접·비캡처** — `scroll` 은 버블링하지 않고, `document`/capture 로 붙이면 프리뷰 내부 `pre`·`table` 의 가로 스크롤이 세로 동기화를 트리거한다.
18. **`0/0 = NaN` 을 `scrollTop` 에 대입하면 브라우저가 조용히 0 으로 클램프한다.** 예외가 안 나므로 가드 누락이 개발 중에 안 보인다. `!== 0` 이 아니라 **`> 0`** 으로 비교하라(레이아웃 전이 중 음수 가능).
19. **배포 검증에는 캐시 우회와 재시도가 둘 다 필요하다.** 엣지 캐시(`cf-cache-status: HIT`)로 구버전을 보고 오판한 적이 두 번, 인증서 프로비저닝으로 1분간 500 이 난 적이 한 번 있다. `scripts/healthcheck.sh` 가 이를 처리한다.
20. **폼 컨트롤은 `color` 를 상속하지 않는다.** `body` 에만 색을 주면 `textarea#editor` 가 UA 의 `fieldtext` 로 초기화돼 **다크 모드에서만** 검은 글씨가 어두운 표면 위에 남는다. 개발 중엔 라이트로 보고 있어 안 보인다. 표면색을 바꾸면 그 위의 글자색도 **같은 규칙에서** 함께 선언하라.
21. **색은 반드시 bare `:root` 에 기준값을 두고 `@media (prefers-color-scheme: dark)` 는 덮어쓰기만 하라.** 미디어 쿼리 안에서만 정의된 색은 라이트에서 값이 없어 UA 기본값으로 떨어진다. 그리고 다크는 **토큰 값만** 바꾼다 — 다크 전용 레이아웃 분기를 만들면 F-72 구분과 720px 경계가 두 벌이 되어 한쪽만 갱신되는 사고가 난다.
22. **PWA 아이콘 PNG 는 `npm run icons` 로만 갱신된다.** `public/icon.svg` 를 바꾸고 재생성을 잊으면 **PNG 만 옛 그림으로 남는다** — 빌드도 테스트도 통과하므로 배포 후 홈 화면에서야 드러난다. `apple-touch-icon`·maskable 은 **full-bleed**, `purpose: any` 는 **둥근 모서리**다(소비자가 자기 마스크를 씌우느냐로 갈린다). 생성기 파서는 좁아서 곡선·도형 추가를 만나면 예외로 멈춘다.
23. **가드를 넣었으면 그 가드가 실제로 걸리는지 확인하라.** `gen-icons.mjs` 의 곡선 거부 가드는 토크나이저가 `C` 를 아예 버려서 **한 번도 실행되지 않았다** — 곡선이 직선으로 조용히 파싱됐다. 트랩 #16(단언 검증)의 생성기 버전이다.
24. **단축키는 `shortcutDefs.ts` 에만 추가한다.** 안내 UI 가 같은 정의에서 파생되므로 자동 반영되고, 디스패치를 빠뜨리면 `Record<ShortcutId, …>` 가 타입 오류로 막는다. `shortcuts.ts` 에서 직접 `e.key` 를 비교하는 방식으로 되돌리면 **안내가 조용히 낡는다** — 안내가 거짓말하는 것은 안내가 없는 것보다 나쁘다.
25. **전역 리셋 `* { margin: 0 }` 이 `<dialog>` 의 UA `margin: auto` 를 덮어쓴다.** 모달이 화면 **좌상단에 붙지만 기능은 멀쩡해서** 테스트 없이는 그대로 배포된다. 그리고 **백드롭 클릭의 히트 타깃은 `dialog` 가 아니다**(Chromium 은 아래 깔린 요소를 준다) — 좌표로 판단하고, `click` 이 아니라 **`pointerdown`** 으로 들어야 여는 클릭이 즉시 닫는 경합을 피한다.
26. **검색 중에는 에디터로 포커스를 옮기지 말 것.** `reveal()` 이 `editorEl.focus()` 를 하면 **Enter 가 본문에 개행을 넣어 방금 찾은 일치를 지운다**(실제로 그랬고 E2E 가 `1/3 → 1/2` 로 잡았다). 선택만 걸고 포커스는 검색창에 남긴다 — Esc 로 닫는 순간 그 선택이 활성 선택이 된다.
27. **치환은 `execCommand("insertText")` 를 반드시 유지하라.** `textarea.value` 대입으로 바꾸면 **Cmd+Z 실행 취소가 통째로 죽는다**. 특히 "모두 바꾸기" 는 문서 전체를 갈아치우므로 되돌릴 수 없으면 데이터 유실에 가깝다. 그리고 전체 치환은 **삽입 1회**여야 한다 — 부분 치환을 N번 반복하면 Cmd+Z 를 N번 눌러야 한다.
28. **`Cmd/Ctrl+F` 는 `Cmd+W`·`Cmd+N` 과 달리 가로챌 수 있다.** 페이지에 도달하고 `preventDefault()` 가 먹는다(실측). 트랩 #4 를 이 조합까지 확대 적용하지 말 것.
29. **F-32 리사이저에 F-25 억제 훅을 다시 붙이지 말 것.** 구현해 두고 실측했더니 있으나 없으나 드래그 후 두 패널의 비율 차이가 **0 으로 동일**했다 — F-25 의 메아리 판별이 이미 처리한다. 되살리려면 먼저 재현되는 실패를 만들 것.
30. **F-33 은 패널을 `display: none` 으로 숨겨야 한다.** 숨은 패널의 `clientHeight` 가 0 이 되어 F-25 의 `> 0` 가드에 걸리는 데 기대는 설계다. `visibility`/`opacity` 로 바꾸면 **크기가 남아 동기화가 계속 돌면서 보이지 않는 패널을 따라 움직인다.**
31. **레이아웃 설정 쓰기는 항상 병합이다.** 통째로 덮어쓰면 모드를 저장할 때 비율이 지워지는데, 같은 세션에서는 메모리 값이 가려 **새로고침해야 드러난다.**
32. **`initViewMode()` 는 `initToolbar()` 뒤에 호출한다.** 순서가 뒤집히면 클릭은 동작하지만 `aria-*` 가 비어 스크린리더에게는 상태 없는 버튼이 된다 — 눈으로는 안 보인다.
33. **F-69 E2E 는 `E2E_PREVIEW=1` 에서만 돈다.** 서비스 워커가 `import.meta.env.PROD` 에서만 등록되기 때문. 이 가드를 테스트용으로 완화하면 원래 막으려던 "고쳤는데 안 바뀌는" 문제가 되살아난다.

## 테스트

- **단위**: `tests/*.test.ts` (Vitest + jsdom). `parser.ts`(100%)·`storage.ts`(88.6%)만 커버. 나머지는 0%.
- **E2E**: `tests/e2e/*.spec.ts` (Playwright, Chromium) 73건.
- `vitest.config.ts` 가 `tests/e2e/**` 를 제외한다. **새 E2E 는 `.spec.ts`, 단위는 `.test.ts`.**
- `tests/setup.ts` 는 Node 22+ 의 `localStorage` 전역 예약 때문에 필요한 Storage 셰임이다. 지우면 `storage.test.ts` 가 깨진다.
- **`localStorage` 메서드를 스텁할 때는 `window.localStorage` 속성 자체를 `Object.defineProperty` 로 갈아끼워야 한다.** jsdom 의 Storage 는 Proxy 라 `localStorage.setItem = fn` 이 메서드 교체가 아니라 `"setItem"` 이라는 이름의 **항목 저장**으로 처리된다. 로컬(셰임=일반 객체)에서는 통과하고 CI(jsdom 실물=Proxy)에서만 깨지는 함정이다.
- 파일 I/O 는 `tests/e2e/fixtures.ts` 의 `installFsMock()` / `installFallbackMode()` 로 검증한다. 목 핸들은 이름별로 재사용되므로 `isSameEntry()` 중복 방지까지 실제와 같이 동작한다.
- Playwright 는 테스트마다 새 컨텍스트를 쓰므로 localStorage 가 자동 격리된다.

## 배포

| 브랜치 | 환경 | Worker | URL |
|--------|------|--------|-----|
| `dev` | dev | `markdown-editor-dev` | `*.workers.dev` |
| `main` | prod | `markdown-editor-prod` | `md-editor.devworld.co.kr` |

**`main`·`dev` 모두 브랜치 보호 규칙이 걸려 있다.** 직접 push 가 거부되므로 문서 한 줄 수정이라도 `feature/*` → PR → 머지 경로를 거쳐야 한다.

`.github/workflows/ci.yml` 한 파일에 `verify`(빌드+단위+E2E) → `deploy`(needs: verify) 두 잡. **CI 는 Node 24 를 써야 한다** — jsdom 30 → undici 8 이 Node >=22.19 를 요구해 Node 20 에서는 vitest 가 기동하지 못한다. 배포는 `cloudflare/wrangler-action` 대신 `npx wrangler` 직접 호출 (액션 번들 wrangler 3.x 는 `wrangler.jsonc` 를 못 읽는다). `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 시크릿은 등록 완료. **커스텀 도메인은 첫 prod 배포 때 생성되므로 `main` 에 병합되기 전까지 서비스되지 않는다.**

## 문서 관리 (필수)

모든 프로젝트 문서는 `docs/` 하위에 있으며 인덱스는 `docs/README.md` 다.

**코드를 변경하면 같은 작업 안에서 대응 문서를 반드시 갱신한다.** 판단 기준은 `docs/architecture/traceability.md` 의 "변경 영향도" 표다. 요약:

| 변경 대상 | 갱신 문서 |
|-----------|-----------|
| `src/tabs.ts` (`TabState`) · `src/storage.ts` (세션 스키마) | `docs/architecture/data-model.md`, `docs/architecture/traceability.md` |
| `src/fileOps.ts` · `src/shortcuts.ts` · `src/notice.ts` | `docs/api/browser-apis.md` |
| `src/swUpdate.ts` · `public/sw.js` (생명주기) | `docs/architecture/service-architecture.md` §7.2, `docs/api/browser-apis.md` §4.1 |
| `vite.config.ts` 빌드 ID 플러그인 | `docs/architecture/infrastructure.md` §3.2 |
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

1. 폴백 브라우저(Safari·Firefox)의 기능 한계를 사용자에게 알리는 UI 가 없다 (F-58).
2. `fileOps.ts` 커버리지 5.26% — 파일 I/O 분기는 데이터 유실과 직결되는데 단위 안전망이 없다 (F-47 잔여).
3. PWA 아이콘이 SVG 단일 — iOS 홈 화면 품질 (F-68).
4. Safari·Firefox 는 덮어쓰기·중복 탭 방지가 불가능하나 이를 안내하는 UI 가 없다 (F-11, F-58).
5. 용량 초과 후 오래된 탭을 자동 회수하지 않아 자동 저장이 멈춘 상태로 유지된다 (F-54 잔여).
