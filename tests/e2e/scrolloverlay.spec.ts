import { expect, test, type Page } from "@playwright/test";

/**
 * F-25 재검증 — 스크롤 동기화가 편집 하이라이팅(F-23 잔여)과 함께 동작한다 (이슈 #97).
 *
 * 오버레이는 편집기 스크롤을 따라가고, 편집기는 프리뷰와 동기화된다. **두 개의
 * 동기화가 같은 스크롤 이벤트에 붙는다** — 서로를 밀어내지 않는지 확인한다.
 */

const LONG = Array.from({ length: 120 }, (_, i) =>
  i % 6 === 0 ? `## 절 ${i}` : `**${i}번째** 줄의 내용 \`코드\` 와 [링크](url).`,
).join("\n\n");

async function setOverlay(page: Page, on: boolean): Promise<void> {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-highlight").setChecked(on);
  await page.locator("#editor-settings-close").click();
}

async function scrollEditor(page: Page, top: number): Promise<void> {
  await page.locator("#editor").evaluate((el, top) => {
    el.scrollTop = top;
  }, top);
}

function ratio(el: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  const max = el.scrollHeight - el.clientHeight;
  return max > 0 ? el.scrollTop / max : 0;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill(LONG);
});

test("SS1: 편집기를 스크롤하면 프리뷰와 오버레이가 함께 따라온다", async ({ page }) => {
  await setOverlay(page, true);
  await scrollEditor(page, 800);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
        return overlay.scrollTop === editor.scrollTop;
      }),
    )
    .toBe(true);

  // 프리뷰 동기화는 rAF 를 거치므로 값이 잡힐 때까지 기다린다.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = (el: Element) => {
          const max = el.scrollHeight - el.clientHeight;
          return max > 0 ? el.scrollTop / max : 0;
        };
        return Math.abs(
          r(document.querySelector("#editor")!) - r(document.querySelector("#preview")!),
        );
      }),
    )
    .toBeLessThan(0.05);
});

test("SS2: 프리뷰를 스크롤해도 오버레이가 편집기와 어긋나지 않는다", async ({ page }) => {
  await setOverlay(page, true);

  await page.locator("#preview").evaluate((el) => {
    el.scrollTop = 900;
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
        return overlay.scrollTop - editor.scrollTop;
      }),
    )
    .toBe(0);
});

test("SS3: 오버레이를 켜고 꺼도 동기화 비율이 달라지지 않는다", async ({ page }) => {
  /**
   * 프리뷰 동기화는 rAF 를 거친다. 스크롤 직후에 값을 한 번 읽으면 아직 0 일 수
   * 있어, 로컬에서는 통과하고 CI 에서만 깨진다(실제로 그랬다). 두 비율이 맞을
   * 때까지 기다린 **뒤에** 그 값을 기록한다.
   */
  async function settledPreviewRatio(): Promise<number> {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = (el: Element) => {
            const max = el.scrollHeight - el.clientHeight;
            return max > 0 ? el.scrollTop / max : 0;
          };
          return Math.abs(
            r(document.querySelector("#editor")!) - r(document.querySelector("#preview")!),
          );
        }),
      )
      .toBeLessThan(0.05);

    return page.evaluate(() => {
      const el = document.querySelector("#preview")!;
      const max = el.scrollHeight - el.clientHeight;
      return max > 0 ? el.scrollTop / max : 0;
    });
  }

  await scrollEditor(page, 700);
  const before = await settledPreviewRatio();

  await setOverlay(page, true);
  await scrollEditor(page, 700);
  const after = await settledPreviewRatio();

  expect(Math.abs(after - before)).toBeLessThan(0.02);
});

test("SS4: 탭을 전환해도 오버레이가 새 탭의 스크롤 위치를 따른다", async ({ page }) => {
  await setOverlay(page, true);
  await scrollEditor(page, 900);

  // 두 번째 탭을 만들고 돌아온다 (F-25 의 억제 해제 순서가 걸린 경로).
  await page.keyboard.press("Alt+KeyN");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await page.locator("#tab-bar .tab").first().click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
        return overlay.scrollTop - editor.scrollTop;
      }),
    )
    .toBe(0);

  const editorTop = await page.evaluate(
    () => document.querySelector<HTMLTextAreaElement>("#editor")!.scrollTop,
  );
  expect(editorTop).toBeGreaterThan(0);
});

test("SS5: 보기 모드를 편집 전용으로 바꿔도 오버레이가 따라간다", async ({ page }) => {
  // F-33 은 숨긴 패널의 clientHeight 가 0 이 되는 것에 기댄다(트랩 #30).
  // 오버레이가 그 판정을 흔들지 않아야 한다.
  await setOverlay(page, true);
  // 버튼 제목은 모드에 따라 바뀐다(F-33) — id 로 잡는다.
  await page.locator("#view-mode").click();
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "editor");

  await scrollEditor(page, 600);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
        return overlay.scrollTop - editor.scrollTop;
      }),
    )
    .toBe(0);
});
