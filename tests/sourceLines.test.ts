import { describe, expect, it } from "vitest";

import { blockStartLines, lineStartOffsets } from "../src/sourceLines";
import { parseMarkdown } from "../src/parser";

/** 프리뷰가 실제로 만드는 최상위 요소 수. 대응표의 반대쪽이다. */
function previewBlockCount(markdown: string): number {
  const container = document.createElement("div");
  container.innerHTML = parseMarkdown(markdown);
  return container.children.length;
}

describe("blockStartLines", () => {
  it("블록마다 시작 줄을 준다", () => {
    expect(blockStartLines("# 제목\n\n본문\n\n- 목록")).toEqual([0, 2, 4]);
  });

  it("여러 줄짜리 블록 뒤의 줄 번호가 밀리지 않는다", () => {
    const md = "# 제목\n\n```ts\nconst a = 1;\n```\n\n끝";
    expect(blockStartLines(md)).toEqual([0, 2, 6]);
  });

  it("빈 문서는 빈 목록", () => {
    expect(blockStartLines("")).toEqual([]);
  });

  it("HTML 을 만들지 않는 토큰은 세지 않는다 — 하나만 끼어도 뒤가 전부 밀린다", () => {
    // 각주 정의는 그 자리에 아무것도 남기지 않는다 (F-73).
    const md = "본문[^1]\n\n[^1]: 각주\n\n다음 문단";
    const lines = blockStartLines(md);
    expect(lines).toEqual([0, 4]);
  });

  it("링크 참조 정의도 세지 않는다", () => {
    const md = "[링크][ref]\n\n[ref]: https://example.com\n\n다음";
    expect(blockStartLines(md)).toEqual([0, 4]);
  });
});

describe("blockStartLines ↔ 프리뷰 블록 수", () => {
  const SAMPLES: Array<[string, string]> = [
    ["제목·본문", "# 제목\n\n본문\n\n## 소제목\n\n다른 본문"],
    ["코드블록", "본문\n\n```ts\nconst a = 1;\n```\n\n끝"],
    ["목록·인용", "- 하나\n- 둘\n\n> 인용\n\n본문"],
    ["표", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n본문"],
    ["구분선", "위\n\n---\n\n아래"],
    ["정의 목록", "용어\n: 뜻\n\n본문"],
    ["연속 빈 줄", "첫\n\n\n\n둘"],
    ["끝 개행", "본문\n\n"],
    ["중첩 목록", "- 하나\n  - 안쪽\n- 둘\n\n본문"],
  ];

  it.each(SAMPLES)("%s — 개수가 같다", (_name, md) => {
    // 개수가 어긋나면 `buildAnchors` 가 대응을 포기하고 비율로 되돌아간다.
    // 즉 여기서 깨지면 그 문서에서는 앵커 동기화가 조용히 꺼진다.
    expect(blockStartLines(md).length).toBe(previewBlockCount(md));
  });

  it("각주가 있는 문서는 프리뷰에 각주 절이 하나 더 붙는다", () => {
    // 각주 절은 원문 블록이 아니다. 개수가 하나 어긋나므로 앵커가 꺼진다 —
    // 알고 있는 한계이며, 틀린 대응표로 맞추는 것보다 낫다.
    const md = "본문[^1]\n\n[^1]: 각주";
    expect(previewBlockCount(md) - blockStartLines(md).length).toBe(1);
  });
});

describe("lineStartOffsets", () => {
  it("각 줄의 시작 인덱스를 준다", () => {
    expect(lineStartOffsets("가\n나\n다")).toEqual([0, 2, 4]);
  });

  it("빈 문자열도 0 하나", () => {
    expect(lineStartOffsets("")).toEqual([0]);
  });

  it("끝 개행 뒤의 빈 줄도 센다", () => {
    expect(lineStartOffsets("가\n")).toEqual([0, 2]);
  });
});
