# 테스트 실행 결과

> 실행일: 2026-08-12 · 대상: 웹 전환 (v2.0.0)
> 환경: macOS 25.5.0 / Node v26.7.0 / Chromium (Playwright 1.62.1) / Vite dev server `http://127.0.0.1:5173`

## 1. 종합

| 스위트 | 도구 | 통과 | 실패 | skip | 총계 |
|--------|------|------|------|------|------|
| 단위 | Vitest 4.1.10 (jsdom) | **885** | 0 | 0 | 885 |
| E2E (dev 서버) | Playwright 1.62.1 (chromium) | **390** | **0** | 15 ※ | 405 |
| **합계 (dev 기준)** | | **1275** | **0** | 15 | 1290 |

단위 테스트 파일 10개: `parser` 13 · `storage` 9 · `swUpdate` 20 · `tabs` 34 · `textEdit` 13 · `fileOps` 9 · `shortcuts` 11 · `notice` 7 · `editor` 4 · `offline` 7.

※ 스킵은 **환경 조건**에 따른 것이다. 세 부류가 있다.

| 부류 | 예 | 언제 실행되나 |
|------|-----|---------------|
| 배포 환경 전용 | CSP 헤더, 서비스 워커 등록 | `E2E_BASE_URL=<배포 URL>` |
| 프리뷰(프로덕션 번들) 전용 | F-69 STUB 시나리오 E1~E7 | `E2E_PREVIEW=1` |
| 개발 서버 전용 | `/src/*.ts` 소스 모듈 응답 | 기본 실행 |

세 모드를 합치면 전 케이스가 최소 1회 실행된다. 어느 한 모드에서 전량이 도는 구성은 원리적으로 불가능하다 — 개발 서버와 프로덕션 번들은 서로 배타적인 전제 위에 있다.

| 검증 | 결과 |
|------|------|
| `npx tsc --noEmit` | ✅ 오류 0건 |
| `npm run build` | ✅ 15 모듈, 115ms |
| `npx wrangler deploy --env dev --dry-run` | ✅ 설정 유효, 자산 5개 인식, `APP_ENV=dev` 바인딩 확인 |
| dev·prod 실배포 + 배포 환경 E2E | ✅ 각 58/58 (§6.5) |

### 빌드 산출물

| 산출물 | 크기 | gzip |
|--------|------|------|
| `dist/index.html` | 1.43 kB | 0.76 kB |
| `dist/assets/index-*.css` | 3.13 kB | 1.12 kB |
| `dist/assets/index-*.js` | 83.66 kB | 28.04 kB |
| `dist/_headers`, `manifest.webmanifest`, `icon.svg`, `sw.js` | (정적 복사) | — |

전환 전(48.57 kB / gzip 15.05 kB) 대비 JS 가 약 34.8 kB 늘었다. 대부분 **DOMPurify**(sanitize)이며, 나머지는 storage/notice 모듈과 파일 I/O 분기 코드다. XSS 방어와 맞바꾼 비용으로 판단한다.

## 2. E2E 결과 — 78 PASS / 4 SKIP

