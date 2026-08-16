import { expect, test } from "@playwright/test";
import { installFsMock, setFsMock } from "./fixtures";

/**
 * #148 저장 상태.
 *
 * 단위 테스트가 "무엇을 보여주는가" 를 맡는다. 여기서는 **앱의 실제 상태 변화와
 * 이어져 있는가** 를 본다 — 입력·저장·탭 전환이 상태를 움직이는지.
 */

const SS = "#save-state";

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("SS1: 새 문서는 '저장한 적 없음'", async ({ page }) => {
  await expect(page.locator(SS)).toHaveAttribute("data-status", "unsaved");
  await expect(page.locator("#save-state-text")).toHaveText("저장한 적 없음");
});

test("SS2: 글자를 입력해도 파일이 없으면 여전히 '저장한 적 없음'", async ({ page }) => {
  await page.locator("#editor").fill("# 새 글");
  // 저장할 곳이 정해지지 않았다는 것이 dirty 여부보다 중요한 정보다.
  await expect(page.locator(SS)).toHaveAttribute("data-status", "unsaved");
});

test("SS3: 파일을 열면 '저장됨' + 파일명", async ({ page }) => {
  await setFsMock(page, { openName: "note.md", contents: { "note.md": "# 문서" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("note.md");

  await expect(page.locator(SS)).toHaveAttribute("data-status", "saved");
  await expect(page.locator("#save-state-text")).toHaveText("저장됨");
  await expect(page.locator("#save-state-name")).toHaveText("note.md");
});

test("SS4: 고치면 '저장하지 않은 변경', 저장하면 되돌아온다", async ({ page }) => {
  await setFsMock(page, { openName: "note.md", contents: { "note.md": "# 문서" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator(SS)).toHaveAttribute("data-status", "saved");

  await page.locator("#editor").fill("# 고쳤다");
  await expect(page.locator(SS)).toHaveAttribute("data-status", "dirty");
  await expect(page.locator("#save-state-text")).toHaveText("저장하지 않은 변경");

  await page.locator('.toolbar-btn[title="Save"]').click();
  await expect(page.locator(SS)).toHaveAttribute("data-status", "saved");
});

test("SS5: 탭을 전환하면 그 탭의 상태를 보여준다", async ({ page }) => {
  await setFsMock(page, { openName: "a.md", contents: { "a.md": "# A" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator(SS)).toHaveAttribute("data-status", "saved");

  await page.locator("#editor").fill("# A 고침");
  await expect(page.locator(SS)).toHaveAttribute("data-status", "dirty");

  await page.locator('.toolbar-btn[title="New"]').click();
  await expect(page.locator(SS)).toHaveAttribute("data-status", "unsaved");

  // dirty 탭의 이름은 "a.md *" 라 정확 일치가 맞지 않는다.
  await page.locator('#tab-bar .tab-name', { hasText: "a.md" }).first().click();
  await expect(page.locator(SS)).toHaveAttribute("data-status", "dirty");
});

test("SS6: 상태 표시줄에 aria-live 가 없다 — 타이핑마다 읽으면 편집이 불가능해진다", async ({
  page,
}) => {
  const attrs = await page.evaluate(() => {
    const bar = document.querySelector("#status-bar")!;
    const ss = document.querySelector("#save-state")!;
    const pick = (el: Element) => ({
      live: el.getAttribute("aria-live"),
      role: el.getAttribute("role"),
    });
    return { bar: pick(bar), ss: pick(ss) };
  });
  expect(attrs.bar.live).toBeNull();
  expect(attrs.bar.role).toBeNull();
  expect(attrs.ss.live).toBeNull();
  expect(attrs.ss.role).toBeNull();
});

test("SS7: 상태가 글자로도 전달된다 — 색만으로 알리지 않는다", async ({ page }) => {
  for (const [status, text] of [["unsaved", "저장한 적 없음"]] as const) {
    await expect(page.locator(SS)).toHaveAttribute("data-status", status);
    await expect(page.locator("#save-state-text")).toHaveText(text);
  }
  // 아이콘만 있고 글자가 비면 색·모양에만 기대게 된다.
  await expect(page.locator("#save-state-text")).not.toBeEmpty();
});

test("SS8: 통계 표시를 꺼도 저장 상태는 남는다 — 다른 경로다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-doc-stats").uncheck();
  await page.locator("#editor-settings-close").click();

  await expect(page.locator("#status-stats")).toBeHidden();
  await expect(page.locator(SS)).toBeVisible();
});
