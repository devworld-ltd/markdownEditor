/**
 * 텍스트 조작의 순수 계산 부분.
 *
 * `toolbar.ts` 의 `wrapSelection`·`insertAtLineStart`·`insertBlock` 은 이 모듈이
 * 계산한 결과를 받아 `document.execCommand("insertText")` 로 실제 DOM 삽입만 수행하는
 * 얇은 껍데기다. `textarea.value` 를 직접 대입하면 `Cmd+Z` undo 스택이 깨지므로
 * (docs/user-scenarios.md US-05) DOM 삽입 방식은 여전히 execCommand 를 쓴다 — 이 모듈은
 * "무엇을 삽입할지" 만 계산하고 "어떻게 삽입할지" 는 모른다.
 *
 * DOM 타입을 인자로 받지 않는다. 다른 앱 모듈에도 의존하지 않는 리프 모듈이다
 * (docs/architecture/traceability.md §2 의존 그래프 참고).
 */

export interface WrapResult {
  /** execCommand("insertText")로 선택 영역에 삽입할 문자열 */
  replacement: string;
  /**
   * 원래 선택 영역이 비어 있었을 때만 채워짐 — 삽입 후 placeholder 를 다시
   * 선택 상태로 만들기 위한 범위. 선택 영역이 있었으면 null (브라우저가 삽입
   * 지점으로 커서를 자동 이동시키므로 별도 처리 불필요).
   */
  placeholderSelection: { start: number; end: number } | null;
}

const DEFAULT_PLACEHOLDER = "텍스트";

/** `before`/`after` 로 선택 영역을 감싼다 (Bold/Italic/Strikethrough/Code 등). */
export function computeWrap(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  before: string,
  after: string,
  placeholder: string = DEFAULT_PLACEHOLDER,
): WrapResult {
  const selected = value.slice(selectionStart, selectionEnd);
  const replacement = `${before}${selected || placeholder}${after}`;

  if (selected) {
    return { replacement, placeholderSelection: null };
  }

  const start = selectionStart + before.length;
  return {
    replacement,
    placeholderSelection: { start, end: start + placeholder.length },
  };
}

/** 커서가 속한 줄의 시작 인덱스 (Heading/List/Blockquote 접두어 삽입 지점). */
export function computeLineStart(value: string, selectionStart: number): number {
  return value.lastIndexOf("\n", selectionStart - 1) + 1;
}

/** 블록 요소(Horizontal Rule 등) 삽입 문자열. 커서 앞에 개행이 없으면 하나 보충한다. */
export function computeBlockInsertion(
  value: string,
  selectionStart: number,
  text: string,
): string {
  const needsNewline = selectionStart > 0 && value[selectionStart - 1] !== "\n";
  return needsNewline ? `\n${text}\n` : `${text}\n`;
}
