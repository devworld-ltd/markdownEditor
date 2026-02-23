# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

바닐라 TypeScript로 만든 마크다운 에디터. 프레임워크 없이 순수 TypeScript + DOM API를 사용하며, `marked` 라이브러리로 마크다운을 HTML로 변환한다.

## 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | Vite 개발 서버 실행 |
| `npm run build` | TypeScript 컴파일 + Vite 빌드 (→ `dist/`) |
| `npm run preview` | 빌드 결과물 미리보기 |
| `npm test` | 전체 테스트 실행 (vitest) |
| `npm run test:watch` | 워치 모드 테스트 |
| `npx vitest run tests/parser.test.ts` | 단일 테스트 파일 실행 |

## 아키텍처

좌우 분할 레이아웃: 왼쪽 textarea(에디터) + 오른쪽 div(프리뷰). 입력 시 디바운스(150ms)를 거쳐 프리뷰가 갱신된다.

**모듈 흐름:**
```
main.ts → editor.ts → preview.ts → parser.ts → marked
```

- **`main.ts`** — 엔트리포인트. DOM 요소를 찾아 에디터를 초기화한다.
- **`editor.ts`** — 에디터 로직. textarea의 input 이벤트를 디바운스로 처리하고 프리뷰 갱신을 트리거한다.
- **`preview.ts`** — 파싱된 HTML을 프리뷰 패널에 렌더링한다.
- **`parser.ts`** — `marked` 라이브러리 래퍼. GFM + line breaks 옵션이 활성화되어 있다.

## 핵심 의존성

- **marked** — 마크다운→HTML 변환 (GFM 지원)
- **Vite** — 번들러 및 개발 서버
- **Vitest** — 테스트 러너 (Vite 기반)

## 테스트

테스트 파일은 `tests/` 디렉토리에 `*.test.ts` 패턴으로 작성한다. 현재 `parser.test.ts`에서 마크다운 변환 로직을 테스트한다.
