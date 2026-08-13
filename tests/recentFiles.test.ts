import { describe, expect, it } from "vitest";
import {
  RECENT_LIMIT,
  addRecent,
  formatRelativeTime,
  parseRecent,
  removeRecent,
} from "../src/recentFiles";

/** F-36 최근 파일 목록 계산 (이슈 #64). */

describe("addRecent", () => {
  it("맨 앞에 넣는다", () => {
    expect(addRecent([{ name: "a.md", at: 1 }], "b.md", 2)).toEqual([
      { name: "b.md", at: 2 },
      { name: "a.md", at: 1 },
    ]);
  });

  it("같은 이름은 중복을 만들지 않고 앞으로 옮긴다", () => {
    const list = [
      { name: "a.md", at: 1 },
      { name: "b.md", at: 2 },
    ];
    expect(addRecent(list, "a.md", 3)).toEqual([
      { name: "a.md", at: 3 },
      { name: "b.md", at: 2 },
    ]);
  });

  it("상한을 넘으면 오래된 것부터 버린다", () => {
    let list: Array<{ name: string; at: number }> = [];
    for (let i = 0; i < RECENT_LIMIT + 5; i++) list = addRecent(list, `f${i}.md`, i);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].name).toBe(`f${RECENT_LIMIT + 4}.md`);
  });

  it("빈 이름은 무시한다", () => {
    const list = [{ name: "a.md", at: 1 }];
    expect(addRecent(list, "   ", 2)).toEqual(list);
    expect(addRecent(list, "", 2)).toEqual(list);
  });

  it("이름의 공백을 정리한다", () => {
    expect(addRecent([], "  a.md  ", 1)[0].name).toBe("a.md");
  });

  it("원본을 바꾸지 않는다", () => {
    const list = [{ name: "a.md", at: 1 }];
    addRecent(list, "b.md", 2);
    expect(list).toHaveLength(1);
  });
});

describe("removeRecent", () => {
  it("이름으로 지운다", () => {
    expect(removeRecent([{ name: "a.md", at: 1 }, { name: "b.md", at: 2 }], "a.md")).toEqual([
      { name: "b.md", at: 2 },
    ]);
  });

  it("없는 이름은 아무 일도 없다", () => {
    const list = [{ name: "a.md", at: 1 }];
    expect(removeRecent(list, "z.md")).toEqual(list);
  });
});

describe("parseRecent", () => {
  it("정상 목록을 읽는다", () => {
    expect(parseRecent([{ name: "a.md", at: 2 }, { name: "b.md", at: 1 }])).toEqual([
      { name: "a.md", at: 2 },
      { name: "b.md", at: 1 },
    ]);
  });

  it("손상된 항목만 버리고 나머지는 살린다", () => {
    // 목록 하나가 깨졌다고 전부 잃을 이유가 없다.
    const raw = [
      { name: "a.md", at: 2 },
      null,
      { at: 5 },
      { name: 42, at: 1 },
      "문자열",
      { name: "b.md", at: 1 },
    ];
    expect(parseRecent(raw)).toEqual([
      { name: "a.md", at: 2 },
      { name: "b.md", at: 1 },
    ]);
  });

  it("배열이 아니면 빈 목록", () => {
    for (const bad of [null, undefined, {}, "x", 42]) expect(parseRecent(bad)).toEqual([]);
  });

  it("시각이 없거나 이상하면 0 으로 채운다", () => {
    expect(parseRecent([{ name: "a.md" }, { name: "b.md", at: "어제" }])).toEqual([
      { name: "a.md", at: 0 },
      { name: "b.md", at: 0 },
    ]);
  });

  it("최신 순으로 정렬하고 같은 이름은 하나만 남긴다", () => {
    expect(
      parseRecent([
        { name: "a.md", at: 1 },
        { name: "b.md", at: 5 },
        { name: "a.md", at: 9 },
      ]),
    ).toEqual([
      { name: "a.md", at: 9 },
      { name: "b.md", at: 5 },
    ]);
  });

  it("상한을 넘으면 자른다", () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ name: `f${i}.md`, at: i }));
    expect(parseRecent(raw)).toHaveLength(RECENT_LIMIT);
  });
});

describe("formatRelativeTime", () => {
  // 400일 전을 빼도 양수로 남을 만큼 큰 값이어야 한다 — 작은 NOW 를 쓰면
  // at 이 음수가 되어 "유효하지 않은 시각" 가드에 걸린다.
  const NOW = Date.UTC(2026, 7, 14);

  it("경과에 따라 단위를 바꾼다", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("방금");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5분 전");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3시간 전");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2일 전");
    expect(formatRelativeTime(NOW - 400 * 86_400_000, NOW)).toBe("오래 전");
  });

  it("미래 시각도 음수로 새지 않는다", () => {
    expect(formatRelativeTime(NOW + 100000, NOW)).toBe("방금");
  });

  it("시각이 없으면 빈 문자열", () => {
    expect(formatRelativeTime(0, NOW)).toBe("");
    expect(formatRelativeTime(NaN, NOW)).toBe("");
  });
});
