# 테스트 계획

> 최종 갱신: 2026-08-12 · 대상: 웹 전환 (v2.0.0)

## 1. 목적 및 범위

애플리케이션이 노출하는 **전체 URL 과 전 기능**이 정상 동작하는지 자동 검증한다.

| 계층 | 도구 | 위치 | 대상 |
|------|------|------|------|
| 단위 | Vitest (jsdom) | `tests/*.test.ts` | 순수/리프 모듈 (`parser.ts`, `storage.ts`) |
| E2E | Playwright (Chromium) | `tests/e2e/*.spec.ts` | URL 응답, DOM, 상호작용, 파일 I/O, 세션 |
| 배포 | Wrangler | — | `wrangler deploy --dry-run` 설정 검증 |
| 수동 | — | — | 실제 파일 선택기, 크로스 브라우저, 반응형 |

**범위 제외**: HTTP API·DB 테스트(존재하지 않음), 시각 회귀 테스트.

**웹 전환에 따른 변화**: 네이티브 브리지 스펙(`bridge.spec.ts`)을 제거하고 `fileaccess.spec.ts`(브라우저 파일 API)와 `session.spec.ts`(localStorage)로 대체했다. 단위 테스트 환경은 `node` → `jsdom` 으로 바꿨다.

## 2. 테스트 환경

| 항목 | 값 |
|------|-----|
| 실행 URL | `http://127.0.0.1:5173` (`E2E_BASE_URL` 로 재정의) |
| 서버 기동 | Playwright `webServer` 가 `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` 자동 실행 |
| 브라우저 | Chromium (`devices["Desktop Chrome"]`) |
| 병렬 | `fullyParallel: true` — 테스트마다 새 브라우저 컨텍스트 = **localStorage 격리** |
| 실행 모드 | 기본 = vite 개발 서버 / `E2E_PREVIEW=1` = **프로덕션 번들**(`build && preview`) |
| 재시도 | 로컬 0회 / CI 1회 |
| 실패 아티팩트 | 스크린샷 + trace, `playwright-report/` |
| 단위 환경 | jsdom + `tests/setup.ts` (Node 22+ 의 `localStorage` 전역 예약 때문에 Storage 셰임 필요) |

### 실행 명령

```bash
npm test                 # 단위
npm run test:coverage    # 단위 + 커버리지
npm run test:e2e         # E2E (dev 서버 자동 기동)
E2E_PREVIEW=1 npx playwright test   # E2E (프로덕션 번들 — 서비스 워커 시나리오)
npm run test:e2e:report  # 직전 E2E HTML 리포트
npx wrangler deploy --env dev --dry-run   # 배포 설정 검증
```

## 3. URL 인벤토리

백엔드 API 가 없으므로 "전체 URL" = **개발 서버가 서빙하는 문서 + 소스 모듈**이다. 프로덕션에서는 번들된 `assets/*` 로 합쳐져 Cloudflare Workers 가 서빙한다.

| # | URL | 기대 상태 | 기대 Content-Type |
|---|-----|-----------|-------------------|
| U-01 | `/` | 200 | `text/html` |
| U-02 | `/index.html` | 200 | `text/html` |
| U-03 | `/src/style.css` | 200 | `text/javascript` ※ |
| U-04~U-12 | `/src/{main,editor,preview,parser,tabs,fileOps,toolbar,shortcuts,storage,notice}.ts` | 200 | `text/javascript` |
| U-13 | `/does-not-exist.js` | 200 또는 404 | — |

※ Vite 개발 서버는 HMR 을 위해 CSS 를 JS 모듈로 감싼다. 프로덕션 빌드에서는 `text/css` 로 분리된다.

프로덕션에서는 `not_found_handling: "single-page-application"` 설정에 따라 알 수 없는 경로가 `index.html` 로 폴백한다.

## 4. 테스트 스위트 설계

### 4.1 `tests/e2e/urls.spec.ts` — URL 응답 (15케이스)
전체 URL 200 + Content-Type 검증, 404 경로 처리, **페이지 로드 중 콘솔 에러 0건**.

### 4.2 `tests/e2e/editor.spec.ts` — 에디터·프리뷰·정화 (10케이스) → F-01, F-02, F-03, F-18
초기 레이아웃, 기본 타이틀, 디바운스 렌더, GFM 4종, 코드 블록, 전체 삭제, **script/이벤트 핸들러 미실행**, **`javascript:` 링크 제거**.

### 4.3 `tests/e2e/toolbar.spec.ts` — 툴바 (16케이스) → F-04, F-16
버튼 16개 · 구분선 1개, 인라인 래핑 4종, 줄머리 접두어 4종, Link·Image·Code Block·HR, 선택 영역 래핑, 프리뷰 반영.

