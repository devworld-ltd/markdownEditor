import { expect, test } from "@playwright/test";

/**
 * F-32 분할 비율 조절 (이슈 #49).
 *
 * 계산부(`splitLayout.test.ts`)가 자르기·단계 이동을 맡으므로 여기서는
 * **브라우저에서만 확인되는 것**만 본다: 실제 드래그, 포인터 캡처, 세션 복원,
 * 그리고 F-25 스크롤 동기화와의 경합.
 */

const RESIZER = "#split-resizer";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

async function widths(page: import("@playwright/test").Page) {
  const editor = await page.locator("#editor").boundingBox();
  const preview = await page.locator("#preview").boundingBox();
  return { editor: editor!.width, preview: preview!.width };
}

/** 리사이저를 x 좌표로 끈다. */
async function dragTo(page: import("@playwright/test").Page, x: number, y?: number) {
  const box = (await page.locator(RESIZER).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, y ?? box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y ?? box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("P1: 기본은 반반이고 리사이저가 그 사이에 있다", async ({ page }) => {
  const { editor, preview } = await widths(page);
  expect(Math.abs(editor - preview)).toBeLessThan(4);
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "50");
});

test("P2: 드래그로 비율이 바뀐다", async ({ page }) => {
  const before = await widths(page);
  await dragTo(page, 300);
  const after = await widths(page);

  expect(after.editor).toBeLessThan(before.editor);
  expect(after.preview).toBeGreaterThan(before.preview);
});

test("P3: 끝까지 끌어도 한쪽이 사라지지 않는다", async ({ page }) => {
  // 완전히 접히면 되돌릴 손잡이도 함께 사라진다.
  await dragTo(page, -500);
  const collapsed = await widths(page);
  expect(collapsed.editor).toBeGreaterThan(50);

  await dragTo(page, 9999);
  const expanded = await widths(page);
  expect(expanded.preview).toBeGreaterThan(50);
});

test("P4: 더블클릭으로 반반 복귀", async ({ page }) => {
  await dragTo(page, 300);
  await expect(page.locator(RESIZER)).not.toHaveAttribute("aria-valuenow", "50");

  await page.locator(RESIZER).dblclick();
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "50");
});

test("P5: 키보드 화살표로 조절되고 Home 으로 복귀한다", async ({ page }) => {
  // 드래그 전용이면 키보드 사용자에게는 없는 기능이다.
  await page.locator(RESIZER).focus();
  await expect(page.locator(RESIZER)).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "52");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "54");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "52");

  await page.keyboard.press("Home");
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "50");
});

test("P6: 비율이 새로고침 후에도 유지된다", async ({ page }) => {
  await page.locator(RESIZER).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "54");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "54");
});

test("P7: 손상된 저장값이 있어도 앱이 정상적으로 뜬다", async ({ page }) => {
  // JSON 파싱 실패
  await page.evaluate(() => {
    localStorage.setItem("markdown-editor:layout:v1", "{not json");
  });
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(RESIZER)).toHaveAttribute("aria-valuenow", "50");

  // 파싱은 되지만 **타입이 틀린** 값. 이쪽이 더 위험하다 — 그대로 흘려보내면
  // 레이아웃 계산이 NaN 으로 무너지고 예외도 나지 않는다.
  for (const bad of ['{"ratio":"0.7"}', '{"ratio":null}', '{"ratio":{}}', "[]"]) {
    await page.evaluate((raw) => {
      localStorage.setItem("markdown-editor:layout:v1", raw);
    }, bad);
    await page.reload();
    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.locator(RESIZER), `저장값 ${bad}`).toHaveAttribute("aria-valuenow", "50");
  }
});

test("P8: 비율을 바꿔도 편집 위치가 움직이지 않는다 (F-25 경합)", async ({ page }) => {
  // 폭이 바뀌면 프리뷰의 scrollHeight 가 바뀌고, 줄어든 쪽은 브라우저가
  // scrollTop 을 클램프하며 scroll 이벤트를 쏜다. 억제하지 않으면 F-25 가
  // 그것을 **사용자 스크롤로 분류**해 반대편(에디터)을 끌고 간다 — 사용자가
  // 보던 자리가 드래그만으로 이동해 버린다.
  const editor = page.locator("#editor");
  await editor.fill(Array.from({ length: 300 }, (_, i) => `${i}번째 줄 채우기`).join("\n"));

  // 문서 중간으로 스크롤한다. 끝이 아니라 중간이어야 어긋남이 드러난다.
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(120);
  const before = await editor.evaluate((el: HTMLTextAreaElement) => el.scrollTop);
  expect(before).toBeGreaterThan(100);

  await dragTo(page, 320);
  await page.waitForTimeout(150);

  // 에디터가 권위 있는 쪽이다 — 드래그로 움직여선 안 된다.
  const after = await editor.evaluate((el: HTMLTextAreaElement) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(40);
});

test("P9: 720px 이하에서는 세로 방향으로 동작한다", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });

  const before = await page.locator("#editor").boundingBox();
  const box = (await page.locator(RESIZER).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 150, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator("#editor").boundingBox();

  expect(after!.height).toBeLessThan(before!.height);
});

test("P10: 리사이저가 스크린리더에 슬라이더로 노출된다", async ({ page }) => {
  const attrs = await page.locator(RESIZER).evaluate((el) => ({
    role: el.getAttribute("role"),
    label: el.getAttribute("aria-label"),
    min: el.getAttribute("aria-valuemin"),
    max: el.getAttribute("aria-valuemax"),
    tabindex: el.getAttribute("tabindex"),
  }));

  expect(attrs.role).toBe("separator");
  expect(attrs.label).toBeTruthy();
  expect(attrs.min).toBe("15");
  expect(attrs.max).toBe("85");
  expect(attrs.tabindex).toBe("0");
});
