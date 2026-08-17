import { describe, expect, it } from "vitest";
import { activeIndex, activeIndexAtScroll, buildToc, slugify } from "../src/manualToc";

/** #151 사용 설명서 차례 — 계산부. */

describe("slugify", () => {
  it("한국어 제목을 버리지 않는다", () => {
    // 영문자만 남기면 `"5. 파일 다루기"` 가 통째로 비어 모든 절이 같은 id 가 된다.
    const id = slugify("5. 파일 다루기", new Set());
    expect(id).toContain("파일");
    expect(id).not.toBe("manual-절");
  });

  it("같은 제목이 두 번 나와도 다른 id 를 준다", () => {
    const taken = new Set<string>();
    const a = slugify("정리", taken);
    taken.add(a);
    const b = slugify("정리", taken);
    expect(b).not.toBe(a);
  });

  it("글자가 하나도 없는 제목에도 id 를 준다", () => {
    expect(slugify("###", new Set())).toBe("manual-절");
  });

  it("공백·구두점을 하나의 이음표로 줄인다", () => {
    expect(slugify("가   나 -- 다", new Set())).toBe("manual-가-나-다");
  });
});

describe("buildToc", () => {
  it("제목 수만큼 항목을 만들고 id 가 모두 다르다", () => {
    const toc = buildToc(["가", "나", "가"]);
    expect(toc).toHaveLength(3);
    expect(new Set(toc.map((t) => t.id)).size).toBe(3);
  });

  it("제목 앞뒤 공백을 표시에서 없앤다", () => {
    expect(buildToc(["  가  "])[0].title).toBe("가");
  });

  it("절이 없으면 빈 차례다", () => {
    expect(buildToc([])).toEqual([]);
  });
});

describe("activeIndex", () => {
  const tops = [0, 100, 200, 300];

  it("맨 위에서는 첫 절이다", () => {
    expect(activeIndex(tops, 0)).toBe(0);
  });

  it("지나온 제목 중 마지막을 고른다", () => {
    expect(activeIndex(tops, 150)).toBe(1);
    expect(activeIndex(tops, 200)).toBe(2);
  });

  it("여유(slack)만큼 미리 넘어간다 — 링크로 이동한 직후 이전 절이 남지 않게", () => {
    // 이동은 대개 몇 픽셀 모자라게 끝난다.
    expect(activeIndex(tops, 95, 8)).toBe(1);
    expect(activeIndex(tops, 95, 0)).toBe(0);
  });

  it("절이 없으면 -1", () => {
    expect(activeIndex([], 0)).toBe(-1);
  });
});

describe("activeIndexAtScroll", () => {
  const tops = [0, 100, 200, 900];

  it("끝까지 내리면 마지막 절이다", () => {
    // 마지막 절이 짧으면 기준선을 못 넘어 강조가 영영 닿지 않는다.
    expect(activeIndexAtScroll(tops, 600, 400, 1000)).toBe(3);
  });

  it("중간에서는 평소 규칙을 따른다", () => {
    expect(activeIndexAtScroll(tops, 150, 400, 2000)).toBe(1);
  });

  it("절이 없으면 -1", () => {
    expect(activeIndexAtScroll([], 0, 100, 100)).toBe(-1);
  });
});
