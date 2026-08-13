/**
 * F-40 렌더된 HTML 클립보드 복사 (이슈 #65).
 *
 * F-38 은 **파일로 내보내고**, 이쪽은 **다른 앱에 붙여넣게** 한다. 메일·문서
 * 도구는 파일보다 붙여넣기를 훨씬 자주 쓴다.
 *
 * 설계 판단:
 *
 * 1) **정화된 HTML 만 쓴다** (F-18). F-38 과 같은 원칙 — 마크다운을 여기서 다시
 *    파싱하지 않는다. 붙여넣는 곳이 우리 앱이 아니므로 위험도는 오히려 높다.
 * 2) **`text/plain` 대체본을 함께 넣는다.** 붙여넣는 곳이 서식을 모르면
 *    (터미널·코드 편집기·plain 모드 메일) HTML 태그가 **날것 그대로** 들어간다.
 *    대체본이 있으면 브라우저가 알아서 고른다.
 *    대체본은 **마크다운 원문**이다 — 태그를 벗긴 텍스트보다 원문이 더 쓸모 있고,
 *    마크다운을 아는 곳에 붙이면 서식이 살아난다.
 * 3) **`navigator.clipboard.write` 가 없으면 원문만이라도 넣는다.** 서식은 잃지만
 *    "아무 일도 안 일어남" 보다 낫다.
 *
 * DOM·클립보드 API 를 직접 만지지 않는다 — 전부 host 로 주입받는다.
 */

export interface ClipboardExportHost {
  /** `ClipboardItem` 을 지원하는가. */
  supportsRichCopy(): boolean;
  /** 서식 있는 복사. 실패하면 던진다. */
  writeRich(html: string, text: string): Promise<void>;
  /** 일반 텍스트 복사. */
  writeText(text: string): Promise<void>;
  notify?: (message: string, kind?: "info" | "error") => void;
}

export type CopyOutcome = "rich" | "plain" | "failed";

/**
 * 렌더 결과를 클립보드에 넣는다.
 *
 * @param sanitizedHtml **이미 `parseMarkdown()` 을 거친** HTML
 * @param markdownSource 대체본으로 쓸 마크다운 원문
 */
export async function copyRenderedHtml(
  host: ClipboardExportHost,
  sanitizedHtml: string,
  markdownSource: string,
): Promise<CopyOutcome> {
  if (host.supportsRichCopy()) {
    try {
      await host.writeRich(sanitizedHtml, markdownSource);
      host.notify?.("서식을 유지한 채 복사했습니다.");
      return "rich";
    } catch {
      // 권한 거부·비보안 컨텍스트 등. 아래 폴백으로 내려간다.
    }
  }

  try {
    await host.writeText(markdownSource);
    // 무엇이 복사됐는지 정확히 말한다 — "복사됨" 만 띄우면 붙여넣고 나서야
    // 서식이 없다는 걸 알게 된다.
    host.notify?.("이 브라우저에서는 서식 복사를 지원하지 않아 마크다운 원문을 복사했습니다.");
    return "plain";
  } catch {
    host.notify?.("클립보드에 복사하지 못했습니다.", "error");
    return "failed";
  }
}
