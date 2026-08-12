import { test, expect } from "@playwright/test";
import { installFsMock, setFsMock } from "./fixtures";

const STORAGE_KEY = "markdown-editor:session:v1";

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("편집 내용이 localStorage 에 자동 저장된다", async ({ page }) => {
  await page.locator("#editor").fill("# 자동 저장 확인");

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("자동 저장 확인");
});

test("새로고침 후 편집 중이던 내용이 복원된다", async ({ page }) => {
  await page.locator("#editor").fill("# 복원될 문서");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("복원될 문서");

  await page.reload();

  await expect(page.locator("#editor")).toHaveValue("# 복원될 문서");
  await expect(page.locator("#preview h1")).toHaveText("복원될 문서");
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
});

test("여러 탭과 활성 탭 위치가 함께 복원된다", async ({ page }) => {
  await page.locator("#editor").fill("첫 탭");

  await setFsMock(page, { openName: "second.md", contents: { "second.md": "둘째 탭" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("둘째 탭");

  await page.reload();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("second.md");
  await expect(page.locator("#editor")).toHaveValue("둘째 탭");

  await page.locator("#tab-bar .tab").first().click();
  await expect(page.locator("#editor")).toHaveValue("첫 탭");
});

test("복원된 탭은 파일 핸들이 없어 저장 시 위치를 다시 묻는다", async ({ page }) => {
  await setFsMock(page, { openName: "doc.md", contents: { "doc.md": "본문" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#editor")).toHaveValue("본문");

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("doc.md");

  await page.reload();
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("doc.md");

  // 핸들이 없으므로 showSaveFilePicker 경로(saveName)로 저장된다.
  await setFsMock(page, { saveName: "재선택.md" });
  await page.locator("#editor").fill("수정");
  await page.keyboard.press("ControlOrMeta+s");

  await expect
    .poll(() => page.evaluate(() => window.__fsMock!.writes))
    .toEqual([{ name: "재선택.md", content: "수정" }]);
});

test("저장된 세션이 없으면 빈 Untitled 탭으로 시작한다", async ({ page }) => {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled");
  await expect(page.locator("#editor")).toHaveValue("");
});

test("손상된 세션 데이터는 무시하고 정상 기동한다", async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, "{ 깨진 JSON"), STORAGE_KEY);

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.reload();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#editor")).toBeVisible();
  expect(errors).toEqual([]);
});
