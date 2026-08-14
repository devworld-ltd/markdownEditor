/**
 * 원문 줄 ↔ 프리뷰 블록 대응 (이슈 #114).
 *
 * ## 왜 필요한가
 *
 * F-25 는 두 패널을 **스크롤 가능 거리의 비율**로 연동한다. 그런데 같은 원문이라도
 * 두 패널의 높이 분포가 다르다 — 제목은 프리뷰에서 크게 렌더되고, 코드블록·표는
 * 줄 수와 렌더 높이가 아예 다르다. 그래서 비율이 같아도 **보이는 줄이 다르다.**
 *
 * 맞추려면 "이 원문 줄이 프리뷰의 어느 위치인가" 를 알아야 한다. 그 대응표의
 * 절반(원문 쪽)을 여기서 만든다 — 최상위 블록이 **몇 번째 줄에서 시작하는지**.
 *
 * ## 렌더 결과가 없는 토큰은 세지 않는다
 *
 * 프리뷰의 자식 요소와 순서대로 짝지을 것이므로, HTML 을 만들지 않는 토큰
 * (빈 줄·링크 정의·각주 정의)이 목록에 끼면 그 뒤가 **통째로 한 칸씩 밀린다.**
 *
 * ## marked 만 쓰고 DOM 은 만지지 않는다
 *
 * 순수 모듈이라 단위 테스트로 경계를 전부 확인할 수 있다.
 */

import { marked } from "marked";

/** HTML 을 만들지 않는 최상위 토큰. 대응표에서 빠져야 한다. */
const INVISIBLE_TOKENS = new Set(["space", "def", "footnoteDef"]);

/**
 * 최상위 블록들이 시작하는 **0-based 줄 번호**.
 *
 * 프리뷰의 최상위 자식 요소와 **같은 개수·같은 순서**로 나오는 것이 이 함수의
 * 계약이다. 개수가 어긋나면 호출부(`scrollAnchors`)가 대응을 포기하고 기존 비율
 * 동기화로 되돌아간다 — 틀린 대응표로 맞추는 것보다 안 맞추는 편이 낫다.
 */
export function blockStartLines(markdown: string): number[] {
  let tokens: Array<{ type: string; raw: string }>;
  try {
    tokens = marked.lexer(markdown) as Array<{ type: string; raw: string }>;
  } catch {
    // 파서가 실패해도 스크롤은 계속 동작해야 한다.
    return [];
  }

  const lines: number[] = [];
  let line = 0;

  for (const token of tokens) {
    if (!INVISIBLE_TOKENS.has(token.type)) lines.push(line);
    // `raw` 의 개행 수가 그 토큰이 소비한 줄 수다.
    line += countNewlines(token.raw ?? "");
  }

  return lines;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") count += 1;
  }
  return count;
}

/** 줄 번호 → 문자 인덱스. 편집기에서 그 줄의 y 를 재려면 인덱스가 필요하다. */
export function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}
