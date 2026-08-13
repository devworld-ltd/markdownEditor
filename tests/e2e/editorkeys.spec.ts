import { expect, test } from "@playwright/test";

/**
 * F-26 리스트 이어쓰기 · F-27 Tab 들여쓰기 (이슈 #78·#79).
 *
 * 계산은 `editorKeys.test.ts` 가 맡는다. 여기서는 **실제 브라우저에서만 확인되는
 * 것**을 본다 — 실행 취소가 정말 되는지, Tab 으로 빠져나갈 수 있는지, 조합 입력을
 * 방해하지 않는지.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").click();
});

test("EK1: 불릿 목록을 이어 쓴다", async ({ page }) => {
  await page.keyboard.type("- 첫째");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째");

  await expect(page.locator("#editor")).toHaveValue("- 첫째\n- 둘째");
});

test("EK2: 번호 목록의 번호가 올라간다", async ({ page }) => {
  await page.keyboard.type("1. 첫째");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째");
  await page.keyboard.press("Enter");
  await page.keyboard.type("셋째");

  await expect(page.locator("#editor")).toHaveValue("1. 첫째\n2. 둘째\n3. 셋째");
});

test("EK3: 체크박스는 빈 상태로 이어진다", async ({ page }) => {
  await page.keyboard.type("- [x] 완료");
  await page.keyboard.press("Enter");
  await page.keyboard.type("다음");

  // 완료 표시까지 물려받으면 새 항목이 이미 완료된 것으로 보인다.
  await expect(page.locator("#editor")).toHaveValue("- [x] 완료\n- [ ] 다음");
});

test("EK4: 빈 항목에서 Enter 를 치면 목록이 끝난다", async ({ page }) => {
  // 이어쓰기만 하면 사용자가 목록을 빠져나갈 방법이 없다.
  await page.keyboard.type("- 첫째");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("본문");

  await expect(page.locator("#editor")).toHaveValue("- 첫째\n\n본문");
});

test("EK5: 목록이 아니면 평범하게 줄바꿈한다", async ({ page }) => {
  await page.keyboard.type("그냥 글");
  await page.keyboard.press("Enter");
  await page.keyboard.type("다음 줄");

  await expect(page.locator("#editor")).toHaveValue("그냥 글\n다음 줄");
});

test("EK6: 이어쓰기가 Cmd+Z 로 되돌아간다", async ({ page }) => {
  // execCommand 대신 value 대입을 쓰면 실행 취소가 통째로 죽는다.
  await page.keyboard.type("- 첫째");
  await page.keyboard.press("Enter");
  await expect(page.locator("#editor")).toHaveValue("- 첫째\n- ");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#editor")).toHaveValue("- 첫째");
});

test("EK7: Tab 이 들여쓰기를 넣는다", async ({ page }) => {
  await page.keyboard.type("코드");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Tab");

  await expect(page.locator("#editor")).toHaveValue("  코드");
});

test("EK8: Shift+Tab 이 내어쓴다", async ({ page }) => {
  await page.locator("#editor").fill("    코드");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await page.keyboard.press("Shift+Tab");

  await expect(page.locator("#editor")).toHaveValue("  코드");
});

test("EK9: 여러 줄을 한 번에 들여쓴다", async ({ page }) => {
  await page.locator("#editor").fill("첫째\n둘째\n셋째");
  // 0..5 = "첫째\n둘째\n" — 선택이 셋째 줄 맨 앞에서 끝나므로 그 줄은 제외된다.
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.keyboard.press("Tab");

  await expect(page.locator("#editor")).toHaveValue("  첫째\n  둘째\n셋째");
});

test("EK10: 들여쓰기도 Cmd+Z 로 되돌아간다", async ({ page }) => {
  await page.locator("#editor").fill("첫째\n둘째");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor")).toHaveValue("  첫째\n  둘째");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#editor")).toHaveValue("첫째\n둘째");
});

test("EK11: Esc 를 누르면 다음 Tab 으로 편집 영역을 빠져나갈 수 있다", async ({ page }) => {
  // Tab 을 무조건 가로채면 키보드 사용자가 편집 영역에 갇힌다 (F-59).
  await page.keyboard.type("내용");
  await expect(page.locator("#editor")).toBeFocused();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");

  await expect(page.locator("#editor")).not.toBeFocused();
  await expect(page.locator("#editor")).toHaveValue("내용");
});

test("EK12: 탈출은 한 번만 — 그 다음 Tab 은 다시 들여쓰기다", async ({ page }) => {
  // 영구히 꺼지면 다시 켜는 방법을 사용자가 알 수 없다.
  await page.keyboard.type("내용");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor")).not.toBeFocused();

  await page.locator("#editor").click();
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor")).toHaveValue("  내용");
});

test("EK13: 다른 키를 누르면 탈출 예약이 사라진다", async ({ page }) => {
  await page.keyboard.type("내용");
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");

  // Esc 직후의 Tab 에만 적용된다.
  await expect(page.locator("#editor")).toBeFocused();
  await expect(page.locator("#editor")).toHaveValue("내용x  ");
});

test("EK14: 이어쓴 목록이 프리뷰에 반영된다", async ({ page }) => {
  await page.keyboard.type("- 첫째");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째");

  await expect(page.locator("#preview li")).toHaveCount(2);
});

test("EK15: 조합 입력 중의 Enter 를 가로채지 않는다", async ({ page }) => {
  // 한글 조합 중 Enter 는 글자를 확정하는 키다. 가로채면 조합이 깨진다.
  await page.locator("#editor").fill("- 항목");
  const handled = await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(el.value.length, el.value.length);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "isComposing", { value: true });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(handled).toBe(false);
});
