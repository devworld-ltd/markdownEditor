import { describe, expect, it } from "vitest";
import {
  fetchErrorMessage,
  fileNameFromUrl,
  looksLikeWebPage,
  MAX_REMOTE_BYTES,
  openedMessage,
  readOpenIntent,
  rejectMessage,
  type FetchReason,
} from "../src/openParams";
import { MAX_IMAGE_BYTES } from "../src/imageUpload";

/**
 * F-90/F-91 순수 모듈 — DOM·fetch 없음(이슈 #195).
 *
 * 문구 문자열은 E2E 의 판정 신호다(기술 스펙 §3-1) — `404`·`CORS`·
 * `닿지 못했습니다`·`2MB`·`http`·`파일 선택` 이 서로 겹치지 않아야 한다.
 */

describe("readOpenIntent — 스킴", () => {
  it("https 는 항상 remote", () => {
    const intent = readOpenIntent("https://app.test/?url=" + encodeURIComponent("https://raw.test/a.md"));
    expect(intent).toEqual({ kind: "remote", url: "https://raw.test/a.md", host: "raw.test" });
  });

  it.each([
    ["http://localhost:8080/a.md"],
    ["http://127.0.0.1/a.md"],
    ["http://[::1]/a.md"],
  ])("앱이 로컬일 때 로컬 호스트의 http 는 remote — %s", (target) => {
    const intent = readOpenIntent("http://127.0.0.1:5173/?url=" + encodeURIComponent(target));
    expect(intent).toMatchObject({ kind: "remote", url: target });
  });

  // #198: 대상만 보고 열어 주면 배포된 앱의 ?url=http://localhost 링크도 확인창까지
  // 도달한다. 예외는 앱 자신이 로컬일 때만 열린다.
  it.each([
    ["http://localhost:8080/a.md"],
    ["http://127.0.0.1/a.md"],
    ["http://[::1]/a.md"],
  ])("앱이 배포 오리진이면 로컬 호스트의 http 도 reject(scheme) — %s", (target) => {
    const intent = readOpenIntent("https://app.test/?url=" + encodeURIComponent(target));
    expect(intent).toEqual({ kind: "reject", reason: "scheme" });
  });

  it.each([
    ["localhost", "http://localhost:5173/"],
    ["127.0.0.1", "http://127.0.0.1:5173/"],
    ["[::1]", "http://[::1]:5173/"],
  ])("앱 오리진이 %s 면 예외가 열린다", (_name, appHref) => {
    const target = "http://localhost:3000/a.md";
    const intent = readOpenIntent(appHref + "?url=" + encodeURIComponent(target));
    expect(intent).toMatchObject({ kind: "remote", url: target });
  });

  it("앱이 로컬이어도 비-로컬 http 는 여전히 reject(scheme)", () => {
    const target = "http://example.com/a.md";
    const intent = readOpenIntent("http://127.0.0.1:5173/?url=" + encodeURIComponent(target));
    expect(intent).toEqual({ kind: "reject", reason: "scheme" });
  });

  it("앱이 로컬이어도 https 는 그대로 remote — 예외가 https 를 가리지 않는다", () => {
    const target = "https://raw.test/a.md";
    const intent = readOpenIntent("http://127.0.0.1:5173/?url=" + encodeURIComponent(target));
    expect(intent).toEqual({ kind: "remote", url: target, host: "raw.test" });
  });

  it.each([
    ["http://example.com/a.md"],
    ["file:///Users/me/a.md"],
    ["javascript:alert(1)"],
    ["data:text/markdown,x"],
    ["blob:https://app.test/abcd"],
  ])("%s 는 reject(scheme)", (target) => {
    const intent = readOpenIntent("https://app.test/?url=" + encodeURIComponent(target));
    expect(intent).toEqual({ kind: "reject", reason: "scheme" });
  });

  it("파싱 불가능한 값은 reject(not-absolute)", () => {
    const intent = readOpenIntent("https://app.test/?url=notaurl");
    expect(intent).toEqual({ kind: "reject", reason: "not-absolute" });
  });
});

describe("readOpenIntent — 분기", () => {
  it("?open=local 은 local", () => {
    expect(readOpenIntent("https://app.test/?open=local")).toEqual({ kind: "local" });
  });

  it("?url=&open=local (url 빈 값) 은 local", () => {
    expect(readOpenIntent("https://app.test/?url=&open=local")).toEqual({ kind: "local" });
  });

  it("?url=X&open=local 은 remote — 로컬은 무시된다", () => {
    const target = "https://raw.test/a.md";
    const intent = readOpenIntent("https://app.test/?url=" + encodeURIComponent(target) + "&open=local");
    expect(intent).toMatchObject({ kind: "remote", url: target });
  });

  it("파라미터가 없으면 null", () => {
    expect(readOpenIntent("https://app.test/")).toBeNull();
  });

  it("?url= 만 빈 값이면 null", () => {
    expect(readOpenIntent("https://app.test/?url=")).toBeNull();
  });

  it("?file=/Users/me/a.md 는 reject(local-path)", () => {
    expect(readOpenIntent("https://app.test/?file=/Users/me/a.md")).toEqual({
      kind: "reject",
      reason: "local-path",
    });
  });

  it("경로가 /s/<16진수16> 이면 null — 공유 링크가 우선이다(§7-2)", () => {
    const intent = readOpenIntent(
      "https://app.test/s/0123456789abcdef?url=" + encodeURIComponent("https://raw.test/a.md"),
    );
    expect(intent).toBeNull();
  });

  it("href 자체를 파싱할 수 없으면 null", () => {
    expect(readOpenIntent("not a url")).toBeNull();
  });
});

