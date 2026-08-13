import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATIO,
  KEYBOARD_STEP,
  MAX_RATIO,
  MIN_RATIO,
  clampRatio,
  parseStoredRatio,
  ratioFromPointer,
  stepRatio,
  toAriaValue,
  toPercent,
} from "../src/splitLayout";

/**
 * F-32 분할 비율 계산 (이슈 #49).
 *
 * 드래그·키보드·복원의 어려운 부분은 전부 "비율을 어떻게 자를 것인가" 이고,
 * DOM 없이 검증된다.
 */

describe("clampRatio", () => {
  it("한쪽이 사라지지 않게 하한/상한으로 자른다", () => {
    // 0 을 허용하면 사용자가 한쪽을 완전히 접은 뒤 되돌릴 손잡이도 사라진다.
    expect(clampRatio(0)).toBe(MIN_RATIO);
    expect(clampRatio(-5)).toBe(MIN_RATIO);
    expect(clampRatio(1)).toBe(MAX_RATIO);
    expect(clampRatio(99)).toBe(MAX_RATIO);
  });

  it("범위 안의 값은 그대로", () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.3)).toBe(0.3);
  });

  it("NaN·Infinity 는 기본값으로 되돌린다", () => {
    // 0/0 을 흘려보내면 레이아웃이 조용히 무너진다 (트랩 #18).
    expect(clampRatio(NaN)).toBe(DEFAULT_RATIO);
    expect(clampRatio(Infinity)).toBe(DEFAULT_RATIO);
    expect(clampRatio(-Infinity)).toBe(DEFAULT_RATIO);
  });
});

describe("ratioFromPointer", () => {
  it("컨테이너 안의 좌표를 비율로 바꾼다", () => {
    expect(ratioFromPointer(500, 0, 1000)).toBe(0.5);
    expect(ratioFromPointer(300, 0, 1000)).toBe(0.3);
  });

  it("컨테이너 시작점을 뺀다 (좌우 여백 보정)", () => {
    expect(ratioFromPointer(600, 100, 1000)).toBe(0.5);
  });

  it("범위를 벗어난 좌표는 잘린다", () => {
    expect(ratioFromPointer(-100, 0, 1000)).toBe(MIN_RATIO);
    expect(ratioFromPointer(9999, 0, 1000)).toBe(MAX_RATIO);
  });

  it("크기가 0 이하면 기본값 — 0 나눗셈을 흘려보내지 않는다", () => {
    // 레이아웃 전이 중 크기가 0 이거나 음수일 수 있다 (트랩 #18).
    expect(ratioFromPointer(500, 0, 0)).toBe(DEFAULT_RATIO);
    expect(ratioFromPointer(500, 0, -10)).toBe(DEFAULT_RATIO);
  });
});

describe("stepRatio", () => {
  it("한 걸음씩 움직인다", () => {
    expect(stepRatio(0.5, 1)).toBeCloseTo(0.5 + KEYBOARD_STEP, 10);
    expect(stepRatio(0.5, -1)).toBeCloseTo(0.5 - KEYBOARD_STEP, 10);
  });

  it("끝에 닿으면 더 가지 않는다 — 순환하지 않는다", () => {
    // 순환하면 화살표를 누르던 사용자가 반대쪽 끝으로 튕겨 나간다.
    expect(stepRatio(MAX_RATIO, 1)).toBe(MAX_RATIO);
    expect(stepRatio(MIN_RATIO, -1)).toBe(MIN_RATIO);
  });
});

describe("toPercent / toAriaValue", () => {
  it("CSS 에 넣을 퍼센트 문자열", () => {
    expect(toPercent(0.5)).toBe("50.00%");
    expect(toPercent(0.333)).toBe("33.30%");
  });

  it("스크린리더용 정수 퍼센트", () => {
    expect(toAriaValue(0.5)).toBe(50);
    expect(toAriaValue(0.333)).toBe(33);
  });

  it("표시 값도 범위 안으로 잘린다", () => {
    expect(toAriaValue(2)).toBe(Math.round(MAX_RATIO * 100));
  });
});

describe("parseStoredRatio", () => {
  it("숫자면 범위로 자른 값", () => {
    expect(parseStoredRatio(0.7)).toBe(0.7);
    expect(parseStoredRatio(0.01)).toBe(MIN_RATIO);
  });

  it("손상된 값은 조용히 기본값 — 레이아웃 설정 때문에 앱이 안 뜨면 안 된다", () => {
    for (const bad of [null, undefined, "0.5", {}, [], NaN, Infinity]) {
      expect(parseStoredRatio(bad)).toBe(DEFAULT_RATIO);
    }
  });
});
