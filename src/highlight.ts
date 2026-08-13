/**
 * F-23 코드 구문 하이라이팅 — 의존성 0 (이슈 #76).
 *
 * ## 왜 직접 쓰는가
 *
 * highlight.js·shiki 는 정확하지만 런타임 의존성이 3개가 되고 번들이 수십~수백 KB
 * 늘어난다. 이 저장소는 기능 12개를 더하는 동안 런타임 의존성을 `marked`·
 * `DOMPurify` **둘로 유지**했고, 코드블록 색칠은 그 성질을 포기할 만큼 중요하지
 * 않다. 대신 **지원 범위를 좁게 잡고 모르는 것은 건드리지 않는다.**
 *
 * ## 정확도보다 안전을 택한 지점들
 *
 * - **모르는 언어는 아무것도 하지 않는다.** 어설프게 칠하면 틀린 색이 오히려
 *   읽기를 방해한다. 지금과 똑같은 단색으로 남는 편이 낫다.
 * - **토크나이저는 한 번의 선형 스캔이다.** 정규식 대안(alternation)에 백트래킹이
 *   생기면 특정 입력에서 지수 시간이 된다(ReDoS). 문자 단위로 훑으면 그 위험이
 *   구조적으로 없다.
 * - **출력은 `<span class>` 뿐이다.** 색은 CSS 가 정한다. DOMPurify 허용 목록에
 *   `class` 하나만 열면 되고, 정화 파이프라인을 우회하지 않는다(F-18).
 *
 * DOM 을 만지지 않는 순수 모듈이라 토큰 경계를 전부 단위 테스트로 확인한다.
 */

export type TokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "punct"
  | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

interface LanguageRules {
  keywords: Set<string>;
  /** 줄 주석 시작 표식들. 긴 것부터 검사한다. */
  lineComment: string[];
  /** 블록 주석 [시작, 끝]. 없으면 null. */
  blockComment: [string, string] | null;
  /** 문자열 따옴표. */
  quotes: string[];
  /** 식별자에 쓰이는 문자인지. */
  isIdentChar: (ch: string) => boolean;
}

/**
 * JS/TS/JSON/셸의 식별자 문자.
 *
 * **하이픈을 넣으면 안 된다** — `a-1` 이 한 덩어리로 읽혀 빼기가 사라진다.
 * CSS·HTML 만 하이픈을 식별자에 포함하며, 그건 각자 자기 규칙에 적었다.
 */
const WORD = /[A-Za-z0-9_$]/;
const identChar = (ch: string) => WORD.test(ch);

function words(list: string): Set<string> {
  return new Set(list.split(/\s+/).filter(Boolean));
}

/**
 * 지원 언어. **좁게 유지한다** — 목록을 늘릴수록 "칠해지긴 하는데 틀린" 경우가
 * 늘고, 그건 단색보다 나쁘다.
 */
const LANGUAGES: Record<string, LanguageRules> = {
  javascript: {
    keywords: words(`
      const let var function return if else for while do break continue
      class extends new this super typeof instanceof in of delete void
      try catch finally throw switch case default async await yield
      import export from as static get set null undefined true false
    `),
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    isIdentChar: identChar,
  },
  typescript: {
    keywords: words(`
      const let var function return if else for while do break continue
      class extends implements interface type enum namespace declare
      new this super typeof instanceof keyof in of delete void readonly
      try catch finally throw switch case default async await yield
      import export from as satisfies public private protected static
      get set null undefined true false abstract override
    `),
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    isIdentChar: identChar,
  },
  json: {
    keywords: words("true false null"),
    lineComment: [],
    blockComment: null,
    quotes: ['"'],
    isIdentChar: identChar,
  },
  css: {
    keywords: words(`
      important media supports keyframes import charset font-face
      from to and not only all print screen
    `),
    lineComment: [],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    isIdentChar: (ch) => /[A-Za-z0-9_-]/.test(ch),
  },
  html: {
    keywords: words(`
      html head body div span a p ul ol li table tr td th script style
      link meta title header footer nav main section article form input
      button img svg path pre code h1 h2 h3 h4 h5 h6 br hr
    `),
    lineComment: [],
    blockComment: ["<!--", "-->"],
    quotes: ['"', "'"],
    isIdentChar: (ch) => /[A-Za-z0-9_:-]/.test(ch),
  },
  shell: {
    keywords: words(`
      if then else elif fi for while do done case esac function return
      export local readonly source echo cd exit set unset trap shift
      true false in
    `),
    lineComment: ["#"],
    blockComment: null,
    quotes: ['"', "'"],
    isIdentChar: identChar,
  },
};

