import { describe, it, expect } from "vitest";
import { computeBlockInsertion, computeLineStart, computeWrap } from "../src/textEdit";

describe("computeWrap", () => {
  it("선택 영역이 없으면 placeholder 를 감싸고 재선택 범위를 반환한다", () => {
    const result = computeWrap("hello", 5, 5, "**", "**");
    expect(result.replacement).toBe("**텍스트**");
    expect(result.placeholderSelection).toEqual({ start: 7, end: 10 });
  });

  it("선택 영역이 있으면 그 텍스트를 감싸고 재선택 범위는 null 이다", () => {
    const result = computeWrap("hello world", 0, 5, "**", "**");
    expect(result.replacement).toBe("**hello**");
    expect(result.placeholderSelection).toBeNull();
  });

  it("빈 문자열에서 커서가 0 이어도 placeholder 를 삽입한다", () => {
    const result = computeWrap("", 0, 0, "*", "*");
    expect(result.replacement).toBe("*텍스트*");
    expect(result.placeholderSelection).toEqual({ start: 1, end: 4 });
  });

  it("커서가 문서 끝에 있어도 동일하게 동작한다", () => {
    const value = "abc";
    const result = computeWrap(value, value.length, value.length, "`", "`");
    expect(result.replacement).toBe("`텍스트`");
    expect(result.placeholderSelection).toEqual({ start: 4, end: 7 });
  });

  it("before/after 가 비대칭이어도 재선택 범위는 before 길이만큼 밀린다", () => {
    const result = computeWrap("x", 1, 1, "~~", "~~");
    expect(result.placeholderSelection?.start).toBe(3);
  });
});

describe("computeLineStart", () => {
  it("문서 첫 줄에서는 0을 반환한다", () => {
    expect(computeLineStart("hello", 3)).toBe(0);
  });

  it("두 번째 줄 중간에서는 개행 다음 인덱스를 반환한다", () => {
    const value = "first\nsecond";
    // "second" 는 인덱스 6부터 시작, 커서가 "sec|ond" 위치(9)라 가정
    expect(computeLineStart(value, 9)).toBe(6);
  });

  it("빈 문자열에서 커서 0이면 0을 반환한다", () => {
    expect(computeLineStart("", 0)).toBe(0);
  });

  it("줄 맨 앞(개행 직후)에서도 그 줄의 시작을 반환한다", () => {
    const value = "a\nb";
    expect(computeLineStart(value, 2)).toBe(2);
  });
});

describe("computeBlockInsertion", () => {
  it("개행 직후(커서 바로 앞이 \\n)면 앞에 개행을 보충하지 않는다", () => {
    const value = "line1\n";
    expect(computeBlockInsertion(value, value.length, "---")).toBe("---\n");
  });

  it("개행이 아닌 위치(줄 중간 끝)면 앞에 개행을 보충한다", () => {
    const value = "line1";
    expect(computeBlockInsertion(value, value.length, "---")).toBe("\n---\n");
  });

  it("커서가 문서 맨 앞(0)이면 개행을 보충하지 않는다", () => {
    expect(computeBlockInsertion("", 0, "---")).toBe("---\n");
  });

  it("커서가 0보다 크고 직전 문자가 개행이 아니면 보충한다", () => {
    expect(computeBlockInsertion("ab", 2, "---")).toBe("\n---\n");
  });
});
