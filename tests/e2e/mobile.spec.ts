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

/**
 * #155 좁은 화면 서식 바.
 *
 * **가상 키보드 대응은 여기서 검증되지 않는다** — 헤드리스 브라우저에는 키보드가
 * 없다. 계산 규칙은 `tests/virtualKeyboard.test.ts` 가, 실기기 확인은 이슈 댓글의
 * 절차가 맡는다.
 */

test("KB1: 좁은 화면·편집 모드에서 서식 바가 보인다", async ({ page }) => {
  const bar = page.locator("#format-bar");
  await expect(bar).toBeVisible();
  await expect(bar.locator(".format-btn")).toHaveCount(8);
  // 화면 아래에 붙어야 엄지가 닿는다.
  const box = (await bar.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y + box.height).toBeCloseTo(viewport.height, -1);
});

test("KB2: 서식 버튼이 툴바와 같은 결과를 낸다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator("#editor").fill("가나다");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 3);
  });

  await page.locator('#format-bar [data-action="Bold"]').click();

  await expect(page.locator("#editor")).toHaveValue("**가나다**");
});

test("KB3: 서식 삽입이 Cmd/Ctrl+Z 로 되돌아간다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator("#editor").fill("가나다");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 3);
  });
  await page.locator('#format-bar [data-action="Bold"]').click();
  await expect(page.locator("#editor")).toHaveValue("**가나다**");

  // `execCommand("insertText")` 를 유지해야만 되돌아온다 (트랩 #27).
  await page.locator("#editor").focus();
  await page.keyboard.press("ControlOrMeta+z");

  await expect(page.locator("#editor")).toHaveValue("가나다");
});

test("KB4: 넓은 화면에서는 서식 바가 없다 — 툴바와 중복이다", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await expect(page.locator("#format-bar")).toBeHidden();
});

test("KB5: 미리보기 모드에서는 서식 바가 사라진다 — 넣을 곳이 없다", async ({ page }) => {
  await expect(page.locator("#format-bar")).toBeVisible();
  await page.locator('#view-segment [data-mode="preview"]').click();
  await expect(page.locator("#format-bar")).toBeHidden();
});

test("KB6: 서식 바가 편집 영역을 가리지 않는다", async ({ page }) => {
  const editor = (await page.locator("#editor-pane").boundingBox())!;
  const bar = (await page.locator("#format-bar").boundingBox())!;
  // 편집 영역의 아래 끝이 서식 바 위쪽보다 위여야 한다.
  expect(editor.y + editor.height).toBeLessThanOrEqual(bar.y + 1);
});

test("KB7: 버튼을 눌러도 편집기 포커스와 선택이 유지된다", async ({ page }) => {
  await page.locator("#editor").click();
  await page.locator("#editor").fill("가나다라");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 2);
  });

  await page.locator('#format-bar [data-action="Italic"]').click();

  // 포커스를 잃으면 선택이 사라져 서식이 엉뚱한 곳에 들어가고, 모바일에서는
  // 키보드까지 내려간다.
  await expect(page.locator("#editor")).toBeFocused();
  await expect(page.locator("#editor")).toHaveValue("*가나*다라");
});

test("KB8: 버튼의 pointerdown 이 취소된다 — 눌러도 키보드가 내려가지 않는 근거", async ({
  page,
}) => {
  // 실기기에서 포커스를 잃으면 **가상 키보드가 내려간다.** 헤드리스에는 키보드가
  // 없어 그 결과를 볼 수 없으므로, 트랩 #38(dragover)과 같은 방법으로 **이벤트가
  // 취소됐는지 자체**를 본다.
  const cancelled = await page
    .locator('#format-bar [data-action="Bold"]')
    .evaluate((el) => {
      const event = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(cancelled).toBe(true);
});
