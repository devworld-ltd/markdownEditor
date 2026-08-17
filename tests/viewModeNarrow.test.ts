import { describe, expect, it } from "vitest";
import { effectiveViewMode, nextViewMode, VIEW_MODES } from "../src/viewMode";

/** #154 좁은 화면 규칙 — 계산부. */

describe("effectiveViewMode", () => {
  it("넓은 화면에서는 저장된 값 그대로다", () => {
    for (const mode of VIEW_MODES) {
      expect(effectiveViewMode(mode, false)).toBe(mode);
    }
  });

  it("좁은 화면에서 분할은 편집으로 접힌다", () => {
    // 390px 에서 위아래로 나누면 양쪽 다 너무 얕아 쓸 수 없다.
    expect(effectiveViewMode("split", true)).toBe("editor");
  });

  it("좁은 화면에서도 사용자가 고른 값은 바꾸지 않는다", () => {
    expect(effectiveViewMode("preview", true)).toBe("preview");
    expect(effectiveViewMode("editor", true)).toBe("editor");
  });
});

describe("nextViewMode", () => {
  it("넓은 화면에서는 셋을 순환한다", () => {
    expect(nextViewMode("split")).toBe("editor");
    expect(nextViewMode("editor")).toBe("preview");
    expect(nextViewMode("preview")).toBe("split");
  });

  it("좁은 화면에서는 분할을 건너뛴다", () => {
    expect(nextViewMode("editor", true)).toBe("preview");
    expect(nextViewMode("preview", true)).toBe("editor");
  });

  it("좁은 화면에서 분할이 저장돼 있으면 편집 다음인 미리보기로 간다", () => {
    // 표시가 편집이므로 다음은 미리보기여야 한다 — 분할로 되돌아가면 아무 일도
    // 안 일어난 것처럼 보인다.
    expect(nextViewMode("split", true)).toBe("preview");
  });

  it("좁은 화면 순환은 두 번이면 제자리다", () => {
    expect(nextViewMode(nextViewMode("editor", true), true)).toBe("editor");
  });
});
