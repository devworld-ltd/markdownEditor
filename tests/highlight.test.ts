import { describe, expect, it } from "vitest";
import {
  highlightToHtml,
  isSupportedLanguage,
  resolveLanguage,
  tokenize,
} from "../src/highlight";

/**
 * F-23 코드 하이라이팅 (이슈 #76).
 *
 * 의존성 없이 직접 쓴 토크나이저다. 검증의 핵심은 **정확도가 아니라 안전**이다 —
 * 모르는 것은 건드리지 않는가, 깨진 입력에 폭주하지 않는가, 출력이 정화
 * 파이프라인을 우회하지 않는가.
 */

const kinds = (code: string, lang: string) =>
  tokenize(code, lang).map((t) => `${t.kind}:${t.text}`);

/**
 * plain 토큰이 몇 조각으로 나뉘는지는 **구현 세부**다(식별자를 만날 때마다 버퍼가
 * 비워진다). 계약은 "색이 붙는 토큰이 무엇인가" 이므로 그것만 본다.
 */
const marked = (code: string, lang: string) =>
  tokenize(code, lang)
    .filter((t) => t.kind !== "plain")
    .map((t) => `${t.kind}:${t.text}`);

describe("resolveLanguage", () => {
  it("별칭을 정규화한다", () => {
    expect(resolveLanguage("js")).toBe("javascript");
    expect(resolveLanguage("TS")).toBe("typescript");
    expect(resolveLanguage("  bash  ")).toBe("shell");
  });

  it("모르는 언어는 null — 어설프게 칠하지 않는다", () => {
    // 틀린 색은 단색보다 나쁘다.
    for (const lang of ["rust", "go", "python", "", null, undefined, "  "]) {
      expect(resolveLanguage(lang), String(lang)).toBeNull();
      expect(isSupportedLanguage(lang), String(lang)).toBe(false);
    }
  });
});

describe("tokenize — 기본", () => {
  it("키워드·숫자·구두점을 가른다", () => {
    expect(marked("const a = 1;", "js")).toEqual([
      "keyword:const",
      "punct:=",
      "number:1",
      "punct:;",
    ]);
  });

  it("줄 주석은 줄 끝까지", () => {
    expect(marked("a // 주석\nb", "js")).toEqual(["comment:// 주석"]);
  });

  it("블록 주석은 닫힐 때까지", () => {
    expect(marked("a /* x\ny */ b", "js")).toEqual(["comment:/* x\ny */"]);
  });

  it("닫히지 않은 블록 주석은 끝까지 — 편집 중에 흔한 상태다", () => {
    expect(marked("a /* 아직", "js")).toEqual(["comment:/* 아직"]);
  });

  it("문자열의 이스케이프를 건너뛴다", () => {
    expect(marked('"a\\"b"', "js")).toEqual(['string:"a\\"b"']);
  });

  it("닫히지 않은 따옴표가 나머지를 통째로 삼키지 않는다", () => {
    // 편집 중에는 열린 따옴표가 흔하다. 화면 전체가 문자열 색이 되면 안 된다.
    const result = kinds('const a = "열림\nconst b = 1;', "js");
    expect(result.some((t) => t.startsWith("keyword:const"))).toBe(true);
    expect(result.filter((t) => t.startsWith("keyword:const"))).toHaveLength(2);
  });

  it("템플릿 리터럴은 여러 줄을 허용한다", () => {
    expect(marked("`a\nb`", "js")).toEqual(["string:`a\nb`"]);
  });

  it("빼기와 음수를 혼동하지 않는다", () => {
    // a-1 을 a, -1 로 읽으면 틀린다. (JS 식별자에는 `-` 가 없으므로 a / - / 1)
    expect(marked("a-1", "js")).toEqual(["punct:-", "number:1"]);
  });

  it("모르는 언어는 통째로 plain", () => {
    expect(kinds("fn main() {}", "rust")).toEqual(["plain:fn main() {}"]);
    expect(marked("fn main() {}", "rust")).toEqual([]);
  });

  it("한글·이모지를 깨뜨리지 않는다", () => {
    const code = 'const 이름 = "한글 🙂";';
    expect(tokenize(code, "js").map((t) => t.text).join("")).toBe(code);
  });

  it("어떤 입력에서도 원문을 그대로 복원한다", () => {
    // 토큰을 이어 붙이면 항상 원본이어야 한다 — 글자가 사라지거나 늘면 안 된다.
    const samples = [
      "",
      "   ",
      "//",
      '"',
      "`",
      "/*",
      "const x = `a${b}c`; // 끝",
      "#!/bin/sh\necho 'hi' # 주석",
      '{"a": 1, "b": [true, null]}',
      "a".repeat(5000),
    ];
    for (const lang of ["js", "ts", "json", "css", "html", "sh"]) {
      for (const sample of samples) {
        expect(tokenize(sample, lang).map((t) => t.text).join(""), `${lang}:${sample}`).toBe(
          sample,
        );
      }
    }
  });

  it("병적인 입력에도 선형 시간이다 (ReDoS 없음)", () => {
    // 정규식 대안에 백트래킹이 생기면 이런 입력에서 지수 시간이 된다.
    const evil = '"'.repeat(20000) + "\\".repeat(20000);
    const start = Date.now();
    tokenize(evil, "js");
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("tokenize — 언어별", () => {
  it("JSON 의 true/false/null 을 키워드로 본다", () => {
    expect(marked('{"a":true}', "json")).toContain("keyword:true");
  });

  it("셸의 # 주석", () => {
    expect(marked("echo hi # 주석", "sh")).toContain("comment:# 주석");
  });

  it("셸의 # 는 JS 에서는 주석이 아니다", () => {
    expect(marked("a # b", "js").some((t) => t.startsWith("comment"))).toBe(false);
  });

  it("CSS 는 하이픈을 식별자에 포함한다", () => {
    expect(marked("font-size", "css")).toEqual([]);
    expect(tokenize("font-size", "css")).toEqual([{ kind: "plain", text: "font-size" }]);
  });
});

describe("highlightToHtml", () => {
  it("토큰을 span 으로 감싼다", () => {
    expect(highlightToHtml("const a", "js")).toBe(
      '<span class="tok-keyword">const</span> a',
    );
  });

  it("HTML 특수문자를 이스케이프한다", () => {
    // 이스케이프를 빼먹으면 코드 안의 <script> 가 실제 태그가 된다.
    const html = highlightToHtml('const a = "<script>";', "js");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("class 외에는 어떤 속성도 넣지 않는다", () => {
    // style·이벤트 속성을 넣기 시작하면 DOMPurify 허용 목록을 계속 열어야 한다.
    const html = highlightToHtml("const a = 1; // x", "js");
    const attrs = [...html.matchAll(/<span ([^>]*)>/g)].map((m) => m[1]);
    for (const attr of attrs) expect(attr).toMatch(/^class="tok-[a-z]+"$/);
  });

  it("모르는 언어는 이스케이프만 하고 span 을 넣지 않는다", () => {
    const html = highlightToHtml("fn main() { }", "rust");
    expect(html).not.toContain("<span");
    expect(html).toBe("fn main() { }");
  });

  it("이스케이프한 텍스트를 되돌리면 원문이다", () => {
    const code = 'a & b < c > d "e"';
    const html = highlightToHtml(code, "rust");
    const back = html
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    expect(back).toBe(code);
  });
});
