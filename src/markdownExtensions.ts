/**
 * 각주 · 정의 목록 (이슈 #111).
 *
 * ## 왜 파서까지 손대는가
 *
 * 편집 영역 하이라이팅(F-23 잔여)을 각주까지 넓히려다 보니, **프리뷰가 각주를
 * 렌더하지 못한다**는 사실이 걸렸다. marked 기본 GFM 에 없어 `[^1]` 이 그냥
 * 평문으로 나온다. 편집 영역에만 색을 입히면 "앱이 각주를 안다" 고 오해하게
 * 되므로 — 색은 언제나 결과와 같은 말을 해야 한다 — 렌더까지 함께 지원한다.
 *
 * ## 새 의존성은 없다
 *
 * marked 확장(`marked.use({ extensions })`)으로 만든다. 이 저장소는 기능 30개를
 * 더하는 동안 런타임 의존성을 `marked`·`DOMPurify` 둘로 유지했고, 각주 하나로
 * 그것을 포기할 이유가 없다.
 *
 * ## 정화 경로는 여전히 하나다
 *
 * 여기서 만든 HTML 도 `parseMarkdown()` 의 `DOMPurify.sanitize()` 를 그대로
 * 통과한다(F-18). 그래도 **여기서 먼저 이스케이프한다** — 정화기가 잡아 주니까
 * 대충 만들어도 된다는 태도는, 나중에 이 HTML 을 다른 경로에서 쓰는 순간 뚫린다.
 *
 * ## 각주 ID 는 사용자 입력이다
 *
 * `[^내 각주]` 처럼 무엇이든 올 수 있고 그대로 `id`/`href` 에 나간다. 그래서
 * **슬러그로 정규화**한 뒤 쓴다. 정규화 결과가 겹치면 뒤에 번호를 붙여 갈라
 * 놓는다 — 두 각주가 같은 `id` 를 가지면 되돌아가기 링크가 엉뚱한 곳으로 간다.
 */

import type { MarkedExtension, Tokens } from "marked";

/** 한 번의 파싱 동안 모이는 각주. `parseMarkdown()` 이 호출마다 새로 만든다. */
export interface FootnoteRegistry {
  /** 정의 본문(마크다운 원문). 키는 정규화 전 원본 라벨. */
  definitions: Map<string, string>;
  /** 참조된 순서. 번호는 이 순서를 따른다 — 정의 순서가 아니라 **읽는 순서**다. */
  order: string[];
  /** 라벨 → 슬러그. 충돌 시 접미 번호가 붙는다. */
  slugs: Map<string, string>;
  /** 이미 쓰인 슬러그 (충돌 판정용). */
  usedSlugs: Set<string>;
}

export function createFootnoteRegistry(): FootnoteRegistry {
  return {
    definitions: new Map(),
    order: [],
    slugs: new Map(),
    usedSlugs: new Set(),
  };
}

let registry: FootnoteRegistry = createFootnoteRegistry();

