import { expect, test } from "@playwright/test";

/** F-30 표 편집 보조 (이슈 #82). */

const MESSY = [
  "| 이름 | 값 |",
  "| --- | --- |",
  "| 한글이름 | 1 |",
  "| a | 2 |",
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

async function openTableDialog(page: import("@playwright/test").Page) {
  await page.locator('.toolbar-btn[title="Table"]').click();
  await expect(page.locator("#table-dialog")).toBeVisible();
}

test("TB1: 빈 문서에서는 삽입 모드로 열린다", async ({ page }) => {
  await page.locator("#editor").click();
  await openTableDialog(page);
  await expect(page.locator("#table-insert")).toBeVisible();
  await expect(page.locator("#table-edit")).toBeHidden();
  await expect(page.locator("#table-submit")).toHaveText("표 삽입");
});

test("TB2: 표를 삽입하면 프리뷰에 표로 렌더된다", async ({ page }) => {
  await page.locator("#editor").click();
  await openTableDialog(page);
  await page.locator("#table-rows").fill("2");
  await page.locator("#table-columns").fill("3");
  await page.locator("#table-submit").click();

  await expect(page.locator("#preview table")).toBeVisible();
  await expect(page.locator("#preview thead th")).toHaveCount(3);
  await expect(page.locator("#preview tbody tr")).toHaveCount(2);
});

test("TB3: 커서가 표 안이면 편집 모드로 열린다", async ({ page }) => {
  await page.locator("#editor").fill(MESSY);
  await page.locator("#editor").click();
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(3, 3);
  });

  await openTableDialog(page);
  await expect(page.locator("#table-edit")).toBeVisible();
  await expect(page.locator("#table-insert")).toBeHidden();
  await expect(page.locator("#table-submit")).toHaveText("정렬 맞추기");
  await expect(page.locator("#table-align .table-align-btn")).toHaveCount(6);
});

test("TB4: 정렬 맞추기가 한글 폭까지 반영해 파이프를 맞춘다", async ({ page }) => {
  await page.locator("#editor").fill(MESSY);
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });

  await openTableDialog(page);
  await page.locator("#table-submit").click();

  const value = await page.locator("#editor").inputValue();
  const lines = value.trim().split("\n");
  // 표시 폭 기준으로 모든 줄이 같은 칸 수를 차지해야 한다. 문자 수로 맞추면
  // "한글이름"(8칸) 열이 어긋난다.
  const widths = lines.map((line) =>
    [...line].reduce(
      (sum, ch) => sum + (/[가-힣一-鿿]/.test(ch) ? 2 : 1),
      0,
    ),
  );
  expect(new Set(widths).size).toBe(1);
});

test("TB5: 열 정렬을 오른쪽으로 바꾸면 프리뷰에 반영된다", async ({ page }) => {
  await page.locator("#editor").fill(MESSY);
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });

  await openTableDialog(page);
  await page.locator('#table-align [data-column="1"][data-align="right"]').click();
  await page.locator("#table-submit").click();

  await expect(page.locator("#editor")).toHaveValue(/\| *-+: *\|/);
  const align = await page
    .locator("#preview tbody tr:first-child td:nth-child(2)")
    .evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe("right");
});

test("TB6: 표 정렬을 되돌릴 수 있다 — execCommand 로 undo 스택이 보존된다", async ({
  page,
}) => {
  await page.locator("#editor").fill(MESSY);
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });

  await openTableDialog(page);
  await page.locator("#table-submit").click();
  await expect(page.locator("#editor")).not.toHaveValue(MESSY);

  await page.locator("#editor").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#editor")).toHaveValue(MESSY);
});

test("TB7: 표가 아닌 파이프 본문은 건드리지 않는다", async ({ page }) => {
  // 구분선이 없으면 표가 아니다 — 본문을 마음대로 고치면 안 된다.
  await page.locator("#editor").fill("a | b\nc | d");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(2, 2);
  });

  await openTableDialog(page);
  await expect(page.locator("#table-insert")).toBeVisible();
});

test("TB8: 본문 뒤에 삽입해도 표로 읽힌다", async ({ page }) => {
  await page.locator("#editor").fill("문단");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(2, 2);
  });

  await openTableDialog(page);
  await page.locator("#table-submit").click();

  // 빈 줄이 없으면 marked 가 표로 읽지 않는다.
  await expect(page.locator("#preview table")).toBeVisible();
  await expect(page.locator("#preview p").first()).toHaveText("문단");
});

test("TB9: Esc 로 닫으면 문서가 그대로다", async ({ page }) => {
  await page.locator("#editor").fill("문단");
  await openTableDialog(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#table-dialog")).toBeHidden();
  await expect(page.locator("#editor")).toHaveValue("문단");
});
