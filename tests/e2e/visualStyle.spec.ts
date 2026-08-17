import { expect, test } from "@playwright/test";
import { clickToolbarAction, installFsMock, setFsMock } from "./fixtures";

/**
 * #153 알림·설정·검색 바 시각 정리.
 *
 * 전부 마크업·CSS 변경이라 **색 값을 단언하지 않는다** — 값은 토큰이 정하고
 * 토큰은 테마마다 다르다(트랩: 색은 관계로 검증한다). 여기서 고정하는 것은
 * **종류마다 다른가 · 키보드로 쓸 수 있는가 · 한 줄인가** 다.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

async function leftBar(page: import("@playwright/test").Page, selector: string) {
  return page
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).borderLeftColor);
}

test("VS1: 알림 종류마다 상태 막대 색이 다르다", async ({ page }) => {
  // 네 요소를 모두 보이게 한 뒤 색을 읽는다. `hidden` 인 요소도 계산된 스타일은 나온다.
  const colors = await page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? getComputedStyle(el).borderLeftColor : "";
    };
    const notice = document.querySelector("#notice") as HTMLElement;
    notice.dataset.kind = "info";
    const info = getComputedStyle(notice).borderLeftColor;
    notice.dataset.kind = "error";
    const error = getComputedStyle(notice).borderLeftColor;
    return { info, error, warn: read("#fs-limit-notice"), ok: read("#sw-update") };
  });

  expect(new Set(Object.values(colors)).size).toBe(4);
  expect(colors.info).not.toBe("");
});

test("VS2: 알림에 왼쪽 상태 막대가 실제로 그려진다", async ({ page }) => {
  const width = await page
    .locator("#notice")
    .evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(width).toBe("3px");
});

test("VS3: 실제 실패 알림이 오류 막대로 뜬다", async ({ page }) => {
  // `installFsMock` 은 `addInitScript` 라 **goto 앞**이어야 한다.
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await setFsMock(page, { failWrite: true, saveName: "x.html" });
  await page.locator("#editor").fill("내용");

  await clickToolbarAction(page, "Export HTML");

  const notice = page.locator("#notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-kind", "error");
  // 종류에 맞는 막대가 실제로 화면에 그려진다 — VS1 은 손으로 종류를 바꿔 본 것이다.
  const bar = await notice.evaluate((el) => getComputedStyle(el).borderLeftColor);
  const info = await page.evaluate(() => {
    const el = document.querySelector("#notice") as HTMLElement;
    const kept = el.dataset.kind;
    el.dataset.kind = "info";
    const c = getComputedStyle(el).borderLeftColor;
    el.dataset.kind = kept ?? "info";
    return c;
  });
  expect(bar).not.toBe(info);
});

test("VS4: 설정 스위치를 키보드(Space)로 켜고 끌 수 있다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  const check = page.locator("#setting-line-numbers");
  const before = await check.isChecked();

  await check.focus();
  await page.keyboard.press("Space");

  expect(await check.isChecked()).toBe(!before);
  // 실제 요소가 체크박스로 남아 있어야 이 조작이 공짜로 따라온다.
  await expect(check).toHaveAttribute("type", "checkbox");
});

test("VS5: 스위치가 켜짐·꺼짐을 모양으로 구분한다", async ({ page }) => {
  // **전환(transition) 중에 읽으면 중간 색이 나온다** — 껐다 켠 직후의
  // `getComputedStyle` 은 아직 이전 색이라, 스타일이 멀쩡해도 실패한다.
  // 움직임 줄이기를 켜면 `transition: none` 이 걸려 값이 곧바로 확정된다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('.toolbar-btn[title="Settings"]').click();
  const check = page.locator("#setting-line-numbers");
  if (await check.isChecked()) await check.uncheck();

  const read = () => check.evaluate((el) => getComputedStyle(el).backgroundColor);
  const off = await read();
  await check.check();
  expect(await read()).not.toBe(off);

  // **기본 체크박스 겉모습을 끈 상태여야** 스위치로 보인다. 이것을 되돌리면
  // 색·손잡이 단언은 그대로 통과하면서 화면에는 네모 체크박스가 남는다(실측).
  expect(await check.evaluate((el) => getComputedStyle(el).appearance)).toBe("none");

  // 손잡이도 함께 움직여야 색을 못 보는 사람에게도 상태가 전달된다.
  const knob = await check.evaluate(
    (el) => getComputedStyle(el, "::after").transform,
  );
  expect(knob).not.toBe("none");
});

test("VS6: 검색 바와 바꾸기 줄이 한 줄에 놓인다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("Control+f");
  await page.locator("#search-toggle-replace").click();
  await expect(page.locator("#search-replace-row")).toBeVisible();

  const find = await page.locator("#search-bar").boundingBox();
  const replace = await page.locator("#search-replace-row").boundingBox();
  // 두 줄이면 y 가 다르다.
  expect(replace!.y).toBe(find!.y);
});

test("VS7: 일치 수가 입력 옆에 보인다", async ({ page }) => {
  await page.locator("#editor").fill("결제 결제 결제");
  await page.keyboard.press("Control+f");
  await page.locator("#search-input").fill("결제");

  const count = page.locator("#search-count");
  await expect(count).toContainText("3");

  const input = await page.locator("#search-input").boundingBox();
  const box = await count.boundingBox();
  // 오른쪽 끝이 아니라 입력 **바로 옆**이다 — 버튼들보다 왼쪽에 있어야 한다.
  expect(box!.x).toBeGreaterThan(input!.x);
  const prev = await page.locator("#search-prev").boundingBox();
  expect(box!.x).toBeLessThan(prev!.x);
});

test("VS8: 검색 중 Enter 를 눌러도 본문에 개행이 들어가지 않는다 (트랩 #26 회귀)", async ({
  page,
}) => {
  await page.locator("#editor").fill("결제 결제 결제");
  await page.keyboard.press("Control+f");
  await page.locator("#search-input").fill("결제");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await expect(page.locator("#editor")).toHaveValue("결제 결제 결제");
  await expect(page.locator("#search-count")).toContainText("3");
});

test("VS9: 오프라인 배지는 알약 모양이고 아이콘을 함께 보여준다", async ({ page }) => {
  const radius = await page
    .locator("#offline-indicator")
    .evaluate((el) => getComputedStyle(el).borderRadius);
  expect(Number.parseInt(radius, 10)).toBeGreaterThan(20);
  await expect(page.locator("#offline-indicator .offline-icon")).toHaveCount(1);
  // 아이콘은 장식이다 — 스크린리더가 글리프를 읽으면 소음이다.
  await expect(page.locator("#offline-indicator .offline-icon")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

test("VS10: 대화상자 폭이 3종 체계를 따른다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.locator('.toolbar-btn[title="Manual"]').click();
  const wide = await page.locator("#manual").boundingBox();
  await page.locator("#manual-close").click();

  await page.locator('.toolbar-btn[title="Settings"]').click();
  const mid = await page.locator("#editor-settings").boundingBox();

  // 실제 폭은 내용에 따라 줄어들 수 있으므로 **상한**을 본다 — 폭 3종은 최대값의 체계다.
  expect(wide!.width).toBeGreaterThan(mid!.width);
  const wideMax = await page
    .locator("#manual")
    .evaluate((el) => getComputedStyle(el).maxWidth);
  const midMax = await page
    .locator("#editor-settings")
    .evaluate((el) => getComputedStyle(el).maxWidth);
  expect(Math.round(Number.parseFloat(wideMax))).toBe(760);
  expect(Math.round(Number.parseFloat(midMax))).toBe(480);
});
