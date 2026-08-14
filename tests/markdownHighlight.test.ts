import { describe, expect, it } from "vitest";

import { highlightInline, highlightMarkdown } from "../src/markdownHighlight";

/** 태그를 걷어낸 순수 텍스트. 오버레이 정렬의 근거가 되는 불변식을 잰다. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe("글자를 더하거나 빼지 않는다 (오버레이 정렬의 전제)", () => {
  const SAMPLES = [
    "",
    "평범한 문장",
    "# 제목",
    "###### 여섯 단계",
    "**굵게** 와 *기울임* 과 ~~취소~~",
    "`인라인 코드`",
    "[링크](https://example.com)",
    "![이미지](/i/abc.png)",
    "> 인용문\n>> 중첩 인용",
    "- 목록\n1. 번호\n2) 괄호",
    "---",
    "```ts\nconst a = 1;\n```",
    "```\n언어 없는 코드\n```",
    "```ts\n닫히지 않은 코드블록",
    "닫히지 않은 **굵게",
    "괄호가 든 [링크](https://ko.wikipedia.org/wiki/마크다운_(형식))",
    "이스케이프 \\*별표\\* 는 그대로",
    "a < b && c > d",
    '따옴표 "인용" 과 & 기호',
    "한글과 🙂 이모지가 섞인 **문장**",
    "여러\n\n빈\n\n줄",
    "  들여쓴 - 목록",
    "표 | 파이프 | 문자",
  ];

  it.each(SAMPLES)("%j", (sample) => {
    expect(textOf(highlightMarkdown(sample))).toBe(sample);
  });

  it("줄 수가 보존된다 — 한 줄이라도 어긋나면 그 아래가 전부 밀린다", () => {
    const text = "# 제목\n\n본문\n\n```ts\ncode\n```\n\n끝";
    expect(highlightMarkdown(text).split("\n")).toHaveLength(text.split("\n").length);
  });

  it("HTML 을 이스케이프한다 — 오버레이는 innerHTML 로 주입된다", () => {
    const html = highlightMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("블록 서식", () => {
  it("제목 표식과 내용을 나눠 칠한다", () => {
    const html = highlightMarkdown("## 제목");
    expect(html).toContain('<span class="md-marker">##</span>');
    expect(html).toContain('<span class="md-heading">제목</span>');
  });

  it("#뒤에 공백이 없으면 제목이 아니다", () => {
    expect(highlightMarkdown("#해시태그")).not.toContain("md-heading");
  });

  it("인용 표식을 칠한다 (중첩 포함)", () => {
    expect(highlightMarkdown(">> 깊은 인용")).toContain('<span class="md-marker">&gt;&gt; </span>');
  });

  it("목록 표식을 칠한다", () => {
    expect(highlightMarkdown("- 항목")).toContain('<span class="md-list">-</span>');
    expect(highlightMarkdown("1. 항목")).toContain('<span class="md-list">1.</span>');
  });

  it("구분선을 칠한다", () => {
    expect(highlightMarkdown("---")).toContain('<span class="md-marker">---</span>');
  });

  it("목록 안의 인라인 서식도 칠한다", () => {
    expect(highlightMarkdown("- **굵은** 항목")).toContain("md-strong");
  });
});

describe("코드블록", () => {
  it("언어를 알면 기존 토크나이저로 칠한다", () => {
    const html = highlightMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain("tok-keyword"); // highlight.ts 의 출력
  });

  it("모르는 언어는 코드 색만 입힌다", () => {
    const html = highlightMarkdown("```brainfuck\n+++\n```");
    expect(html).toContain("md-code-block");
    expect(html).not.toContain("tok-keyword");
  });

  it("코드블록 안의 마크다운 표식은 서식이 아니다", () => {
    const html = highlightMarkdown("```\n# 이건 제목이 아니다\n```");
    expect(html).not.toContain("md-heading");
  });

  it("닫히지 않은 코드블록은 끝까지 코드다", () => {
    const html = highlightMarkdown("```\n# 제목처럼 보이는 줄");
    expect(html).not.toContain("md-heading");
  });

  it("여는 표식과 종류가 달라도 닫히지 않는다", () => {
    const html = highlightMarkdown("```\n~~~\n# 제목 아님\n```");
    expect(html).not.toContain("md-heading");
  });

  it("언어 이름을 따로 칠한다", () => {
    expect(highlightMarkdown("```ts\n```")).toContain('<span class="md-lang">ts</span>');
  });
});

describe("인라인 서식", () => {
  it("굵게·기울임·취소선을 구분한다", () => {
    expect(highlightInline("**a**")).toContain("md-strong");
    expect(highlightInline("*a*")).toContain("md-em");
    expect(highlightInline("~~a~~")).toContain("md-strike");
    expect(highlightInline("__a__")).toContain("md-strong");
    expect(highlightInline("_a_")).toContain("md-em");
  });

  it("**는 *보다 먼저 잡는다 — 순서가 뒤집히면 굵게가 기울임 두 개가 된다", () => {
    const html = highlightInline("**굵게**");
    expect(html).toContain("md-strong");
    expect(html).not.toContain("md-em");
  });

  it("닫히지 않은 표식은 칠하지 않는다 — 어설픈 색은 단색보다 나쁘다", () => {
    expect(highlightInline("**닫히지 않음")).not.toContain("md-strong");
  });

  it("표식 뒤가 공백이면 강조가 아니다", () => {
    // "2 * 3 * 4" 가 기울임이 되면 수식이 색칠된다.
    expect(highlightInline("2 * 3 * 4")).not.toContain("md-em");
  });

  it("링크의 텍스트와 주소를 다르게 칠한다", () => {
    const html = highlightInline("[텍스트](https://example.com)");
    expect(html).toContain('<span class="md-link-text">텍스트</span>');
    expect(html).toContain('<span class="md-url">https://example.com</span>');
  });

  it("주소에 든 괄호를 세면서 닫는다", () => {
    const html = highlightInline("[위키](https://ko.wikipedia.org/wiki/마크다운_(형식))");
    expect(html).toContain("마크다운_(형식)");
  });

  it("이미지는 ! 까지 표식으로 본다", () => {
    expect(highlightInline("![alt](/x.png)")).toContain('<span class="md-marker">!</span>');
  });

  it("인라인 코드 안의 표식은 서식이 아니다", () => {
    expect(highlightInline("`**굵지 않다**`")).not.toContain("md-strong");
  });

  it("이스케이프된 표식은 서식이 아니다", () => {
    expect(highlightInline("\\*별표\\*")).not.toContain("md-em");
  });

  it("닫히지 않은 백틱은 코드가 아니다", () => {
    expect(highlightInline("` 열린 백틱")).not.toContain("md-code");
  });
});

describe("성능 — 오버레이는 타이핑마다 다시 그린다", () => {
  it("큰 문서도 선형 시간에 처리한다", () => {
    const line = "# 제목 **굵게** [링크](url) `코드` 그리고 평범한 문장\n";
    const small = line.repeat(500);
    const large = line.repeat(2000);

    const t0 = performance.now();
    highlightMarkdown(small);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    highlightMarkdown(large);
    const largeMs = performance.now() - t1;

    // 4배 입력이 20배 넘게 걸리면 어딘가 되돌아가고 있다는 뜻이다.
    expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 500));
  });

  it("병적인 입력에서도 멈추지 않는다 (ReDoS 방어)", () => {
    const evil = "*".repeat(5000) + "[".repeat(5000);
    const t0 = performance.now();
    highlightMarkdown(evil);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("표 (F-30 잔여)", () => {
  const TABLE = ["| 이름 | 값 |", "| :--- | ---: |", "| 한글 | 1 |"].join("\n");

  it("파이프와 정렬 표식을 나눠 칠한다", () => {
    const html = highlightMarkdown(TABLE);
    expect(html).toContain('<span class="md-table-pipe">|</span>');
    expect(html).toContain("md-table-align");
  });

  it("글자를 더하거나 빼지 않는다", () => {
    expect(textOf(highlightMarkdown(TABLE))).toBe(TABLE);
  });

  it("칸 안의 인라인 서식을 그대로 칠한다", () => {
    const html = highlightMarkdown("| **굵게** | [링크](url) |\n| --- | --- |\n| a | b |");
    expect(html).toContain("md-strong");
    expect(html).toContain("md-url");
  });

  it("칸의 공백을 그대로 둔다 — 걷어내면 오버레이가 밀린다", () => {
    const padded = "|  이름   | 값 |\n| --- | --- |\n|  a  | b |";
    expect(textOf(highlightMarkdown(padded))).toBe(padded);
  });

  it("구분선이 없으면 표가 아니다", () => {
    const html = highlightMarkdown("a | b\nc | d");
    expect(html).not.toContain("md-table-pipe");
  });

  it("표가 끝나면 다시 일반 서식으로 돌아온다", () => {
    const html = highlightMarkdown(`${TABLE}\n\n# 표 뒤의 제목`);
    expect(html).toContain("md-heading");
  });

  it("코드블록 안의 파이프는 표가 아니다", () => {
    const html = highlightMarkdown("```\n| a | b |\n| --- | --- |\n```");
    expect(html).not.toContain("md-table-pipe");
  });

  it("이스케이프된 파이프는 칸을 나누지 않는다", () => {
    const html = highlightMarkdown("| a \\| b | c |\n| --- | --- |\n| 1 | 2 |");
    // 파이프 표식은 칸 구분자 4개뿐이어야 한다 (첫 줄 기준).
    const firstLine = html.split("\n")[0];
    expect(firstLine.match(/md-table-pipe/g)).toHaveLength(3);
  });

  it("앞뒤 파이프가 없는 표도 칠한다", () => {
    const html = highlightMarkdown("a | b\n--- | ---\n1 | 2");
    expect(html).toContain("md-table-pipe");
  });

  it("빈 줄이 오면 표가 끝난다", () => {
    const html = highlightMarkdown(`${TABLE}\n\na | b`);
    const lastLine = html.split("\n").at(-1)!;
    expect(lastLine).not.toContain("md-table-pipe");
  });
});
