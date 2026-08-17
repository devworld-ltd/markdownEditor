import { expect, test } from "@playwright/test";

/**
 * #149 더보기 팝오버.
 *
 * `<dialog>` 가 아니라 **포커스·Esc·바깥 클릭을 직접 만든** 컴포넌트다. 그래서
 * 여기서 보는 것은 대부분 **키보드로 쓸 수 있는가** 다 — 마우스만 되면 툴바에서
 * 뺀 기능이 키보드 사용자에게는 사라진 것이나 같다.
 */

const MORE = "#toolbar-more";
const MENU = "#toolbar-more-menu";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("MO1: 누르면 열리고 첫 항목에 포커스가 간다", async ({ page }) => {
  await expect(page.locator(MENU)).toBeHidden();
  await page.locator(MORE).click();

  await expect(page.locator(MENU)).toBeVisible();
  await expect(page.locator(MORE)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`${MENU} .menu-item`).first()).toBeFocused();
});

test("MO2: Esc 로 닫히고 포커스가 더보기 버튼으로 돌아온다", async ({ page }) => {
  await page.locator(MORE).click();
  await page.keyboard.press("Escape");

  await expect(page.locator(MENU)).toBeHidden();
  await expect(page.locator(MORE)).toHaveAttribute("aria-expanded", "false");
  // 돌려주지 않으면 키보드 사용자는 문서 맨 앞으로 튕겨 방금 자리를 잃는다.
  await expect(page.locator(MORE)).toBeFocused();
});

test("MO3: 바깥을 누르면 닫힌다 — 여는 클릭이 곧바로 닫지 않는다", async ({ page }) => {
  await page.locator(MORE).click();
  await expect(page.locator(MENU)).toBeVisible();

  await page.locator("#editor").click();
  await expect(page.locator(MENU)).toBeHidden();
});

test("MO4: 더보기를 다시 누르면 닫힌다", async ({ page }) => {
  await page.locator(MORE).click();
  await expect(page.locator(MENU)).toBeVisible();
  await page.locator(MORE).click();
  await expect(page.locator(MENU)).toBeHidden();
});

test("MO5: ↓↑ 로 항목을 옮겨 다니고 Home/End 가 양 끝으로 간다", async ({ page }) => {
  await page.locator(MORE).click();
  const items = page.locator(`${MENU} .menu-item`);
  const n = await items.count();

  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(0)).toBeFocused();

  await page.keyboard.press("End");
  await expect(items.nth(n - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.nth(0)).toBeFocused();
});

test("MO6: 맨 아래에서 ↓ 를 누르면 처음으로 돈다", async ({ page }) => {
  await page.locator(MORE).click();
  const items = page.locator(`${MENU} .menu-item`);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(0)).toBeFocused();
});

test("MO7: 키보드만으로 항목을 실행할 수 있다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator("#editor").fill("");
  await page.locator(MORE).click();

  // 첫 항목은 "다른 이름으로 저장" 이라 파일 대화상자를 부른다 — 편집기를 고치는
  // 항목(구분선)으로 내려가 Enter 를 눌러 실행 경로를 확인한다.
  const items = page.locator(`${MENU} .menu-item`);
  const idx = await items.evaluateAll((els) =>
    els.findIndex((el) => el.querySelector(".menu-label")?.textContent === "구분선"),
  );
  for (let i = 0; i < idx; i += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(page.locator(MENU)).toBeHidden();
  await expect(page.locator("#editor")).toHaveValue("---\n");
});

test("MO8: 항목을 실행하면 프리뷰가 따라온다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator(MORE).click();
  await page.locator(`${MENU} .menu-label:text-is("구분선")`).click();

  // 팝오버가 액션을 실제로 실행하는지를 **본문이 아니라 프리뷰**로 확인한다 —
  // 편집 경로 전체(삽입 → 렌더)가 이어져 있어야 통과한다.
  await expect(page.locator("#preview hr")).toBeVisible();
});

test("MO9: 메뉴에 role 과 항목 이름이 있다", async ({ page }) => {
  await page.locator(MORE).click();
  await expect(page.locator(MENU)).toHaveAttribute("role", "menu");
  await expect(page.locator(`${MENU} [role="menuitem"]`).first()).toBeVisible();
  await expect(page.locator(MORE)).toHaveAttribute("aria-haspopup", "true");
});

test("MO10: 구분선은 항목으로 세지 않는다 — 화살표가 빈 칸에 멈추면 안 된다", async ({
  page,
}) => {
  await page.locator(MORE).click();
  await expect(page.locator(`${MENU} .menu-separator`)).toHaveCount(1);
  await expect(page.locator(`${MENU} .menu-separator[aria-hidden="true"]`)).toHaveCount(1);
  // 항목 수는 툴바에서 빠진 `부가` 6개와 같다.
  await expect(page.locator(`${MENU} .menu-item`)).toHaveCount(6);
});

test("MO11: 메뉴 이름이 한국어다 — 툴바 title 은 영어지만 메뉴는 글자가 본체다", async ({
  page,
}) => {
  await page.locator(MORE).click();
  const labels = await page.locator(`${MENU} .menu-label`).allTextContents();
  expect(labels).toEqual([
    "다른 이름으로 저장",
    "코드 블록",
    "구분선",
    "HTML 로 내보내기",
    "HTML 복사",
    "인쇄 / PDF",
  ]);
});
