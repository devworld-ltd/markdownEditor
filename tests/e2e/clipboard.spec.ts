import { expect, test } from "@playwright/test";

/**
 * F-40 렌더된 HTML 클립보드 복사 (이슈 #65).
 *
 * 분기 로직은 `clipboardExport.test.ts` 가 맡는다. 여기서는 **실제로 클립보드에
 * 들어가는 바이트**를 본다 — 조립 결과가 아니라 앱에서 나가는 것.
 *
 * 실제 클립보드 읽기는 권한이 필요해 자동화가 불안정하다. 그래서
 * `navigator.clipboard` 를 앱 스크립트보다 **먼저** 가짜로 바꿔 기록만 남긴다
 * (F-69 의 서비스 워커 스텁과 같은 전략).
 */

const BTN = '.toolbar-btn[title="Copy HTML"]';

/** 클립보드 API 를 기록용 스텁으로 바꾼다. */
async function installClipboardSpy(page: import("@playwright/test").Page, rich = true) {
  await page.addInitScript((supportsRich) => {
    const writes: Array<{ kind: string; types?: string[]; data: Record<string, string> }> = [];
    (window as unknown as { __clip: typeof writes }).__clip = writes;

    if (!supportsRich) {
      // ClipboardItem 자체가 없는 브라우저를 흉내낸다.
      delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    }

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write(items: Array<Record<string, unknown>>) {
          for (const item of items) {
            const data: Record<string, string> = {};
            const types = (item as unknown as { types: string[] }).types ?? [];
            for (const type of types) {
              const blob = await (item as unknown as { getType(t: string): Promise<Blob> }).getType(
                type,
              );
              data[type] = await blob.text();
            }
            writes.push({ kind: "rich", types, data });
          }
        },
        async writeText(text: string) {
          writes.push({ kind: "text", data: { "text/plain": text } });
        },
      },
    });
  }, rich);
}

type ClipWrite = { kind: string; data: Record<string, string> };

function clipWrites(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { __clip: ClipWrite[] }).__clip);
}

/**
 * 클립보드 쓰기는 **비동기**다. 클릭 직후 읽으면 아직 비어 있어, 폴링 없이
 * 단언하면 기능이 멀쩡한데도 실패한다(실제로 그랬다).
 */
async function waitForClipWrite(page: import("@playwright/test").Page): Promise<ClipWrite[]> {
  await expect.poll(async () => (await clipWrites(page)).length).toBeGreaterThan(0);
  return clipWrites(page);
}

test("C1: 서식 있는 복사에 HTML 과 마크다운 원문이 함께 들어간다", async ({ page }) => {
  await installClipboardSpy(page);
  await page.goto("/");
  await page.locator("#editor").fill("# 제목\n\n본문 **굵게**");
  await expect(page.locator("#preview h1")).toBeVisible();

  await page.locator(BTN).click();

  const writes = await waitForClipWrite(page);
  expect(writes).toHaveLength(1);
  expect(writes[0].kind).toBe("rich");
  expect(writes[0].data["text/html"]).toContain("<h1>제목</h1>");
  expect(writes[0].data["text/html"]).toContain("<strong>굵게</strong>");
  // 서식을 모르는 곳에 붙이면 태그가 날것으로 들어간다 — 대체본이 필요하다.
  expect(writes[0].data["text/plain"]).toBe("# 제목\n\n본문 **굵게**");
});

test("C2: 정화된 HTML 만 나간다 (F-18)", async ({ page }) => {
  await installClipboardSpy(page);
  await page.goto("/");
  await page.locator("#editor").fill('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
  await page.waitForTimeout(220);

  await page.locator(BTN).click();

  const html = (await waitForClipWrite(page))[0].data["text/html"];
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("onerror");
});

test("C3: 성공을 사용자에게 알린다", async ({ page }) => {
  await installClipboardSpy(page);
  await page.goto("/");
  await page.locator("#editor").fill("# x");
  await expect(page.locator("#preview h1")).toBeVisible();

  await page.locator(BTN).click();
  await expect(page.locator("#notice")).toBeVisible();
  await expect(page.locator("#notice")).toContainText("서식");
});

test("C4: ClipboardItem 이 없으면 원문만 복사하고 그 사실을 알린다", async ({ page }) => {
  await installClipboardSpy(page, false);
  await page.goto("/");
  await page.locator("#editor").fill("# 제목");
  await expect(page.locator("#preview h1")).toBeVisible();

  await page.locator(BTN).click();

  const writes = await waitForClipWrite(page);
  expect(writes).toHaveLength(1);
  expect(writes[0].kind).toBe("text");
  expect(writes[0].data["text/plain"]).toBe("# 제목");

  // "복사됨" 만 띄우면 붙여넣고 나서야 서식이 없다는 걸 알게 된다.
  await expect(page.locator("#notice")).toContainText("마크다운 원문");
});

test("C5: 편집 중인 최신 내용을 복사한다", async ({ page }) => {
  await installClipboardSpy(page);
  await page.goto("/");
  const editor = page.locator("#editor");
  await editor.fill("# 처음");
  await expect(page.locator("#preview h1")).toHaveText("처음");
  await editor.fill("# 나중");
  await expect(page.locator("#preview h1")).toHaveText("나중");

  await page.locator(BTN).click();

  const writes = await waitForClipWrite(page);
  expect(writes[0].data["text/html"]).toContain("나중");
  expect(writes[0].data["text/plain"]).toBe("# 나중");
});

test("C6: 미리보기 전용 모드에서도 동작한다", async ({ page }) => {
  await installClipboardSpy(page);
  await page.goto("/");
  await page.locator("#editor").fill("# 제목");
  await expect(page.locator("#preview h1")).toBeVisible();

  await page.locator("#view-mode").click();
  await page.locator("#view-mode").click();
  await expect(page.locator(".editor-container")).toHaveAttribute("data-mode", "preview");

  await page.locator(BTN).click();
  const writes = await waitForClipWrite(page);
  expect(writes[0].data["text/html"]).toContain("<h1>제목</h1>");
});

test("C7: 클립보드 쓰기가 실패하면 오류로 알린다", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() {
          throw new Error("거부됨");
        },
      },
    });
  });
  await page.goto("/");
  await page.locator("#editor").fill("# x");
  await expect(page.locator("#preview h1")).toBeVisible();

  await page.locator(BTN).click();

  await expect(page.locator("#notice")).toBeVisible();
  await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
});
