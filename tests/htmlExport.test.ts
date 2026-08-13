import { describe, expect, it } from "vitest";
import {
  buildHtmlDocument,
  escapeHtmlText,
  suggestHtmlFileName,
  titleFromFileName,
} from "../src/htmlExport";
import { parseMarkdown } from "../src/parser";

/**
 * F-38 HTML 내보내기 (이슈 #51).
 *
 * 이 모듈은 **마크다운을 파싱하지 않는다.** 정화된 HTML 을 받아 감싸기만 한다 —
 * 여기서 원문을 다시 파싱하면 정화 정책이 두 곳으로 갈라지고, 한쪽만 갱신되는
 * 순간 F-18 이 뚫린다.
 */

describe("escapeHtmlText", () => {
  it("HTML 특수문자를 이스케이프한다", () => {
    expect(escapeHtmlText('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;");
  });

  it("& 를 먼저 바꾼다 — 나중에 하면 이미 만든 엔티티가 다시 망가진다", () => {
    expect(escapeHtmlText("&lt;")).toBe("&amp;lt;");
  });

  it("평범한 텍스트는 그대로", () => {
    expect(escapeHtmlText("보고서 2026")).toBe("보고서 2026");
  });
});

describe("buildHtmlDocument", () => {
  it("독립 실행 가능한 문서를 만든다", () => {
    const doc = buildHtmlDocument("보고서", "<h1>제목</h1>");

    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain("<title>보고서</title>");
    expect(doc).toContain("<h1>제목</h1>");
  });

  it("스타일을 파일 안에 심는다 — 외부 참조가 없어야 혼자 열린다", () => {
    const doc = buildHtmlDocument("t", "<p>본문</p>");

    expect(doc).toContain("<style>");
    // 링크·스크립트로 외부를 부르면 첨부 파일이 인터넷 없이는 깨진다.
    expect(doc).not.toMatch(/<link\b/i);
    expect(doc).not.toMatch(/<script\b/i);
    expect(doc).not.toMatch(/https?:\/\//);
  });

  it("제목에 든 태그가 문서 구조를 깨뜨리지 않는다", () => {
    // 제목은 사용자가 지은 파일명에서 온다 — 본문과 달리 DOMPurify 를 거치지 않는다.
    const doc = buildHtmlDocument("</title><script>alert(1)</script>", "<p>x</p>");

    expect(doc).not.toContain("<script>alert(1)</script>");
    expect(doc).toContain("&lt;/title&gt;");
  });

  it("본문은 손대지 않는다 — 이미 정화된 값이다", () => {
    const body = parseMarkdown("# 제목\n\n**굵게**");
    const doc = buildHtmlDocument("t", body);
    expect(doc).toContain(body);
  });

  it("정화된 본문에는 위험한 것이 애초에 없다", () => {
    // 정화는 parser.ts 의 책임이다. 여기서 다시 하지 않는다는 것을 명시한다.
    const body = parseMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">');
    const doc = buildHtmlDocument("t", body);

    expect(doc).not.toContain("<script>alert(1)</script>");
    expect(doc).not.toContain("onerror");
  });

  it("빈 제목은 기본 제목으로 대체한다", () => {
    expect(buildHtmlDocument("   ", "<p>x</p>")).toContain("<title>문서</title>");
  });

  it("색상 모드를 라이트로 고정한다", () => {
    // 받는 쪽 OS 설정에 따라 첨부 문서의 모양이 달라지면 안 된다.
    expect(buildHtmlDocument("t", "<p>x</p>")).toContain("color-scheme: light");
  });
});

describe("suggestHtmlFileName", () => {
  it("마크다운 확장자를 .html 로 간다", () => {
    expect(suggestHtmlFileName("note.md")).toBe("note.html");
    expect(suggestHtmlFileName("note.markdown")).toBe("note.html");
    expect(suggestHtmlFileName("note.txt")).toBe("note.html");
  });

  it("확장자가 없으면 붙인다", () => {
    expect(suggestHtmlFileName("note")).toBe("note.html");
  });

  it("이미 html 이면 그대로", () => {
    expect(suggestHtmlFileName("page.html")).toBe("page.html");
    expect(suggestHtmlFileName("page.htm")).toBe("page.htm");
  });

  it("Untitled·빈 값은 Untitled.html", () => {
    expect(suggestHtmlFileName("Untitled")).toBe("Untitled.html");
    expect(suggestHtmlFileName("   ")).toBe("Untitled.html");
  });

  it("이름 안의 점을 확장자로 오해하지 않는다", () => {
    expect(suggestHtmlFileName("v1.2 회의록.md")).toBe("v1.2 회의록.html");
  });
});

describe("titleFromFileName", () => {
  it("확장자를 뗀다", () => {
    expect(titleFromFileName("보고서.md")).toBe("보고서");
    expect(titleFromFileName("note.html")).toBe("note");
  });

  it("확장자가 없으면 그대로", () => {
    expect(titleFromFileName("보고서")).toBe("보고서");
  });

  it("Untitled·빈 값", () => {
    expect(titleFromFileName("Untitled")).toBe("Untitled");
    expect(titleFromFileName("  ")).toBe("Untitled");
  });
});
