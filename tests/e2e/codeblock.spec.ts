import { expect, test } from "@playwright/test";

/**
 * #180 미리보기 코드 블록 들여쓰기.
 *
 * `parseMarkdown()` 의 출력에는 공백이 없다 — 이것은 **CSS 문제**다. 그래서
 * 여기서 보는 것은 HTML 이 아니라 **화면에서 어디에 놓이는가** 다.
 *
 * 색 값은 단언하지 않는다(테마마다 다르다). 단언은 "겹치지 않는다" 로 한다.
 */

const BLOCK = "```\nX-Caller-Id: abc\nAuthorization: Bearer xyz\n```";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("CB1: 코드 블록 안의 code 에는 좌우 여백이 붙지 않는다", async ({ page }) => {
  await page.locator("#editor").fill(BLOCK);
  const code = page.locator("#preview pre code").first();
  await expect(code).toBeVisible();

  const box = await code.evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: s.paddingLeft, right: s.paddingRight };
  });
  expect(box.left).toBe("0px");
  expect(box.right).toBe("0px");

  // 배경도 `<pre>` 에 맡긴다 — 두 겹으로 칠하면 테마가 갈라지는 순간 층이 보인다.
  // 설명서·내보내기의 같은 규칙도 이 선언을 함께 갖고 있다.
  const bg = await code.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgba(0, 0, 0, 0)");
});

test("CB2: 첫 글자가 pre 의 안쪽 여백에 정확히 맞는다", async ({ page }) => {
  await page.locator("#editor").fill(BLOCK);

  const offset = await page.locator("#preview pre").first().evaluate((pre) => {
    const code = pre.querySelector("code")!;
    const range = document.createRange();
    // 첫 글자 하나의 화면 위치를 잰다 — 여백이 남아 있으면 여기서 밀린다.
    range.setStart(code.firstChild!, 0);
    range.setEnd(code.firstChild!, 1);
    const charLeft = range.getBoundingClientRect().left;
    const preStyle = getComputedStyle(pre);
    const contentLeft =
      pre.getBoundingClientRect().left +
      Number.parseFloat(preStyle.paddingLeft) +
      Number.parseFloat(preStyle.borderLeftWidth);
    return charLeft - contentLeft;
  });

  expect(Math.abs(offset)).toBeLessThanOrEqual(1);
});

test("CB3: 인라인 코드는 칩 모양을 그대로 유지한다", async ({ page }) => {
  // 블록만 보고 고치면 인라인 코드의 의도된 스타일까지 지우기 쉽다.
  await page.locator("#editor").fill("본문에 `foo` 가 있다.");

  const code = page.locator("#preview p code").first();
  await expect(code).toBeVisible();
  const padding = await code.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).paddingLeft),
  );
  expect(padding).toBeGreaterThan(0);

  const bg = await code.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
});

test("CB4: 하이라이팅되는 블록도 마찬가지다", async ({ page }) => {
  await page.locator("#editor").fill("```js\nconst a = 1;\n```");

  const code = page.locator("#preview pre code.language-js");
  await expect(code).toBeVisible();
  expect(
    await code.evaluate((el) => getComputedStyle(el).paddingLeft),
  ).toBe("0px");
  // 토큰 색은 살아 있어야 한다 — 여백을 지우다 하이라이팅까지 지우면 안 된다.
  // **색 값이 아니라 "주변 글자와 다른가" 를 본다**(테마마다 값이 다르다).
  const keyword = page.locator("#preview pre code .tok-keyword").first();
  await expect(keyword).toBeVisible();
  const tokenColor = await keyword.evaluate((el) => getComputedStyle(el).color);
  const codeColor = await code.evaluate((el) => getComputedStyle(el).color);
  expect(tokenColor).not.toBe(codeColor);
});

test("CB5: 설명서와 미리보기의 코드 블록이 같은 모양이다", async ({ page }) => {
  await page.locator("#editor").fill(BLOCK);
  const preview = await page
    .locator("#preview pre code")
    .first()
    .evaluate((el) => getComputedStyle(el).paddingLeft);

  await page.locator('.toolbar-btn[title="Manual"]').click();
  const manual = await page
    .locator("#manual-body pre code")
    .first()
    .evaluate((el) => getComputedStyle(el).paddingLeft);

  // 파생 표면에는 이미 있던 규칙이다 — 본체가 그것과 어긋나 있었다.
  expect(preview).toBe(manual);
});

test("CB6: 인쇄에서도 여백이 되살아나지 않는다", async ({ page }) => {
  await page.locator("#editor").fill(BLOCK);
  await page.emulateMedia({ media: "print" });

  const code = page.locator("#preview pre code").first();
  expect(await code.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("0px");
  // 인쇄 규칙은 `#preview code, #preview pre` 의 배경·글자색을 라이트로 덮는다.
  // 그래서 `pre code` 도 배경을 갖게 되는데, **`pre` 와 같은 색**이라 층이
  // 보이지 않는다. 여기서 지키는 것은 "두 겹으로 보이지 않는다" 이다.
  const bg = await code.evaluate((el) => getComputedStyle(el).backgroundColor);
  const preBg = await page
    .locator("#preview pre")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe(preBg);
});
