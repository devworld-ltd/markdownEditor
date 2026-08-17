/**
 * 커서 위치 계산 (이슈 #152).
 *
 * ## 이 기능의 본체는 "언제 계산하느냐" 다
 *
 * 문서 통계(F-29)는 **150ms 렌더 디바운스에 얹혀 있다** — 매 글자마다 전체를
 * 훑으면 큰 문서에서 타이핑이 느려지기 때문이다. 그런데 커서 위치는 **즉시성이
 * 값어치**라 같은 디바운스에 얹으면 늦게 따라오는 것처럼 보인다.
 *
 * 그래서 둘로 나눴다:
 *
 * | 무엇 | 언제 | 비용 (실측, 약 95,000자) |
 * |------|------|--------------------------|
 * | 줄 시작 오프셋 배열 | **본문이 바뀌었을 때만** | 0.088ms |
 * | 행·열 찾기 | 캐럿이 움직일 때마다 | 0.01µs (이진 탐색) |
 *
 * 캐럿 이동은 초당 수십 번 일어나지만 그때 하는 일은 **이진 탐색뿐**이라 사실상
 * 공짜다. 배열을 다시 만드는 쪽은 입력할 때만 일어나고, 그 비용도 한 프레임
 * 예산(16ms)의 200분의 1이다.
 *
 * > 선형 탐색(캐럿까지 개행을 세는 방식)은 같은 문서에서 0.095ms 로, **배열을
 * > 통째로 다시 만드는 것과 비용이 같았다.** 캐시가 이득을 보는 이유는 탐색이
 * > 싸서가 아니라 **입력보다 캐럿 이동이 훨씬 잦기** 때문이다.
 *
 * 줄 나누기는 `sourceLines.ts` 의 `lineStartOffsets()` 를 그대로 쓴다 — 새 파서를
 * 만들지 않는다.
 *
 * 순수 모듈이다.
 */

export interface CaretPosition {
  /** 1부터 센다 — 사람이 세는 방식이다. */
  line: number;
  column: number;
}

export interface SelectionInfo {
  chars: number;
  lines: number;
}

/**
 * 캐럿이 몇 행 몇 열인가.
 *
 * `lineStarts` 는 오름차순이므로 **이진 탐색**으로 찾는다. 앞에서부터 세면 문서
 * 끝에서 캐럿을 움직일 때마다 전체를 훑게 된다.
 */
export function caretPositionAt(
  lineStarts: readonly number[],
  offset: number,
): CaretPosition {
  if (lineStarts.length === 0) return { line: 1, column: 1 };
  const target = Math.max(0, offset);

  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: target - lineStarts[lo] + 1 };
}

/**
 * 선택 영역 정보. 선택이 없으면 `null`.
 *
 * 줄 수는 **개행 수 + 1** 이다 — 한 줄 안에서 고른 것도 1줄이다.
 */
export function selectionInfo(
  text: string,
  start: number,
  end: number,
): SelectionInfo | null {
  if (start === end) return null;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const slice = text.slice(from, to);
  let newlines = 0;
  for (let i = 0; i < slice.length; i += 1) {
    if (slice[i] === "\n") newlines += 1;
  }
  return { chars: slice.length, lines: newlines + 1 };
}

/**
 * 표시 문자열.
 *
 * 한국어에서 "단어" 가 아니라 "어절" 이라고 쓰는 것과 같은 이유로, 여기서는
 * **"글자"** 라고 쓴다 — `length` 가 정확히 세는 것이 그것이다.
 */
export function formatCaret(
  position: CaretPosition,
  selection: SelectionInfo | null = null,
): string {
  const base = `${position.line}행 ${position.column}열`;
  if (!selection) return base;
  // 여러 줄을 골랐을 때만 줄 수를 말한다 — 한 줄이면 "1줄" 은 군더더기다.
  const extra =
    selection.lines > 1
      ? `${selection.chars}자 · ${selection.lines}줄 선택`
      : `${selection.chars}자 선택`;
  return `${base} · ${extra}`;
}
