import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("툴바 버튼이 22개 렌더링된다", async ({ page }) => {
  // 파일 4 + 최근 1 (F-36) + 서식 12 + 내보내기 1 (F-38) + 인쇄 1 (F-39) + 보기 모드 1 (F-33)
  // + 설정 1 (F-35) + 단축키 안내 1 (F-58).
  // 이 숫자는 의도적인 감시선이다 — 버튼이 늘거나 줄면 여기서 먼저 걸린다.
  await expect(page.locator("#toolbar-actions .toolbar-btn")).toHaveCount(22);
});

test("파일·서식·도움말 세 묶음이 구분선으로 나뉜다", async ({ page }) => {
  await expect(page.locator("#toolbar-actions .toolbar-separator")).toHaveCount(3);
});

const INLINE_CASES: Array<{ title: string; expected: string }> = [
  { title: "Bold", expected: "**텍스트**" },
  { title: "Italic", expected: "*텍스트*" },
  { title: "Strikethrough", expected: "~~텍스트~~" },
  { title: "Code", expected: "`텍스트`" },
];

for (const { title, expected } of INLINE_CASES) {
  test(`${title} 버튼이 플레이스홀더를 감싸 삽입한다`, async ({ page }) => {
    await page.locator("#editor").click();
    await page.locator(`.toolbar-btn[title="${title}"]`).click();
    await expect(page.locator("#editor")).toHaveValue(expected);
  });
}

for (const { title, expected } of [
  { title: "Heading", expected: "## " },
  { title: "Unordered List", expected: "- " },
  { title: "Ordered List", expected: "1. " },
  { title: "Blockquote", expected: "> " },
]) {
  test(`${title} 버튼이 줄 시작에 접두어를 삽입한다`, async ({ page }) => {
    const editor = page.locator("#editor");
    await editor.fill("본문");
    await editor.click();
    await page.locator(`.toolbar-btn[title="${title}"]`).click();
    await expect(editor).toHaveValue(`${expected}본문`);
  });
}

test("Link 버튼이 마크다운 링크 문법을 삽입한다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator('.toolbar-btn[title="Link"]').click();
  await expect(page.locator("#editor")).toHaveValue("[링크 텍스트](url)");
});

test("Image 버튼이 마크다운 이미지 문법을 삽입한다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator('.toolbar-btn[title="Image"]').click();
  await expect(page.locator("#editor")).toHaveValue("![이미지 설명](url)");
});

test("Code Block 버튼이 펜스 코드 블록을 삽입한다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator('.toolbar-btn[title="Code Block"]').click();
  await expect(page.locator("#editor")).toHaveValue("```\n코드\n```");
});

test("Horizontal Rule 버튼이 구분선을 삽입한다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator('.toolbar-btn[title="Horizontal Rule"]').click();
  await expect(page.locator("#editor")).toHaveValue("---\n");
  await expect(page.locator("#preview hr")).toBeVisible();
});

test("선택 영역이 있으면 선택 텍스트를 감싼다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("hello");
  await editor.press("ControlOrMeta+a");
  await page.locator('.toolbar-btn[title="Bold"]').click();
  await expect(editor).toHaveValue("**hello**");
});

test("툴바 삽입 결과가 프리뷰에 즉시 반영된다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator('.toolbar-btn[title="Bold"]').click();
  await expect(page.locator("#preview strong")).toHaveText("텍스트");
});
