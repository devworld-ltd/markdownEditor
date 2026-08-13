import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  altFromFileName,
  computeImageKey,
  contentTypeForKey,
  imageErrorMessage,
  imageMarkdown,
  isValidImageKey,
  validateImage,
} from "../src/imageUpload";

/** F-28 이미지 업로드 검증 (이슈 #80). Worker 와 브라우저가 함께 쓴다. */

describe("validateImage", () => {
  it("허용 형식을 통과시킨다", () => {
    for (const [type, ext] of Object.entries(ALLOWED_IMAGE_TYPES)) {
      expect(validateImage(type, 1000), type).toEqual({ ok: true, extension: ext });
    }
  });

  it("SVG 를 거절한다", () => {
    // SVG 는 스크립트를 담을 수 있는 문서 형식이다. 우리 오리진 URL 을 갖게 되면
    // 사용자가 직접 열었을 때 그 스크립트가 우리 오리진에서 실행된다.
    expect(validateImage("image/svg+xml", 1000)).toEqual({ ok: false, reason: "type" });
  });

  it("이미지가 아닌 형식을 거절한다", () => {
    for (const type of ["text/html", "application/pdf", "text/markdown", "", "image/bmp"]) {
      expect(validateImage(type, 1000).ok, type).toBe(false);
    }
  });

  it("빈 파일과 상한 초과를 거절한다", () => {
    expect(validateImage("image/png", 0)).toEqual({ ok: false, reason: "empty" });
    expect(validateImage("image/png", MAX_IMAGE_BYTES + 1)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("경계값은 통과시킨다", () => {
    expect(validateImage("image/png", MAX_IMAGE_BYTES).ok).toBe(true);
  });
});

describe("isValidImageKey / contentTypeForKey", () => {
  it("올바른 키만 통과시킨다", () => {
    expect(isValidImageKey("0123456789abcdef.png")).toBe(true);
    expect(contentTypeForKey("0123456789abcdef.webp")).toBe("image/webp");
  });

  it("경로 조작·이상한 키를 막는다", () => {
    // 검증 없이 R2 키로 쓰면 임의 객체를 읽으려는 시도가 통한다.
    for (const bad of [
      "../secret.png",
      "0123456789abcdef.svg",
      "0123456789ABCDEF.png",
      "short.png",
      "0123456789abcdef",
      "0123456789abcdef.png.svg",
      "",
      null,
    ]) {
      expect(isValidImageKey(bad), String(bad)).toBe(false);
      if (typeof bad === "string") expect(contentTypeForKey(bad), bad).toBeNull();
    }
  });
});

describe("computeImageKey", () => {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

  it("같은 바이트면 같은 키 — 중복 저장이 없다", async () => {
    expect(await computeImageKey(bytes("같은 그림"), "png")).toBe(
      await computeImageKey(bytes("같은 그림"), "png"),
    );
  });

  it("바이트가 다르면 키도 다르다", async () => {
    expect(await computeImageKey(bytes("a"), "png")).not.toBe(
      await computeImageKey(bytes("b"), "png"),
    );
  });

  it("확장자가 키에 들어간다", async () => {
    const key = await computeImageKey(bytes("x"), "webp");
    expect(key.endsWith(".webp")).toBe(true);
    expect(isValidImageKey(key)).toBe(true);
  });
});

describe("imageMarkdown / altFromFileName", () => {
  it("마크다운 이미지 문법을 만든다", () => {
    expect(imageMarkdown("/i/abc.png", "설명")).toBe("![설명](/i/abc.png)");
  });

  it("대체 텍스트의 대괄호를 지운다 — 링크 문법이 깨진다", () => {
    expect(imageMarkdown("/i/a.png", "가[나]다")).toBe("![가나다](/i/a.png)");
  });

  it("파일명에서 확장자를 뗀 이름을 쓴다", () => {
    expect(altFromFileName("스크린샷 2026.png")).toBe("스크린샷 2026");
  });

  it("이름이 없으면 기본값", () => {
    expect(altFromFileName(".png")).toBe("이미지");
    expect(altFromFileName("   ")).toBe("이미지");
  });
});

describe("imageErrorMessage", () => {
  it("형식 오류에는 허용 형식을 분명히 말한다", () => {
    // SVG 를 시도했을 가능성이 높다.
    const message = imageErrorMessage("type");
    expect(message).toContain("PNG");
    expect(message).toContain("WebP");
  });

  it("크기 오류에는 상한을 알린다", () => {
    expect(imageErrorMessage("too-large")).toContain("MB");
  });
});
