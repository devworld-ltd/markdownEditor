import { parseMarkdown } from "./parser";

/**
 * 프리뷰 패널에 마크다운을 렌더링한다.
 */
export function renderPreview(
  target: HTMLElement,
  markdown: string,
): void {
  target.innerHTML = parseMarkdown(markdown);
}
