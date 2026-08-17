import { describe, expect, it } from "vitest";
import { buildTable, formatTable, makeTableBlock } from "../src/tableFormat";

/**
 * #150 — 미리보기와 삽입 결과가 **같은 함수에서 나온다**는 것을 고정한다.
 */

describe("makeTableBlock", () => {
  it("삽입 결과가 이 블록을 그대로 쓴 것과 같다", () => {
    // 갈라지는 순간 "미리보기와 넣은 것이 같다" 가 거짓이 된다.
    expect(buildTable(3, 4, "center")).toBe(formatTable(makeTableBlock(3, 4, "center")));
  });

  it("행·열 수를 그대로 만든다", () => {
    const block = makeTableBlock(4, 2);
    expect(block.header).toHaveLength(2);
    expect(block.body).toHaveLength(4);
    expect(block.body[0]).toHaveLength(2);
  });

  it("정렬을 모든 열에 건다", () => {
    expect(makeTableBlock(1, 3, "right").align).toEqual(["right", "right", "right"]);
  });

  it("범위를 벗어난 값은 잘라 낸다", () => {
    expect(makeTableBlock(0, 0).body).toHaveLength(1);
    expect(makeTableBlock(999, 999).body).toHaveLength(50);
    expect(makeTableBlock(999, 999).header).toHaveLength(20);
  });

  it("숫자가 아닌 입력에서도 표 하나는 나온다 — 빈 칸을 지운 상태가 이렇다", () => {
    // 입력을 비우면 `Number("")` 이 `NaN` 이라 여기로 온다.
    expect(makeTableBlock(NaN, NaN).body).toHaveLength(1);
    expect(makeTableBlock(NaN, NaN).header).toHaveLength(1);
  });
});
