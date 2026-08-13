import { describe, expect, it, vi } from "vitest";
import { copyRenderedHtml, type ClipboardExportHost } from "../src/clipboardExport";

/**
 * F-40 클립보드 복사 (이슈 #65).
 *
 * 클립보드 API 는 보안 컨텍스트·사용자 제스처·권한에 따라 실패한다. 그 분기를
 * host 로 뽑아 두면 **실패 경로 전부**를 브라우저 없이 검증할 수 있다.
 */

function buildHost(overrides: Partial<ClipboardExportHost> = {}) {
  const rich: Array<{ html: string; text: string }> = [];
  const plain: string[] = [];
  const notices: Array<{ message: string; kind?: string }> = [];
  const host: ClipboardExportHost & { rich: typeof rich; plain: typeof plain; notices: typeof notices } = {
    rich,
    plain,
    notices,
    supportsRichCopy: () => true,
    writeRich: async (html, text) => {
      rich.push({ html, text });
    },
    writeText: async (text) => {
      plain.push(text);
    },
    notify: (message, kind) => notices.push({ message, kind }),
    ...overrides,
  };
  return host;
}

describe("copyRenderedHtml", () => {
  it("서식 있는 복사가 되면 HTML 과 원문을 함께 넣는다", async () => {
    const host = buildHost();
    const outcome = await copyRenderedHtml(host, "<h1>제목</h1>", "# 제목");

    expect(outcome).toBe("rich");
    expect(host.rich).toEqual([{ html: "<h1>제목</h1>", text: "# 제목" }]);
    expect(host.plain).toHaveLength(0);
  });

  it("대체본은 마크다운 원문이다", async () => {
    // 태그를 벗긴 텍스트보다 원문이 더 쓸모 있고, 마크다운을 아는 곳에
    // 붙이면 서식이 살아난다.
    const host = buildHost();
    await copyRenderedHtml(host, "<p><strong>굵게</strong></p>", "**굵게**");
    expect(host.rich[0].text).toBe("**굵게**");
  });

  it("서식 복사를 지원하지 않으면 원문만 넣는다", async () => {
    const host = buildHost({ supportsRichCopy: () => false });
    const outcome = await copyRenderedHtml(host, "<h1>제목</h1>", "# 제목");

    expect(outcome).toBe("plain");
    expect(host.rich).toHaveLength(0);
    expect(host.plain).toEqual(["# 제목"]);
  });

  it("서식 복사가 던지면 원문으로 내려간다", async () => {
    // 권한 거부·비보안 컨텍스트 등. "아무 일도 안 일어남" 보다 낫다.
    const host = buildHost({
      writeRich: async () => {
        throw new Error("NotAllowedError");
      },
    });
    const outcome = await copyRenderedHtml(host, "<h1>제목</h1>", "# 제목");

    expect(outcome).toBe("plain");
    expect(host.plain).toEqual(["# 제목"]);
  });

  it("폴백 시 무엇이 복사됐는지 정확히 알린다", async () => {
    // "복사됨" 만 띄우면 붙여넣고 나서야 서식이 없다는 걸 알게 된다.
    const host = buildHost({ supportsRichCopy: () => false });
    await copyRenderedHtml(host, "<h1>x</h1>", "# x");

    expect(host.notices[0].message).toContain("마크다운 원문");
  });

  it("둘 다 실패하면 오류로 알린다", async () => {
    const host = buildHost({
      supportsRichCopy: () => false,
      writeText: async () => {
        throw new Error("거부됨");
      },
    });
    const outcome = await copyRenderedHtml(host, "<h1>x</h1>", "# x");

    expect(outcome).toBe("failed");
    expect(host.notices.at(-1)).toMatchObject({ kind: "error" });
  });

  it("성공 시에도 무엇이 됐는지 알린다", async () => {
    const host = buildHost();
    await copyRenderedHtml(host, "<h1>x</h1>", "# x");
    expect(host.notices[0].message).toContain("서식");
    expect(host.notices[0].kind).toBeUndefined();
  });

  it("notify 가 없어도 던지지 않는다", async () => {
    const host = buildHost({ notify: undefined });
    await expect(copyRenderedHtml(host, "<h1>x</h1>", "# x")).resolves.toBe("rich");
  });

  it("빈 문서도 복사한다 — 조용히 실패하지 않는다", async () => {
    const host = buildHost();
    const outcome = await copyRenderedHtml(host, "", "");
    expect(outcome).toBe("rich");
    expect(host.rich).toEqual([{ html: "", text: "" }]);
  });

  it("HTML 을 다시 정화하지 않는다 — 받은 그대로 넣는다", async () => {
    // 정화는 parser.ts 의 책임이다. 여기서 또 하면 정책이 두 곳으로 갈라진다.
    const host = buildHost();
    const html = '<p>a &amp; b <em>강조</em></p>';
    await copyRenderedHtml(host, html, "a & b *강조*");
    expect(host.rich[0].html).toBe(html);
  });
});
