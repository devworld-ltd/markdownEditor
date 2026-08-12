import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 마크다운 문자열을 HTML로 변환한다.
 *
 * 웹으로 배포되는 이상 문서 본문은 신뢰할 수 없는 입력이다(공유 링크·붙여넣기·
 * 업로드된 .md). marked 는 raw HTML 을 그대로 통과시키므로 DOMPurify 로 정화한 뒤
 * 반환한다. 이 함수를 거치지 않고 innerHTML 에 마크다운 결과를 넣으면 안 된다.
 */
export function parseMarkdown(source: string): string {
  const html = marked.parse(source) as string;
  return DOMPurify.sanitize(html);
}
