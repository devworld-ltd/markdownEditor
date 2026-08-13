import { describe, expect, it } from "vitest";
import {
  MAX_SHARE_BYTES,
  SHARE_ID_LENGTH,
  computeShareId,
  isValidShareId,
  shareErrorMessage,
  shareIdFromPath,
  shareUrl,
  validateShareContent,
} from "../src/shareId";

/**
 * F-60 공유 ID·검증 (이슈 #66).
 *
 * 이 모듈은 **Worker 와 브라우저 양쪽에서 쓰인다.** 그래서 두 쪽이 같은 판정을
 * 내리는지가 핵심이고, 그건 전부 순수 계산이라 여기서 확인된다.
 */

describe("computeShareId", () => {
  it("같은 내용이면 같은 ID — 다시 공유해도 링크가 그대로다", async () => {
    const a = await computeShareId("# 제목\n본문");
    const b = await computeShareId("# 제목\n본문");
    expect(a).toBe(b);
  });

  it("내용이 다르면 다른 ID", async () => {
    expect(await computeShareId("a")).not.toBe(await computeShareId("b"));
  });

  it("한 글자만 달라도 달라진다", async () => {
    expect(await computeShareId("문서 A")).not.toBe(await computeShareId("문서 B"));
  });

  it("정해진 길이의 16진수다", async () => {
    const id = await computeShareId("아무거나");
    expect(id).toHaveLength(SHARE_ID_LENGTH);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it("유니코드를 바이트로 다룬다 — 인코딩이 달라도 결정적이다", async () => {
    const id = await computeShareId("한글 문서 🙂");
    expect(isValidShareId(id)).toBe(true);
  });
});

describe("isValidShareId", () => {
  it("올바른 형식만 통과시킨다", () => {
    expect(isValidShareId("0123456789abcdef")).toBe(true);
  });

  it("경로 조작·이상한 키를 막는다", () => {
    // 검증 없이 R2 키로 쓰면 임의 객체를 읽으려는 시도가 통한다.
    for (const bad of [
      "../secret",
      "0123456789ABCDEF", // 대문자
      "0123456789abcde", // 짧음
      "0123456789abcdef0", // 김
      "zzzzzzzzzzzzzzzz",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isValidShareId(bad), String(bad)).toBe(false);
    }
  });
});

describe("validateShareContent", () => {
  it("빈 문서는 거절한다", () => {
    expect(validateShareContent("")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("상한을 넘으면 거절한다", () => {
    // 익명 공개 쓰기 엔드포인트라 상한이 없으면 남용된다.
    const big = "a".repeat(MAX_SHARE_BYTES + 1);
    expect(validateShareContent(big)).toMatchObject({ ok: false, reason: "too-large" });
  });

  it("경계값은 통과시킨다", () => {
    expect(validateShareContent("a".repeat(MAX_SHARE_BYTES))).toMatchObject({ ok: true });
  });

  it("바이트 기준으로 센다 — 글자 수가 아니다", () => {
    // 한글은 UTF-8 에서 3바이트다. 글자 수로 세면 상한이 3배로 새어 나간다.
    const korean = "한".repeat(Math.floor(MAX_SHARE_BYTES / 3) + 10);
    expect(validateShareContent(korean).ok).toBe(false);
    expect(validateShareContent(korean).bytes).toBeGreaterThan(MAX_SHARE_BYTES);
  });
});

describe("shareUrl / shareIdFromPath", () => {
  it("링크를 만든다", () => {
    expect(shareUrl("https://example.com", "0123456789abcdef")).toBe(
      "https://example.com/s/0123456789abcdef",
    );
  });

  it("오리진의 끝 슬래시를 정리한다", () => {
    expect(shareUrl("https://example.com//", "0123456789abcdef")).toBe(
      "https://example.com/s/0123456789abcdef",
    );
  });

  it("경로에서 ID 를 뽑는다", () => {
    expect(shareIdFromPath("/s/0123456789abcdef")).toBe("0123456789abcdef");
    expect(shareIdFromPath("/s/0123456789abcdef/")).toBe("0123456789abcdef");
  });

  it("공유 경로가 아니면 null", () => {
    for (const path of ["/", "/index.html", "/s/", "/s/../x", "/share/abc", "/s/zzz"]) {
      expect(shareIdFromPath(path), path).toBeNull();
    }
  });

  it("형식이 틀린 ID 는 받아들이지 않는다", () => {
    expect(shareIdFromPath("/s/abc")).toBeNull();
    expect(shareIdFromPath("/s/0123456789abcdef0")).toBeNull();
  });

  it("만든 링크를 다시 파싱할 수 있다", async () => {
    const id = await computeShareId("왕복 검사");
    expect(shareIdFromPath(new URL(shareUrl("https://x.dev", id)).pathname)).toBe(id);
  });
});

describe("shareErrorMessage", () => {
  it("사유별로 다른 문구를 준다", () => {
    expect(shareErrorMessage("empty")).toContain("빈 문서");
    expect(shareErrorMessage("too-large")).toContain("KB");
  });
});
