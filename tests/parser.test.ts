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

  it("GFM 테이블을 변환한다", () => {
    const result = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(result).toContain("<table>");
    expect(result).toContain("<th>A</th>");
  });

  it("취소선을 변환한다", () => {
    expect(parseMarkdown("~~gone~~")).toContain("<del>gone</del>");
  });

  it("breaks 옵션으로 단일 개행을 <br>로 변환한다", () => {
    expect(parseMarkdown("a\nb")).toContain("<br>");
  });
});

describe("parseMarkdown — sanitize", () => {
  it("script 태그를 제거한다", () => {
    const result = parseMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(");
  });

  it("이벤트 핸들러 속성을 제거한다", () => {
    const result = parseMarkdown('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  it("javascript: 링크를 제거한다", () => {
    const result = parseMarkdown("[클릭](javascript:alert(1))");
    expect(result).not.toContain("javascript:");
  });

  it("iframe 을 제거한다", () => {
    const result = parseMarkdown('<iframe src="https://example.com"></iframe>');
    expect(result).not.toContain("<iframe");
  });

  it("안전한 인라인 HTML 은 유지한다", () => {
    const result = parseMarkdown("<em>강조</em>");
    expect(result).toContain("<em>강조</em>");
  });

  it("GFM 체크박스는 유지한다", () => {
    const result = parseMarkdown("- [x] 완료");
    expect(result).toContain('type="checkbox"');
  });
});
