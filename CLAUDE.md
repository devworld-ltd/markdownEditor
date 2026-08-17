# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

바닐라 TypeScript로 만든 **웹 기반 마크다운 에디터**. 프레임워크 없이 순수 TypeScript + DOM API를 사용하며, `marked` + `DOMPurify` 로 마크다운을 안전한 HTML로 변환한다. 다이어그램(F-74)에만 `mermaid` 를 **지연 로드**한다 — 문서에 ```mermaid 블록이 없으면 내려받지 않는다. Cloudflare Workers 에 정적 자산으로 배포한다.

**공유 링크(F-60)를 제외하면** 서버·데이터베이스·네트워크 호출이 없다. 편집·저장·프리뷰·내보내기·인쇄는 전부 브라우저 안에서 끝나고, 문서는 사용자 브라우저(localStorage)와 로컬 디스크에만 존재한다.

**F-60 이 이 성격을 부분적으로 바꿨다.** 공유 버튼을 누를 때만 `POST /api/share` 가 나가고, 그 문서는 Cloudflare R2 에 저장된다. `wrangler.jsonc` 에 `main`(Worker 진입점)과 R2 바인딩이 생긴 것도 이 때문이다. 공유를 쓰지 않는 사용자에게는 여전히 네트워크 요청이 **한 건도 없다**(E2E `SH8` 이 이를 단언한다).

> **v2.0.0 에서 방향이 바뀌었다.** v1.x 는 macOS 네이티브 앱(SwiftUI + WKWebView)이었고, Xcode 프로젝트·`build.sh`·DMG·JS↔Swift 브리지(`window.webkit`/`window._bridge`)·`app://` 스킴이 있었다. 이 모두가 제거됐으므로 **오래된 문서나 커밋을 참고할 때 주의한다.** 전환 내역: `docs/history/2026-08-12-web-pivot.md`

