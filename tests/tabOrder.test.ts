import { describe, expect, it } from "vitest";
import { dropIndex, moveItem, stepItem } from "../src/tabOrder";

/**
 * F-34 탭 재정렬 계산 (이슈 #62).
 *
 * 재정렬의 어려운 부분은 전부 인덱스 계산이다 — 특히 "자기 자신을 지나쳐 뒤로
 * 옮길 때 제거로 인해 인덱스가 하나 당겨진다" 는 것.
 */

const ABC = ["a", "b", "c", "d"];

describe("moveItem", () => {
  it("앞으로 옮긴다", () => {
    expect(moveItem(ABC, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("뒤로 옮긴다", () => {
    expect(moveItem(ABC, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("맨 끝으로 옮긴다", () => {
    expect(moveItem(ABC, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("원본을 바꾸지 않는다", () => {
    // 재구성 도중 예외가 나면 원본이 반쯤 뒤섞인 채 남는 것이 최악이다.
    const original = [...ABC];
    moveItem(original, 0, 3);
    expect(original).toEqual(ABC);
  });

  it("같은 자리로 옮기면 그대로", () => {
    expect(moveItem(ABC, 1, 1)).toEqual(ABC);
  });

  it("범위를 벗어나면 원본 그대로 — 조용히 뒤바뀌지 않는다", () => {
    // 드래그는 화면 밖·빈 영역에서도 끝난다. 그때 순서가 바뀌면 이유를 알 수 없다.
    expect(moveItem(ABC, -1, 2)).toEqual(ABC);
    expect(moveItem(ABC, 9, 2)).toEqual(ABC);
    expect(moveItem(ABC, 0, -1)).toEqual(ABC);
    expect(moveItem(ABC, 0, 9)).toEqual(ABC);
  });

  it("정수가 아닌 인덱스도 막는다", () => {
    expect(moveItem(ABC, 0.5, 2)).toEqual(ABC);
    expect(moveItem(ABC, NaN, 2)).toEqual(ABC);
  });

  it("빈 배열·1개 배열에서도 안전하다", () => {
    expect(moveItem([], 0, 0)).toEqual([]);
    expect(moveItem(["a"], 0, 0)).toEqual(["a"]);
  });
});

describe("stepItem", () => {
  it("한 칸씩 움직인다", () => {
    expect(stepItem(ABC, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(stepItem(ABC, "b", 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("끝에서는 더 가지 않는다 — 순환하지 않는다", () => {
    // 순환하면 화살표를 누르던 사용자의 탭이 반대쪽 끝으로 튕겨 나간다.
    expect(stepItem(ABC, "a", -1)).toEqual(ABC);
    expect(stepItem(ABC, "d", 1)).toEqual(ABC);
  });

  it("없는 id 는 무시한다", () => {
    expect(stepItem(ABC, "z", 1)).toEqual(ABC);
  });
});

describe("dropIndex", () => {
  it("앞쪽 절반에 놓으면 그 앞에 들어간다", () => {
    expect(dropIndex(ABC, "d", "b", false)).toBe(1);
  });

  it("뒤쪽 절반에 놓으면 그 뒤에 들어간다", () => {
    expect(dropIndex(ABC, "d", "b", true)).toBe(2);
  });

  it("자기 자신을 지나쳐 뒤로 갈 때 인덱스 당김을 보정한다", () => {
    // a 를 c 뒤로 → 제거 후 배열이 [b,c,d] 이므로 목표는 2 지 3 이 아니다.
    expect(dropIndex(ABC, "a", "c", true)).toBe(2);
    expect(moveItem(ABC, 0, dropIndex(ABC, "a", "c", true))).toEqual(["b", "c", "a", "d"]);
  });

  it("앞으로 갈 때는 보정하지 않는다", () => {
    expect(dropIndex(ABC, "d", "a", false)).toBe(0);
    expect(moveItem(ABC, 3, dropIndex(ABC, "d", "a", false))).toEqual(["d", "a", "b", "c"]);
  });

  it("맨 끝으로 옮길 수 있다", () => {
    // 항상 앞에 넣는 구현이면 마지막 자리로 옮길 방법이 없다.
    expect(moveItem(ABC, 0, dropIndex(ABC, "a", "d", true))).toEqual(["b", "c", "d", "a"]);
  });

  it("맨 앞으로 옮길 수 있다", () => {
    expect(moveItem(ABC, 3, dropIndex(ABC, "d", "a", false))).toEqual(["d", "a", "b", "c"]);
  });

  it("모르는 id 는 원래 위치를 돌려준다", () => {
    expect(dropIndex(ABC, "z", "b", false)).toBe(-1);
    expect(dropIndex(ABC, "a", "z", false)).toBe(0);
  });
});
