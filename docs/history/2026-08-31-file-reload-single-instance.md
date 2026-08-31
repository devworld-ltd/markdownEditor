# 파일 변경 감지 새로고침(F-88) + 앱 중복 실행 방지(F-89)

> 일자: 2026-08-31 · 이슈 #187 · PR #188

## 요청 사항

이슈 #187 에서 요구 2건을 받았다.

1. **파일 변경 감지 새로고침** — 열려 있는 파일이 디스크에서 변경되었을 때 새로 읽어올 수 있도록 새로고침 기능을 추가한다.
2. **앱 중복 실행 방지** — 이미 앱이 열려 있는데(OS 파일 연결 실행 등) 새 창이 또 열리는 문제를 막고, 기존 창을 재사용한다.

배경: File System Access API 핸들(`handleStore.ts`)과 OS 파일 연결 실행(`launchFiles.ts`, #135)은 이미 있었고, 요구 2는 PWA `launch_handler`(`client_mode: focus-existing`)·`launchQueue` 경로와 관련될 것으로 예상됐다.

## 수행 내역

- **F-88**: `src/diskStamp.ts`(기준값 비교·클램프 순수 계산, 신규) → `src/fileReload.ts`(감지·재읽기 주입형 배선, `tabs.ts` 미의존, 신규) → `src/reloadUi.ts`(변경 배너 + 재읽기/저장충돌 확인 대화상자, 신규). `TabState` 에 `diskStamp`/`diskChanged` 를 메모리 전용 필드로 추가(세션 스키마 변경 없음, `SCHEMA_VERSION` 유지). 감지 시점은 포커스·`visibilitychange`·탭 전환이며 폴링은 쓰지 않는다. 더티 탭은 확인 대화상자를 거치고, 저장 시점에 디스크가 바뀌어 있으면 `setSaveConflictGuard` 훅으로 충돌을 경고한다. 툴바에 Reload 버튼(21 → 22)과 `Alt+R` 단축키를 추가했다.
- **F-89**: `public/manifest.webmanifest` 에 `launch_handler.client_mode: "focus-existing"` 을 선언하고 기존 `launchFiles.ts`/`launchQueue` 소비자를 그대로 재사용했다(신규 코드 없음).
- PR 안에서 `docs/features/feature-status.md`, `docs/api/browser-apis.md`, `docs/architecture/data-model.md`, `docs/architecture/traceability.md`, `docs/manual.md`, `docs/testing/test-plan.md`, `docs/testing/test-results.md`, `CLAUDE.md`(트랩 #82 갱신)가 함께 갱신됐다.

## 산출물

- `src/diskStamp.ts`, `src/fileReload.ts`, `src/reloadUi.ts` (신규)
- `src/fileOps.ts`, `src/tabs.ts`, `src/main.ts`, `src/toolbar.ts`, `src/shortcutDefs.ts`, `src/shortcuts.ts`, `src/style.css`, `index.html`, `public/manifest.webmanifest` (수정)
- 테스트: `tests/diskStamp.test.ts`(20), `tests/fileReload.test.ts`(27), `tests/reloadUi.test.ts`(8), `tests/e2e/fileReload.spec.ts`(13), `tests/e2e/launchHandler.spec.ts`(2)
- PR [#188](https://github.com/devworld-ltd/markdownEditor/pull/188) → dev 머지 완료(2026-08-30)

## 검증 결과

- 단위: 신규 55건 전부 PASS (diskStamp 100%, fileReload 95%, reloadUi 89% 커버리지)
- E2E: 신규 15건 전부 PASS, 기존 스위트 회귀 없음
- `npm run typecheck` · `npm run build` 오류 0건

## 발견 사항

- 코드 리뷰에서 P2(권고) 1건 발견: `main.ts` 에서 `setTabSwitchListener` 가 두 번 등록되어 첫 번째 등록이 두 번째에 덮여 죽은 코드가 된다. 기능에는 영향 없어 병합을 막지는 않았고, 별도 이슈 [#189](https://github.com/devworld-ltd/markdownEditor/issues/189) 로 분리했다.

## 남은 과제

- **F-89 AC-20 실기기 검증**: OS 파일 연결(Finder "다음으로 열기")로 실행했을 때 새 창이 아니라 기존 창이 포커스되고 파일이 열리는지는 헤드리스 Chromium 에 macOS Launch Services 가 없어 자동 테스트로 확인할 수 없다(트랩 #82 와 같은 성격). PWA 설치 후 실기기에서 확인하고 결과를 이슈 #187 댓글에 기록해야 한다.
- 이슈 #189(`setTabSwitchListener` 중복 등록 정리)는 아직 열려 있다.
