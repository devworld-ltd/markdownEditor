import { describe, expect, it } from "vitest";

import {
  buildTable,
  displayWidth,
  findTableAt,
  formatTable,
  lineRangeToOffsets,
  parseDelimiterRow,
  splitRow,
  withAlignment,
} from "../src/tableFormat";

describe("displayWidth", () => {
  it("라틴 문자는 한 칸이다", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("")).toBe(0);
  });

  it("한글은 두 칸이다 — 문자 수가 아니다", () => {
    expect("이름".length).toBe(2);
    expect(displayWidth("이름")).toBe(4);
  });

  it("한자·가나도 두 칸이다", () => {
    expect(displayWidth("漢字")).toBe(4);
    expect(displayWidth("かな")).toBe(4);
  });

  it("이모지는 코드 단위가 2 여도 두 칸이다", () => {
    expect("🙂".length).toBe(2);
    expect(displayWidth("🙂")).toBe(2);
  });

  it("이모지 가족은 한 글자로 두 칸이다 — 코드 포인트로 세면 6칸이 된다", () => {
    const family = "👨‍👩‍👧";
    expect([...family].length).toBeGreaterThan(2);
    expect(displayWidth(family)).toBe(2);
  });

  it("결합 문자는 폭을 더하지 않는다", () => {
    expect(displayWidth("é")).toBe(1);
  });

  it("섞인 문자열은 각각을 더한다", () => {
    expect(displayWidth("ab한글")).toBe(6);
  });
});

