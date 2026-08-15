import { expect, test, type Page } from "@playwright/test";

/**
 * 이슈 #121 — 각주가 있는 문서에서 스크롤이 다시 어긋나던 회귀.
 *
 * 재는 것은 스크롤 **값**이 아니라 **보이는 위치의 오차(px)** 다. 값만 보면
 * 비율 동기화도 "동작한다" 로 보이지만 사용자는 어긋난 화면을 본다.
 */

const BODY = (i: number) => `본문 ${i} 입니다. `.repeat(8);
const base = (n: number) =>
  Array.from({ length: n }, (_, i) => (i % 3 === 0 ? `## 절 ${i}` : BODY(i)));

const DOCS: Array<[string, string]> = [
  ["일반", base(30).join("\n\n")],
  ["각주", [...base(30), "[^1]: 각주 내용", "본문에 각주[^1] 참조"].join("\n\n")],
  [
    "각주 여러 개",
    [...base(24), "가[^a] 나[^b]", "[^a]: 에이", "[^b]: 비", ...base(6)].join("\n\n"),
  ],
];

/** 편집기에서 `line` 을 화면 맨 위로 올리고, 프리뷰에서 같은 제목의 오차(px)를 잰다. */
async function driftFor(page: Page, label: string): Promise<number> {
  return page.evaluate(async (label) => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    const preview = document.querySelector<HTMLElement>("#preview")!;
    const style = getComputedStyle(editor);

    const line = editor.value.split("\n").findIndex((l) => l === `## ${label}`);
    const lines = editor.value.split("\n");

    const mirror = document.createElement("div");
    mirror.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;width:${style.width};padding:${style.padding};border:${style.border};font:${style.font};line-height:${style.lineHeight};box-sizing:${style.boxSizing};tab-size:${style.tabSize};`;
    mirror.appendChild(document.createTextNode(`${lines.slice(0, line).join("\n")}\n`));
    const mark = document.createElement("span");
    mirror.appendChild(mark);
    mirror.appendChild(document.createTextNode(lines.slice(line).join("\n")));
    document.body.appendChild(mirror);
    const y = mark.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    mirror.remove();

    editor.scrollTop = y;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const previewBase = preview.getBoundingClientRect().top - preview.scrollTop;
    const heading = [...preview.querySelectorAll("h2")].find(
      (h) => h.textContent?.trim() === label,
    )!;
    return Math.round(heading.getBoundingClientRect().top - previewBase - preview.scrollTop);
  }, label);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

for (const [name, doc] of DOCS) {
  test(`SD1(${name}): 같은 제목이 양쪽 화면 같은 자리에 온다`, async ({ page }) => {
    await page.locator("#editor").fill(doc);
    await expect(page.locator("#preview h2").first()).toBeVisible();
    await page.waitForTimeout(300);

    for (const label of ["절 6", "절 12", "절 18"]) {
      const drift = await driftFor(page, label);
      // 5px = 사용자가 "같은 자리" 로 인식하는 범위. 비율 동기화로 돌아가면
      // 각주 문서에서 28~54px 로 벌어졌다(이슈 #121 실측).
      expect(Math.abs(drift), `${name} / ${label} 어긋남 ${drift}px`).toBeLessThanOrEqual(5);
    }
  });
}

test("SD2: 각주 절 자체는 앵커가 아니다 — 그래도 끝까지 스크롤된다", async ({ page }) => {
  await page.locator("#editor").fill(DOCS[1][1]);
  await expect(page.locator("#preview .footnotes")).toBeVisible();

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = editor.scrollHeight;
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = document.querySelector<HTMLElement>("#preview")!;
        return p.scrollHeight - p.clientHeight - p.scrollTop;
      }),
    )
    .toBeLessThanOrEqual(2);
});
