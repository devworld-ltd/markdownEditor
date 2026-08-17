import { describe, expect, it } from "vitest";
import { renderTablePreview } from "../src/tablePreview";
import { makeTableBlock, type TableBlock } from "../src/tableFormat";

/**
 * #150 표 미리보기.
 *
 * 여기서 고정하는 것은 **보이는 것과 넣는 것이 같은 데서 나온다**는 것과,
 * 미리보기가 자기만의 손질을 하지 않는다는 것이다.
 */

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

describe("격자", () => {
  it("행·열 수가 입력 그대로 나온다 — 머리 1행 + 본문 N행", () => {
    const el = container();
    renderTablePreview(el, makeTableBlock(4, 2));
    expect(el.querySelectorAll("thead th")).toHaveLength(2);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(el.querySelectorAll("tbody tr:first-child td")).toHaveLength(2);
  });

  it("다시 그리면 이전 표가 남지 않는다", () => {
    const el = container();
    renderTablePreview(el, makeTableBlock(3, 3));
    renderTablePreview(el, makeTableBlock(1, 1));
    expect(el.querySelectorAll("table")).toHaveLength(1);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("머리 행을 `<th>` 로 만든다 — 배경 구분이 여기에 걸린다", () => {
    const el = container();
    renderTablePreview(el, makeTableBlock(2, 2));
    expect(el.querySelectorAll("thead th").length).toBeGreaterThan(0);
    expect(el.querySelectorAll("thead td")).toHaveLength(0);
  });
});

describe("정렬", () => {
  it("열마다 다른 정렬을 그대로 반영한다", () => {
    const el = container();
    const block: TableBlock = {
      ...makeTableBlock(1, 3),
      align: ["left", "center", "right"],
    };
    renderTablePreview(el, block);
    const heads = [...el.querySelectorAll<HTMLElement>("thead th")].map(
      (th) => th.style.textAlign,
    );
    const cells = [...el.querySelectorAll<HTMLElement>("tbody td")].map(
      (td) => td.style.textAlign,
    );
    expect(heads).toEqual(["left", "center", "right"]);
    expect(cells).toEqual(["left", "center", "right"]);
  });
});

describe("칸 내용", () => {
  it("칸을 손질하지 않는다 — `splitRow()` 는 trim 하므로 렌더용이 아니다", () => {
    const el = container();
    const block: TableBlock = {
      ...makeTableBlock(1, 1),
      header: ["  여백 있음  "],
      body: [["  값  "]],
    };
    renderTablePreview(el, block);
    expect(el.querySelector("thead th")?.textContent).toBe("  여백 있음  ");
    expect(el.querySelector("tbody td")?.textContent).toBe("  값  ");
  });

  it("HTML 로 해석하지 않는다 — 두 번째 주입 지점을 만들지 않는다", () => {
    const el = container();
    const block: TableBlock = {
      ...makeTableBlock(1, 1),
      header: ["<img src=x onerror=alert(1)>"],
      body: [["<script>x</script>"]],
    };
    renderTablePreview(el, block);
    expect(el.querySelectorAll("img")).toHaveLength(0);
    expect(el.querySelectorAll("script")).toHaveLength(0);
    expect(el.querySelector("thead th")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("칸이 모자라도 격자를 유지한다 — 열 수는 정렬 배열이 정한다", () => {
    const el = container();
    const block: TableBlock = { ...makeTableBlock(1, 3), body: [["가"]] };
    renderTablePreview(el, block);
    expect(el.querySelectorAll("tbody td")).toHaveLength(3);
  });
});

describe("스크린리더", () => {
  it("미리보기 표를 읽히지 않는다 — 빈 격자를 읽어 봐야 얻는 것이 없다", () => {
    const el = container();
    renderTablePreview(el, makeTableBlock(2, 2));
    expect(el.querySelector("table")?.getAttribute("aria-hidden")).toBe("true");
  });
});
