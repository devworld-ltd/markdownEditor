import { describe, expect, it } from "vitest";
import { keyboardInset } from "../src/virtualKeyboard";

/**
 * #155 가상 키보드 높이 계산.
 *
 * **실제로 키보드 위에 붙는지는 여기서 알 수 없다** — 헤드리스 브라우저에는
 * 가상 키보드가 없다. 여기서 고정하는 것은 계산 규칙뿐이고, 실기기 확인 절차는
 * 이슈 #155 댓글에 있다.
 */

describe("keyboardInset", () => {
  it("키보드가 없으면 0", () => {
    expect(keyboardInset({ height: 844 }, 844)).toBe(0);
  });

  it("가려진 만큼 띄운다", () => {
    // iPhone 세로에서 키보드가 약 336px 를 먹는다.
    expect(keyboardInset({ height: 508 }, 844)).toBe(336);
  });

  it("확대로 밀린 양(offsetTop)도 뺀다", () => {
    expect(keyboardInset({ height: 500, offsetTop: 20 }, 844)).toBe(324);
  });

  it("보이는 높이가 창보다 커도 음수를 만들지 않는다", () => {
    // 확대 중에는 이런 순간이 있다. 음수를 그대로 쓰면 바가 화면 밖으로 나간다.
    expect(keyboardInset({ height: 900 }, 844)).toBe(0);
  });

  it("1px 안팎의 반올림 오차는 무시한다 — 그것 때문에 바가 떨리면 안 된다", () => {
    expect(keyboardInset({ height: 843.4 }, 844)).toBe(0);
  });

  it("visualViewport 가 없는 브라우저에서는 0", () => {
    expect(keyboardInset(null, 844)).toBe(0);
    expect(keyboardInset(undefined, 844)).toBe(0);
  });

  it("이상한 값이 와도 0 으로 물러난다", () => {
    expect(keyboardInset({ height: Number.NaN }, 844)).toBe(0);
    expect(keyboardInset({ height: 500 }, Number.NaN)).toBe(0);
  });
});
