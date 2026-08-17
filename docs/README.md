# 문서 인덱스

MarkdownEditor 프로젝트의 전체 문서 목록. 최종 갱신: 2026-08-12 (웹 전환 v2.0.0 기준).

> **v2.0.0 에서 프로젝트 방향이 바뀌었다.** macOS 네이티브 앱(SwiftUI + WKWebView)에서 **웹 기반 마크다운 에디터**로 전환하고 Cloudflare Workers 에 배포한다. 전환 내역: [웹 전환 히스토리](./history/2026-08-12-web-pivot.md)

## 빠른 진입

| 알고 싶은 것 | 문서 |
|--------------|------|
| 이 앱을 **어떻게 쓰나** (사용자용) | [사용 설명서](./manual.md) |
| 이 앱은 어떻게 동작하나 (**비개발자용**) | [동작 방식 해설](./how-it-works.md) |
| 이 앱은 어떻게 동작하나 (개발자용) | [서비스 아키텍처](./architecture/service-architecture.md) |
| 어떻게 빌드·배포되나 | [인프라 아키텍처](./architecture/infrastructure.md) |
| 상태는 어디에 어떻게 저장되나 | [데이터 모델](./architecture/data-model.md) |
| 브라우저 API 를 어떻게 쓰나 | [브라우저 API 명세](./api/browser-apis.md) |
| 이 코드를 고치면 뭐가 영향받나 | [상호 관계 매트릭스](./architecture/traceability.md) |
| 사용자는 어떻게 쓰나 | [사용자 시나리오](./user-scenarios.md) |
| 뭐가 되고 뭐가 안 되나 | [기능 개발 현황](./features/feature-status.md) |
| 브라우저마다 뭐가 다른가 | [서비스 아키텍처 §6](./architecture/service-architecture.md#6-브라우저-지원-매트릭스) |
| 테스트는 어떻게 돌리나 | [테스트 계획](./testing/test-plan.md) |
| 지금 테스트 상태는 | [테스트 실행 결과](./testing/test-results.md) |
| 배포는 어떻게 되나 | [Cloudflare Workers 구성](./operations/cloudflare-workers.md) |
| 브랜치는 어떻게 쓰나 | [브랜치 전략](./operations/branch-strategy.md) |

## 아키텍처

| 문서 | 내용 |
|------|------|
| [서비스 아키텍처](./architecture/service-architecture.md) | 시스템 구성도, 레이어, 초기화 순서, 데이터 흐름, 브라우저 지원 매트릭스 |
| [인프라 아키텍처](./architecture/infrastructure.md) | 환경 매트릭스(local/dev/prod), 빌드 파이프라인, Wrangler 설정, CI/CD |
| [데이터 모델](./architecture/data-model.md) | `TabState` 스키마, localStorage 세션 스키마, 상태 정합성 규칙, 상태 전이도 |
| [상호 관계 매트릭스](./architecture/traceability.md) | 기능 ↔ 모듈 ↔ 상태 ↔ API ↔ 테스트 추적표, 변경 영향도 |

## API

| 문서 | 내용 |
|------|------|
| [브라우저 API 명세](./api/browser-apis.md) | File System Access API, 업로드/다운로드 폴백, localStorage, 단축키, 이탈 방지, 보안 노트 |

## 기능 · 시나리오

| 문서 | 내용 |
|------|------|
| [사용 설명서](./manual.md) | **사용자용** — 글쓰기·표·그림·파일·탭·검색·내보내기·단축키·문제 해결. 앱의 매뉴얼 버튼이 이 파일을 그대로 보여준다 |
| [동작 방식 해설](./how-it-works.md) | **비개발자용** — 일이 어디서 벌어지나, 정화 경로, 스크롤 짝 맞추기, 공유, 저장 공간 회수 |
| [사용자 시나리오](./user-scenarios.md) | 페르소나 3종, US-01~US-08, 미충족 시나리오 |
| [기능 개발 현황](./features/feature-status.md) | F-01~F-66 구현/부분/미구현/제거 분류, 권장 개발 순서 |

## 테스트

| 문서 | 내용 |
|------|------|
| [테스트 계획](./testing/test-plan.md) | 범위, 환경, URL 인벤토리, 스위트 설계, 수동 회귀 체크리스트 |
| [테스트 실행 결과](./testing/test-results.md) | 단위 1037건 + E2E 463건 결과, 발견·수정한 버그 |
| [테스트 커버리지 분석](./testing/coverage.md) | 파일별 커버리지, 공백 우선순위, 개선 로드맵 |

## 운영

| 문서 | 내용 |
|------|------|
| [Cloudflare Workers 구성](./operations/cloudflare-workers.md) | 환경 매핑, `wrangler.jsonc`, 배포·롤백, 결정 기록 |
| [환경 변수 정리](./operations/environment-variables.md) | 배포 시크릿, `APP_ENV`, 테스트 변수, 도입 규약 |
| [브랜치 전략](./operations/branch-strategy.md) | main/dev/feature/bug 흐름, 커밋 규칙, 릴리즈 절차, 문서 동기화 규칙 |

## 히스토리

| 문서 | 내용 |
|------|------|
| [작업 히스토리](./history/README.md) | 요청 작업별 처리 결과 기록 |
| [웹 전환 (v2.0.0)](./history/2026-08-12-web-pivot.md) | 네이티브 → 웹 전환 전체 내역 |
| [최초 전수 분석 (v1.x)](./history/2026-08-12-project-analysis.md) | ⚠️ 네이티브 시절 기준. 이력 참고용 |

---

## 문서 관리 원칙

1. **코드가 바뀌면 문서도 같은 PR 에서 바뀐다.** 무엇을 고쳐야 하는지는 [변경 영향도 표](./architecture/traceability.md#5-변경-영향도--이-파일을-고치면-어떤-문서를-갱신하나) 참조.
2. 각 문서 상단에 **최종 갱신일 + 대상 버전**을 명시한다.
3. 기능에는 **F-ID**, 시나리오에는 **US-ID**, URL 에는 **U-ID** 를 붙여 문서 간 상호 참조한다.
4. 부재하는 것(DB·HTTP API 등)은 삭제하지 않고 **부재 사실과 사유를 기록**한다.
5. 제거한 기능은 지우지 말고 **🗑 제거됨 + 사유**로 남긴다.
6. 작업 완료 시 [히스토리](./history/README.md) 에 항목을 추가한다.
