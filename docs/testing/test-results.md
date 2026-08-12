# 테스트 실행 결과

> 실행일: 2026-08-12 · 대상: 웹 전환 (v2.0.0)
> 환경: macOS 25.5.0 / Node v26.7.0 / Chromium (Playwright 1.62.1) / Vite dev server `http://127.0.0.1:5173`

## 1. 종합

| 스위트 | 도구 | 통과 | 실패 | skip | 총계 |
|--------|------|------|------|------|------|
| 단위 | Vitest 4.1.10 (jsdom) | 22 | 0 | 0 | 22 |
| E2E (로컬) | Playwright 1.62.1 (chromium) | **78** | **0** | 4 ※ | 82 |
| **합계** | | **100** | **0** | 4 | 104 |

※ `_headers`(Cloudflare 전용)와 서비스 워커(`import.meta.env.PROD` 전용)를 검증하는 4케이스는 로컬에서 `test.skip()` 된다. 원격 baseURL 로 실행하면 전량 수행된다.

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
| `hardening.spec.ts` | 9 | ✅ 5 통과 / 4 skip (배포 환경 전용) |

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

## 4. 전환 작업 중 발견해 수정한 애플리케이션 버그

E2E 를 새로 작성하는 과정에서 **실제 결함 3건**이 드러났다. 모두 수정 후 회귀 테스트를 추가했다.

| # | 심각도 | 버그 | 원인 | 수정 |
|---|--------|------|------|------|
| 1 | 높음 | New/Open/Save 버튼을 누르면 문서가 **즉시 변경됨(dirty)** 으로 표시 | `initToolbar()` 가 **모든** 버튼 클릭 후 `input` 이벤트를 재발행 — 파일 액션까지 포함 | `ToolbarAction.editsText` 플래그 도입, 서식 액션 12개만 재발행 |
| 2 | 중간 | 탭을 전환하면 **커서 위치가 항상 0,0 으로 초기화** | 포커스 없는 textarea 의 선택 영역을 `setSelectionRange()` 로 복원해도, 클릭 이벤트가 끝나며 브라우저가 되돌림 | `switchTab()` 에서 `editorEl.focus()` 후 선택 복원 |
| 3 | 낮음 | jsdom 단위 테스트에서 `localStorage` 접근 불가 | Node 22+ 가 `localStorage` 전역을 예약해 vitest 의 jsdom 환경이 실제 구현을 싣지 못함 | `tests/setup.ts` 에 테스트 전용 Storage 셰임 추가 |
| 4 | 낮음 | `tsc` 가 타입 오류로 멈추면 `dist/` 에 중간 산출물(`.js`/`.d.ts`)이 남음 | tsconfig 가 `outDir: dist` + `declaration: true` 였다. 평소엔 `vite build` 가 덮어써 드러나지 않았다 | `tsc --noEmit` 으로 전환하고 tsconfig 에서 emit 옵션 제거 |

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
| dev | `markdown-editor-dev.devworld-ltd-ai.workers.dev` | ✅ **58/58** (7.6s) |
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