| 스펙 | 케이스 | 결과 |
|------|--------|------|
| `urls.spec.ts` | 15 | ✅ 전체 통과 |
| `editor.spec.ts` | 10 | ✅ 전체 통과 |
| `toolbar.spec.ts` | 16 | ✅ 전체 통과 |
| `tabs.spec.ts` | 11 | ✅ 전체 통과 |
| `fileaccess.spec.ts` | 15 | ✅ 전체 통과 |
| `session.spec.ts` | 6 | ✅ 전체 통과 |
| `hardening.spec.ts` | 10 | ✅ 배포 환경 전용 제외 통과 |
| `swupdate.spec.ts` | 10 | ✅ 프리뷰 모드에서 전량 통과 (dev 서버에서는 skip) |
| `offline.spec.ts` | 3 | ✅ Playwright `context.setOffline()` 으로 실제 오프라인 재현 |
| `scrollsync.spec.ts` | 11 | ✅ F-72 시각 구분 + F-25 스크롤 동기화 |
| `darkmode.spec.ts` | 6 | ✅ F-57 다크 모드 — 대비비를 Node 에서 실제 계산해 단언 |
| `icons.spec.ts` | 7 | ✅ F-68 PWA 아이콘 — IHDR 을 읽어 선언과 실물을 대조 |
| `shortcuthelp.spec.ts` | 11 | ✅ F-58 단축키 안내 — 모달 동작·포커스 복귀·macOS 표기 |
| `search.spec.ts` | 23 | ✅ F-22 검색 + 치환 — 키 가로채기·선택·스크롤·**실행 취소** |
| `splitter.spec.ts` | 10 | ✅ F-32 분할 비율 — 드래그·키보드·세션 복원·손상 저장값 |
| `viewmode.spec.ts` | 12 | ✅ F-33 보기 모드 — 순환·복원·F-25 무동작·설정 병합 |
| `htmlexport.spec.ts` | 7 | ✅ F-38 HTML 내보내기 — 실제 기록되는 바이트·탭 무영향·폴백 |
| `print.spec.ts` | 9 | ✅ F-39 인쇄 — `emulateMedia("print")` 로 실제 인쇄 스타일 검증 |
| `a11y.spec.ts` | 18 | ✅ F-59 접근성 — axe 8상태 + 다크 + 수동 시나리오 9건 |
| `taborder.spec.ts` | 11 | ✅ F-34 탭 재정렬 — 드래그·키보드·즉시 영속화 |
| `settings.spec.ts` | 12 | ✅ F-35 편집 설정 — 글꼴·크기·웹폰트 없음·설정 격리 |
| `recent.spec.ts` | 12 | ✅ F-36 최근 파일 — 핸들 수명·중복 탭 방지·내용 미저장 |
| `clipboard.spec.ts` | 7 | ✅ F-40 클립보드 — 실제 나가는 바이트·폴백·정화 |
| `share.spec.ts` | 10 | ✅ F-60 공유 — 배선·정화·요청 없음 확인 |
| `highlight.spec.ts` | 9 | ✅ F-23 하이라이팅 — 정화 통과·라이트/다크/인쇄 AA·성능 |
| `linenumbers.spec.ts` | 10 | ✅ F-24 줄 번호 — 줄바꿈 정렬·복사 격리·글꼴 변경 추종 |
| `editorkeys.spec.ts` | 15 | ✅ F-26·F-27 — 실행 취소·Tab 탈출·조합 입력 |
| `docstats.spec.ts` | 8 | ✅ F-29 문서 통계 — 어절/단어 구분·선택 통계·성능 |
| `table.spec.ts` | 9 | ✅ F-30 표 편집 — 폭 정렬·열 정렬·undo 보존 |
| `filedrop.spec.ts` | 10 | ✅ F-56 파일 드롭 — 다중 탭·핸들 유무·거절 |
| `session.spec.ts` (F-54 추가분) | 2 | ✅ 용량 초과 회수 — 회수 후 저장 성공·회수 불가 시 알림 |
| `editorhighlight.spec.ts` | 14 | ✅ F-23 잔여 편집 하이라이팅 — 정렬·스크롤·커서 보존·표 |
| `footnotes.spec.ts` | 8 | ✅ F-73 각주·정의 목록 — 렌더·링크·내보내기 |
| `scrollanchor.spec.ts` | 9 | ✅ #114 블록 앵커 — 보이는 내용 일치·양 끝·폴백 |
| `mermaid.spec.ts` | 7 | ✅ F-74 다이어그램 — 렌더·실패·캐시·내보내기·다크·지연 로드 |
| `scrolldrift.spec.ts` | 4 | ✅ #121 각주 문서 스크롤 어긋남 — 오차 ≤ 5px |
| `searchoverlay.spec.ts` | 9 | ✅ F-22 재검증 — 오버레이 켬/끔 양쪽에서 검색·치환 |
| `scrolloverlay.spec.ts` | 5 | ✅ F-25 재검증 — 두 동기화의 공존·탭 전환·보기 모드 |
| `fontoverlay.spec.ts` | 9 | ✅ F-35 재검증 — 글꼴·크기·줄 번호·탭 전환에서의 정렬 |
| `overlaya11y.spec.ts` | 9 | ✅ F-59 재검증 — axe·포커스·대비·인쇄·커서 |

### 2.1 URL 응답 (15)

`/`, `/index.html`, `/src/style.css`, `/src/{main,editor,preview,parser,tabs,fileOps,toolbar,shortcuts,storage,notice}.ts` 전부 200. 미존재 경로 처리 정상. **페이지 로드 중 콘솔 에러 0건.**

### 2.2 에디터·프리뷰·정화 (10)

초기 레이아웃 / 기본 타이틀 `Markdown Editor` / 디바운스 렌더 / GFM 테이블·취소선·체크리스트·`breaks` / 코드 블록 / 전체 삭제 / **`<script>`·`onerror` 미실행** / **`javascript:` 링크 제거**.

### 2.3 툴바 (16)

버튼 16개(New·Open·Save·Save As + 서식 12) 및 구분선 1개 확인. 인라인 래핑 4종, 줄머리 접두어 4종, Link·Image·Code Block·HR, 선택 영역 래핑, 프리뷰 즉시 반영.

### 2.4 멀티 탭 (11)

초기 탭 / dirty 마커 / New 버튼 / `Alt+N` / 탭별 내용 보존 / **커서 위치 복원 `[3,6]`** / 깨끗한 탭 닫기 / **dirty 닫기 확인 후 취소 시 유지** / **확인 시 닫힘** / 마지막 탭 재생성 / `Alt+W`.

