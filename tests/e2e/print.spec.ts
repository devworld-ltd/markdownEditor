import { expect, test } from "@playwright/test";
import { clickToolbarAction } from "./fixtures";

/**
 * F-39 인쇄 / PDF (이슈 #52).
 *
 * `Cmd/Ctrl+P` 를 가로채지 않으므로 검증 대상은 **인쇄 미디어에서 무엇이
 * 보이는가** 다. Playwright 의 `emulateMedia({ media: "print" })` 로 실제 인쇄
 * 스타일을 적용한 채 계산된 값을 읽는다.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill(
    "# 제목\n\n본문 문단.\n\n```\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> 인용\n\n[링크](https://example.com) 그리고 [내부](#a)\n",
  );
  await expect(page.locator("#preview h1")).toBeVisible();
});

/** 인쇄 미디어에서 요소가 실제로 렌더되는지 (display:none 이면 rect 가 0). */
async function printVisibility(page: import("@playwright/test").Page, selectors: string[]) {
  await page.emulateMedia({ media: "print" });
  const result = await page.evaluate((list) => {
    const out: Record<string, boolean> = {};
    for (const sel of list) {
      const el = document.querySelector(sel);
      // display 만 보면 **부모가 숨겨진 경우**를 놓친다. getClientRects() 는
      // 조상까지 반영하므로 "실제로 그려지는가" 를 그대로 답한다.
      out[sel] = !!el && el.getClientRects().length > 0;
    }
    return out;
  }, selectors);
  await page.emulateMedia({ media: "screen" });
  return result;
}

test("PR1: 인쇄에서는 프리뷰만 남고 앱 껍데기는 사라진다", async ({ page }) => {
  const visible = await printVisibility(page, [
    "#preview",
    "#editor",
    ".toolbar",
    "#tab-bar",
    "#split-resizer",
    "#notice-stack",
  ]);

  expect(visible["#preview"]).toBe(true);
  expect(visible["#editor"]).toBe(false);
  expect(visible[".toolbar"]).toBe(false);
  expect(visible["#tab-bar"]).toBe(false);
  expect(visible["#split-resizer"]).toBe(false);
  expect(visible["#notice-stack"]).toBe(false);
});

test("PR2: 검색 바를 열어 둔 채 인쇄해도 종이에 나오지 않는다", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator("#search-bar")).toBeVisible();

  const visible = await printVisibility(page, ["#search-bar", "#preview"]);
  expect(visible["#search-bar"]).toBe(false);
  expect(visible["#preview"]).toBe(true);
});

test("PR3: 편집 전용 모드에서 인쇄해도 빈 종이가 나오지 않는다", async ({ page }) => {
  // data-mode 규칙이 #preview 를 숨기므로, 되돌리지 않으면 백지가 인쇄된다.
  await page.locator("#view-mode").click();
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "editor");
  await expect(page.locator("#preview")).toBeHidden();

  const visible = await printVisibility(page, ["#preview", "#editor"]);
  expect(visible["#preview"]).toBe(true);
  expect(visible["#editor"]).toBe(false);
});

test("PR4: 다크 모드로 보고 있어도 종이에는 흰 배경·검은 글씨", async ({ page }) => {
  await page.emulateMedia({ media: "print", colorScheme: "dark" });

  const colors = await page.evaluate(() => {
    const preview = getComputedStyle(document.querySelector("#preview")!);
    const pre = getComputedStyle(document.querySelector("#preview pre")!);
    return {
      background: preview.backgroundColor,
      color: preview.color,
      preBackground: pre.backgroundColor,
    };
  });
  await page.emulateMedia({ media: "screen", colorScheme: null });

  expect(colors.background).toBe("rgb(255, 255, 255)");
  expect(colors.color).toBe("rgb(0, 0, 0)");
  // 다크의 어두운 코드 배경을 그대로 인쇄하면 잉크를 쏟는다.
  expect(colors.preBackground).toBe("rgb(244, 244, 244)");
});

test("PR5: 코드블록·표·인용이 페이지 경계에서 잘리지 않게 표시된다", async ({ page }) => {
  await page.emulateMedia({ media: "print" });
  const breaks = await page.evaluate(() => {
    const read = (sel: string) => getComputedStyle(document.querySelector(sel)!).breakInside;
    return {
      pre: read("#preview pre"),
      table: read("#preview table"),
      blockquote: read("#preview blockquote"),
    };
  });
  await page.emulateMedia({ media: "screen" });

  expect(breaks.pre).toBe("avoid");
  expect(breaks.table).toBe("avoid");
  expect(breaks.blockquote).toBe("avoid");
});

test("PR6: 외부 링크는 주소가 함께 인쇄되고, 내부 앵커는 아니다", async ({ page }) => {
  await page.emulateMedia({ media: "print" });
  const contents = await page.evaluate(() => {
    const links = [...document.querySelectorAll("#preview a")] as HTMLElement[];
    return links.map((el) => ({
      href: el.getAttribute("href"),
      after: getComputedStyle(el, "::after").content,
    }));
  });
  await page.emulateMedia({ media: "screen" });

  const external = contents.find((c) => c.href?.startsWith("http"));
  const internal = contents.find((c) => c.href?.startsWith("#"));

  // 종이에서는 링크를 누를 수 없다.
  expect(external?.after).toContain("example.com");
  // 내부 앵커 주소를 적어 봐야 의미가 없고 소음만 된다.
  expect(internal?.after === "none" || internal?.after === "").toBe(true);
});

test("PR7: 인쇄 스타일이 화면 표시에는 영향을 주지 않는다", async ({ page }) => {
  // 화면에서는 툴바·에디터가 그대로 보여야 한다.
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#split-resizer")).toBeVisible();

  const editorBg = await page
    .locator("#editor")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(editorBg).toBe("rgb(242, 242, 240)");
});

test("PR8: 인쇄 버튼이 브라우저 인쇄를 호출한다", async ({ page }) => {
  // window.print() 는 자동화에서 대화상자를 열 수 없으므로 호출만 관찰한다.
  await page.evaluate(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });

  await clickToolbarAction(page, "Print / PDF");

  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
});

test("PR9: Cmd/Ctrl+P 를 가로채지 않는다", async ({ page }) => {
  // 브라우저 인쇄가 곧 원하는 동작이다. 가로채면 대화상자 취소·미리보기
  // 동작만 잃으면서 같은 일을 한 겹 더 감싼다.
  const prevented = await page.evaluate(async () => {
    let wasPrevented = false;
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key.toLowerCase() === "p" && (e.metaKey || e.ctrlKey)) {
          wasPrevented = e.defaultPrevented;
        }
      },
      false,
    );
    return new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(wasPrevented), 150);
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true, cancelable: true, bubbles: true }),
      );
    });
  });

  expect(prevented).toBe(false);
});
