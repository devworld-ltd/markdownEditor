import { expect, test, type Page } from "@playwright/test";

import { installFsMock } from "./fixtures";

/** F-56 마크다운 파일 드래그앤드롭으로 열기 (이슈 #83). */

/**
 * 진짜 `drop` 이벤트를 만든다. Playwright 로는 OS 파일을 끌어올 수 없으므로
 * 페이지 안에서 `DataTransfer` 를 조립한다 — 앱이 보는 이벤트 모양은 같다.
 *
 * `withHandle` 이면 `getAsFileSystemHandle` 을 붙여 Chrome·Edge 경로를,
 * 아니면 그것이 없는 Safari·Firefox 경로를 흉내 낸다.
 */
async function dropFiles(
  page: Page,
  files: Array<{ name: string; type: string; content: string }>,
  withHandle = false,
): Promise<void> {
  await page.locator("#editor").evaluate(
    (el, { files, withHandle }) => {
      const transfer = new DataTransfer();
      for (const spec of files) {
        transfer.items.add(new File([spec.content], spec.name, { type: spec.type }));
      }

      if (withHandle) {
        // 항목 객체에 직접 붙이면 안 된다 — `transfer.items[i]` 는 접근할 때마다
        // 새 래퍼를 주므로 붙인 메서드가 사라진다. 프로토타입을 갈아끼운다.
        // (Chromium 에는 네이티브 구현이 있지만 합성 항목에는 null 을 준다.)
        const store = (window as unknown as { __handles: Map<string, unknown> }).__handles ??=
          new Map<string, unknown>();
        for (const spec of files) {
          if (store.has(spec.name)) continue;
          store.set(spec.name, {
            kind: "file",
            name: spec.name,
            async getFile() {
              return new File([spec.content], spec.name, { type: spec.type });
            },
            async isSameEntry(other: unknown) {
              return (other as { name?: string })?.name === spec.name;
            },
          });
        }
        (
          DataTransferItem.prototype as DataTransferItem & {
            getAsFileSystemHandle?: unknown;
          }
        ).getAsFileSystemHandle = function (this: DataTransferItem) {
          const name = this.getAsFile()?.name ?? "";
          return Promise.resolve(store.get(name) ?? null);
        };
      }

      el.dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { files, withHandle },
  );
}

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("FD1: 마크다운을 드롭하면 새 탭으로 열린다", async ({ page }) => {
  await dropFiles(page, [
    { name: "메모.md", type: "text/markdown", content: "# 떨어진 문서" },
  ]);

  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("메모.md");
  await expect(page.locator("#editor")).toHaveValue("# 떨어진 문서");
  await expect(page.locator("#preview h1")).toHaveText("떨어진 문서");
});

test("FD2: 여러 파일을 한 번에 드롭하면 여러 탭이 열린다", async ({ page }) => {
  await dropFiles(page, [
    { name: "하나.md", type: "text/markdown", content: "하나" },
    { name: "둘.md", type: "text/markdown", content: "둘" },
  ]);

  // 처음의 빈 Untitled 탭 + 두 개
  await expect(page.locator("#tab-bar .tab")).toHaveCount(3);
  await expect(page.locator("#tab-bar .tab-name").nth(1)).toHaveText("하나.md");
  await expect(page.locator("#tab-bar .tab-name").nth(2)).toHaveText("둘.md");
});

test("FD3: MIME 타입이 비어 있어도 확장자로 연다", async ({ page }) => {
  // 맥에서 .md 의 타입은 자주 빈 문자열이다.
  await dropFiles(page, [{ name: "무타입.md", type: "", content: "본문" }]);
  await expect(page.locator("#editor")).toHaveValue("본문");
});

test("FD4: .txt 도 연다", async ({ page }) => {
  await dropFiles(page, [{ name: "메모.txt", type: "text/plain", content: "텍스트" }]);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("메모.txt");
});

test("FD5: 열 수 없는 형식은 이름을 밝혀 거절한다", async ({ page }) => {
  await dropFiles(page, [
    { name: "보고서.pdf", type: "application/pdf", content: "%PDF" },
  ]);

  await expect(page.locator("#notice")).toBeVisible();
  await expect(page.locator("#notice")).toContainText("보고서.pdf");
  // 탭이 늘지 않아야 한다.
  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
});

test("FD6: 드롭한 문서가 현재 편집 내용을 덮어쓰지 않는다", async ({ page }) => {
  await page.locator("#editor").fill("작업 중인 글");
  await dropFiles(page, [{ name: "새.md", type: "text/markdown", content: "새 문서" }]);

  await expect(page.locator("#editor")).toHaveValue("새 문서");
  // 원래 탭으로 돌아가면 내용이 남아 있어야 한다.
  await page.locator("#tab-bar .tab").first().click();
  await expect(page.locator("#editor")).toHaveValue("작업 중인 글");
});

test("FD7: 같은 파일을 두 번 드롭하면 탭이 하나다 (핸들이 있을 때)", async ({
  page,
}) => {
  const file = [{ name: "같은.md", type: "text/markdown", content: "본문" }];
  await dropFiles(page, file, true);
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  await dropFiles(page, file, true);
  // 핸들이 있으면 isSameEntry 로 이미 열린 탭을 알아본다.
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
});

test("FD8: 핸들이 없는 브라우저에서도 열린다", async ({ page }) => {
  // Safari·Firefox 에는 getAsFileSystemHandle 이 없다. 열리기는 해야 한다.
  await dropFiles(page, [{ name: "폴백.md", type: "text/markdown", content: "본문" }]);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("폴백.md");
});

test("FD9: 드래그 중에는 놓을 수 있다는 표시가 뜬다", async ({ page }) => {
  await page.locator("#editor").evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "a.md", { type: "text/markdown" }));
    el.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.locator("#editor")).toHaveAttribute("data-dropping", "true");

  await page.locator("#editor").evaluate((el) => {
    el.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
  });
  await expect(page.locator("#editor")).not.toHaveAttribute("data-dropping", "true");
});

test("FD10: 파일 드롭은 기본 동작을 막는다 — 안 막으면 문서가 통째로 사라진다", async ({
  page,
}) => {
  const prevented = await page.locator("#editor").evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "a.md", { type: "text/markdown" }));
    const event = new DragEvent("drop", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
