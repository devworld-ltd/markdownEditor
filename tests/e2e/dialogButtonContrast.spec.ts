import { expect, test, type Page } from "@playwright/test";

/**
 * PR #196 리뷰 P1.
 *
 * `.shortcut-help`(테마를 따르는 대화상자)의 버튼이 `.notice`(항상 어두운
 * 표면) 전용으로 고정된 `.sw-update-btn` 의 `color: #fff` 를 그대로 재사용해,
 * 라이트 모드 대화상자(흰 배경)에서 취소 버튼 글자가 안 보이고 다크 모드
 * accent(밝은 파랑) 위 열기/확인 버튼 글자도 흐려지는 결함이 있었다
 * (#open-url-dialog·#reload-dialog·#save-conflict-dialog).
 *
 * **색 값 자체는 단언하지 않는다**(트랩: 토큰은 바뀐다) — 대비 관계만 본다.
 * 전환 중 값을 읽지 않도록 `reducedMotion: "reduce"` 를 쓴다(트랩 #96).
 */

/** WCAG 상대 휘도. `rgb(r, g, b)` 문자열을 받는다. */
function luminance(color: string): number {
  const parts = color.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) throw new Error(`색 파싱 실패: ${color}`);
  const [r, g, b] = parts.slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `<dialog>` 를 `showModal()` 로 강제로 연다 — 실제 트리거 흐름(파일 변경
 * 감지·URL 파라미터 등)을 재현하지 않고 CSS 대비만 확인하기 위해서다. */
async function openDialog(page: Page, dialogId: string) {
  await page.evaluate((id) => {
    const dialog = document.getElementById(id) as HTMLDialogElement;
    if (!dialog.open) dialog.showModal();
  }, dialogId);
}

async function buttonColors(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    const dialog = el.closest("dialog")!;
    return { color: cs.color, bg: getComputedStyle(dialog).backgroundColor };
  });
}

const DIALOGS: { id: string; cancel: string; primary: string }[] = [
  { id: "reload-dialog", cancel: "#reload-dialog-cancel", primary: "#reload-dialog-ok" },
  { id: "save-conflict-dialog", cancel: "#save-conflict-cancel", primary: "#save-conflict-overwrite" },
  { id: "open-url-dialog", cancel: "#open-url-cancel", primary: "#open-url-confirm" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} 모드`, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.locator("#editor")).toBeVisible();
    });

    for (const { id, cancel, primary } of DIALOGS) {
      test(`DB-${id}(${scheme}): 취소·주 버튼 글자가 대화상자 배경에서 AA 를 넘는다`, async ({ page }) => {
        await openDialog(page, id);

        const cancelColors = await buttonColors(page, cancel);
        expect(
          contrast(cancelColors.color, cancelColors.bg),
          `${cancel} color=${cancelColors.color} bg=${cancelColors.bg}`,
        ).toBeGreaterThanOrEqual(4.5);

        const primaryEl = page.locator(primary);
        const primaryBg = await primaryEl.evaluate((el) => getComputedStyle(el).backgroundColor);
        const primaryColor = await primaryEl.evaluate((el) => getComputedStyle(el).color);
        expect(
          contrast(primaryColor, primaryBg),
          `${primary} color=${primaryColor} bg(accent)=${primaryBg}`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}

test("DB-notice: .notice 맥락의 sw-update-btn 은 그대로 흰 글자다 — 회귀 아님", async ({ page }) => {
  await page.goto("/");
  const color = await page
    .locator("#fs-limit-notice-dismiss")
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(255, 255, 255)");
});
