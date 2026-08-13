import { expect, test } from "@playwright/test";
import { getWrites, installFallbackMode, installFsMock, setFsMock } from "./fixtures";

/**
 * F-38 HTML 내보내기 (이슈 #51).
 *
 * 문서 조립은 `htmlExport.test.ts` 가 맡는다. 여기서는 **앱에서 실제로 나가는
 * 바이트**를 본다 — 어떤 HTML 이 파일로 쓰이는지, 그리고 내보내기가 탭 상태를
 * 건드리지 않는지.
 */

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

const EXPORT_BTN = '.toolbar-btn[title="Export HTML"]';

test("H1: 렌더된 본문이 담긴 독립 HTML 을 내보낸다", async ({ page }) => {
  await setFsMock(page, { saveName: "note.html" });
  await page.locator("#editor").fill("# 제목\n\n본문 **굵게**");
  await expect(page.locator("#preview h1")).toBeVisible();

  await page.locator(EXPORT_BTN).click();

  const writes = await getWrites(page);
  expect(writes).toHaveLength(1);
  const html = writes[0].content;

  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain("<h1>제목</h1>");
  expect(html).toContain("<strong>굵게</strong>");
  expect(html).toContain("<style>");
  // 외부를 부르면 인터넷 없이는 깨진다.
  expect(html).not.toMatch(/<link\b/i);
  expect(html).not.toMatch(/https?:\/\//);
});

test("H2: 내보낸 HTML 에는 정화된 본문만 담긴다 (F-18)", async ({ page }) => {
  await setFsMock(page, { saveName: "x.html" });
  await page.locator("#editor").fill('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
  await page.waitForTimeout(200);

  await page.locator(EXPORT_BTN).click();

  const html = (await getWrites(page))[0].content;
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("onerror");
});

test("H3: 내보내기가 탭 상태를 바꾸지 않는다", async ({ page }) => {
  // 탭이 .html 을 가리키게 되면 다음 Cmd+S 가 마크다운 원문을 .html 에 덮어쓴다.
  await setFsMock(page, { saveName: "note.html" });
  await page.locator("#editor").fill("내용");
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");

  await page.locator(EXPORT_BTN).click();
  await page.waitForTimeout(150);

  // 파일명도 dirty 표시도 그대로여야 한다 — 내보내기는 저장이 아니다.
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
});

test("H4: 파일명이 .md → .html 로 제안된다", async ({ page }) => {
  await setFsMock(page, { openName: "보고서.md", contents: { "보고서.md": "# 보고서" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("보고서.md");

  const suggested = await page.evaluate(() => {
    let captured = "";
    const original = window.showSaveFilePicker!;
    window.showSaveFilePicker = async (options?: { suggestedName?: string }) => {
      captured = options?.suggestedName ?? "";
      return original(options as never);
    };
    (window as unknown as { __captured: () => string }).__captured = () => captured;
    return true;
  });
  expect(suggested).toBe(true);

  await page.locator(EXPORT_BTN).click();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => (window as unknown as { __captured: () => string }).__captured()),
  ).toBe("보고서.html");
});

test("H5: 취소해도 오류가 뜨지 않는다", async ({ page }) => {
  await setFsMock(page, { cancel: true });
  await page.locator("#editor").fill("내용");

  await page.locator(EXPORT_BTN).click();
  await page.waitForTimeout(200);

  await expect(page.locator("#notice")).toBeHidden();
  expect(await getWrites(page)).toHaveLength(0);
});

test("H6: 쓰기가 실패하면 오류 알림이 뜬다", async ({ page }) => {
  await setFsMock(page, { failWrite: true, saveName: "x.html" });
  await page.locator("#editor").fill("내용");

  await page.locator(EXPORT_BTN).click();

  await expect(page.locator("#notice")).toBeVisible();
  await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
});

test.describe("폴백 브라우저", () => {
  test.beforeEach(async ({ page }) => {
    await installFallbackMode(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("H7: FS Access API 가 없으면 다운로드로 내보낸다", async ({ page }) => {
    await page.locator("#editor").fill("# 제목");
    await expect(page.locator("#preview h1")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.locator(EXPORT_BTN).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe("Untitled.html");
  });
});
