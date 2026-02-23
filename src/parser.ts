import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 마크다운 문자열을 HTML로 변환한다.
 */
export function parseMarkdown(source: string): string {
  return marked.parse(source) as string;
}