### 4.4 `tests/e2e/tabs.spec.ts` — 멀티 탭 (11케이스) → F-05, F-06, F-09, F-10, F-15
초기 탭, dirty 마커, New 버튼/`Alt+N`, 탭별 내용 보존, **커서 위치 복원**, 깨끗한 탭 닫기, **dirty 탭 닫기 확인/취소**, 마지막 탭 재생성, `Alt+W`.

### 4.5 `tests/e2e/fileaccess.spec.ts` — 파일 I/O (15케이스) → F-07, F-08, F-11, F-12, F-14

두 경로를 모두 검증한다.

**File System Access 경로 (10케이스)** — `tests/e2e/fixtures.ts` 의 `installFsMock()` 이 `showOpenFilePicker`/`showSaveFilePicker` 를 대체한다. 같은 이름의 핸들은 동일 객체로 재사용되므로 `isSameEntry()` 기반 중복 방지도 실제와 같은 방식으로 검증된다.

| 검증 항목 |
|-----------|
| `data-fs-access="true"` |
| 파일 열기 → 새 탭 |
| 같은 파일 재열기 → 탭 전환 |
| 미저장 문서 저장 → 위치 선택 후 기록 |
| 핸들 있는 문서 → 대화상자 없이 덮어쓰기 |
| 저장 후 dirty 해제 |
| Save As 는 핸들이 있어도 새 위치를 묻는다 |
| `Shift+Cmd/Ctrl+S` |
| 대화상자 취소 시 무변경 |
| 쓰기 실패 → 오류 알림 + **dirty 유지** |

**폴백 경로 (5케이스)** — `installFallbackMode()` 로 두 API 를 제거한다.

| 검증 항목 |
|-----------|
| `data-fs-access="false"` |
| 숨김 `#file-input` 존재 |
| 업로드 → 새 탭 |
| 저장 → 다운로드 (`Untitled.md`) |
| 기존 파일명·확장자 유지 다운로드 |

### 4.6 `tests/e2e/session.spec.ts` — 세션 영속 (6케이스) → F-19, F-20
자동 저장, 새로고침 복원, 다중 탭+활성 탭 복원, **복원 탭은 핸들이 없어 저장 시 위치 재질의**, 세션 없음, 손상된 JSON 무시.

### 4.7 `tests/e2e/hardening.spec.ts` — 보안·PWA·저장 실패 (9케이스) → F-54, F-61, F-62

| 그룹 | 케이스 | 실행 조건 |
|------|--------|-----------|
| F-54 자동 저장 실패 알림 | 용량 초과 시 오류 알림 + 편집 계속 가능 / 정상 시 알림 없음 | 전 환경 |
| F-61 PWA | manifest 필드 · 아이콘/sw.js 서빙 · 문서의 manifest 링크 | 전 환경 |
| F-61 PWA | 서비스 워커 등록 | **원격 baseURL 전용** |
| F-62 보안 헤더 | CSP 지시어 · 보안 헤더 3종 / 캐시 정책 / CSP 위반 0건 | **원격 baseURL 전용** |

`_headers` 는 Cloudflare 가 적용하고 서비스 워커는 `import.meta.env.PROD` 에서만 등록되므로, 해당 4케이스는 로컬 실행 시 `test.skip()` 된다. 로컬 82건 중 78건 실행, 원격 실행 시 전량 수행.

용량 초과는 `Storage.prototype.setItem` 을 세션 키에 한해 throw 하도록 스텁해 재현한다(읽기는 정상 유지 → "쓸 수 있는데 실패한" 상태).

### 4.8 `tests/e2e/swupdate.spec.ts` — 서비스 워커 갱신 (10케이스) → F-69

**프리뷰 모드 전용.** 서비스 워커는 `import.meta.env.PROD` 에서만 등록되므로 개발 서버 번들에서는 `register()` 자체가 호출되지 않는다. `E2E_PREVIEW=1` 로 프로덕션 번들을 띄워야 유효하다.

실제 두 버전 배포를 자동 재현할 수는 없으므로, `fixtures.ts` 의 `installSwUpdateStub()` 이 `navigator.serviceWorker` 를 앱 스크립트 실행 **전에** 가짜 객체로 치환한다. 검증 대상은 앱의 **판정·표시·갱신 로직 전체**이며, 브라우저가 `/sw.js` 바이트 차이로 업데이트를 감지하는 부분만 배포 환경 수동 검증으로 남는다.