/** 파싱 한 번마다 새 등록부를 쓴다. 이전 문서의 각주가 남으면 안 된다. */
export function beginFootnotes(): FootnoteRegistry {
  registry = createFootnoteRegistry();
  return registry;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 라벨을 `id` 로 쓸 수 있는 형태로 줄인다.
 *
 * 한글을 지우지 않는다 — 한국어 문서에서 `[^설명]` 은 흔하고, 지우면 라벨이
 * 전부 빈 문자열이 되어 죄다 충돌한다. 대신 **공백·따옴표·꺾쇠처럼 속성값을
 * 깨뜨리는 문자만** 걷어낸다.
 */
export function slugifyLabel(label: string): string {
  const cleaned = label
    .trim()
    .toLowerCase()
    .replace(/[\s"'`<>&/\\#?%=]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "fn";
}

/** 라벨의 슬러그. 같은 라벨은 항상 같은 값, 다른 라벨은 절대 같지 않다. */
function slugFor(label: string): string {
  const existing = registry.slugs.get(label);
  if (existing) return existing;

  const base = slugifyLabel(label);
  let candidate = base;
  let n = 2;
  // 정규화가 서로 다른 라벨을 같은 값으로 뭉갤 수 있다("A B" 와 "a-b").
  // 그대로 두면 되돌아가기 링크가 엉뚱한 각주로 간다.
  while (registry.usedSlugs.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  registry.usedSlugs.add(candidate);
  registry.slugs.set(label, candidate);
  return candidate;
}

/**
 * 참조 번호(1부터)와 **처음 참조인지** 여부. 번호는 처음 참조된 순서를 따른다.
 *
 * 처음인지 구분하는 이유: `id` 는 문서에서 유일해야 하는데, 같은 각주를 여러 번
 * 참조하는 것은 흔한 일이다(`가[^1] 나[^1]`). 참조마다 같은 `id` 를 붙이면
 * 문서에 같은 `id` 가 여러 개 생긴다.
 */
function referenceFor(label: string): { number: number; first: boolean } {
  const index = registry.order.indexOf(label);
  if (index >= 0) return { number: index + 1, first: false };
  registry.order.push(label);
  return { number: registry.order.length, first: true };
}

interface FootnoteRefToken extends Tokens.Generic {
  type: "footnoteRef";
  label: string;
}

interface FootnoteDefToken extends Tokens.Generic {
  type: "footnoteDef";
  label: string;
  body: string;
}

interface DefinitionListEntry {
  /** 용어·뜻의 **인라인 토큰**. 토크나이저에서 만들어 둔다 — 렌더러에는
   *  lexer 가 없어서 그때 가서는 문자열을 토큰으로 바꿀 수 없다(marked 17). */
  term: unknown[];
  details: unknown[][];
}

interface DefinitionListToken extends Tokens.Generic {
  type: "definitionList";
  entries: DefinitionListEntry[];
}

/**
 * `[^라벨]` 참조.
 *
 * **정의가 없으면 각주가 아니다.** 정의 없는 참조를 링크로 만들면 어디로도
 * 가지 않는 링크가 생긴다 — 그럴 바에는 쓴 그대로 두는 편이 정직하다.
 * 그래서 정의는 블록 단계에서 먼저 모이고(marked 는 블록 → 인라인 순으로
 * 토큰화한다), 이 토크나이저는 그 결과를 본다.
 */
const footnoteRef: MarkedExtension = {
  extensions: [
    {
      name: "footnoteRef",
      level: "inline",
      start(src: string) {
        // **-1 을 그대로 돌려주면 안 된다.** marked 는 이 값으로 평문을 잘라내는데,
        // 음수가 들어가면 뒤에서부터 잘라 엉뚱한 자리에 줄바꿈·공백이 생긴다
        // (실제로 `가[^b] 나[^a]` 가 `가<br>…` 로 나왔다). 없으면 undefined 다.
        const index = src.indexOf("[^");
        return index === -1 ? undefined : index;
      },
      tokenizer(src: string) {
        const match = /^\[\^([^\]\s][^\]]*)\]/.exec(src);
        if (!match) return undefined;
        const label = match[1].trim();
        if (!registry.definitions.has(label)) return undefined;
        return { type: "footnoteRef", raw: match[0], label } as FootnoteRefToken;
      },
      renderer(token) {
        const { label } = token as FootnoteRefToken;
        const slug = escapeHtml(slugFor(label));
        const { number, first } = referenceFor(label);
        // 되돌아가기 링크는 **처음 참조**를 가리킨다. 두 번째 참조에까지 같은
        // id 를 달면 문서에 같은 id 가 여러 개 생긴다.
        const id = first ? ` id="fnref-${slug}"` : "";
        return `<sup class="footnote-ref"><a${id} href="#fn-${slug}">${number}</a></sup>`;
      },
    },
  ],
};

/**
 * `[^라벨]: 내용` 정의.
 *
 * 이어지는 들여쓴 줄까지 한 각주로 본다. 정의 자체는 **그 자리에 아무것도
 * 남기지 않는다** — 각주는 문서 끝에 모여야 각주다.
 */
const footnoteDef: MarkedExtension = {
  extensions: [
    {
      name: "footnoteDef",
      level: "block",
      start(src: string) {
        // **`^` 로 줄머리를 찾으면 안 된다.** marked 는 이 함수에 `src.slice(1)` 을
        // 넘기므로(그리고 결과에 1 을 더한다), 잘려 나간 문자 뒤가 문자열의 처음이
        // 되어 `^` 가 **줄 한가운데서도** 맞는다. 실제로 `가[^b] 나` 의 `[^b]` 가
        // 줄머리로 잡혀 문단이 두 동강 났다(`가<br>[^b] 나`).
        // 그래서 줄바꿈을 명시적으로 요구한다.
        const index = src.search(/\n\[\^[^\]\s][^\]]*\]:/);
        return index === -1 ? undefined : index + 1;
      },
      tokenizer(src: string) {
        const match = /^\[\^([^\]\s][^\]]*)\]:[ \t]*([^\n]*)(?:\n(?![ \t]*\n)[ \t]+[^\n]*)*/.exec(
          src,
        );
        if (!match) return undefined;

        const label = match[1].trim();
        const body = match[0]
          .slice(match[0].indexOf("]:") + 2)
          .split("\n")
          .map((line) => line.trim())
          .join("\n")
          .trim();

        // 같은 라벨이 두 번 정의되면 **처음 것을 남긴다** — 나중 것으로 덮으면
        // 위에서 이미 읽은 각주의 내용이 아래에서 바뀐다.
        if (!registry.definitions.has(label)) registry.definitions.set(label, body);

        return { type: "footnoteDef", raw: match[0], label, body } as FootnoteDefToken;
      },
      renderer() {
        return "";
      },
    },
  ],
};