describe("splitRow", () => {
  it("앞뒤 파이프를 걷어내고 칸을 나눈다", () => {
    expect(splitRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  it("앞뒤 파이프가 없어도 나눈다", () => {
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("이스케이프된 파이프는 칸을 나누지 않는다", () => {
    expect(splitRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });

  it("빈 칸을 보존한다", () => {
    expect(splitRow("| a |  | c |")).toEqual(["a", "", "c"]);
  });
});

describe("parseDelimiterRow", () => {
  it.each([
    ["| --- | --- |", ["left", "left"]],
    ["| :--- | ---: |", ["left", "right"]],
    ["| :---: | --- |", ["center", "left"]],
    ["|---|---|", ["left", "left"]],
  ])("%s → %s", (line, expected) => {
    expect(parseDelimiterRow(line)).toEqual(expected);
  });

  it("구분선이 아니면 null", () => {
    expect(parseDelimiterRow("| a | b |")).toBeNull();
    expect(parseDelimiterRow("| -a- | --- |")).toBeNull();
    expect(parseDelimiterRow("본문")).toBeNull();
  });
});

const TABLE = ["| 이름 | 값 |", "| --- | ---: |", "| a | 1 |", "| 한글 | 2 |"].join(
  "\n",
);

describe("findTableAt", () => {
  it("커서가 표 안이면 블록을 찾는다", () => {
    const block = findTableAt(TABLE, 2)!;
    expect(block.startLine).toBe(0);
    expect(block.endLine).toBe(3);
    expect(block.header).toEqual(["이름", "값"]);
    expect(block.body).toEqual([
      ["a", "1"],
      ["한글", "2"],
    ]);
    expect(block.align).toEqual(["left", "right"]);
  });

  it("표 중간 줄에서도 전체를 찾는다", () => {
    const cursor = TABLE.indexOf("| a |") + 2;
    expect(findTableAt(TABLE, cursor)?.endLine).toBe(3);
  });

  it("앞뒤에 본문이 있어도 표 범위만 잡는다", () => {
    const text = `문단\n\n${TABLE}\n\n다음 문단`;
    const block = findTableAt(text, text.indexOf("| a |"))!;
    expect(block.startLine).toBe(2);
    expect(block.endLine).toBe(5);
  });

  it("구분선이 없으면 표가 아니다 — 본문의 파이프를 건드리면 안 된다", () => {
    const text = "a | b\nc | d";
    expect(findTableAt(text, 0)).toBeNull();
  });

  it("표 밖이면 null", () => {
    const text = `${TABLE}\n\n문단`;
    expect(findTableAt(text, text.length - 1)).toBeNull();
  });

  it("칸 수가 모자란 행은 빈 칸으로 채운다", () => {
    const text = "| a | b |\n| --- | --- |\n| 1 |";
    expect(findTableAt(text, 0)?.body).toEqual([["1", ""]]);
  });
});

describe("formatTable", () => {
  it("한글 폭을 반영해 파이프를 맞춘다", () => {
    const out = formatTable(findTableAt(TABLE, 0)!);
    const widths = out.split("\n").map((line) => displayWidth(line));
    expect(new Set(widths).size).toBe(1);
  });

  it("정렬은 구분선에 남기고 내용은 왼쪽에 붙인다", () => {
    const out = formatTable(findTableAt(TABLE, 0)!);
    expect(out.split("\n")[1]).toContain("-:");
    expect(out.split("\n")[2]).toMatch(/^\| a /);
  });

  it("이미 맞은 표를 다시 포맷해도 그대로다 (멱등)", () => {
    const once = formatTable(findTableAt(TABLE, 0)!);
    const twice = formatTable(findTableAt(once, 0)!);
    expect(twice).toBe(once);
  });

  it("이모지가 든 칸도 폭이 맞는다", () => {
    const text = "| a | b |\n| --- | --- |\n| 🙂 | 한글 |";
    const out = formatTable(findTableAt(text, 0)!);
    const widths = out.split("\n").map((line) => displayWidth(line));
    expect(new Set(widths).size).toBe(1);
  });

  it("구분선은 최소 세 글자다", () => {
    const text = "| a |\n| --- |\n| b |";
    expect(formatTable(findTableAt(text, 0)!).split("\n")[1]).toBe("| --- |");
  });
});

describe("buildTable", () => {
  it("헤더 + 지정한 행·열을 만든다", () => {
    const lines = buildTable(2, 3).split("\n");
    expect(lines).toHaveLength(4); // 헤더 + 구분선 + 본문 2
    expect(splitRow(lines[0])).toHaveLength(3);
  });

  it("정렬을 구분선에 반영한다", () => {
    // "제목 1" 은 여섯 칸이라 구분선도 여섯 칸이다 — 폭이 내용을 따라간다.
    expect(buildTable(1, 2, "center").split("\n")[1]).toBe("| :----: | :----: |");
  });

  it("만들어진 표를 곧바로 다시 파싱할 수 있다", () => {
    const table = buildTable(2, 2, "right");
    expect(findTableAt(table, 0)?.align).toEqual(["right", "right"]);
  });

  it("말도 안 되는 크기를 잘라낸다", () => {
    expect(buildTable(0, 0).split("\n")).toHaveLength(3); // 최소 1행 1열
    expect(splitRow(buildTable(1, 999).split("\n")[0])).toHaveLength(20);
  });
});

describe("withAlignment", () => {
  it("지정한 열만 바꾼다", () => {
    const block = findTableAt(TABLE, 0)!;
    expect(withAlignment(block, 0, "center").align).toEqual(["center", "right"]);
  });

  it("원본을 바꾸지 않는다", () => {
    const block = findTableAt(TABLE, 0)!;
    withAlignment(block, 0, "center");
    expect(block.align).toEqual(["left", "right"]);
  });

  it("범위 밖이면 그대로 둔다", () => {
    const block = findTableAt(TABLE, 0)!;
    expect(withAlignment(block, 9, "center")).toBe(block);
  });
});

describe("lineRangeToOffsets", () => {
  it("표 범위를 정확히 가리킨다", () => {
    const text = `앞\n${TABLE}\n뒤`;
    const block = findTableAt(text, text.indexOf("| a |"))!;
    const { start, end } = lineRangeToOffsets(text, block.startLine, block.endLine);
    expect(text.slice(start, end)).toBe(TABLE);
  });

  it("첫 줄부터의 범위도 맞다", () => {
    const { start, end } = lineRangeToOffsets(TABLE, 0, 3);
    expect(TABLE.slice(start, end)).toBe(TABLE);
  });
});
