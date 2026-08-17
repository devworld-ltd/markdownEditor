import { expect, test } from "@playwright/test";

/**
 * #154 좁은 화면 — 편집/미리보기 세그먼트.
 *
 * 여기서 못을 박는 것은 **상태가 한 벌**이라는 것이다. 좁은 화면 전용 상태를
 * 따로 만들면 넓은 화면과 두 벌이 되어 한쪽만 갱신되는 사고가 난다.
 */

const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("MB1: 좁은 화면이면 세그먼트가 보이고 편집이 선택돼 있다", async ({ page }) => {
  await expect(page.locator("#view-segment")).toBeVisible();
  await expect(page.locator('#view-segment [data-mode="editor"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // 저장된 값은 여전히 분할이다 — 표시만 접힌 것이다.
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "editor");
});

test("MB2: 미리보기를 고르면 편집 패널의 clientHeight 가 0 이다", async ({ page }) => {
  await page.locator('#view-segment [data-mode="preview"]').click();

  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "preview");
  // **`display: none` 이어야 한다**(트랩 #30) — 크기가 남으면 F-25 가 보이지 않는
  // 패널을 따라 계속 돈다.
  const height = await page
    .locator("#editor-pane")
    .evaluate((el) => (el as HTMLElement).clientHeight);
  expect(height).toBe(0);
  await expect(page.locator("#preview")).toBeVisible();
});

test("MB3: 고른 상태가 새로고침 뒤에도 유지된다", async ({ page }) => {
  await page.locator('#view-segment [data-mode="preview"]').click();
  await page.reload();

  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "preview");
  await expect(page.locator('#view-segment [data-mode="preview"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("MB4: 넓히면 분할로 돌아오고 맞춰 둔 비율이 보존된다", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await expect(page.locator("#view-segment")).toBeHidden();
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "split");

  // 비율을 바꾼 뒤 좁혔다 넓혀도 그대로여야 한다 — 모드와 비율은 독립이다.
  await page.evaluate(() => {
    localStorage.setItem(
      "markdown-editor:layout",
      JSON.stringify({ ...JSON.parse(localStorage.getItem("markdown-editor:layout") ?? "{}"), ratio: 0.7 }),
    );
  });
  await page.reload();
  const before = await page.locator("#editor-pane").evaluate((el) => el.clientWidth);

  await page.setViewportSize(NARROW);
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "editor");
  await page.setViewportSize(WIDE);

  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "split");
  expect(await page.locator("#editor-pane").evaluate((el) => el.clientWidth)).toBe(before);
});

test("MB5: 좁은 화면에서 고른 값은 넓은 화면에도 그대로 간다 — 상태는 한 벌이다", async ({
  page,
}) => {
  await page.locator('#view-segment [data-mode="preview"]').click();
  await page.setViewportSize(WIDE);

  // 좁은 화면 전용 상태를 따로 두면 여기서 분할로 돌아가 버린다.
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "preview");
});

test("MB6: 툴바가 축약되고 보기 모드 버튼이 세그먼트로 대체된다", async ({ page }) => {
  await expect(page.locator('.toolbar-group[data-group="강조"]')).toBeHidden();
  await expect(page.locator('.toolbar-group[data-group="파일"]')).toBeVisible();
  // `title` 은 `viewMode` 가 상태 이름으로 덮어쓰므로 `id` 로 고른다.
  await expect(page.locator("#view-mode")).toBeHidden();
  // 같은 일을 하는 컨트롤이 둘이면 어느 쪽이 현재 상태인지 대조해야 한다.
  await expect(page.locator("#toolbar-more")).toBeVisible();
  await expect(page.locator('.toolbar-btn[title="Open"]')).toBeVisible();
});

test("MB7: 넓은 화면에서는 툴바가 그대로다", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await expect(page.locator('.toolbar-group[data-group="강조"]')).toBeVisible();
  await expect(page.locator("#view-mode")).toBeVisible();
  await expect(page.locator("#view-segment")).toBeHidden();
});

test("MB8: 탭이 많아져도 탭바가 한 줄로 남고 가로로 흐른다", async ({ page }) => {
  const oneRow = await page.locator("#tab-bar").evaluate((el) => el.clientHeight);

  // 탭을 여럿 연다. 줄바꿈하면 여기서 탭바가 세로로 자란다.
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("Alt+KeyN");

  const bar = page.locator("#tab-bar");
  expect(await bar.evaluate((el) => el.clientHeight)).toBe(oneRow);
  expect(await bar.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
    await bar.evaluate((el) => el.clientWidth),
  );
});

test("MB9: 상태 표시줄이 축약된다 — 저장 상태·글자 수·버전만 남는다", async ({ page }) => {
  await expect(page.locator("#status-caret")).toBeHidden();
  await expect(page.locator("#save-state")).toBeVisible();
  await expect(page.locator("#status-stats")).toBeVisible();
});

test("MB10: 좁은 화면에서 보기 모드 순환은 분할을 건너뛴다", async ({ page }) => {
  // 툴바 버튼은 숨겼으므로 단축키로 순환한다.
  await page.locator("#editor").click();
  await page.keyboard.press("Alt+KeyM");
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "preview");
  await page.keyboard.press("Alt+KeyM");
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "editor");
});
