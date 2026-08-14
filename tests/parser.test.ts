import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../src/parser";
import { slugifyLabel } from "../src/markdownExtensions";

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

describe("parseMarkdown — 코드 하이라이팅 (F-23)", () => {
  it("토큰 class 가 정화 후에도 살아남는다", () => {
    // DOMPurify 기본 허용 목록에 class 가 있다는 성질에 기대고 있다.
    // 이게 깨지면 색이 통째로 사라지는데, 예외도 오류도 나지 않는다.
    const html = parseMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain('class="tok-keyword"');
    expect(html).toContain("const");
  });

  it("모르는 언어는 marked 기본 출력 그대로다", () => {
    // 우리 렌더러가 넘겨받으면 미묘한 차이(줄바꿈 처리 등)가 생긴다.
    expect(parseMarkdown("```rust\nfn a() {}\n```")).toBe(
      '<pre><code class="language-rust">fn a() {}\n</code></pre>\n',
    );
  });

  it("코드 안의 위험한 문자열이 태그가 되지 않는다", () => {
    const html = parseMarkdown('```js\nconst a = "<img src=x onerror=alert(1)>";\n```');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("각주 (이슈 #111)", () => {
  it("참조를 위첨자 링크로, 정의를 문서 끝 목록으로 만든다", () => {
    const html = parseMarkdown("본문[^1] 끝\n\n[^1]: 각주 내용");
    expect(html).toContain('<sup class="footnote-ref"><a id="fnref-1" href="#fn-1">1</a></sup>');
    expect(html).toContain('<section class="footnotes">');
    expect(html).toContain('<li id="fn-1">각주 내용');
  });

  it("정의는 그 자리에 아무것도 남기지 않는다 — 각주는 끝에 모여야 각주다", () => {
    const html = parseMarkdown("본문[^1]\n\n[^1]: 내용");
    expect(html.indexOf("footnotes")).toBeGreaterThan(html.indexOf("본문"));
    expect(html).not.toContain("[^1]:");
  });

  it("번호는 정의 순서가 아니라 읽는 순서를 따른다", () => {
    const html = parseMarkdown("가[^b] 나[^a]\n\n[^a]: 에이\n[^b]: 비");
    expect(html).toMatch(/가<sup[^>]*><a id="fnref-b"[^>]*>1<\/a>/);
    expect(html).toMatch(/나<sup[^>]*><a id="fnref-a"[^>]*>2<\/a>/);
  });

  it("같은 각주를 두 번 참조해도 번호가 같다", () => {
    const html = parseMarkdown("가[^1] 나[^1]\n\n[^1]: 내용");
    expect(html.match(/>1<\/a>/g)).toHaveLength(2);
    expect(html.match(/<li id="fn-1"/g)).toHaveLength(1);
  });

  it("정의가 없으면 각주가 아니다 — 어디로도 가지 않는 링크를 만들지 않는다", () => {
    const html = parseMarkdown("본문[^없음] 끝");
    expect(html).toContain("[^없음]");
    expect(html).not.toContain("footnote-ref");
    expect(html).not.toContain("footnotes");
  });

  it("아무도 참조하지 않은 정의는 목록에 넣지 않는다", () => {
    expect(parseMarkdown("본문\n\n[^1]: 쓰이지 않음")).not.toContain("footnotes");
  });

  it("되돌아가기 링크가 참조를 가리킨다", () => {
    const html = parseMarkdown("본문[^1]\n\n[^1]: 내용");
    expect(html).toContain('href="#fnref-1"');
  });

  it("코드블록 안의 표식은 각주가 아니다", () => {
    const html = parseMarkdown("```\n[^1]\n```\n\n[^1]: 내용");
    expect(html).not.toContain("footnote-ref");
  });

  it("인라인 코드 안의 표식도 각주가 아니다", () => {
    expect(parseMarkdown("`[^1]` 코드\n\n[^1]: 내용")).toContain("<code>[^1]</code>");
  });

  it("각주 본문의 인라인 서식을 살린다", () => {
    expect(parseMarkdown("본문[^1]\n\n[^1]: **굵은** 각주")).toContain("<strong>굵은</strong>");
  });

  it("각주 본문도 정화된다 — 정화 경로는 하나뿐이다", () => {
    const html = parseMarkdown('본문[^1]\n\n[^1]: <img src=x onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("라벨이 달라도 id 는 절대 겹치지 않는다", () => {
    const html = parseMarkdown("가[^A B] 나[^a-b]\n\n[^A B]: 하나\n[^a-b]: 둘");
    const ids = [...html.matchAll(/id="fn-([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("라벨에 든 따옴표가 새 속성을 만들지 못한다", () => {
    // 라벨은 사용자 입력이고 그대로 id/href 에 들어간다. 확인할 것은 "그 글자가
    // 없는가" 가 아니라 **속성이 하나 더 생기지 않는가** 다.
    const html = parseMarkdown('본문[^a"onmouseover="x] 끝\n\n[^a"onmouseover="x]: 내용');
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toMatch(/id="fn-[^"]*"/);
  });

  it("문서마다 각주가 새로 시작한다 — 이전 문서의 각주가 따라붙지 않는다", () => {
    parseMarkdown("가[^1]\n\n[^1]: 첫 문서");
    const second = parseMarkdown("나 문서");
    expect(second).not.toContain("footnotes");
    expect(second).not.toContain("첫 문서");
  });

  it("각주가 없는 문서는 예전과 똑같이 렌더된다", () => {
    expect(parseMarkdown("# 제목\n\n본문 **굵게**")).toBe(
      "<h1>제목</h1>\n<p>본문 <strong>굵게</strong></p>\n",
    );
  });
});

describe("정의 목록 (이슈 #111)", () => {
  it("용어와 뜻을 dl/dt/dd 로 만든다", () => {
    const html = parseMarkdown("용어\n: 정의 1\n: 정의 2");
    expect(html).toContain("<dl><dt>용어</dt><dd>정의 1</dd><dd>정의 2</dd></dl>");
  });

  it("앞뒤 문단을 삼키지 않는다", () => {
    const html = parseMarkdown("앞 문단\n\n용어\n: 뜻\n\n뒤 문단");
    expect(html).toContain("<p>앞 문단</p>");
    expect(html).toContain("<p>뒤 문단</p>");
    expect(html).toContain("<dl>");
  });

  it("용어·뜻 안의 인라인 서식을 살린다", () => {
    const html = parseMarkdown("**용어**\n: `코드` 뜻");
    expect(html).toContain("<dt><strong>용어</strong></dt>");
    expect(html).toContain("<code>코드</code>");
  });

  it("본문 속 콜론은 정의 목록이 아니다", () => {
    expect(parseMarkdown("본문에 콜론: 있음\n다음 줄")).not.toContain("<dl>");
  });

  it("뜻 없는 용어만으로는 목록이 되지 않는다", () => {
    expect(parseMarkdown("용어만 있음")).not.toContain("<dl>");
  });
});

describe("각주 라벨 슬러그 (이슈 #111)", () => {
  it("공백·따옴표·꺾쇠·해시를 걷어낸다 — id/href 는 남이 손으로도 쓰는 값이다", () => {
    for (const label of ['a b', 'a"b', "a'b", "a<b>", "a#b", "a&b", "a/b", "a=b"]) {
      const slug = slugifyLabel(label);
      expect(slug, `${label} → ${slug}`).toMatch(/^[^\s"'<>&/\\#?%=]+$/);
    }
  });

  it("한글은 지우지 않는다 — 지우면 한국어 라벨이 죄다 빈 값이 된다", () => {
    expect(slugifyLabel("설명")).toBe("설명");
  });

  it("남는 것이 없으면 기본값을 쓴다", () => {
    expect(slugifyLabel("###")).toBe("fn");
  });

  it("대소문자만 다른 라벨은 같은 슬러그다", () => {
    expect(slugifyLabel("Note")).toBe(slugifyLabel("note"));
  });

  it("id 와 href 에 공백이 들어가지 않는다", () => {
    const html = parseMarkdown("본문[^긴 라벨]\n\n[^긴 라벨]: 내용");
    expect(html).toMatch(/id="fn-[^"\s]+"/);
    expect(html).toMatch(/href="#fn-[^"\s]+"/);
  });
});

describe("각주 안의 각주 (이슈 #111 리뷰에서 발견)", () => {
  it("각주 본문이 참조한 각주도 목록에 들어간다 — 링크만 있고 항목이 없으면 안 된다", () => {
    const html = parseMarkdown("본문[^1]\n\n[^1]: 첫 각주 참고[^2]\n[^2]: 둘째 각주");
    expect(html).toContain('href="#fn-2"');
    expect(html).toContain('<li id="fn-2">둘째 각주');
  });

  it("모든 각주 링크가 실재하는 항목을 가리킨다", () => {
    const html = parseMarkdown("가[^a]\n\n[^a]: 에이 참고[^b]\n[^b]: 비 참고[^c]\n[^c]: 씨");
    const targets = [...html.matchAll(/href="#(fn-[^"]+)"/g)].map((m) => m[1]);
    for (const target of targets) {
      expect(html, `${target} 항목이 없다`).toContain(`id="${target}"`);
    }
  });

  it("자기 자신을 참조해도 멈춘다", () => {
    const html = parseMarkdown("본문[^1]\n\n[^1]: 자기 자신[^1] 참조");
    expect(html.match(/<li id="fn-1"/g)).toHaveLength(1);
  });

  it("같은 각주를 여러 번 참조해도 id 는 하나뿐이다", () => {
    const html = parseMarkdown("가[^1] 나[^1] 다[^1]\n\n[^1]: 내용");
    expect(html.match(/id="fnref-1"/g)).toHaveLength(1);
    // 번호는 모두 같아야 한다.
    expect(html.match(/>1<\/a>/g)).toHaveLength(3);
  });

  it("문서 전체에 같은 id 가 두 번 나오지 않는다", () => {
    const html = parseMarkdown("가[^1] 나[^1] 다[^2]\n\n[^1]: 하나 참고[^2]\n[^2]: 둘");
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
