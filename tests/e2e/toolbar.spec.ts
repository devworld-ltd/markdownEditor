import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("툴바 버튼이 21개 렌더링된다 — `부가` 6개는 더보기 팝오버로 갔다 (#149)", async ({ page }) => {
  // 파일 4 + 최근 1 (F-36) + 서식 12 + 표 1 (F-30) + 내보내기 1 (F-38) + 복사 1 (F-40) + 공유 1 (F-60) + 인쇄 1 (F-39) + 보기 모드 1 (F-33)
  // + 설정 1 (F-35) + 단축키 안내 1 (F-58).
  // 이 숫자는 의도적인 감시선이다 — 버튼이 늘거나 줄면 여기서 먼저 걸린다.
  await expect(page.locator("#toolbar-actions .toolbar-btn")).toHaveCount(21);
});

test("#147: 묶음 7개가 구분선 6개로 나뉜다 — 구분선은 경계에서 자동 생성된다", async ({ page }) => {
  // `부가` 는 #149 에서 팝오버로 옮겨져 툴바에 렌더되지 않는다.
  const groups = ["파일", "강조", "블록", "삽입", "공유", "보기·도움"];
  await expect(page.locator("#toolbar-actions .toolbar-group")).toHaveCount(groups.length);
  // 구분선은 묶음 사이에만 — 마지막 묶음 뒤에는 없다.
  await expect(page.locator("#toolbar-actions .toolbar-separator")).toHaveCount(groups.length - 1);

  // **묶음은 눈으로만 나뉘는 것이 아니다.** 구분선은 스크린리더에게 아무 뜻도 아니므로
  // 묶음 컨테이너의 접근 가능한 이름이 그 역할을 대신해야 한다.
  for (const g of groups) {
    await expect(page.locator(`#toolbar-actions [role="group"][aria-label="${g}"]`)).toHaveCount(1);
  }
});

test("#147: 묶음 순서가 화면 순서와 같다", async ({ page }) => {
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("#toolbar-actions .toolbar-group")].map((g) =>
      g.getAttribute("aria-label"),
    ),
  );
  expect(order).toEqual(["파일", "강조", "블록", "삽입", "공유", "보기·도움"]);
});

test("#147: 모든 버튼이 어느 묶음엔가 들어 있다 — 묶음 밖에 떨어진 버튼이 없다", async ({
  page,
}) => {
  const total = await page.locator("#toolbar-actions .toolbar-btn").count();
  const inGroups = await page.locator("#toolbar-actions .toolbar-group .toolbar-btn").count();
  expect(inGroups).toBe(total);
});

test("#149: 단축키가 없는 기능이 더보기 팝오버에서 닿는다", async ({ page }) => {
  // 코드 블록·구분선·HTML 내보내기·HTML 복사는 `shortcutDefs.ts` 에 정의가 없다.
  // 툴바에서 뺀 대신 팝오버가 유일한 진입점이 되므로, 여기서 끊기면 기능이 고립된다.
  await page.locator("#toolbar-more").click();
  for (const label of ["코드 블록", "구분선", "HTML 로 내보내기", "HTML 복사"]) {
    await expect(page.locator(`#toolbar-more-menu .menu-label:text-is("${label}")`)).toHaveCount(1);
  }
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
  await page.locator("#toolbar-more").click();
  await page.locator('#toolbar-more-menu .menu-label:text-is("코드 블록")').click();
  await expect(page.locator("#editor")).toHaveValue("```\n코드\n```");
});

test("Horizontal Rule 버튼이 구분선을 삽입한다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator("#toolbar-more").click();
  await page.locator('#toolbar-more-menu .menu-label:text-is("구분선")').click();
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
