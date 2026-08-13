/**
 * F-26 리스트 자동 이어쓰기 · F-27 Tab 들여쓰기 — 계산부 (이슈 #78·#79).
 *
 * DOM 을 만지지 않는 순수 모듈이다. "무엇을 어디에 넣을지" 만 계산하고, 실제
 * 삽입은 호출부가 `execCommand("insertText")` 로 한다 — **`value` 대입으로 바꾸면
 * Cmd+Z 실행 취소 스택이 통째로 날아간다**(`toolbar.ts`·`search.ts` 와 같은 이유).
 */

/** 들여쓰기 한 단계. 탭 문자 대신 공백 2칸 — 마크다운 목록의 관례다. */
export const INDENT = "  ";

export interface ListMarker {
  /** 줄 앞의 공백 */
  indent: string;
  /** `-`, `*`, `+`, 또는 `1.` 같은 번호 */
  bullet: string;
  /** 체크박스 `[ ]` / `[x]` (있으면) */
  checkbox: string;
  /** 표식 뒤 본문 */
  content: string;
}

/** 목록 줄이면 구성요소를, 아니면 null. */
export function parseListMarker(line: string): ListMarker | null {
  const match = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (!match) return null;
  return {
    indent: match[1],
    bullet: match[2],
    checkbox: match[3] ? match[3].trimEnd() : "",
    content: match[4],
  };
}

/** 번호 목록이면 다음 번호로 올린 표식, 아니면 그대로. */
function nextBullet(bullet: string): string {
  const match = /^(\d+)([.)])$/.exec(bullet);
  if (!match) return bullet;
  return `${Number(match[1]) + 1}${match[2]}`;
}

export interface ContinuationResult {
  /** 선택 구간을 이 문자열로 대체한다. */
  replacement: string;
  /** 대체 대상 시작 위치 */
  start: number;
  /** 대체 대상 끝 위치 */
  end: number;
}

/**
 * Enter 를 눌렀을 때 이어 쓸 목록 표식을 계산한다.
 *
 * **빈 항목에서 Enter 를 치면 표식을 지운다**(목록 종료). 그러지 않으면 사용자가
 * 목록을 끝내려고 Enter 를 눌러도 빈 항목만 계속 생겨 빠져나갈 수 없다 —
 * 이어쓰기 기능이 오히려 갇히게 만드는 흔한 실패다.
 *
 * 계산할 것이 없으면 null (브라우저 기본 동작에 맡긴다).
 */
export function computeListContinuation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ContinuationResult | null {
  // 선택 영역이 있으면 관여하지 않는다 — 지우고 줄바꿈하는 기본 동작이 옳다.
  if (selectionStart !== selectionEnd) return null;

  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const line = value.slice(lineStart, selectionStart);
  const marker = parseListMarker(line);
  if (!marker) return null;

  // 빈 항목 → 표식을 지운다(목록 종료).
  if (marker.content.trim() === "") {
    return { replacement: "\n", start: lineStart, end: selectionStart };
  }

  const checkbox = marker.checkbox ? "[ ] " : "";
  return {
    replacement: `\n${marker.indent}${nextBullet(marker.bullet)} ${checkbox}`,
    start: selectionStart,
    end: selectionStart,
  };
}

export interface IndentResult {
  replacement: string;
  start: number;
  end: number;
  /** 삽입 후 선택 영역 */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * 선택이 걸쳐 있는 줄들의 시작·끝 범위.
 *
 * **선택이 어떤 줄의 맨 앞에서 끝나면 그 줄은 포함하지 않는다.** 위 줄 끝까지
 * 드래그하면 커서가 다음 줄 0열에 놓이는데, 그때 다음 줄까지 들여쓰면 사용자가
 * 고르지 않은 줄이 움직인다 — 여러 줄 선택에서 가장 흔한 어긋남이다.
 */
function lineSpan(value: string, selectionStart: number, selectionEnd: number) {
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;

  let effectiveEnd = selectionEnd;
  if (selectionEnd > selectionStart && value[selectionEnd - 1] === "\n") {
    effectiveEnd = selectionEnd - 1;
  }

  const endIndex = value.indexOf("\n", effectiveEnd);
  const end = endIndex === -1 ? value.length : endIndex;
  return { start, end: Math.max(start, end) };
}

/**
 * Tab 들여쓰기.
 *
 * 선택 영역이 없으면 커서 자리에 공백을 넣는다. 여러 줄이 걸쳐 있으면 **줄 전체를**
 * 들여쓴다 — 그러지 않으면 선택이 통째로 공백으로 바뀌어 내용이 사라진다.
 */
export function computeIndent(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): IndentResult {
  const singleLine = !value.slice(selectionStart, selectionEnd).includes("\n");
  if (selectionStart === selectionEnd || singleLine) {
    return {
      replacement: INDENT,
      start: selectionStart,
      end: selectionEnd,
      selectionStart: selectionStart + INDENT.length,
      selectionEnd: selectionStart + INDENT.length,
    };
  }

  const span = lineSpan(value, selectionStart, selectionEnd);
  const block = value.slice(span.start, span.end);
  const indented = block
    .split("\n")
    .map((line) => INDENT + line)
    .join("\n");

  return {
    replacement: indented,
    start: span.start,
    end: span.end,
    selectionStart: span.start,
    selectionEnd: span.start + indented.length,
  };
}

/** Shift+Tab 내어쓰기. 들여쓰기가 없는 줄은 그대로 둔다. */
export function computeOutdent(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): IndentResult {
  const span = lineSpan(value, selectionStart, selectionEnd);
  const block = value.slice(span.start, span.end);

  let removedBeforeCursor = 0;
  const lines = block.split("\n").map((line, index) => {
    const match = /^( {1,2}|\t)/.exec(line);
    if (!match) return line;
    if (index === 0) removedBeforeCursor = match[1].length;
    return line.slice(match[1].length);
  });
  const outdented = lines.join("\n");

  // 커서만 있는 경우 위치를 보존한다 — 줄 시작보다 앞으로 가면 안 된다.
  const collapsed = selectionStart === selectionEnd;
  const nextCaret = Math.max(span.start, selectionStart - removedBeforeCursor);

  return {
    replacement: outdented,
    start: span.start,
    end: span.end,
    selectionStart: collapsed ? nextCaret : span.start,
    selectionEnd: collapsed ? nextCaret : span.start + outdented.length,
  };
}