### 2.5 파일 I/O (15)

| FS Access 경로 (10) | 폴백 경로 (5) |
|---------------------|---------------|
| `data-fs-access="true"` | `data-fs-access="false"` |
| 파일 열기 → 새 탭 | 숨김 `#file-input` 존재 |
| 재열기 → 탭 전환 (중복 없음) | 업로드 → 새 탭 |
| 미저장 저장 → 위치 선택 후 기록 | 저장 → `Untitled.md` 다운로드 |
| 핸들 있음 → 대화상자 없이 덮어쓰기 | 기존 파일명 유지 다운로드 |
| 저장 후 dirty 해제 | |
| Save As → 새 위치 질의 | |
| `Shift+Cmd/Ctrl+S` | |
| 취소 시 무변경 + 알림 없음 | |
| 쓰기 실패 → 오류 알림 + dirty 유지 | |

### 2.6 세션 영속 (6)

자동 저장 / 새로고침 복원(본문·프리뷰·dirty) / 다중 탭+활성 탭 복원 / **복원 탭은 핸들이 없어 저장 시 위치 재질의** / 세션 없음 → 빈 탭 / 손상된 JSON 무시 후 정상 기동(`pageerror` 0건).

### 2.7 보안·PWA·저장 실패 (9 — 5 통과 / 4 skip)

| 케이스 | 결과 |
|--------|------|
| 용량 초과 시 사용자에게 알린다 + 편집은 계속 가능 | ✅ |
| 저장이 정상이면 실패 알림이 뜨지 않는다 | ✅ |
| manifest 가 서빙되고 필수 필드를 갖춘다 (`maskable` 아이콘 포함) | ✅ |
| 아이콘·서비스 워커 스크립트 서빙 | ✅ |
| 문서에 manifest·icon 링크가 있다 | ✅ |
| 서비스 워커 등록 | ⏭ 배포 환경 전용 |
| CSP·보안 헤더 3종 | ⏭ 배포 환경 전용 |
| 캐시 정책 (`immutable` / `no-cache`) | ⏭ 배포 환경 전용 |
| CSP 위반 0건으로 동작 | ⏭ 배포 환경 전용 |

## 3. 단위 테스트 — 22/22 PASS

| 파일 | 케이스 | 내용 |
|------|--------|------|
| `parser.test.ts` | 13 | GFM 변환 7 + sanitize 6 (`<script>`·이벤트 핸들러·`javascript:`·`iframe` 제거, 안전 HTML·체크박스 유지) |
| `storage.test.ts` | 9 | 저장·복원 왕복, 세션 없음, 손상 JSON, 버전 불일치, 형식 오류 항목 필터, 빈 탭, **용량 초과**, `clearSession` |
| `swUpdate.test.ts` | 20 | 표시 판정(최초 설치 미표시 포함) · dismiss · 갱신 결정 · `controllerchange`/타임아웃 경합 · **포커스 복원 순서** |
| `tabs.test.ts` | 34 | `closeTab` 3분기 · dirty 확인 콜백 · `restoreSession` ID 시퀀스 복구 · `persistNow` 반환값 · 용량 초과 알림 1회 제한 |
| `textEdit.test.ts` | 13 | 감싸기·줄머리·블록 삽입의 경계 조건 |
| `fileOps.test.ts` | 9 | `suggestFileName` 4분기 + 확장자 대소문자 |
| `shortcuts.test.ts` 11 · `notice.test.ts` 7 · `editor.test.ts` 4 · `offline.test.ts` 7 | | |

## 4. 전환 작업 중 발견해 수정한 애플리케이션 버그

E2E 를 새로 작성하는 과정에서 **실제 결함 3건**이 드러났다. 모두 수정 후 회귀 테스트를 추가했다.

