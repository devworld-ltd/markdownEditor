import { describe, expect, it } from "vitest";
import {
  clampCaret,
  clampScroll,
  compareStamp,
  isRealChange,
  type DiskStamp,
} from "../src/diskStamp";

describe("compareStamp", () => {
  const a: DiskStamp = { lastModified: 1000, size: 10 };
  const b: DiskStamp = { lastModified: 1000, size: 10 };
  const changedMtime: DiskStamp = { lastModified: 2000, size: 10 };
  const changedSize: DiskStamp = { lastModified: 1000, size: 11 };

  it("기준값이 없으면(둘 중 하나라도 null) unknown", () => {
    expect(compareStamp(null, a)).toBe("unknown");
    expect(compareStamp(a, null)).toBe("unknown");
    expect(compareStamp(null, null)).toBe("unknown");
  });

  it("mtime·크기가 모두 같으면 same", () => {
    expect(compareStamp(a, b)).toBe("same");
  });

  it("mtime 만 달라도 changed", () => {
    expect(compareStamp(a, changedMtime)).toBe("changed");
  });

  it("크기만 달라도 changed", () => {
    expect(compareStamp(a, changedSize)).toBe("changed");
  });
});

describe("isRealChange", () => {
  it("내용이 다르면 true", () => {
    expect(isRealChange("disk", "tab")).toBe(true);
  });

  it("내용이 같으면 false (S-3: mtime 만 바뀐 경우를 걸러낸다)", () => {
    expect(isRealChange("same", "same")).toBe(false);
  });

  it("빈 문자열끼리도 같다고 판정한다", () => {
    expect(isRealChange("", "")).toBe(false);
  });
});

describe("clampCaret", () => {
  it("새 길이 안에 있으면 그대로", () => {
    expect(clampCaret(5, 10)).toBe(5);
  });

  it("새 길이를 넘으면 끝으로 클램프한다", () => {
    expect(clampCaret(50, 10)).toBe(10);
  });

  it("정확히 새 길이와 같으면 그대로", () => {
    expect(clampCaret(10, 10)).toBe(10);
  });

  it("0 은 그대로 0", () => {
    expect(clampCaret(0, 10)).toBe(0);
  });

  it("음수 오프셋은 0 으로 클램프한다", () => {
    expect(clampCaret(-5, 10)).toBe(0);
  });

  it("NaN 오프셋은 0 으로 클램프한다 (예외를 던지지 않는다)", () => {
    expect(clampCaret(NaN, 10)).toBe(0);
  });

  it("NaN 길이는 0 으로 클램프한다", () => {
    expect(clampCaret(5, NaN)).toBe(0);
  });
});

describe("clampScroll — 트랩 #18: NaN 을 만들지 않고 > 0 으로 비교한다", () => {
  it("스크롤할 내용이 없으면(0/0) NaN 대신 0을 준다", () => {
    // newScrollHeight === clientHeight 이면 maxScroll 은 0 — top 이 0보다 크더라도 0이어야 한다.
    expect(clampScroll(5, 100, 100)).toBe(0);
  });

  it("top 이 0 이하이면 항상 0", () => {
    expect(clampScroll(0, 500, 100)).toBe(0);
    expect(clampScroll(-10, 500, 100)).toBe(0);
  });

  it("top 이 NaN 이면 0 (NaN > 0 은 false)", () => {
    expect(clampScroll(NaN, 500, 100)).toBe(0);
  });

  it("maxScroll 보다 크면 maxScroll 로 클램프한다", () => {
    expect(clampScroll(1000, 500, 100)).toBe(400);
  });

  it("maxScroll 이하면 그대로", () => {
    expect(clampScroll(200, 500, 100)).toBe(200);
  });

  it("clientHeight 가 scrollHeight 보다 크면(음수 maxScroll) 0", () => {
    expect(clampScroll(50, 100, 500)).toBe(0);
  });
});
