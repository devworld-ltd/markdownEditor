import { expect, test } from "@playwright/test";

/**
 * F-24 줄 번호 (이슈 #77).
 *
 * 계산·배선은 단위 테스트가 맡는다. 여기서는 **실제 레이아웃**에서만 확인되는
 * 것을 본다 — 특히 줄바꿈된 줄에서 번호가 어긋나지 않는가.
 */

const SETTINGS = '.toolbar-btn[title="Settings"]';

async function enable(page: import("@playwright/test").Page) {
  await page.locator(SETTINGS).click();
  await page.locator("#setting-line-numbers").check();
  await page.locator("#editor-settings-close").click();
  await expect(page.locator("#line-gutter")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("LN1: 기본은 꺼져 있고 설정으로 켠다", async ({ page }) => {
  await expect(page.locator("#line-gutter")).toBeHidden();
  await enable(page);
  await expect(page.locator("#line-gutter")).toBeVisible();
});

test("LN2: 줄 수만큼 번호가 나온다", async ({ page }) => {
  await page.locator("#editor").fill("첫째\n둘째\n셋째");
  await enable(page);

  await expect(page.locator("#line-gutter .line-number")).toHaveCount(3);
  expect(await page.locator("#line-gutter .line-number").allTextContents()).toEqual([
    "1",
    "2",
    "3",
  ]);
});

test("LN3: 줄바꿈된 긴 줄에서도 번호가 어긋나지 않는다", async ({ page }) => {
  // 이 기능의 핵심이다. 같은 간격으로 찍으면 여기서 곧바로 틀어진다.
  await enable(page);
  await page.locator("#editor").fill(`짧은 줄\n${"아주 긴 줄 ".repeat(40)}\n마지막 줄`);
  await expect(page.locator("#line-gutter .line-number")).toHaveCount(3);

  const heights = await page.evaluate(() =>
    [...document.querySelectorAll("#line-gutter .line-number")].map(
      (el) => (el as HTMLElement).getBoundingClientRect().height,
    ),
  );

  // 가운데 줄이 여러 행을 차지하므로 첫/마지막보다 뚜렷이 높아야 한다.
  expect(heights[1]).toBeGreaterThan(heights[0] * 2);
  expect(heights[0]).toBeCloseTo(heights[2], 0);
});

test("LN4: 번호 합계가 편집 영역 콘텐츠 높이와 맞는다", async ({ page }) => {
  await enable(page);
  await page.locator("#editor").fill(
    Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? "긴 줄 ".repeat(30) : `줄 ${i}`)).join("\n"),
  );
  await expect(page.locator("#line-gutter .line-number")).toHaveCount(30);

  const { gutterTotal, editorContent } = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#line-gutter .line-number")] as HTMLElement[];
    const editor = document.querySelector("#editor") as HTMLTextAreaElement;
    const style = getComputedStyle(editor);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return {
      gutterTotal: rows.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0),
      editorContent: editor.scrollHeight - padding,
    };
  });

  // 누적 오차가 한 줄 높이를 넘으면 아래로 갈수록 눈에 띄게 어긋난다.
  expect(Math.abs(gutterTotal - editorContent)).toBeLessThan(24);
});

test("LN5: 편집 영역을 스크롤하면 번호도 따라간다", async ({ page }) => {
  await enable(page);
  await page.locator("#editor").fill(Array.from({ length: 200 }, (_, i) => `줄 ${i}`).join("\n"));
  await expect(page.locator("#line-gutter .line-number")).toHaveCount(200);

  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = 400;
    el.dispatchEvent(new Event("scroll"));
  });

  await expect
    .poll(() => page.locator("#line-gutter").evaluate((el) => (el as HTMLElement).style.transform))
    .toBe("translateY(-400px)");
});

test("LN6: 텍스트를 복사해도 번호가 섞이지 않는다", async ({ page }) => {
  // 번호가 딸려오면 복사한 코드가 못 쓰게 된다.
  await enable(page);
  await page.locator("#editor").fill("첫째\n둘째");

  const selected = await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.select();
    return el.value.slice(el.selectionStart, el.selectionEnd);
  });
  expect(selected).toBe("첫째\n둘째");

  const userSelect = await page
    .locator("#line-gutter")
    .evaluate((el) => getComputedStyle(el).userSelect);
  expect(userSelect).toBe("none");
});

test("LN7: 스크린리더에는 숨긴다", async ({ page }) => {
  // 줄 번호를 한 줄씩 읽어 주는 것은 도움이 아니라 소음이다.
  await enable(page);
  await expect(page.locator("#line-gutter")).toHaveAttribute("aria-hidden", "true");
});

test("LN8: 글자 크기를 바꾼 뒤에도 번호가 편집 영역과 맞는다", async ({ page }) => {
  // "커졌는가" 만 보면 약하다 — 번호 칸 CSS 도 같은 변수를 쓰므로 재측정 없이도
  // 커진다. 재측정이 빠졌는지는 **편집 영역과의 일치**로만 드러난다.
  await enable(page);
  await page.locator("#editor").fill(
    Array.from({ length: 20 }, (_, i) => (i % 4 === 0 ? "긴 줄 ".repeat(25) : `줄 ${i}`)).join("\n"),
  );
  await expect(page.locator("#line-gutter .line-number")).toHaveCount(20);

  await page.locator(SETTINGS).click();
  for (let i = 0; i < 6; i++) await page.locator("#setting-size-up").click();
  await page.locator("#editor-settings-close").click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rows = [...document.querySelectorAll("#line-gutter .line-number")] as HTMLElement[];
        const editor = document.querySelector("#editor") as HTMLTextAreaElement;
        const style = getComputedStyle(editor);
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const total = rows.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
        return Math.round(Math.abs(total - (editor.scrollHeight - padding)));
      }),
    )
    .toBeLessThan(30);
});

test("LN9: 설정이 새로고침 후에도 유지된다", async ({ page }) => {
  await enable(page);
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#line-gutter")).toBeVisible();
});

test("LN10: 줄 번호를 켜도 분할 비율·스크롤 동기화가 어긋나지 않는다", async ({ page }) => {
  await enable(page);
  await page.locator("#editor").fill(Array.from({ length: 150 }, (_, i) => `줄 ${i}`).join("\n"));

  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(150);

  const ends = await page.evaluate(() => {
    const e = document.querySelector("#editor") as HTMLTextAreaElement;
    const p = document.querySelector("#preview") as HTMLElement;
    return {
      editor: e.scrollHeight - e.clientHeight - e.scrollTop,
      preview: p.scrollHeight - p.clientHeight - p.scrollTop,
    };
  });
  expect(ends.editor).toBeLessThan(4);
  expect(ends.preview).toBeLessThan(4);
});
