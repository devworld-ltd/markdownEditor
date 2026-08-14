import { marked } from "marked";
import DOMPurify from "dompurify";
import { highlightToHtml, isSupportedLanguage } from "./highlight";
import {
  beginFootnotes,
  markdownExtensions,
  renderFootnoteSection,
} from "./markdownExtensions";

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * F-23: 코드블록만 직접 렌더해 토큰에 `<span class>` 를 입힌다.
 *
 * **모르는 언어는 marked 기본 동작 그대로 둔다** — 어설프게 칠하면 틀린 색이
 * 오히려 읽기를 방해한다. 언어 표시가 없는 블록도 마찬가지다.
 *
 * 여기서 만든 HTML 도 아래 `DOMPurify.sanitize()` 를 그대로 통과한다. 정화를
 * 우회하는 경로를 만들지 않는 것이 이 함수의 전제다(F-18).
 */
// 각주·정의 목록 (이슈 #111). 확장이 만든 HTML 도 아래 `DOMPurify.sanitize()` 를
// 그대로 통과한다 — 정화 경로를 늘리지 않는 것이 전제다(F-18).
for (const extension of markdownExtensions) marked.use(extension);

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = (lang ?? "").trim().split(/\s+/)[0];
      if (!isSupportedLanguage(language)) return false as unknown as string;

      return `<pre><code class="language-${language}">${highlightToHtml(text, language)}</code></pre>\n`;
    },
  },
});

/**
 * 마크다운 문자열을 HTML로 변환한다.
 *
 * 웹으로 배포되는 이상 문서 본문은 신뢰할 수 없는 입력이다(공유 링크·붙여넣기·
 * 업로드된 .md). marked 는 raw HTML 을 그대로 통과시키므로 DOMPurify 로 정화한 뒤
 * 반환한다. 이 함수를 거치지 않고 innerHTML 에 마크다운 결과를 넣으면 안 된다.
 */
export function parseMarkdown(source: string): string {
  // 각주 등록부는 **호출마다 새로 만든다.** 모듈 수준에 두고 재사용하면 이전
  // 문서의 각주가 다음 문서 끝에 따라붙는다.
  beginFootnotes();

  const body = marked.parse(source) as string;
  // 각주 목록은 본문을 다 훑은 뒤에야 만들 수 있다 — 번호가 **읽는 순서**를
  // 따르기 때문이다.
  const html = body + renderFootnoteSection((markdown) => marked.parseInline(markdown) as string);
  // F-23: 하이라이팅이 붙인 `class` 가 살아남아야 색이 나온다.
  //
  // 처음에는 `{ ADD_ATTR: ["class"] }` 를 넘겼는데 **불필요했다** — DOMPurify 의
  // 기본 허용 목록에 `class` 가 이미 있다(제거해도 테스트가 통과해 확인했다).
  // 허용 목록을 건드리지 않는 편이 F-18 에 더 안전하므로 옵션을 지웠다.
  // 이 성질은 `parser.test.ts` 가 못 박는다.
  return DOMPurify.sanitize(html);
}
