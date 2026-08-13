import { describe, expect, it } from "vitest";
import { computeStats, formatStats } from "../src/docStats";

/**
 * F-29 문서 통계 (이슈 #81).
 *
 * 핵심은 **정확한 이름 붙이기**다. 공백으로 자른 결과를 "단어" 라고 부르면
 * 한국어에서 조용히 틀린 숫자가 되지만, "어절" 이라고 부르면 맞는 숫자다.
 */

describe("computeStats — 세기", () => {
  it("공백으로 자른 조각을 센다", () => {
    expect(computeStats("hello world foo").words).toBe(3);
  });

  it("연속 공백·개행을 하나로 본다", () => {
    expect(computeStats("a   b\n\nc\t d").words).toBe(4);
  });

  it("앞뒤 공백을 무시한다", () => {
    expect(computeStats("  a b  ").words).toBe(2);
  });

  it("빈 문서는 전부 0", () => {
    expect(computeStats("")).toMatchObject({
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
      lines: 0,
      readingMinutes: 0,
    });
  });

  it("공백만 있는 문서도 어절은 0", () => {
    expect(computeStats("   \n  ").words).toBe(0);
  });

  it("공백 포함·제외 글자 수를 따로 센다", () => {
    const stats = computeStats("a b c");
    expect(stats.characters).toBe(5);
    expect(stats.charactersNoSpaces).toBe(3);
  });

  it("이모지를 한 글자로 센다", () => {
    // 코드 단위로 세면 서로게이트 쌍이 2로 잡혀 사용자가 보는 수와 어긋난다.
    expect(computeStats("🙂").characters).toBe(1);
    expect(computeStats("가🙂나").characters).toBe(3);
  });

  it("줄 수를 센다", () => {
    expect(computeStats("a").lines).toBe(1);
    expect(computeStats("a\nb").lines).toBe(2);
    expect(computeStats("a\n").lines).toBe(2);
  });
});

describe("computeStats — 한국어 판정", () => {
  it("한글이 충분히 섞이면 한국어 문서로 본다", () => {
    expect(computeStats("한글 문서입니다").koreanHeavy).toBe(true);
  });

  it("영문 문서는 아니다", () => {
    expect(computeStats("This is an English document.").koreanHeavy).toBe(false);
  });

  it("영문에 한글 한 글자가 섞인 정도로는 바뀌지 않는다", () => {
    // 임계값이 없으면 코드블록 주석 하나로 기준이 뒤집힌다.
    const text = "a".repeat(200) + "가";
    expect(computeStats(text).koreanHeavy).toBe(false);
  });

  it("빈 문서는 한국어가 아니다", () => {
    expect(computeStats("").koreanHeavy).toBe(false);
  });
});

describe("computeStats — 읽기 시간", () => {
  it("한국어는 글자 수 기준", () => {
    // 분당 단어로 재면 한글에서 크게 빗나간다.
    const stats = computeStats("가".repeat(1500));
    expect(stats.koreanHeavy).toBe(true);
    expect(stats.readingMinutes).toBe(3);
  });

  it("영문은 어절 수 기준", () => {
    const stats = computeStats(Array.from({ length: 600 }, () => "word").join(" "));
    expect(stats.koreanHeavy).toBe(false);
    expect(stats.readingMinutes).toBe(3);
  });

  it("내용이 있으면 최소 1분 — 0분은 정보가 아니다", () => {
    expect(computeStats("짧다").readingMinutes).toBe(1);
    expect(computeStats("hi").readingMinutes).toBe(1);
  });

  it("빈 문서는 0분", () => {
    expect(computeStats("").readingMinutes).toBe(0);
  });
});

describe("formatStats", () => {
  it("한국어 문서는 '어절' 이라고 쓴다", () => {
    // "단어" 라고 쓰고 어절을 세면 조용히 틀린 숫자가 된다.
    expect(formatStats(computeStats("한글 문서 입니다"))).toContain("어절");
  });

  it("영문 문서는 '단어' 라고 쓴다", () => {
    expect(formatStats(computeStats("one two three"))).toContain("단어");
  });

  it("빈 문서를 알린다", () => {
    expect(formatStats(computeStats(""))).toBe("빈 문서");
  });

  it("선택 통계는 접두어를 붙이고, 비었으면 아무것도 안 쓴다", () => {
    expect(formatStats(computeStats("한글 문서"), true)).toContain("선택");
    expect(formatStats(computeStats(""), true)).toBe("");
  });

  it("천 단위를 구분한다", () => {
    expect(formatStats(computeStats("가".repeat(1500)))).toContain("1,500");
  });
});
