# 테스트 커버리지 분석

> 측정일: 2026-08-12 · 대상: 웹 전환 (v2.0.0)
> 명령: `npm run test:coverage` (Vitest v8 provider, jsdom), `npm run test:e2e`

## 0. 요약

이 프로젝트는 단일 레포이며 백엔드·어드민·서브모듈이 없다. 웹 전환으로 Swift 코드까지 제거되어 **검증 대상은 `src/*.ts` 10개 파일 하나뿐**이다.

| 구성 요소 | 단위 | E2E | 판정 |
|-----------|------|-----|------|
| 웹 프론트엔드 (`src/*.ts`) | **8.11%** (라인 8.39%) | 20/23 기능 커버 | ⚠️ 단위 취약 · E2E 양호 |
| 네이티브 셸 (Swift) | — | — | 🗑 제거됨 |
| 백엔드 / 어드민 | 해당 없음 | 해당 없음 | — |

전환 전 0.91% → 현재 8.11%. 개선폭은 새로 추가한 `storage.ts` 테스트에서 나왔고, **DOM 결합 모듈은 여전히 0%** 다.

## 1. 단위 테스트 커버리지

```
Statements : 8.11% ( 34/419 )
Branches   : 7.14% ( 13/182 )
Functions  : 9.41% (  8/85 )
Lines      : 8.39% ( 32/381 )
```

| 파일 | Stmts | Branch | Funcs | Lines | 비고 |
|------|-------|--------|-------|-------|------|
| `parser.ts` | **100%** | **100%** | **100%** | **100%** | 순수 함수. sanitize 포함 13케이스 |
| `storage.ts` | **88.57%** | 86.66% | **100%** | 93.54% | 신규. 미커버 라인은 storage 접근 throw / QuotaExceeded catch |
| `preview.ts` | 0% | 100% | 0% | 0% | 분기 없음 |
| `editor.ts` | 0% | 0% | 0% | 0% | 디바운스 미검증 |
| `tabs.ts` | 0% | 0% | 0% | 0% | **상태 로직 전량 미검증 (298줄)** |
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

**기능 커버리지: 20/23 자동 검증 (87%)**
**URL 커버리지: 13/13 (100%)**

## 3. 커버리지 공백 — 우선순위별

### 우선순위 높음

| 대상 | 미검증 로직 | 권장 테스트 |
|------|-------------|-------------|
| `tabs.ts` | `closeTab` 3분기, `switchTab` 스냅샷·복원, `restoreSession` ID 시퀀스 복구, `syncActiveTab` | jsdom 단위 테스트 (`initTabs` 에 가짜 DOM 주입) |
| `fileOps.ts` | `saveFile` 핸들 유무 분기, `suggestFileName` 확장자 보정, `isAbort` 판별 | `suggestFileName` 을 순수 함수로 분리하면 즉시 단위 테스트 가능 |
| `toolbar.ts` | `wrapSelection`·`insertAtLineStart`·`insertBlock` 경계 조건 (첫 줄, 선택 없음, 개행 직후) | 순수 함수로 추출 후 문자열 단위 테스트 |
| `storage.ts` 잔여 | `QuotaExceededError` 경로 | `setItem` 스텁으로 throw 유도 |

### 우선순위 중간

| 대상 | 미검증 로직 |
|------|-------------|
| `editor.ts` | 디바운스 타이머 취소/재설정 — fake timers 로 검증 가능 |
| `shortcuts.ts` | 수식어 없는 키 무시, Alt 조합의 `e.code` 판별, Shift 분기 |
| `notice.ts` | 타이머 중첩 시 이전 타이머 취소 |
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
