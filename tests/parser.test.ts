import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../src/parser";

describe("parseMarkdown", () => {
  it("헤딩을 변환한다", () => {
    expect(parseMarkdown("# Hello")).toContain("<h1>Hello</h1>");
  });

  it("볼드 텍스트를 변환한다", () => {
    expect(parseMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("코드 블록을 변환한다", () => {
    const result = parseMarkdown("```\ncode\n```");
    expect(result).toContain("<code>");
  });

  it("빈 문자열을 처리한다", () => {
    expect(parseMarkdown("")).toBe("");
  });
});
