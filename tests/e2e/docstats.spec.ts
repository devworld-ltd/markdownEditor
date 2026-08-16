import { expect, test } from "@playwright/test";

/** F-29 문서 통계 (이슈 #81). */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("DS1: 기본으로 통계가 보인다", async ({ page }) => {
  await expect(page.locator("#status-stats")).toBeVisible();
  await expect(page.locator("#status-stats")).toHaveText("빈 문서");
});

test("DS2: 입력하면 통계가 갱신된다", async ({ page }) => {
  await page.locator("#editor").fill("한글 문서 입니다");
  await expect(page.locator("#status-stats")).toContainText("3어절");
  await expect(page.locator("#status-stats")).toContainText("9자"); // 공백 2개 포함
});

test("DS3: 영문 문서는 '단어' 로 표시한다", async ({ page }) => {
  await page.locator("#editor").fill("one two three");
  await expect(page.locator("#status-stats")).toContainText("3단어");
});

test("DS4: 선택하면 그 범위의 통계를 보여준다", async ({ page }) => {
  await page.locator("#editor").fill("한글 문서 입니다");
  await expect(page.locator("#status-stats")).toContainText("3어절");

  await page.locator("#editor").click();
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));

  await expect(page.locator("#status-stats")).toContainText("선택");
  await expect(page.locator("#status-stats")).toContainText("2어절");
});

test("DS5: 설정에서 끌 수 있고 유지된다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-doc-stats").uncheck();
  await page.locator("#editor-settings-close").click();
  await expect(page.locator("#status-stats")).toBeHidden();

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#status-stats")).toBeHidden();
});

test("DS6: 인쇄에는 나오지 않는다", async ({ page }) => {
  await page.locator("#editor").fill("본문");
  await page.emulateMedia({ media: "print" });
  const visible = await page.evaluate(
    () => document.querySelector("#status-stats")!.getClientRects().length > 0,
  );
  await page.emulateMedia({ media: "screen" });
  expect(visible).toBe(false);
});

test("DS7: 큰 문서에서도 입력이 느려지지 않는다", async ({ page }) => {
  // 매 글자마다 전체를 세면 여기서 드러난다.
  const big = Array.from({ length: 3000 }, (_, i) => `${i}번째 줄 내용입니다`).join("\n");
  await page.locator("#editor").fill(big);
  await expect(page.locator("#status-stats")).toContainText("어절");

  const start = Date.now();
  await page.locator("#editor").press("End");
  await page.keyboard.type("추가");
  await page.waitForTimeout(300);
  expect(Date.now() - start).toBeLessThan(5000);
});

test("DS8: 스크린리더가 매 글자를 읽지 않는다", async ({ page }) => {
  // aria-live 를 붙이면 타이핑 중 숫자를 계속 읽어 편집이 불가능해진다.
  await expect(page.locator("#status-stats")).not.toHaveAttribute("aria-live", /.*/);
});