/**
 * 정의 목록.
 *
 * ```
 * 용어
 * : 뜻
 * : 다른 뜻
 * ```
 *
 * 표식(`:`)이 **다음 줄**에 오므로, 앞 줄을 이미 문단으로 삼킨 뒤에는 손댈 수
 * 없다. 그래서 블록 확장이 문단보다 먼저 이 모양을 잡아야 한다.
 */
const definitionList: MarkedExtension = {
  extensions: [
    {
      name: "definitionList",
      level: "block",
      start(src: string) {
        // 위(각주 정의)와 같은 이유로 줄바꿈을 명시적으로 요구한다.
        const index = src.search(/\n[^\n]+\n:[ \t]/);
        return index === -1 ? undefined : index + 1;
      },
      tokenizer(src: string) {
        const match = /^((?:[^\n]+\n:[ \t][^\n]*(?:\n:[ \t][^\n]*)*)(?:\n(?![\s]*$)[^\n]+\n:[ \t][^\n]*(?:\n:[ \t][^\n]*)*)*)/.exec(
          src,
        );
        if (!match) return undefined;

        // 용어·뜻 안의 인라인 서식(굵게·링크·코드)은 marked 가 이미 아는 일이다.
        // 여기서 다시 구현하면 두 벌이 되어 한쪽만 갱신되는 사고가 난다.
        const lexer = this.lexer as unknown as { inlineTokens(text: string): unknown[] };

        const lines = match[0].split("\n");
        const entries: DefinitionListEntry[] = [];
        for (const line of lines) {
          if (/^:[ \t]/.test(line)) {
            if (entries.length === 0) return undefined; // 용어 없는 정의는 목록이 아니다
            entries[entries.length - 1].details.push(lexer.inlineTokens(line.slice(1).trim()));
          } else {
            entries.push({ term: lexer.inlineTokens(line.trim()), details: [] });
          }
        }
        // 뜻이 하나도 없는 용어가 있으면 정의 목록이 아니다.
        if (entries.some((e) => e.details.length === 0)) return undefined;

        return {
          type: "definitionList",
          raw: match[0],
          entries,
        } as DefinitionListToken;
      },
      renderer(token) {
        const { entries } = token as DefinitionListToken;
        const parser = this.parser as unknown as {
          parseInline(tokens: unknown[]): string;
        };

        const parts = entries.map(
          ({ term, details }) =>
            `<dt>${parser.parseInline(term)}</dt>` +
            details.map((d) => `<dd>${parser.parseInline(d)}</dd>`).join(""),
        );
        return `<dl>${parts.join("")}</dl>\n`;
      },
    },
  ],
};

export const markdownExtensions: MarkedExtension[] = [
  footnoteDef,
  footnoteRef,
  definitionList,
];

/**
 * 문서 끝에 붙일 각주 목록. 참조가 하나도 없으면 빈 문자열이다 —
 * **정의만 있고 아무도 참조하지 않은 각주는 보여주지 않는다.**
 *
 * `renderBody` 는 각주 본문(마크다운)을 HTML 로 바꾸는 함수다. 인라인 파싱을
 * 호출부(`parser.ts`)에서 넘겨받아, 이 모듈이 marked 인스턴스를 다시 만들지
 * 않게 한다.
 */
export function renderFootnoteSection(
  renderBody: (markdown: string) => string,
): string {
  if (registry.order.length === 0) return "";

  const items: string[] = [];
  // **인덱스로 돈다.** 각주 본문 안에서 다른 각주를 참조할 수 있고
  // (`[^1]: 참고[^2]`), 그러면 이 루프 도중에 `order` 가 늘어난다. `map` 은
  // 시작 시점의 길이만 훑기 때문에 나중에 추가된 각주는 **링크만 있고 항목이
  // 없는 상태**가 된다 — 어디로도 가지 않는 링크를 만들지 않는다는 이 기능의
  // 전제가 깨진다. 새로 늘어난 만큼은 정의 개수로 자연히 멈춘다.
  for (let i = 0; i < registry.order.length; i += 1) {
    const label = registry.order[i];
    const slug = escapeHtml(slugFor(label));
    const body = renderBody(registry.definitions.get(label) ?? "");
    // 되돌아가기 링크가 있어야 각주를 읽고 본문으로 돌아올 수 있다.
    items.push(
      `<li id="fn-${slug}">${body} <a class="footnote-back" href="#fnref-${slug}" aria-label="본문으로 돌아가기">↩</a></li>`,
    );
  }

  return `<section class="footnotes"><ol>${items.join("")}</ol></section>\n`;
}
