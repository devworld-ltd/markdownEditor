import { test, expect } from "@playwright/test";

/**
 * 앱이 노출하는 전체 URL(정적 자원 포함)에 대한 응답 검증.
 * 이 프로젝트는 백엔드 API가 없는 순수 클라이언트 앱이므로
 * "전체 URL" = Vite 개발 서버가 서빙하는 엔트리 문서 + 소스 모듈이다.
 */
const URLS = [
  { path: "/", contentType: /text\/html/ },
  { path: "/index.html", contentType: /text\/html/ },
  // 개발 서버에서 CSS 는 HMR 을 위해 JS 모듈로 래핑되어 서빙된다.
  { path: "/src/style.css", contentType: /javascript/ },
  { path: "/src/main.ts", contentType: /javascript/ },
  { path: "/src/editor.ts", contentType: /javascript/ },
  { path: "/src/preview.ts", contentType: /javascript/ },
  { path: "/src/parser.ts", contentType: /javascript/ },
  { path: "/src/tabs.ts", contentType: /javascript/ },
  { path: "/src/fileOps.ts", contentType: /javascript/ },
  { path: "/src/toolbar.ts", contentType: /javascript/ },
  { path: "/src/shortcuts.ts", contentType: /javascript/ },
  { path: "/src/storage.ts", contentType: /javascript/ },
  { path: "/src/notice.ts", contentType: /javascript/ },
];

for (const { path, contentType } of URLS) {
  test(`GET ${path} → 200`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(contentType);
  });
}

test("존재하지 않는 경로는 SPA fallback 또는 404를 반환한다", async ({ request }) => {
  const res = await request.get("/does-not-exist.js");
  expect([200, 404]).toContain(res.status());
});

test("페이지 로드 중 콘솔 에러가 없다", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  expect(errors).toEqual([]);
});
