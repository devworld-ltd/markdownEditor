import { describe, expect, it } from "vitest";
import { caretPositionAt, formatCaret, selectionInfo } from "../src/caretPosition";
import { lineStartOffsets } from "../src/sourceLines";

/** #152 커서 위치 계산. */

const TEXT = "첫 줄\n둘째 줄입니다\n\n넷째 줄";
const STARTS = lineStartOffsets(TEXT);

describe("caretPositionAt", () => {
  it("문서 맨 앞은 1행 1열 — 사람이 세는 방식이다", () => {
    expect(caretPositionAt(STARTS, 0)).toEqual({ line: 1, column: 1 });
  });

  it("줄 안에서 열이 늘어난다", () => {
    expect(caretPositionAt(STARTS, 2)).toEqual({ line: 1, column: 3 });
  });

  it("개행 **뒤**가 다음 줄 1열이다", () => {
    const second = TEXT.indexOf("\n") + 1;
    expect(caretPositionAt(STARTS, second)).toEqual({ line: 2, column: 1 });
  });

  it("개행 **앞**은 아직 그 줄이다 — 경계에서 한 줄 앞서면 안 된다", () => {
    const beforeNewline = TEXT.indexOf("\n");
    expect(caretPositionAt(STARTS, beforeNewline).line).toBe(1);
  });

  it("빈 줄도 한 줄로 센다", () => {
    const blank = TEXT.indexOf("\n\n") + 1;
    expect(caretPositionAt(STARTS, blank)).toEqual({ line: 3, column: 1 });
  });

  it("문서 끝에서도 맞는다", () => {
    expect(caretPositionAt(STARTS, TEXT.length)).toEqual({ line: 4, column: 5 });
  });

  it("빈 문서는 1행 1열", () => {
    expect(caretPositionAt(lineStartOffsets(""), 0)).toEqual({ line: 1, column: 1 });
  });

  it("음수 오프셋도 1행 1열로 다룬다", () => {
    expect(caretPositionAt(STARTS, -5)).toEqual({ line: 1, column: 1 });
  });

  it("큰 문서에서도 앞에서부터 세지 않는다 — 모든 줄에서 정확하다", () => {
    // 선형 탐색으로 바꿔도 값은 같으므로, 여기서 고정하는 것은 **정확성**이다.
    const big = Array.from({ length: 2000 }, (_, i) => `줄 ${i}`).join("\n");
    const starts = lineStartOffsets(big);
    expect(caretPositionAt(starts, starts[1999])).toEqual({ line: 2000, column: 1 });
    expect(caretPositionAt(starts, starts[1000] + 3)).toEqual({ line: 1001, column: 4 });
  });
});

describe("selectionInfo", () => {
  it("선택이 없으면 null", () => {
    expect(selectionInfo(TEXT, 3, 3)).toBeNull();
  });

  it("글자 수를 센다", () => {
    expect(selectionInfo(TEXT, 0, 3)).toEqual({ chars: 3, lines: 1 });
  });

  it("한 줄 안의 선택도 1줄이다 — 개행 수 + 1", () => {
    expect(selectionInfo(TEXT, 0, 3)?.lines).toBe(1);
  });

  it("여러 줄을 고르면 줄 수가 는다", () => {
    expect(selectionInfo(TEXT, 0, TEXT.indexOf("\n") + 2)?.lines).toBe(2);
  });

  it("거꾸로 고른 것(끝에서 앞으로)도 같게 센다", () => {
    expect(selectionInfo(TEXT, 5, 0)).toEqual(selectionInfo(TEXT, 0, 5));
  });
});

describe("formatCaret", () => {
  it("선택이 없으면 행·열만", () => {
    expect(formatCaret({ line: 3, column: 5 })).toBe("3행 5열");
  });

  it("한 줄 선택에는 줄 수를 말하지 않는다 — \"1줄\" 은 군더더기다", () => {
    expect(formatCaret({ line: 1, column: 1 }, { chars: 7, lines: 1 })).toBe(
      "1행 1열 · 7자 선택",
    );
  });

  it("여러 줄 선택에는 줄 수를 함께 말한다", () => {
    expect(formatCaret({ line: 1, column: 1 }, { chars: 20, lines: 3 })).toBe(
      "1행 1열 · 20자 · 3줄 선택",
    );
  });
});
