import { expect, test, type Page } from "@playwright/test";

/**
 * F-35 재검증 — 글꼴·크기를 바꿔도 오버레이가 어긋나지 않는다 (이슈 #98).
 *
 * 오버레이(F-23 잔여)는 textarea 와 **같은 글자를 같은 자리에** 그려야 한다.
 * 글꼴·크기는 사용자가 바꾸는 값이므로, 두 레이어가 같은 변수를 보지 않으면
 * 설정을 바꾸는 순간 어긋난다.
 */

const DOC = [
  "# 제목",
  "**굵게** 와 `코드` 와 [링크](https://example.com/아주-긴-주소-를-넣는다)",
  "\t탭으로 들여쓴 줄",
  ...Array.from({ length: 60 }, (_, i) => `${i}번째 줄 — 한글과 English 가 섞인 긴 문장을 넣는다.`),
].join("\n");

/** 두 레이어의 글자 배치를 좌우하는 값들. */
const METRICS = [
  "font-family",
  "font-size",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "white-space",
  "overflow-wrap",
  "tab-size",
] as const;

async function openSettings(page: Page): Promise<void> {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await expect(page.locator("#editor-settings")).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator("#editor-settings-close").click();
  await expect(page.locator("#editor-settings")).toBeHidden();
}

async function compare(page: Page) {
  return page.evaluate((props) => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
    const read = (el: Element) => {
      const style = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
    };
    return {
      editorMetrics: read(editor),
      overlayMetrics: read(overlay),
      editorHeight: editor.scrollHeight,
      overlayHeight: overlay.scrollHeight,
      editorLeft: editor.offsetLeft,
      overlayLeft: overlay.offsetLeft,
    };
  }, METRICS as unknown as string[]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill(DOC);
  await openSettings(page);
  await page.locator("#setting-highlight").check();
  await closeSettings(page);
});

for (const font of ["mono", "sans", "serif"]) {
  test(`FO1(${font}): 글꼴을 바꿔도 두 레이어가 같은 배치를 쓴다`, async ({ page }) => {
    await openSettings(page);
    await page.locator("#setting-font").selectOption(font);
    await closeSettings(page);

    const result = await compare(page);
    expect(result.overlayMetrics).toEqual(result.editorMetrics);
    // 줄바꿈 위치가 같으면 전체 높이가 같다.
    expect(result.overlayHeight).toBe(result.editorHeight);
  });
}

test("FO2: 글자 크기를 키우고 줄여도 높이가 함께 움직인다", async ({ page }) => {
  const heights: number[] = [];

  await openSettings(page);
  for (let i = 0; i < 4; i += 1) {
    await page.locator("#setting-size-up").click();
  }
  await closeSettings(page);
  let result = await compare(page);
  expect(result.overlayHeight).toBe(result.editorHeight);
  heights.push(result.editorHeight);

  await openSettings(page);
  for (let i = 0; i < 8; i += 1) {
    await page.locator("#setting-size-down").click();
  }
  await closeSettings(page);
  result = await compare(page);
  expect(result.overlayHeight).toBe(result.editorHeight);
  heights.push(result.editorHeight);

  // 실제로 크기가 달라졌는지 — 안 바뀌었다면 위 단언은 아무것도 검증하지 않는다.
  expect(heights[0]).toBeGreaterThan(heights[1]);
});

test("FO3: 기본값으로 되돌려도 어긋나지 않는다", async ({ page }) => {
  await openSettings(page);
  await page.locator("#setting-font").selectOption("serif");
  await page.locator("#setting-size-up").click();
  await page.locator("#setting-reset").click();
  await closeSettings(page);

  const result = await compare(page);
  expect(result.overlayMetrics).toEqual(result.editorMetrics);
  expect(result.overlayHeight).toBe(result.editorHeight);
});

test("FO4: 줄 번호를 켜면 오버레이도 같은 만큼 밀린다", async ({ page }) => {
  await openSettings(page);
  await page.locator("#setting-line-numbers").check();
  await closeSettings(page);

  const result = await compare(page);
  expect(result.overlayLeft).toBe(result.editorLeft);
  expect(result.editorLeft).toBeGreaterThan(0);
  expect(result.overlayHeight).toBe(result.editorHeight);
});

test("FO5: 줄 번호 + 글꼴 변경을 함께 걸어도 맞는다", async ({ page }) => {
  await openSettings(page);
  await page.locator("#setting-line-numbers").check();
  await page.locator("#setting-font").selectOption("sans");
  await page.locator("#setting-size-up").click();
  await closeSettings(page);

  const result = await compare(page);
  expect(result.overlayMetrics).toEqual(result.editorMetrics);
  expect(result.overlayLeft).toBe(result.editorLeft);
  expect(result.overlayHeight).toBe(result.editorHeight);
});

test("FO6: 새로고침 후에도 저장된 글꼴로 맞는다", async ({ page }) => {
  await openSettings(page);
  await page.locator("#setting-font").selectOption("serif");
  await page.locator("#setting-size-up").click();
  await closeSettings(page);

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  const result = await compare(page);
  expect(result.overlayMetrics).toEqual(result.editorMetrics);
  expect(result.overlayHeight).toBe(result.editorHeight);
});

test("FO7: 탭을 전환해도 오버레이·줄 번호가 새 탭의 내용을 그린다", async ({ page }) => {
  // switchTab() 은 renderPreview 를 직접 부르므로 편집기 렌더 디바운스를 타지
  // 않는다. 그 사실을 잊으면 탭을 바꾼 뒤 이전 문서의 화면이 남는다.
  await openSettings(page);
  await page.locator("#setting-line-numbers").check();
  await closeSettings(page);

  await page.keyboard.press("Alt+KeyN");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#editor")).toHaveValue("");
  await expect(page.locator("#editor-overlay")).toHaveText("");
  await expect(page.locator("#line-gutter > *")).toHaveCount(1);

  await page.locator("#tab-bar .tab").first().click();
  await expect(page.locator("#editor")).toHaveValue(DOC);
  await expect(page.locator("#editor-overlay .md-heading")).toHaveText("제목");
  // DOC 은 63줄이다 — 1 로 남아 있으면 갱신되지 않은 것이다.
  await expect(page.locator("#line-gutter > *")).toHaveCount(DOC.split("\n").length);

  const result = await compare(page);
  expect(result.overlayHeight).toBe(result.editorHeight);
});
