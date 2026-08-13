import { expect, test } from "@playwright/test";

/**
 * F-60 공유 링크 (이슈 #66).
 *
 * Worker·클라이언트 로직은 단위 테스트가 맡는다. 여기서는 **브라우저에서의 배선**을
 * 본다 — 버튼이 요청을 만드는지, 공유 경로로 들어오면 문서가 열리는지, 그리고
 * **공유를 쓰지 않으면 네트워크를 타지 않는지.**
 *
 * `/api/share` 는 Worker 가 처리하므로 vite dev 서버에는 없다. 그래서 API 를
 * 라우트 인터셉트로 가짜 응답한다 — 실제 R2 계약은 `worker.test.ts` 가 검증한다.
 */

const BTN = '.toolbar-btn[title="Share Link"]';
const FAKE_ID = "0123456789abcdef";

async function stubApi(page: import("@playwright/test").Page, doc = "# 공유된 문서") {
  const posts: string[] = [];
  await page.route("**/api/share", async (route) => {
    posts.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: FAKE_ID, reused: false }),
    });
  });
  await page.route(`**/api/share/${FAKE_ID}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/markdown", body: doc });
  });
  return posts;
}

/** 클립보드 스텁 — 링크 복사 결과를 기록한다. */
async function stubClipboard(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(text: string) {
          (window as unknown as { __copied: string[] }).__copied.push(text);
        },
      },
    });
  });
}

test("SH1: 공유 버튼이 문서를 올리고 링크를 복사한다", async ({ page }) => {
  await stubClipboard(page);
  const posts = await stubApi(page);
  await page.goto("/");
  await page.locator("#editor").fill("# 내 문서");

  await page.locator(BTN).click();

  await expect.poll(() => posts.length).toBe(1);
  expect(JSON.parse(posts[0])).toEqual({ content: "# 내 문서" });

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied))
    .toEqual([`${new URL(page.url()).origin}/s/${FAKE_ID}`]);
});

test("SH2: 링크를 아는 사람은 볼 수 있다는 점을 알린다", async ({ page }) => {
  await stubClipboard(page);
  await stubApi(page);
  await page.goto("/");
  await page.locator("#editor").fill("# 문서");

  await page.locator(BTN).click();
  await expect(page.locator("#notice")).toContainText("링크를 아는 사람");
});

test("SH3: 빈 문서는 요청을 보내지 않는다", async ({ page }) => {
  const posts = await stubApi(page);
  await page.goto("/");

  await page.locator(BTN).click();
  await expect(page.locator("#notice")).toContainText("빈 문서");
  expect(posts).toHaveLength(0);
});

test("SH4: 공유 링크로 들어오면 그 문서가 열린다", async ({ page }) => {
  await stubApi(page, "# 남이 만든 문서\n\n본문");
  await page.goto(`/s/${FAKE_ID}`);

  await expect(page.locator("#editor")).toHaveValue("# 남이 만든 문서\n\n본문");
  await expect(page.locator("#preview h1")).toHaveText("남이 만든 문서");
});

test("SH5: 공유 문서도 정화 파이프라인을 탄다 (F-18)", async ({ page }) => {
  // 공유 문서는 남이 만든 것이다 — 서버가 HTML 을 만들지 않는 이유다.
  await stubApi(page, '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
  await page.goto(`/s/${FAKE_ID}`);
  await expect(page.locator("#editor")).not.toHaveValue("");

  const html = await page.locator("#preview").innerHTML();
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("onerror");
});

test("SH6: 공유 링크를 연 뒤 주소가 정리된다", async ({ page }) => {
  // 그대로 두면 새로고침 때마다 다시 받아 탭이 쌓인다.
  await stubApi(page);
  await page.goto(`/s/${FAKE_ID}`);
  await expect(page.locator("#editor")).not.toHaveValue("");

  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
});

test("SH7: 링크가 잘못돼도 앱은 정상적으로 뜬다", async ({ page }) => {
  await page.route(`**/api/share/${FAKE_ID}`, (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.goto(`/s/${FAKE_ID}`);

  // 흰 화면이 되면 안 된다 — 빈 편집기라도 쓸 수 있어야 한다.
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#notice")).toContainText("찾을 수 없습니다");
});

test("SH8: 공유를 쓰지 않으면 네트워크 요청이 없다", async ({ page }) => {
  // 이 앱의 성격이다 — 공유는 유일한 예외이고, 버튼을 눌러야만 나간다.
  const external: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) external.push(r.url());
  });

  await page.goto("/");
  await page.locator("#editor").fill("# 문서\n\n본문 작성 중");
  await page.locator("#editor").press("Control+s").catch(() => {});
  await page.waitForTimeout(400);

  expect(external).toEqual([]);
});

test("SH9: 업로드가 실패하면 사유와 함께 알린다", async ({ page }) => {
  await page.route("**/api/share", (route) =>
    route.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({ error: "too-large" }),
    }),
  );
  await page.goto("/");
  await page.locator("#editor").fill("# 문서");

  await page.locator(BTN).click();
  await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
  await expect(page.locator("#notice")).toContainText("too-large");
});

test("SH10: 클립보드 복사만 실패해도 링크는 보여준다", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() {
          throw new Error("권한 없음");
        },
      },
    });
  });
  await stubApi(page);
  await page.goto("/");
  await page.locator("#editor").fill("# 문서");

  await page.locator(BTN).click();
  // 링크는 만들어졌다 — 그 사실을 감추면 사용자가 결과를 잃는다.
  await expect(page.locator("#notice")).toContainText(`/s/${FAKE_ID}`);
});
