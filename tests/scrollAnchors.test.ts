import { describe, expect, it } from "vitest";

import { buildAnchors, mapWithAnchors, type ScrollAnchor } from "../src/scrollAnchors";

const ANCHORS: ScrollAnchor[] = [
  { editor: 0, preview: 0 },
  { editor: 100, preview: 50 },
  { editor: 200, preview: 300 },
  { editor: 400, preview: 400 },
];

describe("buildAnchors", () => {
  it("두 목록을 순서대로 짝짓는다", () => {
    expect(buildAnchors([0, 10], [0, 20])).toEqual([
      { editor: 0, preview: 0 },
      { editor: 10, preview: 20 },
    ]);
  });

  it("개수가 다르면 포기한다 — 틀린 대응표는 안 맞추느니만 못하다", () => {
    expect(buildAnchors([0, 10, 20], [0, 20])).toEqual([]);
  });

  it("앵커가 하나뿐이면 보간할 구간이 없다", () => {
    expect(buildAnchors([0], [0])).toEqual([]);
  });

  it("단조 증가가 깨진 앵커는 버린다 — 그 구간에서 스크롤이 역주행한다", () => {
    const anchors = buildAnchors([0, 100, 50, 200], [0, 100, 150, 300]);
    expect(anchors.map((a) => a.editor)).toEqual([0, 100, 200]);
  });

  it("측정 실패(NaN)는 건너뛴다", () => {
    const anchors = buildAnchors([0, Number.NaN, 200], [0, 100, 300]);
    expect(anchors).toHaveLength(2);
  });

  it("버리고 나서 2개 미만이면 포기한다", () => {
    expect(buildAnchors([0, Number.NaN], [0, 100])).toEqual([]);
  });
});

describe("mapWithAnchors", () => {
  it("앵커 지점은 정확히 대응한다", () => {
    expect(mapWithAnchors(ANCHORS, "editor", 100, 500, 500)).toBe(50);
    expect(mapWithAnchors(ANCHORS, "editor", 200, 500, 500)).toBe(300);
  });

  it("앵커 사이는 선형 보간한다", () => {
    // editor 150 은 100~200 의 중간 → preview 50~300 의 중간
    expect(mapWithAnchors(ANCHORS, "editor", 150, 500, 500)).toBe(175);
  });

  it("반대 방향도 같은 대응을 준다", () => {
    expect(mapWithAnchors(ANCHORS, "preview", 300, 500, 500)).toBe(200);
    expect(mapWithAnchors(ANCHORS, "preview", 175, 500, 500)).toBe(150);
  });

  it("맨 위·맨 아래는 끝에 붙인다 — 기존 F-25 계약", () => {
    expect(mapWithAnchors(ANCHORS, "editor", 0, 500, 500)).toBe(0);
    expect(mapWithAnchors(ANCHORS, "editor", 500, 700, 500)).toBe(700);
  });

  it("마지막 앵커 아래 구간은 끝까지 이어 준다", () => {
    // editor 450 은 마지막 앵커(400)와 끝(500)의 중간 → preview 400~500 의 중간
    expect(mapWithAnchors(ANCHORS, "editor", 450, 500, 500)).toBe(450);
  });

  it("첫 앵커 위 구간도 이어 준다", () => {
    const shifted: ScrollAnchor[] = [
      { editor: 100, preview: 200 },
      { editor: 200, preview: 400 },
    ];
    expect(mapWithAnchors(shifted, "editor", 50, 500, 500)).toBe(100);
  });

  it("앵커가 2개 미만이면 null — 호출부가 비율로 되돌아간다", () => {
    expect(mapWithAnchors([], "editor", 10, 500, 500)).toBeNull();
    expect(mapWithAnchors([{ editor: 0, preview: 0 }], "editor", 10, 500, 500)).toBeNull();
  });

  it("갈 곳이 없으면 null", () => {
    expect(mapWithAnchors(ANCHORS, "editor", 10, 0, 500)).toBeNull();
    expect(mapWithAnchors(ANCHORS, "editor", 10, 500, 0)).toBeNull();
  });

  it("구간 길이가 0 이어도 0 으로 나누지 않는다", () => {
    const flat: ScrollAnchor[] = [
      { editor: 0, preview: 0 },
      { editor: 0, preview: 100 },
      { editor: 200, preview: 200 },
    ];
    expect(Number.isFinite(mapWithAnchors(flat, "editor", 0, 500, 500)!)).toBe(true);
  });

  it("결과가 단조 증가한다 — 아래로 스크롤하면 반대편도 아래로만 간다", () => {
    let previous = -1;
    for (let top = 0; top <= 500; top += 10) {
      const mapped = mapWithAnchors(ANCHORS, "editor", top, 500, 500)!;
      expect(mapped).toBeGreaterThanOrEqual(previous);
      previous = mapped;
    }
  });
});
