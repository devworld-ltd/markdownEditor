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
  // 프리뷰는 150ms 디바운스 뒤에 그려진다 — 한 번 읽고 끝내면 CI 에서 흔들린다.
  await expect(
    page.locator("#preview tbody tr:first-child td:nth-child(2)"),
  ).toHaveCSS("text-align", "right");
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

/**
 * #150 표 미리보기.
 *
 * jsdom 은 `<dialog>` 의 inert 를 구현하지 않으므로 **삽입이 실제로 먹는지는
 * 여기서만 확인된다**(트랩 #57).
 */

const PREVIEW = "#table-preview .table-preview-table";

test("TP1: 행·열 수를 바꾸면 미리보기가 즉시 따라온다", async ({ page }) => {
  await openTableDialog(page);

  // **한 번에 둘 다 바꾸지 않는다** — 두 입력의 리스너가 서로를 가려, 한쪽을
  // 통째로 지워도 다른 쪽이 다시 그리며 통과한다(실측).
  await page.locator("#table-rows").fill("4");
  await expect(page.locator(`${PREVIEW} tbody tr`)).toHaveCount(4);

  await page.locator("#table-columns").fill("2");
  await expect(page.locator(`${PREVIEW} thead th`)).toHaveCount(2);
});

test("TP2: 정렬을 바꾸면 미리보기 칸이 그 정렬로 바뀐다", async ({ page }) => {
  await openTableDialog(page);

  await page.locator('#table-insert-align [data-align="right"]').click();

  const align = await page
    .locator(`${PREVIEW} thead th`)
    .first()
    .evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe("right");
  await expect(page.locator('#table-insert-align [data-align="right"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("TP3: 삽입한 표가 미리보기와 같은 모양이다", async ({ page }) => {
  await openTableDialog(page);
  await page.locator("#table-rows").fill("3");
  await page.locator("#table-columns").fill("2");
  await page.locator('#table-insert-align [data-align="center"]').click();

  const seen = {
    columns: await page.locator(`${PREVIEW} thead th`).count(),
    rows: await page.locator(`${PREVIEW} tbody tr`).count(),
  };

  await page.locator("#table-submit").click();

  // 넣은 결과를 **프리뷰가 렌더한 표**로 확인한다 — 원문 문자열이 아니라
  // 실제로 표가 됐는지를 본다.
  await expect(page.locator("#preview table thead th")).toHaveCount(seen.columns);
  await expect(page.locator("#preview table tbody tr")).toHaveCount(seen.rows);
  const cellAlign = await page
    .locator("#preview table tbody td")
    .first()
    .evaluate((el) => getComputedStyle(el).textAlign);
  expect(cellAlign).toBe("center");
});

test("TP4: 편집 모드에서도 미리보기가 나오고 정렬 변경이 반영된다", async ({ page }) => {
  await page.locator("#editor").fill("| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await openTableDialog(page);

  await expect(page.locator("#table-insert")).toBeHidden();
  await expect(page.locator(`${PREVIEW} tbody tr`)).toHaveCount(1);
  // 원문의 칸 내용이 그대로 보여야 "이 표를 고치는 중" 임을 알 수 있다.
  await expect(page.locator(`${PREVIEW} thead th`).first()).toHaveText("가");

  await page.locator('#table-align [data-column="1"][data-align="right"]').click();
  const align = await page
    .locator(`${PREVIEW} thead th`)
    .nth(1)
    .evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe("right");
});

test("TP5: 한글·이모지가 섞여도 넣은 표의 세로줄이 맞는다", async ({ page }) => {
  await page.locator("#editor").fill("| 가나다 | b |\n| --- | --- |\n| 🎉 | 값 |\n");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await openTableDialog(page);
  await page.locator("#table-submit").click();

  const lines = (await page.locator("#editor").inputValue()).trim().split("\n");
  // **문자 위치가 아니라 표시 폭**을 본다 — 한글은 length 1 에 2칸, 이모지는
  // length 2 에 2칸이라 두 방향으로 어긋난다(트랩 #59).
  const widthUpTo = (line: string, stop: number): number =>
    [...line]
      .slice(0, stop)
      .reduce((sum, ch) => sum + (/[가-힣一-鿿]/.test(ch) ? 2 : /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0);
  const pipeColumns = (line: string): number[] =>
    [...line].reduce<number[]>(
      (acc, ch, i) => (ch === "|" ? [...acc, widthUpTo(line, i)] : acc),
      [],
    );
  expect(pipeColumns(lines[1])).toEqual(pipeColumns(lines[0]));
  expect(pipeColumns(lines[2])).toEqual(pipeColumns(lines[0]));
});

test("TP6: 미리보기 표는 스크린리더에서 숨긴다", async ({ page }) => {
  await openTableDialog(page);
  await expect(page.locator(PREVIEW)).toHaveAttribute("aria-hidden", "true");
});
