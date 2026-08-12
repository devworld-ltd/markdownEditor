import { describe, it, expect } from "vitest";
import { suggestFileName } from "../src/fileOps";

describe("suggestFileName", () => {
  it("UNTITLED 이면 Untitled.md 를 제안한다", () => {
    expect(suggestFileName("Untitled")).toBe("Untitled.md");
  });

  it("공백 문자열이면 Untitled.md 를 제안한다", () => {
    expect(suggestFileName("   ")).toBe("Untitled.md");
  });

  it("빈 문자열이면 Untitled.md 를 제안한다", () => {
    expect(suggestFileName("")).toBe("Untitled.md");
  });

  it(".md 확장자는 그대로 유지한다", () => {
    expect(suggestFileName("notes.md")).toBe("notes.md");
  });

  it(".markdown 확장자는 그대로 유지한다", () => {
    expect(suggestFileName("notes.markdown")).toBe("notes.markdown");
  });

  it(".txt 확장자는 그대로 유지한다", () => {
    expect(suggestFileName("notes.txt")).toBe("notes.txt");
  });

  it("대소문자가 섞인 확장자(.MD)도 인식해 그대로 유지한다", () => {
    expect(suggestFileName("notes.MD")).toBe("notes.MD");
  });

  it("확장자가 없으면 .md 를 붙인다", () => {
    expect(suggestFileName("notes")).toBe("notes.md");
  });

  it("지원하지 않는 확장자면 .md 를 덧붙인다", () => {
    expect(suggestFileName("notes.doc")).toBe("notes.doc.md");
  });
});
