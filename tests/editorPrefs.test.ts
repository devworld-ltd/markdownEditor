import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE,
  FONT_CHOICES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
  fontLabelOf,
  fontStackOf,
  parseFontId,
  stepFontSize,
} from "../src/editorPrefs";

/** F-35 편집 글꼴·크기 계산 (이슈 #63). */

describe("clampFontSize", () => {
  it("범위 밖은 자른다", () => {
    expect(clampFontSize(1)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(999)).toBe(MAX_FONT_SIZE);
  });

  it("소수는 반올림한다 — 서브픽셀 크기는 흔들림만 만든다", () => {
    expect(clampFontSize(14.4)).toBe(14);
    expect(clampFontSize(14.6)).toBe(15);
  });

  it("숫자가 아니거나 NaN 이면 기본값", () => {
    for (const bad of ["14", null, undefined, {}, [], NaN, Infinity]) {
      expect(clampFontSize(bad)).toBe(DEFAULT_FONT_SIZE);
    }
  });
});

describe("stepFontSize", () => {
  it("한 단계씩 움직인다", () => {
    expect(stepFontSize(14, 1)).toBe(15);
    expect(stepFontSize(14, -1)).toBe(13);
  });

  it("끝에서는 더 가지 않는다 — 순환하면 갑자기 반대 끝으로 튄다", () => {
    expect(stepFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE);
    expect(stepFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE);
  });

  it("범위 밖에서 시작해도 안전하다", () => {
    expect(stepFontSize(999, 1)).toBe(MAX_FONT_SIZE);
  });
});

describe("parseFontId / fontStackOf", () => {
  it("아는 id 는 그대로", () => {
    for (const choice of FONT_CHOICES) expect(parseFontId(choice.id)).toBe(choice.id);
  });

  it("모르는 값은 기본값 — 설정 하나 때문에 편집기가 안 뜨면 안 된다", () => {
    for (const bad of ["comic", "", null, undefined, 42, {}]) {
      expect(parseFontId(bad)).toBe(DEFAULT_FONT_ID);
    }
  });

  it("모르는 id 로도 유효한 스택을 돌려준다", () => {
    expect(fontStackOf("comic")).toBe(fontStackOf(DEFAULT_FONT_ID));
    expect(fontLabelOf("comic")).toBe(fontLabelOf(DEFAULT_FONT_ID));
  });

  it("모든 선택지가 시스템 글꼴 폴백 사슬을 갖는다 — 웹폰트를 쓰지 않는다", () => {
    // 이 앱은 네트워크 요청이 없고 CSP 도 font-src 'self' data: 다.
    for (const choice of FONT_CHOICES) {
      expect(choice.stack, choice.id).not.toMatch(/url\(|https?:/);
      // 마지막 항목은 일반 계열(generic family)이어야 어느 OS 에서도 뜬다.
      expect(choice.stack.split(",").pop()!.trim(), choice.id).toMatch(
        /^(monospace|sans-serif|serif)$/,
      );
    }
  });

  it("선택지 id 가 중복되지 않는다", () => {
    const ids = FONT_CHOICES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
