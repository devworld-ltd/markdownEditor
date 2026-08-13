import { describe, expect, it } from "vitest";

import {
  classifyDropped,
  extensionOf,
  isDocumentFile,
  isImageFile,
  rejectionMessage,
} from "../src/dropFiles";

describe("extensionOf", () => {
  it.each([
    ["문서.md", ".md"],
    ["a.MARKDOWN", ".markdown"],
    ["보고서.tar.gz", ".gz"],
    ["이름없음", ""],
    [".gitignore", ""], // 숨김 파일은 확장자가 아니라 이름이다
  ])("%s → %s", (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });
});

describe("isImageFile", () => {
  it("타입으로 판단한다", () => {
    expect(isImageFile({ name: "a.png", type: "image/png" })).toBe(true);
    expect(isImageFile({ name: "a.png", type: "text/plain" })).toBe(false);
  });

  it("확장자를 고쳐 붙인 파일은 이미지가 아니다", () => {
    // 업로드 검증이 타입 기준이라 여기서도 타입을 믿는다.
    expect(isImageFile({ name: "실행파일.png", type: "application/octet-stream" })).toBe(
      false,
    );
  });
});

describe("isDocumentFile", () => {
  it.each([".md", ".markdown", ".mdown", ".mkd", ".txt"])(
    "%s 는 문서다",
    (ext) => {
      expect(isDocumentFile({ name: `문서${ext}`, type: "" })).toBe(true);
    },
  );

  it("MIME 타입이 비어 있어도 확장자로 판단한다", () => {
    // 맥에서 .md 의 타입은 자주 빈 문자열이다.
    expect(isDocumentFile({ name: "문서.md", type: "" })).toBe(true);
  });

  it("대소문자를 가리지 않는다", () => {
    expect(isDocumentFile({ name: "README.MD", type: "" })).toBe(true);
  });

  it("확장자가 없으면 text/ 타입만 인정한다", () => {
    expect(isDocumentFile({ name: "메모", type: "text/plain" })).toBe(true);
    expect(isDocumentFile({ name: "메모", type: "application/pdf" })).toBe(false);
  });

  it("확장자가 있으면 타입이 text 여도 목록에 없으면 거절한다", () => {
    // 어쩌다 text/plain 으로 오는 pdf 까지 열어 주면 안 된다.
    expect(isDocumentFile({ name: "보고서.pdf", type: "text/plain" })).toBe(false);
  });

  it("이미지는 문서가 아니다", () => {
    expect(isDocumentFile({ name: "사진.png", type: "image/png" })).toBe(false);
  });
});

describe("classifyDropped", () => {
  it("이미지·문서·거절로 가른다", () => {
    const files = [
      { name: "사진.png", type: "image/png" },
      { name: "문서.md", type: "text/markdown" },
      { name: "보고서.pdf", type: "application/pdf" },
    ];
    const result = classifyDropped(files);
    expect(result.images.map((f) => f.name)).toEqual(["사진.png"]);
    expect(result.documents.map((f) => f.name)).toEqual(["문서.md"]);
    expect(result.rejected.map((f) => f.name)).toEqual(["보고서.pdf"]);
  });

  it("빈 목록도 다룬다", () => {
    expect(classifyDropped([])).toEqual({ images: [], documents: [], rejected: [] });
  });

  it("순서를 지킨다 — 여러 파일을 드롭한 순서대로 열려야 한다", () => {
    const files = [
      { name: "b.md", type: "" },
      { name: "a.md", type: "" },
    ];
    expect(classifyDropped(files).documents.map((f) => f.name)).toEqual([
      "b.md",
      "a.md",
    ]);
  });

  it("원래 객체를 그대로 넘긴다 — 핸들 같은 곁가지 정보가 살아남아야 한다", () => {
    const item = { name: "문서.md", type: "", handle: {} };
    expect(classifyDropped([item]).documents[0]).toBe(item);
  });
});

describe("rejectionMessage", () => {
  it("무엇이 왜 안 되는지 이름까지 밝힌다", () => {
    const message = rejectionMessage([
      { name: "보고서.pdf", type: "application/pdf" },
      { name: "표.xlsx", type: "" },
    ]);
    expect(message).toContain("보고서.pdf");
    expect(message).toContain("표.xlsx");
    expect(message).toContain("마크다운");
  });
});
