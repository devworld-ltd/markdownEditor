import { expect, test, type Page } from "@playwright/test";

/**
 * F-22 재검증 — 검색·치환이 편집 하이라이팅(F-23 잔여)과 함께 동작한다 (이슈 #96).
 *
 * 오버레이가 켜지면 **보이는 글자는 textarea 가 아니라 뒤 레이어의 것**이다.
 * 검색은 일치를 선택으로 보여주므로, 선택 배경이 불투명하면 찾은 자리만 가려지는
 * 최악의 조합이 된다. 그래서 같은 시나리오를 오버레이 켬/끔 양쪽에서 돌린다.
 */

const DOC = [
  "# 검색 대상",
  "",
  "사과 하나, 사과 둘, 사과 셋.",
  "",
  "```ts",
  "const 사과 = 3;",
  "```",
].join("\n");

async function setOverlay(page: Page, on: boolean): Promise<void> {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-highlight").setChecked(on);
  await page.locator("#editor-settings-close").click();
}

async function openSearch(page: Page, query: string): Promise<void> {
  await page.locator("#editor").click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator("#search-bar")).toBeVisible();
  await page.locator("#search-input").fill(query);
}

for (const overlay of [false, true]) {
  const label = overlay ? "오버레이 켬" : "오버레이 끔";

  test(`SO1(${label}): 일치 개수를 그대로 센다`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#editor").fill(DOC);
    await setOverlay(page, overlay);
    await openSearch(page, "사과");

    await expect(page.locator("#search-count")).toHaveText("1/4");
  });

  test(`SO2(${label}): 다음 일치로 이동하면 선택이 따라간다`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#editor").fill(DOC);
    await setOverlay(page, overlay);
    await openSearch(page, "사과");

    await page.keyboard.press("Enter");
    await expect(page.locator("#search-count")).toHaveText("2/4");

    const selected = await page.locator("#editor").evaluate((el: HTMLTextAreaElement) =>
      el.value.slice(el.selectionStart, el.selectionEnd),
    );
    expect(selected).toBe("사과");
  });

  test(`SO3(${label}): 모두 바꾸기 후 하이라이팅이 새 본문을 따라간다`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#editor").fill(DOC);
    await setOverlay(page, overlay);
    await openSearch(page, "사과");

    await page.locator("#search-toggle-replace").click();
    await page.locator("#search-replace-input").fill("포도");
    await page.locator("#search-replace-all").click();

    await expect(page.locator("#editor")).toHaveValue(/포도/);
    await expect(page.locator("#editor")).not.toHaveValue(/사과/);

    if (overlay) {
      // 오버레이가 낡은 본문을 그리고 있으면 여기서 드러난다.
      await expect(page.locator("#editor-overlay")).toContainText("포도");
      await expect(page.locator("#editor-overlay")).not.toContainText("사과");
    }
  });
}

test("SO4: 오버레이가 켜지면 선택 배경이 반투명이다 — 불투명하면 찾은 글자가 가려진다", async ({
  page,
}) => {
  await page.goto("/");
  await setOverlay(page, true);

  const background = await page.evaluate(
    () => getComputedStyle(document.querySelector("#editor")!, "::selection").backgroundColor,
  );
  const alpha = Number(/rgba?\([^)]*?,\s*([\d.]+)\)/.exec(background)?.[1] ?? "1");
  expect(alpha).toBeGreaterThan(0);
  expect(alpha).toBeLessThan(1);
});

/**
 * 스크롤 리스너 자체의 회귀는 `editorhighlight.spec.ts` EH6 이 **두 프레임 안에서**
 * 잡는다. 여기서 확인하는 것은 "검색이 스크롤을 움직인 뒤에도 두 레이어가 같은
 * 자리를 본다" 는 결과다 — 폴링으로 여유를 주는 것은 그 때문이다.
 */
test("SO5: 일치로 스크롤하면 오버레이도 같은 자리를 보여준다", async ({ page }) => {
  await page.goto("/");
  await page.locator("#editor").fill(`${"채우는 줄\n".repeat(300)}찾을 낱말`);
  await setOverlay(page, true);
  await openSearch(page, "찾을 낱말");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
        return overlay.scrollTop - editor.scrollTop;
      }),
    )
    .toBe(0);

  const editorTop = await page.evaluate(
    () => document.querySelector<HTMLTextAreaElement>("#editor")!.scrollTop,
  );
  expect(editorTop).toBeGreaterThan(0);
});

test("SO6: Esc 로 닫으면 찾은 자리에서 편집을 이어갈 수 있다 (오버레이 켬)", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#editor").fill(DOC);
  await setOverlay(page, true);
  await openSearch(page, "사과");

  await page.keyboard.press("Escape");
  await expect(page.locator("#search-bar")).toBeHidden();

  await page.keyboard.type("배");
  await expect(page.locator("#editor")).toHaveValue(/배 하나/);
  await expect(page.locator("#editor-overlay")).toContainText("배 하나");
});
