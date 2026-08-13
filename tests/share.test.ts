import { describe, expect, it } from "vitest";
import { createShareLink, loadSharedDocument, type ShareHost } from "../src/share";
import { MAX_SHARE_BYTES } from "../src/shareId";

/** F-60 공유 클라이언트 (이슈 #66). */

function buildHost(overrides: Partial<ShareHost> = {}) {
  const uploads: string[] = [];
  const copied: string[] = [];
  const notices: Array<{ message: string; kind?: string }> = [];
  const host: ShareHost & { uploads: typeof uploads; copied: typeof copied; notices: typeof notices } = {
    uploads,
    copied,
    notices,
    origin: "https://md.example",
    upload: async (content) => {
      uploads.push(content);
      return { id: "0123456789abcdef" };
    },
    download: async () => "# 공유된 문서",
    notify: (message, kind) => notices.push({ message, kind }),
    copyLink: async (url) => {
      copied.push(url);
    },
    ...overrides,
  };
  return host;
}

describe("createShareLink", () => {
  it("업로드하고 링크를 만들어 복사한다", async () => {
    const host = buildHost();
    const result = await createShareLink(host, "# 문서");

    expect(result).toEqual({ ok: true, url: "https://md.example/s/0123456789abcdef" });
    expect(host.uploads).toEqual(["# 문서"]);
    expect(host.copied).toEqual(["https://md.example/s/0123456789abcdef"]);
  });

  it("링크를 아는 사람은 볼 수 있다는 점을 알린다", async () => {
    // 해시는 비밀이 아니다 — "아는 사람만 본다" 수준의 보호임을 밝혀야 한다.
    const host = buildHost();
    await createShareLink(host, "# 문서");
    expect(host.notices[0].message).toContain("링크를 아는 사람");
  });

  it("빈 문서는 요청을 보내지도 않는다", async () => {
    // 어차피 서버가 거절할 요청이다.
    const host = buildHost();
    const result = await createShareLink(host, "");

    expect(result.ok).toBe(false);
    expect(host.uploads).toHaveLength(0);
    expect(host.notices[0]).toMatchObject({ kind: "error" });
  });

  it("너무 큰 문서도 보내지 않는다", async () => {
    const host = buildHost();
    const result = await createShareLink(host, "a".repeat(MAX_SHARE_BYTES + 1));

    expect(result.ok).toBe(false);
    expect(host.uploads).toHaveLength(0);
    expect(host.notices[0].message).toContain("KB");
  });

  it("복사만 실패하면 링크 자체를 알려 준다", async () => {
    // 링크는 만들어졌다 — 그 사실을 감추면 사용자가 결과를 잃는다.
    const host = buildHost({
      copyLink: async () => {
        throw new Error("권한 없음");
      },
    });
    const result = await createShareLink(host, "# 문서");

    expect(result.ok).toBe(true);
    expect(host.notices[0].message).toContain("https://md.example/s/0123456789abcdef");
  });

  it("업로드가 실패하면 사유와 함께 알린다", async () => {
    const host = buildHost({
      upload: async () => {
        throw new Error("too-large");
      },
    });
    const result = await createShareLink(host, "# 문서");

    expect(result).toMatchObject({ ok: false, reason: "upload-failed" });
    expect(host.notices[0]).toMatchObject({ kind: "error" });
    expect(host.notices[0].message).toContain("too-large");
  });
});

describe("loadSharedDocument", () => {
  it("문서를 가져온다", async () => {
    const host = buildHost();
    expect(await loadSharedDocument(host, "0123456789abcdef")).toBe("# 공유된 문서");
  });

  it("실패해도 던지지 않고 null 을 돌려준다", async () => {
    // 링크가 만료됐거나 오타여도 빈 편집기를 쓸 수 있어야 한다 — 흰 화면 금지.
    const host = buildHost({
      download: async () => {
        throw new Error("HTTP 404");
      },
    });

    expect(await loadSharedDocument(host, "0123456789abcdef")).toBeNull();
    expect(host.notices[0]).toMatchObject({ kind: "error" });
    expect(host.notices[0].message).toContain("찾을 수 없습니다");
  });
});