/** 흔한 별칭. 목록에 없는 이름은 **하이라이팅하지 않는다.** */
const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  console: "shell",
  scss: "css",
  htm: "html",
  xml: "html",
};

/** 지원 언어면 정규화된 이름, 아니면 null. */
export function resolveLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return name in LANGUAGES ? name : null;
}

export function isSupportedLanguage(raw: string | null | undefined): boolean {
  return resolveLanguage(raw) !== null;
}

const PUNCT = new Set("{}[]()<>;:,.=+-*/%!&|^~?".split(""));

/**
 * 코드를 토큰으로 나눈다. **한 번의 선형 스캔** — 되돌아가지 않으므로 어떤
 * 입력에도 O(n) 이다.
 */
export function tokenize(code: string, language: string): Token[] {
  const rules = LANGUAGES[resolveLanguage(language) ?? ""];
  if (!rules) return [{ kind: "plain", text: code }];

  const tokens: Token[] = [];
  let buffer = "";

  const flush = (): void => {
    if (buffer) {
      tokens.push({ kind: "plain", text: buffer });
      buffer = "";
    }
  };
  const push = (kind: TokenKind, text: string): void => {
    flush();
    tokens.push({ kind, text });
  };

  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // 1) 블록 주석
    if (rules.blockComment) {
      const [open, close] = rules.blockComment;
      if (code.startsWith(open, i)) {
        const end = code.indexOf(close, i + open.length);
        // 닫히지 않은 주석은 끝까지 주석이다 — 편집 중에 흔한 상태다.
        const stop = end === -1 ? code.length : end + close.length;
        push("comment", code.slice(i, stop));
        i = stop;
        continue;
      }
    }

    // 2) 줄 주석
    let matchedLineComment = false;
    for (const marker of rules.lineComment) {
      if (code.startsWith(marker, i)) {
        const end = code.indexOf("\n", i);
        const stop = end === -1 ? code.length : end;
        push("comment", code.slice(i, stop));
        i = stop;
        matchedLineComment = true;
        break;
      }
    }
    if (matchedLineComment) continue;

    // 3) 문자열. 이스케이프를 건너뛰되, 닫히지 않으면 줄/끝에서 멈춘다 —
    //    편집 중에는 열린 따옴표가 흔하고, 거기서 나머지를 전부 삼키면
    //    화면이 통째로 문자열 색이 된다.
    if (rules.quotes.includes(ch)) {
      let j = i + 1;
      let closed = false;
      while (j < code.length) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === ch) {
          j += 1;
          closed = true;
          break;
        }
        if (code[j] === "\n" && ch !== "`") break; // 템플릿 리터럴만 여러 줄
        j += 1;
      }
      push("string", code.slice(i, closed ? j : Math.min(j, code.length)));
      i = closed ? j : Math.min(j, code.length);
      continue;
    }

    // 4) 숫자 (선행 부호는 punct 로 남긴다 — a-1 을 a, -1 로 읽으면 틀린다)
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < code.length && /[0-9a-fA-FxXoObB._]/.test(code[j])) j += 1;
      push("number", code.slice(i, j));
      i = j;
      continue;
    }

    // 5) 식별자 / 키워드
    if (rules.isIdentChar(ch) && !/[0-9]/.test(ch)) {
      let j = i;
      while (j < code.length && rules.isIdentChar(code[j])) j += 1;
      const word = code.slice(i, j);
      push(rules.keywords.has(word) ? "keyword" : "plain", word);
      i = j;
      continue;
    }

    // 6) 구두점
    if (PUNCT.has(ch)) {
      push("punct", ch);
      i += 1;
      continue;
    }

    // 7) 그 밖(공백·한글 등)은 그대로 모은다
    buffer += ch;
    i += 1;
  }

  flush();
  return tokens;
}

/** HTML 텍스트로 안전하게 넣기 위한 이스케이프. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 토큰을 `<span class="tok-*">` 로 감싼 HTML 로 만든다.
 *
 * **`class` 외에는 아무 속성도 넣지 않는다.** 스타일·이벤트 속성을 넣기 시작하면
 * DOMPurify 허용 목록을 계속 열어야 하고, 그 순간 F-18 이 약해진다.
 */
export function highlightToHtml(code: string, language: string): string {
  const tokens = tokenize(code, language);
  return tokens
    .map((token) =>
      token.kind === "plain"
        ? escapeHtml(token.text)
        : `<span class="tok-${token.kind}">${escapeHtml(token.text)}</span>`,
    )
    .join("");
}