## 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | Vite 개발 서버 (`http://127.0.0.1:5173`) |
| `npm run build` | TypeScript 컴파일 + Vite 빌드 (→ `dist/`) |
| `npm run preview` | 빌드 결과물 미리보기 |
| `npm run typecheck` | 타입 검사 (앱 + Worker 각각) |
| `npm test` | 단위 테스트 (vitest, jsdom) |
| `npm run test:watch` | 워치 모드 |
| `npm run test:coverage` | 단위 + v8 커버리지 |
| `npm run test:e2e` | E2E (playwright, dev 서버 자동 기동) |
| `npx vitest run tests/parser.test.ts` | 단일 단위 테스트 |
| `npx playwright test tests/e2e/tabs.spec.ts` | 단일 E2E 파일 |
| `npm run cf:dev` | 로컬 workerd 런타임으로 `dist/` 서빙 |
| `npm run deploy:dev` / `deploy:prod` | Cloudflare Workers 배포 |
| `npm run release` | 커밋 메시지로 다음 버전 계산 + `package.json`·`CHANGELOG.md` 갱신 |
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
- **`parser.ts`** — `marked`(GFM + breaks + 각주·정의 목록 확장) → **`DOMPurify.sanitize()`**. DOM 비의존 순수 모듈.
- **`tabs.ts`** — 멀티 탭 상태(`Map<string, TabState>`) + 탭바 렌더 + 타이틀 + localStorage 세션 영속화.
- **`storage.ts`** — localStorage 세션 저장/복원. 스키마 버전 검증·손상 데이터 필터·접근 불가 감지.
- **`fileOps.ts`** — 파일 I/O 2경로 분기. FS Access API(Chrome·Edge) ↔ `<input type=file>` + Blob 다운로드(Safari·Firefox).
- **`notice.ts`** — 사용자에게 보이는 성공·오류 알림(`#notice`).
- **`swUpdate.ts`** — 서비스 워커 갱신 감지·알림·리로드(F-69). `SwUpdateHost` 주입형 **리프**라 앱 모듈을 import 하지 않는다(`tabs → notice → tabs` 순환 방지).
- **`offline.ts`** — 오프라인 상태 배지(F-70). 같은 주입형 리프 패턴(`OfflineHost`).
- **`fsLimitNotice.ts`** — 폴백 브라우저의 저장 동작 차이 안내(F-58). 같은 패턴. `fileOps.saveFileAs()` 폴백 분기에서 세션당 1회 호출된다.
- **`textEdit.ts`** — 툴바 텍스트 조작의 **문자열 계산만** 담당하는 순수 리프. DOM 삽입은 `toolbar.ts` 가 `execCommand` 로 한다.
- **`scrollSync.ts`** — 에디터 ↔ 프리뷰 양방향 스크롤 동기화(F-25). 주입형 리프. **블록 앵커**가 있으면 비율 대신 그것으로 맞춘다(#114).
- **`scrollAnchors.ts`** — 앵커 보간(#114). 순수. **개수가 다르면 포기**하고 비율로 되돌아간다.
- **`sourceLines.ts`** — 원문 최상위 블록의 시작 줄(#114). 순수. **HTML 을 만들지 않는 토큰은 세지 않는다.**
- **`anchorMeasure.ts`** — 앵커 y 측정(#114). 미러 **한 장**에 표식을 심어 한 번에 읽는다. **`data-generated` 블록(각주 절)은 세지 않는다**(#121). `tabs.ts` 는 `setScrollSyncHooks()` 로, `editor.ts` 는 `onAfterRender` 콜백으로 연결된다 — 양쪽 다 import 하지 않는다.
- **`public/`** — vite 가 `dist/` 루트로 복사한다. `_headers`(CSP·캐시), `manifest.webmanifest`, `icon.svg`, `sw.js`(서비스 워커).
- **`toolbar.ts`** — 버튼 26개 · **묶음 순서는 `GROUP_ORDER` 가 정한다**(#147). 배열 선언 순서가 아니라 그것이 화면 순서이고, 구분선은 묶음 경계에서 자동 생성된다 — 손으로 놓으면 버튼을 옮길 때 어긋나도 타입이 통과한다. 버튼 16개(파일 4 + 서식 12). `execCommand("insertText")` 로 undo 스택 보존. `fileOps` 를 import 하지 않고 `setFileActions()` 콜백을 주입받는다.
- **`mermaidView.ts`** — mermaid 다이어그램(F-74). 주입형 리프. **블록이 없으면 라이브러리를 받지 않는다**(지연 로드). 그린 SVG 도 같은 `sanitizeHtml()` 을 통과한다.
- **`markdownExtensions.ts`** — 각주·정의 목록(F-73). marked 확장. **정의 없는 참조는 각주가 아니다.**
- **`markdownHighlight.ts`** — 편집 영역 서식 계산(F-23 잔여·F-30 표). 순수. **태그를 걷어낸 텍스트가 입력과 정확히 같아야 한다** — 오버레이 정렬의 전제다. 그래서 `tableFormat.splitRow()`(칸을 trim 한다)를 렌더에 쓰지 않는다.
- **`editorOverlay.ts`** — 편집 하이라이팅 오버레이(F-23 잔여). 주입형 리프. **기본 꺼짐.**
- **`sessionReclaim.ts`** — 용량 초과 회수 규칙(F-54). 순수. **더티 탭의 내용은 절대 버리지 않는다.**
- **`dropFiles.ts`** — 드롭 파일 분류(F-56). 순수. **확장자가 1순위** — `.md` 의 MIME 타입은 환경마다 다르다.
- **`tableFormat.ts`** — 표 계산(F-30). 순수. **표시 폭**(한글·이모지 2칸)으로 파이프를 맞춘다.
- **`tableUi.ts`** — 표 대화상자(F-30). 커서가 표 안이면 편집, 밖이면 삽입. 미리보기와 삽입 결과는 **같은 `currentBlock()`** 에서 나온다(#150).
- **`tablePreview.ts`** — 표 미리보기(#150). 순수 리프. **마크다운을 만들지 않고 `<table>` 로 그린다** — 세로줄은 브라우저가 맞춘다. 칸은 `textContent` 로만 넣는다.
- **`docStats.ts`** — 문서 통계 계산(F-29). 순수. **한국어에서는 "단어" 가 아니라 "어절" 이라고 쓴다** — 공백으로 자른 결과에 정확히 맞는 이름이다.
- **`menuPopover.ts`** — 툴바 더보기 팝오버(F-81). 주입형 리프. **`<dialog>` 가 아니므로** Esc·포커스 복귀·화살표 이동을 직접 만든다. 구분선은 `aria-hidden` 이라 항목으로 세지 않는다.
- **`saveState.ts`** — 저장 상태 표시(#148). 주입형 리프. **통계와 다른 경로로 갱신한다** — 통계는 150ms 디바운스에 얹혀 있지만 저장 상태는 dirty 가 바뀔 때만 달라진다.
- **`caretPosition.ts`** — 커서 행·열 계산(#152). 순수. `lineStartOffsets()` 재사용 + **이진 탐색**. 실측표가 머리에 있다.
- **`caretStatus.ts`** — 커서 위치 표시(#152). 주입형 리프. **`selectionchange` 하나만 듣는다** — 렌더 디바운스에 얹지 않는다.
- **`statusBar.ts`** — 통계 표시(F-29). 주입형 리프.
- **`imageUpload.ts`** — 이미지 형식·크기·키 검증(F-28). 순수. **Worker 와 브라우저가 함께 쓴다.**
- **`editorDrop.ts`** — 드롭·붙여넣기(F-28). 주입형 리프. **드롭 처리는 여기 한 곳뿐이다.**
- **`editorKeys.ts`** — 목록 이어쓰기·들여쓰기 **계산만** 담당하는 순수 리프(F-26·F-27).
- **`editorBehavior.ts`** — 편집 키 배선(F-26·F-27). 주입형 리프.
- **`lineNumbers.ts`** — 줄 번호(F-24). 주입형 리프. **줄별 표시 높이를 재서** 칸 높이를 잡는다 — 균등 간격은 줄바꿈에서 곧바로 어긋난다.
- **`highlight.ts`** — 코드 하이라이팅 토크나이저(F-23). 순수 모듈. **의존성 0** — 라이브러리를 들이지 말 것. 출력은 `<span class>` 뿐이다.
- **`shareId.ts`** — 공유 ID·검증(F-60). **Worker 와 브라우저 양쪽에서 쓰인다** — DOM 도 Node API 도 만지지 않고 `crypto.subtle` 만 쓴다.
- **`share.ts`** — 공유 클라이언트(F-60). 주입형 리프. **이 앱에서 유일하게 네트워크를 타는 모듈**이다.
- **`worker/index.ts`** — 공유 API Worker(F-60). `tsconfig.worker.json` 으로 따로 타입 검사한다.
- **`clipboardExport.ts`** — 클립보드 복사(F-40). 주입형 리프. **`text/html` 과 `text/plain` 을 함께** 넣어야 한다.
- **`recentFiles.ts`** — 최근 파일 목록 계산만 담당하는 순수 리프(F-36).
- **`handleStore.ts`** — 파일 핸들 보관소(#125). IndexedDB 는 **구조화 복제**라 핸들을 그대로 담는다 — JSON 이 안 되는 것과 다른 이야기다. 권한은 따로이며 **사용자 제스처 안에서만** 물을 수 있다.
- **`recentFilesUi.ts`** — 최근 파일 `<dialog>`(F-36). 주입형 리프.
- **`manualToc.ts`** — 설명서 차례 계산(#151). 순수. **차례는 그려진 본문의 `h2` 에서 만든다** — 손으로 적으면 절을 더할 때 조용히 낡는다. 끝까지 내리면 마지막 절로 친다.
- **`manualView.ts`** — 사용 설명서 `<dialog>`(#141). 주입형 리프. 본문은 **`parseMarkdown()` 을 거친다**(F-18). 원문은 `docs/manual.md` — 빌드 시각 번들.
- **`launchFiles.ts`** — OS 파일 연결로 실행됐을 때(#135). 주입형 리프. **핸들을 그대로 `openFileFromHandle` 에 넘긴다** — 직접 읽으면 중복 탭 방지·최근 목록·핸들 보관을 다시 구현하게 된다.
- **`releaseNotes.ts`** — 릴리스 노트 계산(#131). 순수. **버전 비교는 자리별 숫자로** — 사전순이면 `2.10.0 < 2.9.0` 이 되어 큰 갱신에서만 틀린다.
- **`releaseNotesUi.ts`** — 새 소식 `<dialog>`(#131). 주입형 리프. 본문은 **`parseMarkdown()` 을 거친다**(F-18).
- **`editorPrefs.ts`** — 편집 글꼴·크기 계산만 담당하는 순수 리프(F-35). **웹폰트 금지** — 네트워크 요청이 없는 앱이고 CSP 가 `font-src 'self' data:` 다.
- **`editorSettings.ts`** — 편집 설정 `<dialog>`(F-35). 주입형 리프.
- **`tabOrder.ts`** — 탭 재정렬 인덱스 계산만 담당하는 순수 리프(F-34).
- **`htmlExport.ts`** — HTML 내보내기 조립(F-38). 순수 모듈. **마크다운을 파싱하지 않는다** — 정화된 HTML 을 받아 감싸기만 한다.
- **`formatBar.ts`** — 좁은 화면 서식 바(#155). 주입형 리프. **툴바 액션을 그대로 실행한다**(`toolbarActionByLabel`) — 서식 계산을 다시 구현하면 좁은 화면에서만 다른 결과가 난다. 보이고 숨는 조건은 CSS 가 정한다.
- **`virtualKeyboard.ts`** — 가상 키보드가 가린 높이(#155). 순수. **음수를 만들지 않는다** — 확대 중에 음수가 나오면 바가 화면 밖으로 나간다.
- **`viewMode.ts`** — 보기 모드(F-33). 주입형 리프. **버튼 클릭은 듣지 않는다** — 툴바가 이미 다루므로 중복하면 한 번 눌러 두 단계 넘어간다. 다만 **세그먼트(#154)는 툴바가 다루지 않으므로 여기서 듣는다.** 좁은 화면(≤520px)에서는 분할이 `editor` 로 접히는데 **저장하는 값은 그대로다** — 상태는 한 벌이다.
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
6. **파일 핸들은 JSON 으로 직렬화할 수 없다.** 그래서 세션 복원 탭은 항상 `handle: null` 이며 저장 시 위치를 다시 묻는다. **다만 IndexedDB 에는 담긴다**(구조화 복제) — `handleStore.ts` 가 그 경로이고, 최근 목록(F-36)은 그것으로 새로고침 뒤에도 바로 연다(#125). 되살린 핸들은 **권한이 따라오지 않으므로** `requestPermission()` 을 거쳐야 하고, 그 호출은 **클릭 핸들러 안**이어야 한다 — 제스처 밖에서는 조용히 거부된다.
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
33. **내보내기에서 원문을 다시 파싱하지 말 것.** `htmlExport.ts` 는 프리뷰에 이미 들어간 **정화된** HTML 만 받는다. 두 번째 파싱 경로를 만들면 정화 정책이 갈라지고 한쪽만 갱신되는 순간 F-18 이 뚫린다 — 내보낸 파일은 남이 열기 때문에 앱 안보다 위험하다. 단, **제목은 파일명에서 오므로 DOMPurify 를 거치지 않는다** → `escapeHtmlText()` 로 직접 막는다.
34. **`exportFile()` 은 탭 상태를 건드리지 않는다.** 내보내기는 저장이 아니다. 탭이 `note.html` 을 가리키게 되면 다음 `Cmd+S` 가 마크다운 원문을 `.html` 에 덮어쓴다.
35. **`Cmd/Ctrl+P` 는 가로채지 않는다.** 브라우저 인쇄가 곧 원하는 동작이라 가로채면 대화상자 취소·미리보기만 잃는다. PDF 라이브러리도 넣지 말 것 — "PDF 로 저장" 은 인쇄 대화상자 안에 이미 있다. **인쇄 스타일은 `#preview` 를 `!important` 로 되살려야 한다** — 편집 전용 모드(F-33)에서 인쇄하면 빈 종이가 나온다.
36. **자동 접근성 점검(axe) 통과가 "쓸 수 있다" 를 뜻하지 않는다.** 이 저장소의 탭은 axe 를 통과하면서도 **키보드로 전환이 불가능**했다(`<div>` + 클릭 핸들러). 새 UI 를 추가하면 `a11y.spec.ts` 의 상태 목록에 넣고, **키보드 도달·포커스 가시성·상태 전달**은 별도 시나리오로 확인하라.
37. **색을 토큰화할 때 링크를 빠뜨리지 말 것.** F-57 이 표면·본문은 토큰화했지만 링크를 놓쳐, 다크에서 UA 기본 `#0000ee` 가 대비 **1.37:1** 로 떨어졌다. `:visited` 도 함께 지정해야 한다 — UA 는 방문한 링크에 다른 색을 쓴다.
38. **`dragover` 에서 `preventDefault()` 를 빼지 말 것.** 브라우저가 "놓을 수 없음" 으로 판정해 `drop` 이 **아예 발생하지 않는다**. 합성 `DragEvent` 로는 이 결과가 재현되지 않으므로, 테스트는 `dragover` 가 **취소됐는지 자체**를 단언한다.
39. **탭 순서는 `Map` 의 삽입 순서다.** 재정렬은 비우고 다시 넣는 것이고, 세션 영속화가 그 순서를 그대로 쓴다. 재구성 중 하나라도 빠지면 **원본으로 되돌린다** — 탭이 사라지는 것보다 순서가 그대로인 편이 낫다.
40. **F-35 글꼴·크기는 편집 영역에만 적용한다.** 프리뷰까지 바꾸면 내보내기(F-38)·인쇄(F-39) 결과가 사람마다 달라진다 — 그건 문서를 받는 쪽의 몫이다. CSS 폴백값(`var(--editor-font-size, 14px)`)을 지우지 말 것 — 설정 모듈이 실패해도 편집기는 떠야 한다.
41. **최근 목록에 문서 내용을 넣지 말 것.** localStorage 용량을 세션 저장과 다투게 되고, 그러면 **자동 저장이 먼저 죽는다**. 이름과 시각만 저장한다. 그리고 **핸들이 살아 있는지를 항목마다 표시**해야 한다 — 구분하지 않으면 사용자는 목록을 눌렀는데 파일 선택 창이 뜨는 것을 버그로 받아들인다(트랩 #6).
42. **클립보드 복사는 `text/plain` 대체본을 반드시 함께 넣는다.** 서식을 모르는 곳(터미널·코드 편집기·plain 메일)에 붙이면 **태그가 날것 그대로** 들어간다. 대체본은 마크다운 원문이다. 그리고 **무엇이 복사됐는지 정확히 알려라** — "복사됨" 만 띄우면 붙여넣고 나서야 서식이 없다는 걸 알게 된다.
43. **클립보드 E2E 는 폴링해야 한다.** 쓰기가 비동기라 클릭 직후 읽으면 비어 있어, 기능이 멀쩡한데도 실패한다.
44. **정적 자산 계층은 Worker 보다 **먼저** 요청을 가로챈다.** `not_found_handling: single-page-application` 이면 매칭되는 자산이 없는 GET 이 곧바로 `index.html` 로 응답되고 **Worker 코드는 실행조차 되지 않는다**. `assets.run_worker_first` 로 API 경로를 지정해야 한다. 실제로 이것 없이 배포해 `GET /api/share/<id>` 가 마크다운 대신 앱 HTML 을 돌려준 적이 있다 — **POST 는 자산 계층이 다루지 않아 통과했기 때문에 절반만 동작했다.**
45. **API 목(mock)을 쓰는 테스트는 배포 라우팅을 검증하지 못한다.** 단위 473건·E2E 253건이 전부 통과한 상태에서 위 결함이 실물 배포에서만 드러났다. 그래서 `scripts/healthcheck.sh` 가 **공유 API 왕복**을 확인한다 — 그리고 **캐시를 우회해야 한다**(공유 응답은 `immutable` 이라 엣지가 대신 답하면 라우팅이 깨져도 통과한다).
46. **Worker 코드는 `tsconfig.worker.json` 으로 따로 검사한다.** 처음에는 `worker/` 가 `tsconfig.json` 의 `include` 밖에 있어 **타입 검사를 전혀 받지 않았다.** `npm run typecheck` 가 둘 다 돌리고, `npm run build` 가 그것을 부른다.
47. **하이라이팅 출력은 `<span class>` 뿐이어야 한다.** `style`·이벤트 속성을 넣기 시작하면 DOMPurify 허용 목록을 계속 열어야 하고 F-18 이 약해진다. `class` 는 DOMPurify **기본 허용**이라 `ADD_ATTR` 이 필요 없다(넣었다가 불필요함을 확인하고 지웠다). 토크나이저는 **문자 단위 선형 스캔**을 유지하라 — 정규식 대안으로 바꾸면 ReDoS 가 들어온다.
48. **토큰 색은 표면마다 다시 재야 한다.** 같은 값이 프리뷰 코드 배경(`#f4f4f4`)에서는 AA 를 통과하고 **편집 표면(#f2f2f0)에서는 미달**일 수 있다(F-23 잔여에서 실제로 4.46:1 이 나왔다). 그리고 토큰 색을 바꾸면 네 곳을 모두 고쳐야 한다: `:root`(라이트) · `prefers-color-scheme: dark` · `@media print` · `htmlExport.ts`. 한 곳만 고치면 그 환경에서만 대비가 깨지고, 다크·인쇄는 눈으로 잘 안 본다.
49. **F-32 분할 비율의 대상은 `#editor` 가 아니라 `.editor-pane` 이다** (F-24 이후). 줄 번호 칸을 포함한 상자를 조절해야 비율이 맞는다. F-33 보기 모드·F-39 인쇄의 숨김 대상도 이 상자다.
50. **`initLineNumbers()` 는 `createEditor()` 보다 먼저 호출한다.** `onAfterRender` 가 이를 참조하는데 `createEditor` 가 최초 렌더를 동기 수행하므로, 뒤에 두면 TDZ 오류가 난다 — **화면은 뜨지만 콘솔에만 남아** 눈으로는 안 보인다.
51. **Tab 을 무조건 가로채지 말 것.** 키보드 사용자가 편집 영역에 **갇힌다**(F-59). `Esc` 뒤의 **첫 Tab 한 번**은 포커스 이동으로 돌려준다 — 영구히 끄면 다시 켜는 방법을 사용자가 알 수 없다.
52. **목록 이어쓰기는 빈 항목에서 표식을 지워야 한다.** 계속 이어 쓰기만 하면 사용자가 목록을 빠져나갈 방법이 없다 — 편의 기능이 오히려 가둔다.
53. **조합 입력(IME) 중에는 Enter 를 가로채지 말 것.** 한글·일본어 조합에서 Enter 는 글자를 확정하는 키다. `isComposing` 과 `keyCode === 229` 둘 다 확인한다.
54. **SVG 업로드를 허용하지 말 것.** SVG 는 스크립트를 담을 수 있는 **문서**다. 우리 오리진 URL 을 갖게 되면 사용자가 직접 열었을 때 **우리 오리진에서 스크립트가 실행되고**, 공유 링크(F-60)와 합쳐지면 문서가 털린다. 헤더로 막을 수도 있지만 헤더 하나가 빠지면 조용히 뚫린다 — 래스터만 받으면 그 경로가 아예 없다.
55. **드롭 처리는 `editorDrop.ts` 한 곳에서만.** 두 곳에서 `drop` 을 들으면 서로를 가려 어느 쪽이 이길지 예측할 수 없다. F-56 은 `handleOtherFiles` 로 연결된다. 그리고 `dragover` 에서 `preventDefault` 를 빼면 브라우저가 파일을 그냥 열어 **편집 중인 문서가 통째로 사라진다.**
56. **통계 표시에 `aria-live` 를 붙이지 말 것.** 글자를 칠 때마다 스크린리더가 숫자를 읽어 **편집이 불가능해진다.** `role="status"` 도 같은 이유로 안 된다 — 암묵적으로 `aria-live="polite"` 다. 대신 **`<footer>`(contentinfo) 로 둔다**: 랜드마크 밖의 콘텐츠는 axe `region` 위반이라 `<div>` 로 두면 a11y E2E 8건이 깨진다. 그리고 통계는 렌더 디바운스에 얹어라 — 매 글자마다 전체를 훑으면 큰 문서에서 타이핑이 느려진다.
57. **`<dialog>` 가 `showModal()` 로 열린 동안 바깥 요소는 inert 다.** 그 상태에서 `editorEl.focus()` + `execCommand` 는 **예외 없이 조용히 무시된다.** 대화상자를 먼저 닫고 본문을 고쳐라. jsdom 은 inert 를 구현하지 않아 **단위 테스트로는 절대 안 잡힌다** — E2E 가 필요하다.
58. **표 정렬은 `align` 속성으로 나온다.** marked 가 `<td align="right">` 를 내는데, 표현 속성은 CSS 규칙(`#preview td { text-align: left }`)보다 약하다. `[align]` 선택자를 따로 쓰지 않으면 정렬 기능이 **통째로 안 보인다**(오류 없이).
59. **표시 폭은 `length` 가 아니다.** 한글은 `length` 1 에 2칸, 이모지는 `length` 2 에 2칸 — 두 방향으로 틀린다. `tableFormat.displayWidth()` 를 써라.
60. **`getAsFileSystemHandle()` 은 드롭 이벤트 처리 중에 불러야 한다.** `DataTransferItem` 은 핸들러가 끝나면 비워져, 나중에 부르면 빈손이 된다(오류 없이). 반환값은 Promise 라 `await` 는 뒤에서 해도 된다. 그리고 **E2E 에서 항목에 메서드를 붙이지 말 것** — `transfer.items[i]` 는 접근할 때마다 새 래퍼를 준다. `DataTransferItem.prototype` 을 갈아끼워야 한다.
61. **`.md` 의 MIME 타입을 믿지 말 것.** `text/markdown`·`text/plain`·**빈 문자열** 전부 나온다(맥에서 흔하다). 확장자를 1순위로 본다. 반대로 이미지는 타입을 믿는다 — 업로드 검증이 타입 기준이라 확장자만 고친 파일을 통과시키면 안 된다.
62. **세션 회수는 "저장된 사본" 만 비운다.** 편집기의 내용은 건드리지 않는다 — 그래서 이번 세션에서는 아무것도 잃지 않는다. 대상은 **깨끗하고·활성이 아니고·파일 이름이 있고·내용이 있는** 탭뿐이고, **탭 자체는 닫지 않는다.** 다 비워도 저장이 안 되면 **회수하지 않은 것으로 보고**한다(공간도 못 벌면서 사본만 잃는 최악을 피한다).
63. **세션 스키마에 필드를 더할 때는 선택 필드로.** `SCHEMA_VERSION` 을 올리면 기존 세션이 통째로 폐기된다(F-55) — 편의 기능을 넣으려다 사용자 문서를 잃는다.
64. **용량 초과 E2E 는 초기 세션을 `addInitScript` 에서 심어야 한다.** 나중에 심고 `reload()` 하면 **이전 페이지의 `beforeunload` 저장이 그 위를 덮어써** 복원할 것이 사라진다.
65. **오버레이는 글자를 더하거나 빼면 그 즉시 못 쓰게 된다.** 표식을 감추지 말고 흐리게만 칠하라. 정렬을 깨는 것들: **탭 폭**(한쪽만 명시하면 UA 기본 8 과 갈린다) · **마지막 빈 줄**(`pre-wrap` 은 끝 개행을 접는다 → 하나 덧붙인다) · 줄 번호 칸(폭을 CSS 에 다시 적지 말고 `offsetLeft` 로 재라).
66. **오버레이 E2E 에서 높이를 비교할 때는 내용이 창보다 길어야 한다.** 짧으면 두 높이가 모두 창 높이로 잘려, 어긋나 있어도 같아 보인다.
67. **오버레이가 켜지면 `::selection` 배경은 반투명이어야 한다.** 보이는 글자가 뒤 레이어의 것이라, 불투명한 선택 사각형은 **선택한 순간 글자를 지운다** — 검색(F-22)이 일치를 선택으로 보여주므로 찾은 자리만 안 보이게 된다.
68. **오버레이 스크롤 단언은 두 프레임 안에 끝내라.** 폴링으로 여유를 주면 150ms 렌더 디바운스가 대신 맞춰 줘서 **스크롤 리스너를 통째로 지워도 통과한다**(실제로 그랬다). 트랩 #16 의 오버레이 버전이다.
69. **`switchTab()` 은 편집기 렌더 디바운스를 타지 않는다.** `renderPreview()` 를 직접 부르므로, 그 디바운스에 얹은 것(줄 번호·통계·하이라이팅)은 **탭을 바꾸면 이전 문서의 화면으로 남는다.** `setTabRenderListener()` 로 함께 갱신하라. 글꼴·크기 변경(F-35)도 같은 이유로 오버레이 갱신이 필요하다 — 번호 칸 폭이 달라지면 편집기가 옆으로 밀린다.
70. **marked 확장의 `start()` 에 `^` 앵커를 쓰지 말 것.** marked 는 `src.slice(1)` 을 넘기므로 잘려 나간 첫 글자 뒤가 문자열의 처음이 되어 **줄 한가운데서도 `^` 가 맞는다.** 실제로 `가[^b] 나` 의 `[^b]` 가 줄머리로 잡혀 문단이 `가<br>[^b] 나` 로 두 동강 났다. 줄바꿈(`\n`)을 명시적으로 요구하고 인덱스에 +1 하라.
71. **렌더가 덧붙인 블록에는 `data-generated` 를 달아라(#121).** 앵커는 원문 블록과 프리뷰 자식을 1:1 로 짝짓기 때문에, **원문에 없는 블록이 하나만 끼어도 대응표 전체가 버려지고** 그 문서만 조용히 예전 비율 동기화로 돌아간다(각주 문서에서 28~54px 어긋났다). 새 블록을 렌더에서 만들 때마다 이 표식을 확인하라.
72. **스크롤 동기화는 비율이 아니라 블록 앵커로 맞춘다(#114).** 비율은 값만 비례할 뿐 **보이는 줄이 어긋난다** — 두 패널의 높이 분포가 다르기 때문이다. 앵커 개수가 어긋나면(각주 절처럼) **포기하고 비율로 되돌아간다**; 틀린 대응표는 안 맞추느니만 못하다. 그리고 앵커는 **렌더 뒤 한 번만** 재라 — 스크롤 경로에서 재면 큰 문서가 즉시 느려진다.
73. **mermaid 라벨은 `htmlLabels: false` 여야 보인다(F-74).** 기본값은 `<foreignObject>` 인데 **DOMPurify 가 그것을 지운다** — 도형만 남고 글자가 사라진다. 그리고 **최상위와 다이어그램별 설정을 모두** 꺼야 한다: `flowchart.htmlLabels` 만 끄면 클러스터 라벨은 나오고 노드 라벨만 사라진다.
74. **지연 로드 E2E 는 네트워크 리스너를 `goto` 앞에 붙여라.** 뒤에 붙이면 앱 기동 때 나가는 요청을 통째로 놓쳐, 지연 로드를 없애도 통과한다(실제로 그랬다).
75. **릴리스 노트를 받아오지 말 것(#131).** `CHANGELOG.md` 는 **빌드 시각에 가상 모듈(`virtual:release-notes`)로 번들에 들어간다.** `fetch("/releases.json")` 하나면 이 앱의 "공유 외 네트워크 요청 0건" 이 깨지고 E2E `SH8` 이 죽는다. 그리고 **커밋되는 생성 `.ts` 로 만들지 말 것** — 재생성을 잊으면 빌드도 테스트도 통과하면서 화면만 옛 내용으로 남는다(트랩 #22 의 아이콘 사고와 같은 구조).
76. **`addInitScript` 는 내비게이션마다 다시 실행된다.** "한 번만 일어나는 일" 을 검증하는데 초기 상태를 그것으로 심으면, 새로고침할 때 값이 되살아나 **영원히 첫 번째**가 된다(#131 RN6 이 그것 때문에 실패했다). 그런 검증에서는 `page.evaluate()` 로 심고 새로고침하라. 반대로 **`beforeunload` 가 덮어쓰는 값**(세션)은 트랩 #64 대로 `addInitScript` 여야 한다 — 두 경우를 헷갈리지 말 것.
77. **버전을 올리는 것은 CI 가 아니라 승격 PR 이다(#131).** `main`·`dev` 는 브랜치 보호라 **CI 가 되밀어 push 할 수 없다.** `npm run release` 가 PR 안에서 `package.json`·`CHANGELOG.md` 를 고치고, CI 는 머지된 결과를 읽어 **태그와 GitHub Release 만** 만든다. 그리고 **문서·잡무만 있는 배포는 버전을 올리지 않는다** — 빈 새 소식이 반복되면 사용자가 알림을 무시하게 된다.
78. **파일 I/O 를 진짜로 검증하려면 목 핸들로는 안 된다(#125).** `installFsMock()` 의 핸들은 **메서드를 가진 평범한 객체**라 구조화 복제가 아예 안 된다(`DataCloneError`) — 그것으로 "핸들을 보관한다" 를 검증하면 통과해도 아무것도 증명하지 못한다. OPFS(`navigator.storage.getDirectory()`)는 **파일 선택 창 없이 실물 핸들**을 주므로 이 전제를 진짜 객체로 확인할 수 있다(`installRealHandleMock()`).
79. **파일에 쓴 직후 디스크를 한 번만 읽지 말 것.** 쓰기는 스왑 파일을 거쳐 커밋되므로, 알림이 뜬 직후 읽으면 **새 내용 뒤에 옛 꼬리가 남은 중간 상태**가 보인다(실측: 5회 중 2회). 폴링하라 — 트랩 #43(클립보드)과 같은 성격이다.
80. **세션이 복원해 둔 내용을 "파일이 열렸다" 의 증거로 쓰지 말 것(#125).** 새로고침 뒤 탭에는 같은 글이 이미 들어 있어 `toHaveValue(...)` 가 **곧바로 참**이 된다. 그 상태에서 고쳐 쓰면 새 탭이 뜨며 덮어써 **저장되는 것은 옛 내용**이다(실측: 5회 중 2회). 탭 개수·활성 탭 이름처럼 **파일 열기만이 만드는 변화**를 기다려라.
81. **`window.launchQueue` 는 대입으로 갈아끼워지지 않는다(#135).** 플랫폼이 제공하는 속성이라 Chromium 이 자기 것을 되돌려 준다 — **대입 직후에는 바뀐 것처럼 보이지만** 앱이 읽을 때는 원래 것이 와서, 소비자가 영영 불리지 않는다. 기능이 멀쩡한데 테스트만 실패하므로 원인을 코드에서 찾게 된다. `Object.defineProperty` 로 심어라 (트랩 #60 의 `DataTransferItem.prototype` 과 같은 성격).
82. **PWA 파일 연결은 자동 테스트로 끝까지 확인할 수 없다(#135).** Finder "다음으로 열기" 목록은 macOS Launch Services 가 만들고, 헤드리스 Chromium 에는 그것이 없다. 검증할 수 있는 것은 **매니페스트 선언과 `launchQueue` 배선까지**다 — 실제 등록 여부는 PWA 를 설치한 실기기에서 확인한다.
83. **릴리스 기준 태그를 `git describe` 로 찾지 말 것(#131).** 그것은 **HEAD 의 조상**에 붙은 태그만 본다. 이 저장소는 태그를 `main` 의 머지 커밋에 붙이고 릴리스 계산은 `dev` 에서 하므로 태그가 dev HEAD 의 조상이 아니고, `describe` 는 **영영 아무것도 못 찾는다** — 그러면 전체 이력을 훑어 **이미 릴리스된 것까지 CHANGELOG 에 다시 싣는다**(실측: v2.1.0 이 있는데도 기준 태그 없음 · 커밋 91건). `git tag --list` 에서 **버전 순으로 직접 고른다.**
84. **`<dialog>` 에 `display` 를 무조건 주지 말 것(#141).** 닫혀 있을 때 UA 가 `display: none` 으로 숨기는데, `display: flex` 를 그냥 주면 그것을 덮어써 **닫아도 사라지지 않는다.** 기능은 멀쩡하고 화면만 안 닫히므로 원인을 JS 에서 찾게 된다. `dialog[open]` 으로 한정하라.
85. **툴바·탭바 색은 토큰이다(#146).** 예전에는 `#1e1e1e`·`#252526` 하드코딩이라 **라이트 모드에서도 검은 띠**로 남았다. `--surface-chrome`(툴바)·`--surface-tabbar`(탭바)로 나뉘어 있고 **둘을 한 색으로 합치지 말 것** — F-72 의 명도 계단(툴바 < 탭바 < 에디터 < 프리뷰)을 D3 E2E 가 단언한다.
86. **`--text-faint` 를 글자에 쓰지 말 것(#146).** 라이트 툴바 표면에서 `--text-muted` 가 이미 4.67 이라 **그보다 옅으면서 AA 를 넘는 값이 없다.** 세 번째 글자 단계는 존재할 수 없으므로 라벨도 `--text-muted` 를 쓴다. faint 는 아이콘·구분선 전용(3:1)이다.
87. **의도적 버그를 되돌릴 때 `git checkout <파일>` 을 쓰지 말 것.** 그 파일의 **커밋되지 않은 변경 전체**가 함께 날아간다 — 주입한 한 줄만 되돌아가는 것이 아니다. 이 세션에서 두 번 당했고, 두 번째는 `main.ts` 의 배선이 통째로 빠진 채 커밋돼 **CI 에서야** 드러났다(로컬은 지우기 전에 통과했다). 주입 전에 `cp <파일> /tmp/…` 로 사본을 뜨고 `cp` 로 되돌린다.
88. **F-69 E2E 는 `E2E_PREVIEW=1` 에서만 돈다.** 서비스 워커가 `import.meta.env.PROD` 에서만 등록되기 때문. 이 가드를 테스트용으로 완화하면 원래 막으려던 "고쳤는데 안 바뀌는" 문제가 되살아난다.
89. **툴바에서 옮긴 기능은 이름을 들고 가야 한다(#149).** `부가` 묶음 6개를 더보기 팝오버로 옮겼더니 `.toolbar-btn[title="…"]` 을 쓰던 E2E 6개 파일이 한꺼번에 죽었다. 항목에 `data-action` 으로 **원래 이름을 남기고**, `fixtures.ts` 의 `clickToolbarAction()` 이 "툴바에 있으면 누르고 없으면 팝오버를 연다" 를 대신한다 — 그래야 **옮긴 것과 없앤 것이 구별된다**(없앤 기능은 여전히 실패한다).
90. **비모달 팝오버의 바깥 클릭은 `click` 으로 들어도 열리는 클릭이 자기를 닫지 않는다.** 트리거를 따로 걸러내기 때문이다 — 즉 `pointerdown`↔`click` 을 **테스트로 구별할 수 없다.** 대화상자(트랩 #25)와 달리 여기서는 규약 통일이 이유이지 필연이 아니다. 코드 주석에 필연인 것처럼 적으면 다음 사람이 없는 근거를 믿는다.
91. **미리보기는 삽입 결과와 같은 함수에서 나와야 한다(#150).** 각자 계산하면 "보이는 것과 넣은 것이 같다" 가 우연이 되고, 한쪽만 고치는 순간 조용히 갈라진다 — 그 갈라짐은 **넣어 본 사용자만** 발견한다. `makeTableBlock()` 이 단일 출처이고 단위 테스트가 `buildTable() === formatTable(makeTableBlock())` 을 고정한다.
92. **입력이 둘 이상인 화면에서 "즉시 반영" 을 한 번에 검증하지 말 것(#150).** 행과 열을 연달아 바꾸고 마지막에 단언하면 **한쪽 리스너를 통째로 지워도** 다른 쪽이 다시 그리며 통과한다(실측). 하나씩 바꾸고 그때마다 단언하라 — 트랩 #16 의 다입력 버전이다.
93. **대화상자 안의 목차 링크는 기본 동작을 막아야 한다(#151).** `href="#…"` 를 그냥 두면 주소에 해시가 남고, **그 주소를 새로고침하면 앱이 엉뚱한 자리에서 뜬다.** 화면은 멀쩡히 이동하므로 눈으로는 안 보인다 — E2E 는 스크롤이 아니라 **주소에 해시가 없는지**를 본다.
94. **`selectionchange` 는 작업(task)당 한 번으로 합쳐진다(#152).** 그래서 캐럿을 2000번 옮겨도 핸들러는 **한 번** 불린다 — 그 위에서 성능을 재는 E2E 는 캐시를 지워도 이진 탐색을 선형으로 바꿔도 **똑같이 통과한다**(실제로 그랬다). 계산 비용은 Node 벤치로 따로 재고, 그 숫자를 모듈 머리에 적어라. 그리고 구별되지 않는 최적화는 **"필요해서가 아니라 값이 싸서 둔다" 고 명시**한다.
95. **키 입력·클릭 리스너를 캐럿 갱신에 겹쳐 달지 말 것(#152).** `input`·`keyup`·`click` 셋 다 지워도 어떤 테스트도 실패하지 않는다 — 글자를 치는 것도 캐럿을 옮기는 것이라 결국 `selectionchange` 로 온다. 구별되지 않는 배선은 지운다.
96. **전환(transition) 중에 계산된 색을 읽지 말 것(#153).** 스위치를 켠 **직후** `getComputedStyle` 은 아직 이전 색을 준다 — 스타일이 멀쩡해도 테스트만 실패한다. `page.emulateMedia({ reducedMotion: "reduce" })` 로 `transition: none` 을 태우면 값이 곧바로 확정되고, 덤으로 움직임 줄이기 규칙까지 검증된다.
97. **스위치 모양은 `appearance: none` 이 만든다(#153).** 색과 손잡이만 단언하면 그 한 줄을 지워도 **전부 통과하면서 화면에는 네모 체크박스가 남는다**(실측). 요소는 `<input type="checkbox">` 를 유지해야 키보드·스크린리더가 공짜로 따라오므로, 단언은 **`type=checkbox` 이면서 `appearance: none`** 두 가지를 함께 본다.
98. **`#view-mode` 버튼을 `title` 로 고르지 말 것(#154).** `viewMode.paint()` 가 그 `title` 을 한국어 상태 이름(`분할 보기` 등)으로 덮어써서 `[title="View Mode"]` 셀렉터는 **한 번도 맞지 않는다** — CSS 는 조용히 무동작이 되고 테스트만 이유 없이 실패한다. `id` 가 안정적인 손잡이다.
99. **좁은 화면 경계는 720px 이 아니라 520px 이다(#154).** 720px 이하는 예전부터 **위아래 분할**이고 그 폭에서는 양쪽이 여전히 쓸 만하다 — 한 경계로 합치면 520~720px 에서 멀쩡하던 분할과 세로 리사이저가 함께 사라진다(실제로 E2E 3건이 그렇게 깨졌다). 휴대폰 폭에서만 분할을 없앤다.
100. **가상 키보드는 자동 테스트로 확인할 수 없다(#155).** 헤드리스 브라우저에 소프트 키보드가 없어서, "키보드 위에 붙는가"·"눌러도 키보드가 안 내려가는가" 는 실기기에서만 보인다. 대신 **계산은 순수 함수로 떼어 단위로 고정하고**, 포커스 유지는 결과가 아니라 **`pointerdown` 이 취소됐는지 자체**를 본다(트랩 #38 의 키보드 버전). 실기기 절차는 이슈 #155 댓글에 있다.
101. **`npm run release` 전에 `git fetch --tags` 를 하라(#155 승격 중 발견).** 태그는 `main` 의 머지 커밋에 붙고 릴리스 계산은 `dev` 에서 하므로, 승격 직후 로컬에는 방금 만들어진 태그가 없다. 그 상태로 돌리면 기준이 한 단계 낮게 잡혀 **이미 릴리스한 항목이 CHANGELOG 에 다시 실린다**(실측: v2.5.0 이 있는데 기준이 v2.4.0 이라 5건이 두 번 나왔다). `scripts/release.mjs` 가 이제 **기준 태그 < package.json 버전**이면 중단한다 — 트랩 #83 의 후속이다.
102. **"즉시 갱신" 단언은 한 번 읽기로 하지 말 것(#152 → prod 검증에서 발견).** `selectionchange` 는 작업(task)으로 큐에 들어가므로 입력 직후의 단 한 번 읽기는 도착 전일 수 있다 — 로컬에서 통과하고 **prod 검증에서만** 실패했다. 그렇다고 여유를 넉넉히 주면 디바운스에 얹어도 통과해 지키려던 것이 사라진다(트랩 #68). **디바운스보다 짧은 시한**(여기서는 100ms)을 주고 재시도하게 하라 — 안정성과 구별력을 함께 얻는다.

## 테스트

- **단위**: `tests/*.test.ts` (Vitest + jsdom) 61개 파일 · 1070건. 전체 커버리지 **81%**(구문). 자세한 표는 `npm run test:coverage`.
  - **0% 인 것**: `toolbar.ts`·`main.ts`(배선이라 E2E 가 맡는다) · `caretStatus.ts`·`formatBar.ts`(주입형 리프인데 단위가 없다 — 이 저장소의 패턴에서 벗어난 자리다).
  - 커버리지를 올리려면 테스트를 더 쓰지 말고 **의존 방향을 정리하라**(트랩 #15).
- **E2E**: `tests/e2e/*.spec.ts` (Playwright, Chromium) 49개 파일 · 512건. 로컬 dev 서버에서 약 15건이 skip 된다(`_headers`·서비스 워커는 원격에서만 검증).
- `vitest.config.ts` 가 `tests/e2e/**` 를 제외한다. **새 E2E 는 `.spec.ts`, 단위는 `.test.ts`.**
- `tests/setup.ts` 는 Node 22+ 의 `localStorage` 전역 예약 때문에 필요한 Storage 셰임이다. 지우면 `storage.test.ts` 가 깨진다.
- **`localStorage` 메서드를 스텁할 때는 `window.localStorage` 속성 자체를 `Object.defineProperty` 로 갈아끼워야 한다.** jsdom 의 Storage 는 Proxy 라 `localStorage.setItem = fn` 이 메서드 교체가 아니라 `"setItem"` 이라는 이름의 **항목 저장**으로 처리된다. 로컬(셰임=일반 객체)에서는 통과하고 CI(jsdom 실물=Proxy)에서만 깨지는 함정이다.
- 파일 I/O 는 `tests/e2e/fixtures.ts` 의 `installFsMock()` / `installFallbackMode()` 로 검증한다. 목 핸들은 이름별로 재사용되므로 `isSameEntry()` 중복 방지까지 실제와 같이 동작한다.
- Playwright 는 테스트마다 새 컨텍스트를 쓰므로 localStorage 가 자동 격리된다.

## 배포

| 브랜치 | 환경 | Worker | URL |
|--------|------|--------|-----|
| `dev` | dev | `markdown-editor-dev` | `md-editor-dev.devworld.co.kr` |
| `main` | prod | `markdown-editor-prod` | `md-editor.devworld.co.kr` |

**배포 검증 시 워크플로 실행은 SHA 로 특정한다.** 머지 직후에는 새 실행이 아직 만들어지지 않아 `gh run list --limit 1` 이 **이전 버전의 실행**을 준다. 그것이 `success` 라 배포가 끝난 줄 알고 넘어간 적이 있다(v2.3.0 승격). 헬스체크가 SHA 를 대조하는 덕에 드러났다:

```bash
SHA=$(git rev-parse origin/main)
RUN=$(gh run list --branch main --limit 5 --json databaseId,headSha \
      -q ".[] | select(.headSha==\"$SHA\") | .databaseId" | head -1)
```

**이슈는 수동으로 닫아야 한다.** PR 본문의 `Closes #N` 은 **기본 브랜치(`main`)로 머지될 때만** 동작하는데, 이 저장소는 `feature/*` → `dev` 로 머지하고 `dev` → `main` 은 별도 PR 이라 걸리지 않는다. prod 배포까지 끝나면 `gh issue close` 로 직접 닫는다 — 안 닫으면 완료된 작업이 백로그에 쌓여 **다음 사람이 이미 있는 기능을 다시 만든다**(실제로 이슈 #125 가 그럴 뻔했다).

**`main`·`dev` 모두 브랜치 보호 규칙이 걸려 있다.** 직접 push 가 거부되므로 문서 한 줄 수정이라도 `feature/*` → PR → 머지 경로를 거쳐야 한다.

`.github/workflows/ci.yml` 한 파일에 `verify`(빌드+단위+E2E) → `deploy`(needs: verify) 두 잡. **CI 는 Node 24 를 써야 한다** — jsdom 30 → undici 8 이 Node >=22.19 를 요구해 Node 20 에서는 vitest 가 기동하지 못한다. 배포는 `cloudflare/wrangler-action` 대신 `npx wrangler` 직접 호출 (액션 번들 wrangler 3.x 는 `wrangler.jsonc` 를 못 읽는다). `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 시크릿은 등록 완료. **커스텀 도메인은 첫 prod 배포 때 생성되므로 `main` 에 병합되기 전까지 서비스되지 않는다.**

## 문서 관리 (필수)

모든 프로젝트 문서는 `docs/` 하위에 있으며 인덱스는 `docs/README.md` 다.

**코드를 변경하면 같은 작업 안에서 대응 문서를 반드시 갱신한다.** 판단 기준은 `docs/architecture/traceability.md` 의 "변경 영향도" 표다. 요약:

| 변경 대상 | 갱신 문서 |
|-----------|-----------|
| `src/tabs.ts` (`renderTabs` · 리스너) | `src/saveState.ts` — `setTabStateListener` 가 dirty·파일명·탭 전환의 단일 통로다 |
| `src/tabs.ts` (`TabState`) · `src/storage.ts` (세션 스키마) | `docs/architecture/data-model.md`, `docs/architecture/traceability.md` |
| `src/fileOps.ts` · `src/shortcuts.ts` · `src/notice.ts` | `docs/api/browser-apis.md` |
| `src/swUpdate.ts` · `public/sw.js` (생명주기) | `docs/architecture/service-architecture.md` §7.2, `docs/api/browser-apis.md` §4.1 |
| `vite.config.ts` 빌드 ID 플러그인 | `docs/architecture/infrastructure.md` §3.2 |
| `src/toolbar.ts` (버튼 증감 · `GROUP_ORDER`) | `docs/features/feature-status.md`, `tests/e2e/toolbar.spec.ts` 버튼·묶음·구분선 개수 단언 |
| `public/manifest.webmanifest` (`file_handlers`) | `docs/api/browser-apis.md`, `tests/e2e/fileHandler.spec.ts` |
| `src/parser.ts` (marked 옵션 · sanitize 정책) | `docs/architecture/service-architecture.md`, `docs/api/browser-apis.md` §8, `tests/parser.test.ts` |
| `vite.config.ts` · `wrangler.jsonc` · `.github/workflows/*` | `docs/architecture/infrastructure.md`, `docs/operations/cloudflare-workers.md` |
| `index.html` (DOM id) | 전 E2E 셀렉터, `docs/architecture/service-architecture.md` |
| `docs/manual.md` | 앱의 사용 설명서 화면 (빌드 시각 번들 — 따로 옮겨 적지 말 것) |
| `CHANGELOG.md` · `package.json` 버전 | 앱의 새 소식 화면 · GitHub Release 본문 (둘 다 이 파일에서 파생 — 따로 쓰지 말 것) |
| 기능 추가/삭제 | `docs/features/feature-status.md` (F-ID 부여, 제거는 🗑 로 남김) |
| 테스트 변경 | `docs/testing/test-plan.md`, `docs/testing/test-results.md` |

작업 완료 시 `docs/history/` 에 `YYYY-MM-DD-<요약>.md` 로 요청 사항과 처리 결과를 기록하고 `docs/history/README.md` 목록에 한 줄 추가한다.

문서 상단에는 `> 최종 갱신: YYYY-MM-DD · 대상: <버전>` 을 유지한다.

## 알려진 설계 갭

상세: `docs/features/feature-status.md`

**예전에 여기 있던 다섯 항목은 전부 닫혔다** — 폴백 브라우저 안내(F-58 `fsLimitNotice.ts`) ·
`fileOps.ts` 커버리지(5.26% → 73.6%, F-47) · PWA 아이콘 PNG(F-68 `scripts/gen-icons.mjs`) ·
용량 초과 자동 회수(F-54 `sessionReclaim.ts`). **닫힌 항목을 목록에 남겨 두지 말 것** —
다음 사람이 이미 있는 기능을 다시 만든다(실제로 이슈 #125 가 그럴 뻔했다).

지금 남은 것:

1. `caretStatus.ts`·`formatBar.ts` 는 **주입형 리프인데 단위 테스트가 없다**(0%). E2E 로만 덮여
   있어, 이 저장소가 여섯 번 확인한 "리프는 단위로 고정한다" 패턴에서 벗어나 있다.
2. **가상 키보드 동작(F-87)은 실기기 확인이 남아 있다.** 헤드리스에는 소프트 키보드가 없다 —
   절차는 이슈 #155 댓글(트랩 #100).
