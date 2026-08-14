# 테스트 커버리지 분석

> 측정일: 2026-08-12 · 대상: 웹 전환 (v2.0.0)
> 명령: `npm run test:coverage` (Vitest v8 provider, jsdom), `npm run test:e2e`

## 0. 요약

이 프로젝트는 단일 레포이며 백엔드·어드민·서브모듈이 없다. 웹 전환으로 Swift 코드까지 제거되어 **검증 대상은 `src/*.ts` 10개 파일**과 커버리지 집계 밖의 `public/sw.js` 다.

| 구성 요소 | 단위 | E2E | 판정 |
|-----------|------|-----|------|
| 웹 프론트엔드 (`src/*.ts`) + Worker | **77.0%** (라인 77.61%) | 47/50 기능 커버 | ✅ 목표 초과 |
| 네이티브 셸 (Swift) | — | — | 🗑 제거됨 |
| 백엔드 / 어드민 | 해당 없음 | 해당 없음 | — |

전환 전 0.91% → 8.37% → 24.19% → 현재 **60.76%**.

**커버리지는 테스트를 더 써서가 아니라 의존 방향을 정리해서 올랐다.** 같은 처방이 네 번 통했다.

| # | 조치 | 결과 |
|---|------|------|
| 1 | `swUpdate.ts` 를 `SwUpdateHost` 주입형 리프로 설계 | 79.9% |
| 2 | `hasController()` 를 host 로 이동 (이슈 #11) | 테스트의 전역 `navigator` 패치가 **통째로 사라짐** |
| 3 | `textEdit.ts` 로 문자열 계산을 DOM 삽입에서 분리 | 100% |
| 4 | `tabs.ts` 에 가짜 DOM 주입 | 6.97% → **97.67%** |
| 5 | `fsLimitNotice.ts` 를 주입형 리프로 신설 (F-58) | 100% |
| 6 | `fileOps.ts` 에 `FileOpsHost` 도입 — 플랫폼 API 만 분리 | 5.19% → **89.77%** |
| 7 | `scrollSync.ts` 를 `ScrollSyncHost` 주입형 리프로 신설 | **97.77%** |

7번은 주입이 **취향이 아니라 유일한 검증 수단**인 사례다. jsdom 은 `scrollHeight`/`clientHeight` 를 항상 0 으로 보고하므로, 실제 DOM 요소를 쓰면 매핑 함수와 0 나눗셈 가드에 단위 테스트가 **도달조차 할 수 없다**.

6번은 **완전한 리프화가 답이 아니라는 것**도 보여준다. `fileOps.ts` 는 본질적으로 탭 상태를 바꾸는 모듈이라 `tabs.ts` 의존을 끊으면 호출부만 복잡해진다. 검증에 필요한 것은 **플랫폼 경계뿐**이었다.

가장 큰 이득은 숫자가 아니라 **`tabs.ts`(333줄, 이 앱의 핵심 상태 저장소)에 안전망이 생긴 것**이다. 이전에는 고쳤을 때 무엇이 깨지는지 알려주는 게 E2E 뿐이라 상태 로직 리팩터링이 사실상 불가능했다.

## 1. 단위 테스트 커버리지

```
Statements : 72.42%
Branches   : 68.19%
Functions  : 59.72%
Lines      : 77.61%   ← 목표 60% 초과 달성
```

여정: 0.91% → 8.37% → 24.19% → 60.76% → 62.32% → **73.78%**

| 파일 | Stmts | Branch | Funcs | Lines | 비고 |
|------|-------|--------|-------|-------|------|
| `parser.ts` | **100%** | **100%** | **100%** | **100%** | 순수 함수. sanitize 포함 13케이스 |
| `textEdit.ts` | **100%** | **100%** | **100%** | **100%** | 신규 리프. 문자열 계산만 |
| `notice.ts` | 94.11% | 66.66% | **100%** | **100%** | |
| `tabs.ts` | **94.52%** | 88.57% | 91.3% | **97.67%** | 6.97% → 97.67%. 이 PR 묶음의 핵심 성과 |
| `offline.ts` | 73.07% | **100%** | 44.44% | 79.16% | 주입형 리프. 미커버는 기본 host 구현 |
| `fsLimitNotice.ts` | **100%** | 91.66% | **100%** | **100%** | 신규 주입형 리프 (F-58) |
| `fileOps.ts` | 88.54% | 82.35% | 62.5% | **89.77%** | 5.19% → 89.77%. `FileOpsHost` 로 플랫폼 API 만 주입 경계로 분리 |
| `scrollSync.ts` | 97.43% | 97.72% | 91.3% | **98.09%** | 미커버는 실제 `rAF` 기본 구현(주입 테스트에서 안 닿는 게 정상) |
| `shortcutDefs.ts` | 100% | 100% | 100% | **100%** | 순수 모듈. DOM 을 import 하지 않아 평범한 객체로 전부 검증된다 |
| `shortcutHelp.ts` | 98.43% | 95% | 85.71% | **100%** | 주입형 리프 |
| `searchEngine.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `splitLayout.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `tabOrder.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `editorPrefs.ts` | 100% | 80% | 100% | **100%** | 순수 모듈 |
| `editorSettings.ts` | 95.52% | 87.5% | 89.47% | **98.38%** | 주입형 리프 |
| `recentFiles.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `recentFilesUi.ts` | 87.2% | 54.16% | 71.42% | **93.58%** | 주입형 리프 |
| `viewMode.ts` | 100% | 100% | 90.9% | **100%** | 주입형 리프 |
| `htmlExport.ts` | 100% | 92.85% | 100% | **100%** | 순수 모듈 |
| `clipboardExport.ts` | 100% | 100% | 100% | **100%** | 주입형 리프 — 클립보드 실패 경로까지 전부 검증 |
| `highlight.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 — ReDoS 없음과 원문 복원을 단위로 못 박았다 |
| `lineNumbers.ts` | 59.49% | 80% | 71.42% | **59.45%** | 미커버는 미러 측정 — 실제 레이아웃이 필요해 E2E 가 맡는다(`search.ts`·`scrollSync.ts` 와 같은 패턴) |
| `editorKeys.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `editorBehavior.ts` | 97.77% | 100% | 83.33% | **97.56%** | 주입형 리프 |
| `imageUpload.ts` | 96.77% | 88.88% | 100% | **100%** | 순수 모듈 — Worker 와 브라우저가 함께 쓴다 |
| `editorDrop.ts` | 85.48% | 80.76% | 76.92% | **86.53%** | 주입형 리프 |
| `docStats.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `statusBar.ts` | 84.84% | 75% | 55.55% | **87.09%** | 주입형 리프 |
| `tableFormat.ts` | 95.36% | 89.24% | 100% | **98.24%** | 순수 모듈 |
| `tableUi.ts` | 88.29% | 62.5% | 77.77% | **94.25%** | 주입형 리프 |
| `dropFiles.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `sessionReclaim.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 |
| `markdownHighlight.ts` | 98.31% | 96.29% | 100% | **100%** | 순수 모듈 |
| `editorOverlay.ts` | 100% | 91.66% | 100% | **100%** | 주입형 리프 |
| `shareId.ts` | 100% | 100% | 100% | **100%** | 순수 모듈 — Worker 와 브라우저가 함께 쓴다 |
| `share.ts` | 100% | 75% | 100% | **100%** | 주입형 리프 |
| `index.ts` | 100% | 100% | 100% | **100%** | **Worker**. R2·자산 바인딩을 가짜로 주입해 workerd 없이 계약 전부를 검증 |
| `splitter.ts` | 97.22% | 90.9% | 93.33% | **100%** | 주입형 리프. jsdom 에 레이아웃이 없어 컨테이너 사각형을 심어야 드래그 경로에 도달한다 |
| `search.ts` | 79.32% | 78.37% | 82.75% | **80%** | 미커버는 미러 측정과 `execCommand` 기본 구현 — 둘 다 실제 브라우저가 필요해 E2E 가 맡는다 |
| `editor.ts` · `shortcuts.ts` | 커버됨 | | | | 신규 단위 테스트 |
| `storage.ts` | **91.42%** | 86.66% | **100%** | 96.77% | 미커버는 storage 접근 자체가 throw 하는 경로 |
| `swUpdate.ts` | **78.90%** | 60.71% | 70.37% | **85.45%** | 신규. 미커버는 기본 host 구현(실제 `navigator` 경로)과 `postMessage` 실패 분기 |
| `preview.ts` | 0% | 100% | 0% | 0% | 분기 없음 |
| `editor.ts` | 0% | 0% | 0% | 0% | 디바운스 미검증 |
| `tabs.ts` | 0% | 0% | 0% | 0% | **상태 로직 전량 미검증 (333줄)** |
| `toolbar.ts` | 0% | 0% | 0% | 0% | 텍스트 조작 3함수 미검증 (219줄) |
| `fileOps.ts` | 0% | 0% | 0% | 0% | 파일 I/O 분기 미검증 (216줄) |
| `shortcuts.ts` | 0% | 0% | 0% | 0% | 키 매핑 미검증 |
| `notice.ts` | 0% | 0% | 0% | 0% | 신규, 미검증 |
| `main.ts` | 0% | 0% | 0% | 0% | 부트스트랩 |

**원인은 전환 전과 동일하다**: `parser.ts`·`storage.ts` 를 제외한 모든 모듈이 DOM 과 모듈 스코프 싱글턴에 직접 결합돼 있다. 다만 이번에 `storage.ts` 를 리프 모듈로 분리한 것이 "의존 방향을 정리하면 테스트가 붙는다" 는 것을 보여준다.

## 2. E2E 기능 커버리지

| 기능 ID | 기능 | E2E | 스펙 |
|---------|------|-----|------|
| F-01 | 실시간 프리뷰 | ✅ | `editor.spec.ts` |
| F-02 | GFM 렌더링 | ✅ | `editor.spec.ts` + 단위 |
| F-03 | 분할 레이아웃 | ⚠️ 요소 존재만 | `editor.spec.ts` |
| F-04 | 툴바 16종 | ✅ 전 버튼 | `toolbar.spec.ts` |
| F-05 | 멀티 탭 | ✅ | `tabs.spec.ts` |
| F-06 | 커서 보존 | ⚠️ 커서만 (`scrollTop` 미검증) | `tabs.spec.ts` |
| F-07 | 파일 열기 | ✅ 양쪽 경로 | `fileaccess.spec.ts` |
| F-08 | 저장 / 다른 이름으로 | ✅ 양쪽 경로 | `fileaccess.spec.ts` |
| F-09 | dirty 마커 | ✅ | `tabs.spec.ts` |
| F-10 | 타이틀 동기화 | ✅ | `tabs.spec.ts` |
| F-11 | 중복 열기 방지 | ✅ (폴백 제약도 문서화) | `fileaccess.spec.ts` |
| F-12 | 단축키 | ✅ 5종 전부 | `fileaccess.spec.ts`, `tabs.spec.ts` |
| F-14 | 알림 | ✅ 성공·실패 | `fileaccess.spec.ts` |
| F-15 | 닫기 확인 | ✅ 확인/취소 | `tabs.spec.ts` |
| F-15 | 이탈 경고 | ❌ `beforeunload` 자동화 어려움 | 수동 |
| F-16 | undo 보존 삽입 | ⚠️ 간접 | `toolbar.spec.ts` |
| F-18 | sanitize | ✅ | 단위 6 + E2E 2 |
| F-19 | 세션 자동 저장 | ✅ | `session.spec.ts` |
| F-20 | 세션 복원 | ✅ | `session.spec.ts` |
| F-31 | 반응형 | ❌ 뷰포트 테스트 없음 | 수동 |
| F-52 | CF 배포 | ⚠️ `--dry-run` 만 | — |
| F-53 | 저장소 불가 안내 | ⚠️ 단위만 | `storage.test.ts` |
| F-54 | 용량 초과 알림 | ✅ | `hardening.spec.ts`, `storage.test.ts` |
| F-61 | PWA · 오프라인 | ⚠️ manifest·등록만 (실제 오프라인 미검증) | `hardening.spec.ts` |
| F-62 | CSP · 보안 헤더 | ✅ 배포 환경 | `hardening.spec.ts` |
| F-69 | 갱신 알림 | ✅ 단위 20 + STUB 10 / ⚠️ 실제 두 버전 감지는 수동 | `swUpdate.test.ts`, `swupdate.spec.ts` |

**기능 커버리지: 31/34 자동 검증 (91%)**
**URL 커버리지: 13/13 (100%)**

## 3. 커버리지 공백 — 우선순위별

### 우선순위 높음

| 대상 | 미검증 로직 | 권장 테스트 |
|------|-------------|-------------|
| `tabs.ts` | `closeTab` 3분기, `switchTab` 스냅샷·복원, `restoreSession` ID 시퀀스 복구, `syncActiveTab` | jsdom 단위 테스트 (`initTabs` 에 가짜 DOM 주입) |
| `fileOps.ts` | `saveFile` 핸들 유무 분기, `suggestFileName` 확장자 보정, `isAbort` 판별 | `suggestFileName` 을 순수 함수로 분리하면 즉시 단위 테스트 가능 |
| `toolbar.ts` | `wrapSelection`·`insertAtLineStart`·`insertBlock` 경계 조건 (첫 줄, 선택 없음, 개행 직후) | 순수 함수로 추출 후 문자열 단위 테스트 |
| `notice.ts` | 타이머 중첩 시 이전 타이머 취소, `hidden` 토글 | jsdom 단위 테스트 (리프 모듈이라 즉시 가능) |
| `public/sw.js` | 캐시 전략 3분기, 구버전 캐시 정리, `SKIP_WAITING` 수신 | Service Worker 테스트 하니스 또는 오프라인 E2E |
| `swUpdate.ts` 잔여 | 기본 host 구현(실제 `navigator` 경로), `postMessage` 실패 분기 | 이슈 #11(`hasController()` 주입)이 해결되면 기본 구현도 주입 경계로 내려와 검증 가능해진다 |

### 우선순위 중간

| 대상 | 미검증 로직 |
|------|-------------|
| `editor.ts` | 디바운스 타이머 취소/재설정 — fake timers 로 검증 가능 |
| `shortcuts.ts` | 수식어 없는 키 무시, Alt 조합의 `e.code` 판별, Shift 분기 |
| `parser.ts` | 매우 긴 문서 성능 |

### 우선순위 낮음

- `main.ts` 방어 분기 (`#editor`/`#preview` 부재)
- `style.css` 시각 회귀

## 4. 개선 로드맵

| 단계 | 작업 | 기대 라인 커버리지 |
|------|------|--------------------|
| 1 | `toolbar.ts` 텍스트 조작 3함수 + `fileOps.suggestFileName` 을 순수 함수로 추출해 단위 테스트 | ~30% |
| 2 | `tabs.ts` 단위 테스트 (jsdom + 가짜 DOM 주입) | ~60% |
| 3 | `fileOps.ts` 단위 테스트 (picker·Blob 모킹) | ~75% |
| 4 | `editor.ts` fake timers, `notice.ts`, `shortcuts.ts` | ~85% |
| 5 | CI 에 커버리지 임계값(`thresholds`) 설정해 회귀 차단 | — |
| 6 | Playwright 프로젝트에 Firefox·WebKit 추가 (F-65) | E2E 신뢰도 |

1단계는 프로덕션 코드 리팩터링이 선행되지만 가장 비용 대비 효과가 크다. jsdom 환경은 이미 구성돼 있어 2단계 진입 장벽은 낮다.

## 5. 리포트 위치

| 리포트 | 경로 | 생성 명령 |
|--------|------|-----------|
| 단위 커버리지 (HTML) | `coverage/index.html` | `npm run test:coverage` |
| 단위 커버리지 (JSON) | `coverage/coverage-summary.json` | 동일 |
| E2E 리포트 (HTML) | `playwright-report/index.html` | `npm run test:e2e` |
| E2E 실패 아티팩트 | `test-results/` | 실패 시 자동 (CI 는 7일 보관) |

세 디렉터리 모두 `.gitignore` 에 등록되어 있다.

## 6. 관련 문서

- [테스트 계획](./test-plan.md) · [테스트 실행 결과](./test-results.md)
- [기능 개발 현황](../features/feature-status.md)
- [상호 관계 매트릭스](../architecture/traceability.md)


## 총계가 내려가는 경우

기능을 더하면 **총 라인 수가 늘어** 총계 비율이 내려갈 수 있다. 실제로 F-34·F-35 구간에서 78.83% → 77.02% 로 내려갔는데, 원인은 커버리지가 나빠져서가 아니라 **`toolbar.ts`(0%)와 `main.ts`(0%)가 커졌기** 때문이다.

두 파일은 단위 테스트가 없다 — `main.ts` 는 배선만 하는 진입점이고 `toolbar.ts` 는 버튼 정의와 DOM 삽입이라, 둘 다 E2E 가 실제 클릭으로 덮는 편이 의미 있다. 비율을 올리려고 이들에 얇은 단위 테스트를 붙이는 것은 **숫자만 올리고 아무것도 검증하지 않는다**(트랩 #15 의 반대 방향 오류).
