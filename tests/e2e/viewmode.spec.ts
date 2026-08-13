import { expect, test } from "@playwright/test";

/**
 * F-33 보기 모드 (이슈 #50).
 *
 * 계산·배선은 `viewMode.test.ts` 가 맡는다. 여기서는 **실제로 보이는가**와
 * 다른 기능과의 상호작용을 본다 — 특히 한쪽이 숨겨졌을 때 F-25 스크롤 동기화가
 * 조용히 무동작이 되는지.
 */

const CONTAINER = ".editor-container";
const BUTTON = '.toolbar-btn[title]#view-mode, #view-mode';

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("V1: 기본은 분할이고 양쪽이 모두 보인다", async ({ page }) => {
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "split");
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#preview")).toBeVisible();
  await expect(page.locator("#split-resizer")).toBeVisible();
});

test("V2: 버튼이 분할 → 편집 → 미리보기 → 분할로 순환한다", async ({ page }) => {
  const button = page.locator(BUTTON);

  await button.click();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");
  await expect(page.locator("#preview")).toBeHidden();
  await expect(page.locator("#split-resizer")).toBeHidden();

  await button.click();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "preview");
  await expect(page.locator("#editor")).toBeHidden();

  await button.click();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "split");
});

test("V3: Alt+M 으로도 전환된다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.keyboard.press("Alt+KeyM");
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");
});

test("V4: 남은 패널이 전체 폭을 차지한다", async ({ page }) => {
  const containerWidth = (await page.locator(CONTAINER).boundingBox())!.width;

  await page.locator(BUTTON).click(); // editor only
  const editorWidth = (await page.locator("#editor").boundingBox())!.width;
  expect(editorWidth).toBeCloseTo(containerWidth, 0);

  await page.locator(BUTTON).click(); // preview only
  const previewWidth = (await page.locator("#preview").boundingBox())!.width;
  expect(previewWidth).toBeCloseTo(containerWidth, 0);
});

test("V5: 모드가 새로고침 후에도 유지된다", async ({ page }) => {
  await page.locator(BUTTON).click();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");
});

test("V6: 모드를 되돌리면 맞춰 둔 분할 비율이 그대로 돌아온다", async ({ page }) => {
  // 두 설정은 독립이다. 모드 전환이 비율을 초기화하면 매번 다시 맞춰야 한다.
  await page.locator("#split-resizer").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#split-resizer")).toHaveAttribute("aria-valuenow", "54");

  await page.locator(BUTTON).click(); // editor
  await page.locator(BUTTON).click(); // preview
  await page.locator(BUTTON).click(); // split

  await expect(page.locator("#split-resizer")).toHaveAttribute("aria-valuenow", "54");
});

test("V7: 편집 전용에서도 입력과 탭 기능이 동작한다", async ({ page }) => {
  await page.locator(BUTTON).click();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");

  await page.locator("#editor").fill("# 숨은 프리뷰");
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");

  // 프리뷰는 안 보여도 렌더는 계속돼야 한다 — 되돌렸을 때 최신이어야 한다.
  await page.locator(BUTTON).click();
  await page.locator(BUTTON).click();
  await expect(page.locator("#preview h1")).toHaveText("숨은 프리뷰");
});

test("V8: 미리보기 전용에서도 탭 전환이 동작한다", async ({ page }) => {
  await page.locator("#editor").fill("첫 문서");
  await page.locator(BUTTON).click();
  await page.locator(BUTTON).click();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "preview");

  await page.locator('.toolbar-btn[title="New"]').click();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#preview")).toBeEmpty();
});

test("V9: 한쪽이 숨겨져도 스크롤 동기화가 오류 없이 무동작이 된다 (F-25)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const editor = page.locator("#editor");
  await editor.fill(Array.from({ length: 200 }, (_, i) => `${i}번째 줄`).join("\n"));
  await page.locator(BUTTON).click(); // editor only — 프리뷰의 clientHeight 가 0

  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = 500;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(120);

  // 숨은 패널은 clientHeight 0 → computeRatio 의 `> 0` 가드에 걸려 무동작.
  expect(errors).toEqual([]);
  await expect(editor).toHaveJSProperty("scrollTop", 500);
});

test("V10: 버튼이 상태를 스크린리더에 알린다", async ({ page }) => {
  const button = page.locator(BUTTON);

  // 기본 상태를 눌린 것으로 표시하면 늘 뭔가 켜져 있다고 오해된다.
  await expect(button).toHaveAttribute("aria-pressed", "false");
  const splitLabel = await button.getAttribute("aria-label");
  expect(splitLabel).toContain("분할");

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect(await button.getAttribute("aria-label")).not.toBe(splitLabel);
});

test("V11: 안내 목록에 보기 모드 전환이 자동으로 나타난다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();
  const labels = await page.locator("#shortcut-help-list .shortcut-label").allTextContents();
  expect(labels.join(" ")).toContain("미리보기 전용 전환");
});

test("V12: 모드를 저장해도 분할 비율이 지워지지 않는다 (새로고침 후 확인)", async ({ page }) => {
  // 같은 세션에서는 splitter 가 비율을 메모리에 들고 있어 어긋남이 가려진다.
  // 레이아웃 저장이 병합이 아니라 덮어쓰기면 여기서만 드러난다.
  await page.locator("#split-resizer").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#split-resizer")).toHaveAttribute("aria-valuenow", "54");

  await page.locator(BUTTON).click(); // 모드 저장 — 비율을 지우면 안 된다
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(CONTAINER)).toHaveAttribute("data-mode", "editor");

  // 분할로 되돌리면 맞춰 둔 비율이 살아 있어야 한다.
  await page.locator(BUTTON).click();
  await page.locator(BUTTON).click();
  await expect(page.locator("#split-resizer")).toHaveAttribute("aria-valuenow", "54");
});