describe("fileNameFromUrl", () => {
  it.each([
    ["https://raw.test/main/guide.md", "guide.md"],
    ["https://raw.test/docs/guide", "guide.md"],
    ["https://raw.test/", "raw.test.md"],
    ["https://raw.test/a%20b.md", "a b.md"],
    ["https://raw.test/a.txt", "a.txt"],
  ])("%s → %s", (url, expected) => {
    expect(fileNameFromUrl(url)).toBe(expected);
  });

  it("경로 조작이 이름에 남지 않는다 — 정규화 뒤 마지막 조각만 남는다", () => {
    expect(fileNameFromUrl("https://raw.test/x/../../etc/passwd")).toBe("passwd.md");
  });

  it("200자 경로는 120자로 잘린다(확장자 판정은 자른 뒤 별도로 다시 붙는다)", () => {
    const longName = "a".repeat(200) + ".md";
    const result = fileNameFromUrl(`https://raw.test/${longName}`);
    // 120자로 자른 뒤 그 조각에는 더 이상 점이 없어 확장자가 없는 것으로
    // 판정되고 ".md" 가 다시 붙는다 — 최종 길이는 120 + ".md" 만큼 늘어난다.
    expect(result.startsWith("a".repeat(120))).toBe(true);
    expect(result).toBe("a".repeat(120) + ".md");
  });

  it("파싱할 수 없는 값은 document.md", () => {
    expect(fileNameFromUrl("notaurl")).toBe("document.md");
  });
});

describe("fetchErrorMessage — 문구 불변식", () => {
  const cases: Array<[FetchReason, string]> = [
    [{ kind: "http", status: 404 }, "404"],
    [{ kind: "cors" }, "CORS"],
    [{ kind: "network" }, "닿지 못했습니다"],
    [{ kind: "offline" }, "오프라인"],
    [{ kind: "too-large" }, "2MB"],
    [{ kind: "timeout" }, "시간"],
    [{ kind: "empty" }, "비어 있습니다"],
    [{ kind: "ambiguous" }, "CORS"],
  ];

  it.each(cases)("%o 문구에 %s 포함", (reason, word) => {
    expect(fetchErrorMessage(reason)).toContain(word);
  });

  it("8갈래 문구가 서로 다르고, 판정 단어가 각각 정확히 한 갈래에만 나타난다", () => {
    const reasons: FetchReason[] = [
      { kind: "http", status: 404 },
      { kind: "cors" },
      { kind: "network" },
      { kind: "offline" },
      { kind: "too-large" },
      { kind: "timeout" },
      { kind: "empty" },
      { kind: "ambiguous" },
    ];
    const messages = reasons.map(fetchErrorMessage);
    expect(new Set(messages).size).toBe(messages.length);

    // "404"·"2MB" 는 정확히 한 갈래에만 나타나야 한다(AC-6·AC-9 의 구별 근거).
    const exclusiveWords = ["404", "2MB"];
    for (const word of exclusiveWords) {
      const hits = messages.filter((m) => m.includes(word));
      expect(hits, `"${word}" 가 여러 갈래에 나타난다`).toHaveLength(1);
    }
    // "CORS"·"닿지 못했습니다" 는 각각 cors/network 와, 저하 문구인 ambiguous
    // 에도 의도적으로 나타난다(S-1 합본 — AC-7·AC-8 은 cors/network 만 겪는다).
    expect(messages.filter((m) => m.includes("CORS"))).toHaveLength(2);
    expect(messages.filter((m) => m.includes("닿지 못했습니다"))).toHaveLength(2);
  });
});

describe("rejectMessage", () => {
  it("scheme·not-absolute 문구에 http 포함(AC-5)", () => {
    expect(rejectMessage("scheme")).toContain("http");
    expect(rejectMessage("not-absolute")).toContain("http");
  });

  it("local-path 문구에 '파일 선택' 포함(AC-13)", () => {
    expect(rejectMessage("local-path")).toContain("파일 선택");
  });
});

describe("looksLikeWebPage", () => {
  it.each([
    ["text/html", true],
    ["text/html; charset=utf-8", true],
    ["application/xhtml+xml", true],
    ["TEXT/HTML", true],
    ["text/plain", false],
    ["text/markdown", false],
    ["application/octet-stream", false],
    [null, false],
  ])("%s → %s", (contentType, expected) => {
    expect(looksLikeWebPage(contentType as string | null)).toBe(expected);
  });
});

describe("openedMessage", () => {
  it("호스트·파일명을 포함한다(S-4)", () => {
    const msg = openedMessage("raw.test", "guide.md", false);
    expect(msg).toContain("raw.test");
    expect(msg).toContain("guide.md");
  });

  it("htmlHint 가 true 일 때만 raw 안내가 붙는다", () => {
    const withHint = openedMessage("raw.test", "guide.md", true);
    const withoutHint = openedMessage("raw.test", "guide.md", false);
    expect(withHint).toContain("원본(raw)");
    expect(withoutHint).not.toContain("원본(raw)");
  });
});

describe("상수", () => {
  it("MAX_REMOTE_BYTES 는 MAX_IMAGE_BYTES 와 같다(PRD 결정 4)", () => {
    expect(MAX_REMOTE_BYTES).toBe(MAX_IMAGE_BYTES);
  });
});
