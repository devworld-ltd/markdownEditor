import { expect, test, type Page } from "@playwright/test";

import { getWrites, installFsMock, setFsMock } from "./fixtures";

/** 각주 · 정의 목록 (이슈 #111). */

const DOC = [
  "본문에 각주[^1] 가 있다.",
  "",
  "용어",
  ": 뜻풀이",
  "",
  "[^1]: 각주 **내용**",
].join("\n");

async function enableHighlight(page: Page): Promise<void> {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-highlight").check();
  await page.locator("#editor-settings-close").click();
}

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("FN1: 각주 참조와 목록이 프리뷰에 렌더된다", async ({ page }) => {
  await page.locator("#editor").fill(DOC);

  await expect(page.locator("#preview .footnote-ref a")).toHaveText("1");
  await expect(page.locator("#preview .footnotes li")).toHaveCount(1);
  await expect(page.locator("#preview .footnotes li")).toContainText("각주 내용");
  await expect(page.locator("#preview .footnotes li strong")).toHaveText("내용");
});

test("FN2: 각주 링크가 문서 끝 항목을 가리킨다", async ({ page }) => {
  await page.locator("#editor").fill(DOC);

  const href = await page.locator("#preview .footnote-ref a").getAttribute("href");
  expect(href).toBe("#fn-1");
  await expect(page.locator("#preview #fn-1")).toBeVisible();
  // 되돌아가기 링크는 참조를 가리킨다.
  await expect(page.locator("#preview .footnote-back")).toHaveAttribute("href", "#fnref-1");
  await expect(page.locator("#preview #fnref-1")).toBeVisible();
});

test("FN3: 정의 목록이 dl/dt/dd 로 렌더된다", async ({ page }) => {
  await page.locator("#editor").fill(DOC);

  await expect(page.locator("#preview dl dt")).toHaveText("용어");
  await expect(page.locator("#preview dl dd")).toHaveText("뜻풀이");
});

test("FN4: 코드블록 안의 표식은 각주가 아니다", async ({ page }) => {
  await page.locator("#editor").fill("```\n[^1]\n```\n\n[^1]: 내용");
  await expect(page.locator("#preview pre code")).toContainText("[^1]");
  await expect(page.locator("#preview .footnote-ref")).toHaveCount(0);
});

test("FN5: 편집 하이라이팅이 각주·정의 표식을 칠하고 글자를 밀지 않는다", async ({ page }) => {
  await page.locator("#editor").fill(DOC);
  await enableHighlight(page);

  await expect(page.locator("#editor-overlay .md-footnote").first()).toBeVisible();
  await expect(page.locator("#editor-overlay .md-deflist")).toHaveText(":");

  const overlayText = await page.locator("#editor-overlay").innerText();
  expect(overlayText.replace(/\n$/, "")).toBe(DOC);
});

test("FN6: 정의 없는 참조는 평문으로 남는다", async ({ page }) => {
  await page.locator("#editor").fill("본문[^없음] 끝");
  await expect(page.locator("#preview p")).toContainText("[^없음]");
  await expect(page.locator("#preview .footnote-ref")).toHaveCount(0);
  await expect(page.locator("#preview .footnotes")).toHaveCount(0);
});

test("FN7: 내보낸 HTML 에도 각주 목록이 들어간다", async ({ page }) => {
  await setFsMock(page, { saveName: "note.html" });
  await page.locator("#editor").fill(DOC);
  await expect(page.locator("#preview .footnotes")).toBeVisible();

  await page.locator('.toolbar-btn[title="Export HTML"]').click();

  const writes = await getWrites(page);
  expect(writes).toHaveLength(1);
  const html = writes[0].content;
  expect(html).toContain('class="footnotes"');
  expect(html).toContain("각주 <strong>내용</strong>");
  expect(html).toContain("<dt>용어</dt>");
  // 각주·정의 목록이 종이/다른 앱에서도 구분되게 스타일이 함께 나가야 한다.
  expect(html).toContain(".footnotes");
});

test("FN8: 각주를 지우면 목록도 사라진다", async ({ page }) => {
  await page.locator("#editor").fill(DOC);
  await expect(page.locator("#preview .footnotes")).toHaveCount(1);

  await page.locator("#editor").fill("각주 없는 문서");
  await expect(page.locator("#preview .footnotes")).toHaveCount(0);
});
