import { test, expect } from "@playwright/test";
import { installFsMock, setFsMock } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

/** 목 파일을 열어 새 탭을 만든다. */
async function openMockFile(page: import("@playwright/test").Page, name: string, content: string) {
  await setFsMock(page, { openName: name, contents: { [name]: content } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText(name);
}

test("초기 상태에 Untitled 탭 1개가 존재한다", async ({ page }) => {
  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled");
  await expect(page.locator("#tab-bar .tab")).toHaveClass(/active/);
});

test("입력 시 탭 이름에 dirty 마커(*)가 붙는다", async ({ page }) => {
  await page.locator("#editor").fill("변경");
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
  await expect(page).toHaveTitle("Markdown Editor *");
});

test("New 버튼이 빈 탭을 추가하고 활성화한다", async ({ page }) => {
  await page.locator("#editor").fill("첫 탭");
  await page.locator('.toolbar-btn[title="New"]').click();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#editor")).toHaveValue("");
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("Untitled");
});

test("Alt+N 단축키가 새 탭을 만든다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.keyboard.press("Alt+n");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
});

test("탭 전환 시 내용이 탭별로 유지된다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("첫번째 탭 내용");

  await openMockFile(page, "b.md", "두번째 탭 내용");
  await expect(editor).toHaveValue("두번째 탭 내용");

  await page.locator("#tab-bar .tab").first().click();
  await expect(editor).toHaveValue("첫번째 탭 내용");

  await page.locator("#tab-bar .tab").nth(1).click();
  await expect(editor).toHaveValue("두번째 탭 내용");
});

test("탭 전환 시 커서 위치가 복원된다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("0123456789");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 6));

  await openMockFile(page, "other.md", "다른 문서");
  await page.locator("#tab-bar .tab").first().click();

  const selection = await editor.evaluate((el: HTMLTextAreaElement) => [
    el.selectionStart,
    el.selectionEnd,
  ]);
  expect(selection).toEqual([3, 6]);
});

test("깨끗한 탭은 확인 없이 닫힌다", async ({ page }) => {
  await openMockFile(page, "b.md", "B");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  await page.locator("#tab-bar .tab").nth(1).locator(".tab-close").click();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled");
});

test("dirty 탭을 닫으면 확인을 요구하고, 취소 시 유지된다", async ({ page }) => {
  await page.locator("#editor").fill("저장 안 한 내용");

  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("저장되지 않았습니다");
    void dialog.dismiss();
  });
  await page.locator("#tab-bar .tab .tab-close").click();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#editor")).toHaveValue("저장 안 한 내용");
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
});

test("dirty 탭 닫기를 확인하면 닫힌다", async ({ page }) => {
  await openMockFile(page, "b.md", "B");
  await page.locator("#editor").fill("수정됨");
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("b.md *");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("#tab-bar .tab").nth(1).locator(".tab-close").click();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled");
});

test("마지막 탭을 닫으면 빈 Untitled 탭이 새로 생성된다", async ({ page }) => {
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("#editor").fill("내용");
  await page.locator("#tab-bar .tab .tab-close").click();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled");
  await expect(page.locator("#editor")).toHaveValue("");
});

test("Alt+W 단축키가 현재 탭을 닫는다", async ({ page }) => {
  await openMockFile(page, "b.md", "B");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  await page.locator("#editor").click();
  await page.keyboard.press("Alt+w");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
});
