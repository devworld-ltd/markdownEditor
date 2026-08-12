import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("초기 레이아웃 요소가 모두 렌더링된다", async ({ page }) => {
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#preview")).toBeVisible();
  await expect(page.locator("#tab-bar")).toBeVisible();
  await expect(page.locator("#toolbar-actions")).toBeVisible();
  await expect(page.locator("#editor")).toHaveAttribute(
    "placeholder",
    "마크다운을 입력하세요...",
  );
});

test("문서 타이틀 기본값은 Markdown Editor 다", async ({ page }) => {
  await expect(page).toHaveTitle("Markdown Editor");
});

test("마크다운 입력이 프리뷰에 반영된다 (디바운스 150ms)", async ({ page }) => {
  await page.locator("#editor").fill("# 제목\n\n본문 **굵게**");
  await expect(page.locator("#preview h1")).toHaveText("제목");
  await expect(page.locator("#preview strong")).toHaveText("굵게");
});

test("GFM 테이블을 렌더링한다", async ({ page }) => {
  await page.locator("#editor").fill(
    ["| A | B |", "|---|---|", "| 1 | 2 |"].join("\n"),
  );
  await expect(page.locator("#preview table")).toBeVisible();
  await expect(page.locator("#preview th").first()).toHaveText("A");
});

test("GFM 취소선과 체크리스트를 렌더링한다", async ({ page }) => {
  await page.locator("#editor").fill("~~삭제~~\n\n- [x] 완료\n- [ ] 미완료");
  await expect(page.locator("#preview del")).toHaveText("삭제");
  await expect(page.locator('#preview input[type="checkbox"]')).toHaveCount(2);
});

test("breaks 옵션으로 단일 개행이 <br>로 변환된다", async ({ page }) => {
  await page.locator("#editor").fill("첫 줄\n둘째 줄");
  await expect(page.locator("#preview br")).toHaveCount(1);
});

test("코드 블록을 렌더링한다", async ({ page }) => {
  await page.locator("#editor").fill("```ts\nconst a = 1;\n```");
  await expect(page.locator("#preview pre code")).toContainText("const a = 1;");
});

test("프리뷰가 script 태그를 실행하지 않고 제거한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.locator("#editor").fill(
    '# 제목\n\n<script>window.__xss = true;</script>\n\n<img src="x" onerror="window.__xss = true">',
  );
  await expect(page.locator("#preview h1")).toHaveText("제목");

  expect(await page.evaluate(() => (window as never as { __xss?: boolean }).__xss)).toBeUndefined();
  expect(await page.locator("#preview").innerHTML()).not.toContain("onerror");
  expect(errors).toEqual([]);
});

test("javascript: 링크를 제거한다", async ({ page }) => {
  await page.locator("#editor").fill("[클릭](javascript:alert(1))");
  await expect(page.locator("#preview")).toContainText("클릭");
  expect(await page.locator("#preview").innerHTML()).not.toContain("javascript:");
});

test("입력을 모두 지우면 프리뷰가 비워진다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("# 제목");
  await expect(page.locator("#preview h1")).toBeVisible();
  await editor.fill("");
  await expect(page.locator("#preview")).toBeEmpty();
});
