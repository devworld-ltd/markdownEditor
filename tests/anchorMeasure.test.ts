import { describe, expect, it } from "vitest";

import { measurePreviewBlockTops } from "../src/anchorMeasure";

/**
 * jsdom 은 레이아웃을 계산하지 않으므로 위치는 스텁으로 준다.
 * 여기서 확인하는 것은 **무엇을 세고 무엇을 빼는가** 다 (이슈 #121).
 */
function makePreview(html: string): HTMLElement {
  document.body.innerHTML = `<div id="preview">${html}</div>`;
  const preview = document.querySelector<HTMLElement>("#preview")!;
  preview.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  [...preview.children].forEach((child, index) => {
    child.getBoundingClientRect = () => ({ top: index * 100 }) as DOMRect;
  });
  return preview;
}

describe("measurePreviewBlockTops", () => {
  it("최상위 자식의 y 를 순서대로 준다", () => {
    const preview = makePreview("<p>가</p><p>나</p><p>다</p>");
    expect(measurePreviewBlockTops(preview)).toEqual([0, 100, 200]);
  });

  it("`data-generated` 블록은 세지 않는다 — 하나만 끼어도 대응이 통째로 버려진다", () => {
    const preview = makePreview(
      '<p>가</p><p>나</p><section class="footnotes" data-generated="true"><ol></ol></section>',
    );
    expect(measurePreviewBlockTops(preview)).toEqual([0, 100]);
  });

  it("생성된 블록이 중간에 있어도 그 자리만 빠진다", () => {
    const preview = makePreview(
      '<p>가</p><div data-generated="true">X</div><p>나</p>',
    );
    expect(measurePreviewBlockTops(preview)).toEqual([0, 200]);
  });

  it("빈 프리뷰는 빈 목록", () => {
    expect(measurePreviewBlockTops(makePreview(""))).toEqual([]);
  });
});