| 시나리오 | 검증 |
|----------|------|
| E1 | 최초 설치(제어 워커 없음) → 알림 **미표시** |
| E2 | 로드 시 이미 대기 중 → 1초 후 표시 |
| E3 | 새로고침 수락 → `SKIP_WAITING` 전송 → 세션 복원 |
| E4 | "나중에" → 리로드 없음, 같은 버전 재알림 억제 |
| E5 | 저장 실패 + 미저장 탭 → 앱이 확인 요청 |
| E6 | 두 알림 동시 표시 → 겹치지 않음 |
| E7 | 연타 방지 + 활성화 타임아웃 |
| E8 | 오프라인 회귀 (`hardening.spec.ts`) |

### 4.9 단위 테스트

| 파일 | 케이스 | 대상 |
|------|--------|------|
| `tests/parser.test.ts` | 13 | GFM 변환 7 + sanitize 6 |
| `tests/storage.test.ts` | 9 | 저장·복원·스키마 검증·손상 데이터 방어·용량 초과 |
| `tests/swUpdate.test.ts` | 20 | 표시 판정 · dismiss · 갱신 결정 · 타임아웃 경합 · 포커스 순서 |

> `swUpdate.ts` 는 `SwUpdateHost` 주입형 리프라 실제 `navigator.serviceWorker` 없이 가짜 registration 만으로 검증된다. 다만 표시 판정에 쓰는 `navigator.serviceWorker.controller` 만은 DI 계약 밖이라 전역을 패치한다(이슈 #11).

## 5. 커버리지 목표

| 지표 | 현재 | 목표 |
|------|------|------|
| E2E 기능 커버리지 | 24/27 자동 검증 | 유지 |
| URL 커버리지 | 13/13 | 100% 유지 |
| 단위 라인 커버리지 | **25.09%** | 60%+ |

상세: [테스트 커버리지 분석](./coverage.md)

## 6. 알려진 검증 공백

| 공백 | 사유 | 대응 |
|------|------|------|
| 실제 파일 선택기 | 브라우저 네이티브 대화상자는 자동화 불가 | 수동 체크리스트 |
| 실제 디스크 읽기/쓰기 | 위와 동일 (목으로 프로토콜만 검증) | 수동 |
| Firefox · WebKit 실행 | Chromium 프로젝트만 구성 | [F-65](../features/feature-status.md) |
| 반응형 레이아웃 | 뷰포트 테스트 미도입 | 수동 |
| `scrollTop` 복원 | textarea 높이 의존, 단언 불안정 | 미검증 |
| localStorage 용량 초과 | 5MB 채우는 테스트 미도입 | 미검증 |
| CSP · 서비스 워커 (로컬) | `_headers` 는 Cloudflare 전용, SW 는 PROD 전용 | 원격 baseURL 로 E2E 실행 |
| 실제 오프라인 동작 | 네트워크 차단 시나리오 미도입 | 수동 (DevTools Offline) |
| 실제 두 버전 간 `updatefound` | 재배포 없이 자동 재현 불가 | 배포 환경 수동 (2회 배포 후 확인) |
| 과도기 1회 동작 | 현재 워커에 `skipWaiting()` 잔존 | 다음 배포 이후에야 알림이 동작 — 검증 시 감안 |

## 7. 수동 회귀 체크리스트 (릴리즈 전)

### 공통
- [ ] `npm run build` 성공
- [ ] 배포된 URL 접속 시 에디터 표시, 콘솔 에러 없음
- [ ] 한글·이모지 문서 열기/저장 (UTF-8 왕복)
- [ ] 대화상자 취소 시 상태 무변경
- [ ] 탭 3개 전환 시 커서·스크롤 유지
- [ ] 새로고침 후 세션 복원
- [ ] 미저장 상태에서 새로고침 → 이탈 경고

### Chrome / Edge
- [ ] Open → 실제 파일 선택 → 본문·프리뷰 정상
- [ ] Cmd+S 덮어쓰기 후 디스크 내용 확인
- [ ] Save As 로 새 파일 생성
- [ ] 같은 파일 재열기 시 탭 중복 없음
- [ ] 읽기 권한 없는 파일 → 오류 알림, 앱 정상

### Safari / Firefox
- [ ] Open → 업로드 동작
- [ ] Cmd+S → 다운로드 발생, 파일명 정확
- [ ] `data-fs-access="false"` 확인

### 모바일
- [ ] 720px 이하에서 상하 분할
- [ ] 주소창 스크롤 시 레이아웃 유지
- [ ] 백그라운드 전환 후 복귀 시 내용 유지

## 8. 관련 문서

- [테스트 실행 결과](./test-results.md)
- [테스트 커버리지 분석](./coverage.md)
- [사용자 시나리오](../user-scenarios.md)
- [브라우저 API 명세](../api/browser-apis.md)
