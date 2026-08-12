import { test, expect } from "@playwright/test";

/**
 * 앱이 노출하는 전체 URL(정적 자원 포함)에 대한 응답 검증.
 * 이 프로젝트는 백엔드 API가 없는 순수 클라이언트 앱이므로
 * "전체 URL" = Vite 개발 서버가 서빙하는 엔트리 문서 + 소스 모듈이다.
 */

/**
 * 소스 모듈 경로(`/src/*.ts`)는 **개발 서버에서만** 존재한다.
 * 프로덕션 빌드(preview·배포 환경)에서는 `/assets/*` 로 번들되므로 404 다.
 * F-69 에서 프리뷰 실행 모드(E2E_PREVIEW=1)가 생기면서 이 전제가 드러났다.
 */
const IS_DEV_SERVER =
  process.env.E2E_PREVIEW !== "1" &&
  !process.env.E2E_BASE_URL?.match(/^https?:\/\/(?!127\.0\.0\.1|localhost)/);

/** 어떤 환경에서도 존재해야 하는 URL */
const COMMON_URLS = [
  { path: "/", contentType: /text\/html/ },
];

/** 개발 서버 전용 — 프로덕션에서는 번들되어 사라진다 */
const DEV_ONLY_URLS = [
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
  { path: "/src/swUpdate.ts", contentType: /javascript/ },
];

for (const { path, contentType } of COMMON_URLS) {
  test(`GET ${path} → 200`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(contentType);
  });
}

for (const { path, contentType } of DEV_ONLY_URLS) {
  test(`GET ${path} → 200 (개발 서버 전용)`, async ({ request }) => {
    test.skip(!IS_DEV_SERVER, "프로덕션 번들에는 소스 모듈 경로가 없다");
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
