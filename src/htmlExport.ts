/**
 * F-38 HTML 내보내기 — 문서 조립 (이슈 #51).
 *
 * **정화된 HTML 만 받는다.** 이 모듈은 마크다운을 파싱하지 않는다 — 호출부가
 * `parseMarkdown()`(marked → DOMPurify)을 거친 결과를 넘긴다. 여기서 원문을
 * 다시 파싱하는 두 번째 경로를 만들면 정화 정책이 두 곳으로 갈라지고, 한쪽만
 * 갱신되는 순간 F-18 이 뚫린다.
 *
 * DOM 을 만지지 않는 순수 모듈이라 결과 문자열 전체를 단위 테스트로 검증한다.
 */

/**
 * 내보낸 파일에 심을 스타일.
 *
 * **라이트 한 가지로 고정한다.** 내보낸 파일이 열리는 환경은 알 수 없고, 대개
 * 인쇄·첨부·다른 사람에게 전달되는 용도다. `prefers-color-scheme` 을 따라가게
 * 하면 받는 쪽 설정에 따라 첨부 문서의 모양이 달라진다.
 *
 * 앱의 프리뷰 스타일에서 **본문에 해당하는 규칙만** 옮겼다. 툴바·탭바처럼
 * 앱에만 있는 것은 내보낸 문서에 존재하지 않는다.
 */
const EXPORT_STYLES = `
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    padding: 32px 24px;
    max-width: 44rem;
    background: #ffffff;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    word-break: break-word;
  }
  h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.3; }
  h1 { font-size: 1.9em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.25em; }
  p { margin: 0 0 1em; }
  a { color: #0b62c4; }
  code {
    background: #f4f4f4;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.9em;
  }
  pre {
    background: #f4f4f4;
    padding: 14px 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0 0 1em;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 4px solid #dddddd;
    margin: 0 0 1em;
    padding: 0 0 0 14px;
    color: #666666;
  }
  table { border-collapse: collapse; margin: 0 0 1em; display: block; overflow-x: auto; }
  th, td { border: 1px solid #dddddd; padding: 6px 10px; text-align: left; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #dddddd; margin: 2em 0; }
`.trim();

/**
 * 텍스트를 HTML 로 안전하게 넣는다.
 *
 * 제목은 사용자가 지은 **파일명**에서 온다. `<title>` 안이라 스크립트가 실행될
 * 수는 없지만, `</title>` 을 포함한 이름이 문서 구조를 깨뜨릴 수 있다. 본문과
 * 달리 이 값은 DOMPurify 를 거치지 않으므로 여기서 직접 막는다.
 */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 독립 실행 가능한 HTML 문서를 만든다.
 *
 * @param title 문서 제목 (파일명에서 확장자를 뗀 값)
 * @param sanitizedBody **이미 `parseMarkdown()` 을 거친** 본문 HTML
 */
export function buildHtmlDocument(title: string, sanitizedBody: string): string {
  const safeTitle = escapeHtmlText(title.trim() || "문서");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
${EXPORT_STYLES}
</style>
</head>
<body>
${sanitizedBody}
</body>
</html>
`;
}

/** 내보낼 파일명. 마크다운 확장자는 `.html` 로 갈고, 없으면 붙인다. */
export function suggestHtmlFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed || trimmed === "Untitled") return "Untitled.html";
  if (/\.html?$/i.test(trimmed)) return trimmed;
  return `${trimmed.replace(/\.(md|markdown|txt)$/i, "")}.html`;
}

/** 문서 제목 — 파일명에서 확장자를 뗀다. */
export function titleFromFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed || trimmed === "Untitled") return "Untitled";
  return trimmed.replace(/\.[^.]+$/, "") || trimmed;
}
