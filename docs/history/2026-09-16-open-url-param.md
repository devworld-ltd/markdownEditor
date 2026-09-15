# 원격 URL 열기 · 로컬 열기 파라미터 (F-90·F-91, 이슈 #195)

> 작업일: 2026-09-16 · 브랜치 `feature/issue-195`

## 요청 사항

앱 주소에 파라미터를 붙여 링크 한 번으로 특정 마크다운 문서를 열 수 있게 한다.

- `?url=<https 주소>` — 원격 마크다운을 확인 뒤 내려받아 새 탭으로 연다.
- `?open=local` — 확인 뒤 클릭 한 번으로 기존 파일 열기(`openFile()`)를 촉발한다.
- 실패는 HTTP/CORS/네트워크/용량 초과 4갈래로 구별해 안내한다.
- 파라미터가 없으면 네트워크 요청 0건(기존 `SH8` 무손상)을 유지한다.

## 수행 내역

- **`src/openParams.ts`**(신규, 순수) — `?url=`/`?open=local`/`?file=` 판정(`readOpenIntent`),
  탭 이름 도출(`fileNameFromUrl`), 실패/거절/성공 문구 생성. `dropFiles.ts`·`shareId.ts` 의
  기존 순수 함수를 재사용해 판정 경로를 갈라지지 않게 했다.
- **`src/remoteDoc.ts`**(신규, 주입형 리프) — `fetch` 1회 + `Content-Length` 사전검사 +
  `Response.body.getReader()` 본문 누적검사(2단 상한) + `AbortController` 시한 + 실패
  경로에서만 도는 `no-cors` 탐침으로 CORS 거부/네트워크 실패를 구별.
- **`src/openUrlUi.ts`**(신규, 주입형 리프) — `#open-url-dialog` 원격/로컬 2모드 확인
  대화상자. `Promise` 가 아니라 콜백을 받아 클릭 핸들러의 동기 프레임 안에서
  `onConfirm` 을 불러 사용자 제스처를 보존한다(트랩 #109).
- **`src/launchFiles.ts`**(수정) — `LaunchParamsLike.targetURL` 추가, 소비자 안에
  `files` 우선 + 즉시 `return` 뒤 `targetURL` 분기(`openTargetUrl` 선택 필드) 추가.
  새 소비자를 등록하지 않는다(`setConsumer` 이중 등록이 조용히 F-89 를 죽인다 — 트랩 #107).
- **`index.html`** — `#open-url-dialog`(+ title/body/target/cancel/confirm) 마크업을
  `#reload-dialog` 골격 그대로 추가.
- **`src/style.css`** — `.open-url-target`(말줄임 없음, 기존 토큰 색만 사용) 한 규칙.
- **`public/_headers`** — CSP `connect-src` 를 `'self' https://cloudflareinsights.com`
  → `'self' https:` 로 완화(근거 주석 포함). `script-src` 는 불변.
- **`src/main.ts`** — `initOpenUrlUi`·`handleIntent`·`cleanupAddress` 배선. 기존 초기화
  5단계 순서는 그대로 두고 `initLaunchFiles()` 앞뒤에 새 호출을 추가했다. `handleIntent`
  는 취소 시에도 `cleanupAddress()` 를 부르도록 `openUrlUi` 에 `onCancel` 콜백을 새로 뺐다
  (기술 스펙 공개 API 에는 없던 것 — M-9/AC-4 를 만족시키려면 필요했다).
- 단위 테스트 3파일: `tests/openParams.test.ts`(51건) · `tests/remoteDoc.test.ts`(14건) ·
  `tests/openUrlUi.test.ts`(16건).
- `tests/e2e/openUrl.spec.ts` 의 `test.fixme` 26건을 모두 제거해 활성화.

## 산출물

| 파일 | 종류 |
|------|------|
| `src/openParams.ts` | 신규 |
| `src/remoteDoc.ts` | 신규 |
| `src/openUrlUi.ts` | 신규 |
| `src/launchFiles.ts` | 수정 |
| `src/main.ts` | 수정 |
| `index.html` | 수정 |
| `src/style.css` | 수정 |
| `public/_headers` | 수정 |
| `tests/openParams.test.ts` · `tests/remoteDoc.test.ts` · `tests/openUrlUi.test.ts` | 신규 |
| `tests/e2e/openUrl.spec.ts` | 활성화(fixme 제거 + 레이스 컨디션 1건 수정) |

## 검증 결과

- `npm run typecheck` — 통과.
- `npm test` — **1221/1221 통과**(69개 파일, 신규 3파일 · 81건 추가).
- 단언 검증(트랩 #16, `remoteDoc.ts`): (a) 본문 누적 검사 제거 → "본문 누적검사" 케이스
  실패 확인 (b) `AbortError` 우선 검사 제거 → "타임아웃" 케이스가 `network` 로 오분류돼
  실패 확인 (c) `isOnline` 분기 제거 → "오프라인" 케이스가 `network` 로 오분류돼 실패
  확인. 세 버그 모두 `cp` 로 사본을 뜨고 `cp` 로 되돌렸다(`git checkout` 미사용, 트랩 #87).
- `npx playwright test tests/e2e/openUrl.spec.ts` — **24 통과 · 2 skip**(CORS 갈래는 단위
  테스트로 하향, E9 는 로컬 dev 서버에서 `_headers` 미적용이라 스펙대로 skip).
- 회귀 확인: `fileHandler.spec.ts`·`launchHandler.spec.ts`·`share.spec.ts`(SH8 포함) 17건
  전부 통과 — `launchFiles.ts` 변경이 F-89/F-60 을 깨지 않았다.

## 발견 사항

- 기술 스펙 §3-1 은 `?url=file://...` 를 `local-path` 로 분류하라고 서술했지만, PRD
  AC-5 와 `openUrl.spec.ts` E4 는 이 값에 대해 **scheme 거절(문구에 `http` 포함)** 을
  기대한다 — `?file=` 파라미터만 `local-path`(문구에 `파일 선택` 포함)로 남기고, 테스트를
  정본으로 삼아 구현했다.
- `openUrl.spec.ts` E8 의 `targetURL` 시드값이 상대 경로(`/?url=...`)였다 — 실제
  `LaunchParams.targetURL` 은 절대 주소이지만, 순수 함수 `readOpenIntent` 는 절대 URL을
  전제하므로 `launchFiles.ts` 의 `openTargetUrl` 콜백에서 `new URL(href, location.origin)`
  으로 절대화한 뒤 넘기도록 `main.ts` 를 조정했다.
- `openUrl.spec.ts` E3 "네 문구가 서로 다르다" 테스트가 알림이 "가져오는 중…"(info)에서
  최종 error 로 바뀌기 전에 읽어 레이스 컨디션으로 실패했다 — `data-kind="error"` 를
  기다리는 `expect` 를 세 지점에 추가해 고쳤다(구현 버그 아님, 테스트 타이밍 문제).

## 남은 과제

- **F-91 Safari·Firefox 실기기 확인** — `?open=local` → "파일 선택" 클릭이 `<input
  type=file>` 폴백을 여는지. Chromium 만 실측했다. 이슈 #195 댓글에 결과 기록 예정.
- **AC-15 PWA `focus-existing` 실동작** — 배선(E8)은 자동 검증됐지만 "기존 창이 실제로
  앞으로 나오는가"는 헤드리스로 검증 불가(F-89 와 같은 잔여 과제, 트랩 #82).