| # | 심각도 | 버그 | 원인 | 수정 |
|---|--------|------|------|------|
| 1 | 높음 | New/Open/Save 버튼을 누르면 문서가 **즉시 변경됨(dirty)** 으로 표시 | `initToolbar()` 가 **모든** 버튼 클릭 후 `input` 이벤트를 재발행 — 파일 액션까지 포함 | `ToolbarAction.editsText` 플래그 도입, 서식 액션 12개만 재발행 |
| 2 | 중간 | 탭을 전환하면 **커서 위치가 항상 0,0 으로 초기화** | 포커스 없는 textarea 의 선택 영역을 `setSelectionRange()` 로 복원해도, 클릭 이벤트가 끝나며 브라우저가 되돌림 | `switchTab()` 에서 `editorEl.focus()` 후 선택 복원 |
| 3 | 낮음 | jsdom 단위 테스트에서 `localStorage` 접근 불가 | Node 22+ 가 `localStorage` 전역을 예약해 vitest 의 jsdom 환경이 실제 구현을 싣지 못함 | `tests/setup.ts` 에 테스트 전용 Storage 셰임 추가 |
| 4 | 낮음 | `tsc` 가 타입 오류로 멈추면 `dist/` 에 중간 산출물(`.js`/`.d.ts`)이 남음 | tsconfig 가 `outDir: dist` + `declaration: true` 였다. 평소엔 `vite build` 가 덮어써 드러나지 않았다 | `tsc --noEmit` 으로 전환하고 tsconfig 에서 emit 옵션 제거 |
| 5 | 낮음 | 용량 초과 단위 테스트가 **로컬만 통과하고 CI 에서 실패** | jsdom 의 `Storage` 는 Proxy 라 `localStorage.setItem = fn` 이 메서드 교체가 아니라 `"setItem"` 항목 저장으로 처리된다. 로컬은 `tests/setup.ts` 의 셰임(일반 객체)이라 통과했다 | `Object.defineProperty(window, "localStorage", …)` 로 속성 자체를 교체하도록 변경. 셰임·Proxy 두 환경에서 모두 검증 |

버그 1은 **네이티브 버전에도 존재했으나** 당시에는 dirty 상태의 영향이 작아 드러나지 않았다. 웹 전환으로 dirty 가 닫기 확인·이탈 경고·자동 저장을 좌우하게 되면서 표면화됐다.

### 테스트 코드 측 오류 (앱 결함 아님)

| 가정 | 실제 |
|------|------|
| 툴바 버튼 15개 | 파일 액션 추가 후 **16개** |
| — | 전환 전 분석에서도 14개를 15개로 잘못 단언했다가 정정한 이력 있음 |

## 5. 자동 테스트로 확인하지 못한 항목

| 항목 | 사유 |
|------|------|
| 실제 파일 선택기 / 디스크 I/O | 브라우저 네이티브 대화상자 자동화 불가 — 목으로 프로토콜만 검증 |
| Firefox · WebKit 실제 동작 | Chromium 프로젝트만 구성 |
| 반응형 레이아웃 | 뷰포트 테스트 미도입 |
| localStorage 용량 초과 | 미도입 |

→ [테스트 계획 §7 수동 회귀 체크리스트](./test-plan.md#7-수동-회귀-체크리스트-릴리즈-전)로 보완.

## 6. 남아 있는 설계 갭

| 심각도 | 내용 | 참조 |
|--------|------|------|
| 중간 | 서비스 워커 업데이트 알림 UI 없음 — 새 배포가 있어도 사용자는 옛 버전을 본다 | [F-69](../features/feature-status.md) |
| 중간 | 폴백 브라우저에서 덮어쓰기·중복 탭 방지 불가 (API 한계, 안내 UI 없음) | [F-11, F-58](../features/feature-status.md) |
| 낮음 | 용량 초과 후 오래된 탭을 자동 회수하지 않아 자동 저장이 멈춘 상태로 유지 | [F-54 잔여](../features/feature-status.md) |

## 6.5 배포 환경 검증 (2026-08-12)

로컬뿐 아니라 **실제 배포된 아티팩트**를 대상으로 E2E 를 돌렸다. `E2E_BASE_URL` 을 주면
Playwright `webServer` 가 원격 URL 이 살아 있음을 확인하고 로컬 서버를 띄우지 않는다.

| 환경 | URL | 결과 |
|------|-----|------|
| dev | `md-editor-dev.devworld.co.kr` (F-67) | ✅ **58/58** (7.6s) |
| prod | `md-editor.devworld.co.kr` | ✅ **58/58** (7.8s) |

```bash
E2E_BASE_URL=https://md-editor.devworld.co.kr npx playwright test \
  tests/e2e/editor.spec.ts tests/e2e/toolbar.spec.ts tests/e2e/tabs.spec.ts \
  tests/e2e/fileaccess.spec.ts tests/e2e/session.spec.ts
```

`urls.spec.ts` 는 Vite 개발 서버의 소스 모듈 경로를 검증하므로 제외한다(프로덕션은 번들됨).

정적 자산·SPA 폴백·인증서도 함께 확인했다.

| 항목 | 결과 |
|------|------|
| `/assets/*.js` · `*.css` | 200, 올바른 MIME |
| 알 수 없는 경로 | 200 (`index.html` 폴백) |
| TLS | Let's Encrypt, 검증 통과 |

## 7. 재현 방법

```bash
npm install
npm test              # 단위 21건
npm run test:e2e      # E2E 73건 (dev 서버 자동 기동)
npm run test:coverage # 커버리지
npx tsc --noEmit
npx wrangler deploy --env dev --dry-run
```
