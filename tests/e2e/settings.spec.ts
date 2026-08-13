import { expect, test } from "@playwright/test";

/**
 * F-35 편집 글꼴·글자 크기 (이슈 #63).
 *
 * 계산은 `editorPrefs.test.ts` 가 맡는다. 여기서는 **실제로 글자가 바뀌는지**와
 * 다른 기능(프리뷰·내보내기·인쇄·스크롤 동기화)에 새지 않는지 본다.
 */

const DIALOG = "#editor-settings";
const BTN = '.toolbar-btn[title="Settings"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

async function editorFont(page: import("@playwright/test").Page) {
  return page.locator("#editor").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, family: cs.fontFamily };
  });
}

test("S1: 설정 버튼이 다이얼로그를 연다", async ({ page }) => {
  await expect(page.locator(DIALOG)).toBeHidden();
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await expect(page.locator("#editor-settings-title")).toHaveText("편집 설정");
});

test("S2: 글자 크기를 키우고 줄인다", async ({ page }) => {
  const before = await editorFont(page);
  expect(before.size).toBe("14px");

  await page.locator(BTN).click();
  await page.locator("#setting-size-up").click();
  await page.locator("#setting-size-up").click();

  await expect(page.locator("#setting-size-value")).toHaveText("16px");
  expect((await editorFont(page)).size).toBe("16px");

  await page.locator("#setting-size-down").click();
  expect((await editorFont(page)).size).toBe("15px");
});

test("S3: 상한·하한을 넘지 않는다", async ({ page }) => {
  await page.locator(BTN).click();
  for (let i = 0; i < 30; i++) await page.locator("#setting-size-up").click();
  await expect(page.locator("#setting-size-value")).toHaveText("24px");

  for (let i = 0; i < 40; i++) await page.locator("#setting-size-down").click();
  await expect(page.locator("#setting-size-value")).toHaveText("11px");
});

test("S4: 글꼴을 바꾸면 편집 영역에 적용된다", async ({ page }) => {
  const before = await editorFont(page);
  expect(before.family).toContain("SFMono");

  await page.locator(BTN).click();
  await page.locator("#setting-font").selectOption("serif");

  const after = await editorFont(page);
  expect(after.family).not.toBe(before.family);
  expect(after.family.toLowerCase()).toContain("serif");
});

test("S5: 웹폰트를 부르지 않는다", async ({ page }) => {
  // 이 앱은 네트워크 요청이 없고 CSP 도 font-src 'self' data: 다.
  const external: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font" || /fonts\.(googleapis|gstatic)/.test(r.url())) {
      external.push(r.url());
    }
  });

  await page.locator(BTN).click();
  for (const id of ["sans", "serif", "mono"]) {
    await page.locator("#setting-font").selectOption(id);
    await page.waitForTimeout(60);
  }

  expect(external).toEqual([]);
});

test("S6: 설정이 새로고침 후에도 유지된다", async ({ page }) => {
  await page.locator(BTN).click();
  await page.locator("#setting-font").selectOption("sans");
  await page.locator("#setting-size-up").click();
  await page.locator("#setting-size-up").click();
  await page.locator("#editor-settings-close").click();

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  const after = await editorFont(page);
  expect(after.size).toBe("16px");
  expect(after.family).toContain("system");
});

test("S7: 프리뷰 글자 크기는 바뀌지 않는다", async ({ page }) => {
  // 프리뷰까지 바꾸면 내보내기(F-38)·인쇄(F-39) 결과가 사람마다 달라진다 —
  // 그건 문서를 받는 쪽의 몫이다.
  await page.locator("#editor").fill("본문");
  const previewBefore = await page
    .locator("#preview")
    .evaluate((el) => getComputedStyle(el).fontSize);

  await page.locator(BTN).click();
  for (let i = 0; i < 4; i++) await page.locator("#setting-size-up").click();
  expect((await editorFont(page)).size).toBe("18px");

  const previewAfter = await page
    .locator("#preview")
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(previewAfter).toBe(previewBefore);
});

test("S8: 기본값으로 되돌린다", async ({ page }) => {
  await page.locator(BTN).click();
  await page.locator("#setting-font").selectOption("serif");
  await page.locator("#setting-size-up").click();

  await page.locator("#setting-reset").click();

  await expect(page.locator("#setting-size-value")).toHaveText("14px");
  const after = await editorFont(page);
  expect(after.size).toBe("14px");
  expect(after.family).toContain("SFMono");
});

test("S9: Esc 로 닫히고 포커스가 에디터로 돌아온다", async ({ page }) => {
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(page.locator("#editor")).toBeFocused();
});

test("S10: 글자 크기를 바꿔도 스크롤 동기화가 어긋나지 않는다 (F-25)", async ({ page }) => {
  // 글자 크기가 바뀌면 scrollHeight 가 바뀐다.
  const editor = page.locator("#editor");
  await editor.fill(Array.from({ length: 200 }, (_, i) => `${i}번째 줄`).join("\n"));
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(120);

  await page.locator(BTN).click();
  await page.locator("#setting-size-up").click();
  await page.locator("#editor-settings-close").click();
  await page.waitForTimeout(150);

  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(150);

  const ends = await page.evaluate(() => {
    const e = document.querySelector("#editor") as HTMLTextAreaElement;
    const p = document.querySelector("#preview") as HTMLElement;
    return {
      editor: e.scrollHeight - e.clientHeight - e.scrollTop,
      preview: p.scrollHeight - p.clientHeight - p.scrollTop,
    };
  });
  expect(ends.editor).toBeLessThan(4);
  expect(ends.preview).toBeLessThan(4);
});

test("S11: 손상된 저장값이 있어도 기본값으로 뜬다", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "markdown-editor:layout:v1",
      JSON.stringify({ fontId: "comic", fontSize: "크게" }),
    );
  });
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  const after = await editorFont(page);
  expect(after.size).toBe("14px");
  expect(after.family).toContain("SFMono");
});

test("S12: 설정이 다른 레이아웃 값을 지우지 않는다", async ({ page }) => {
  await page.locator("#split-resizer").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#split-resizer")).toHaveAttribute("aria-valuenow", "52");

  await page.locator(BTN).click();
  await page.locator("#setting-size-up").click();
  await page.locator("#editor-settings-close").click();

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#split-resizer")).toHaveAttribute("aria-valuenow", "52");
  expect((await editorFont(page)).size).toBe("15px");
});
