import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5173);
const HOST = process.env.E2E_HOST ?? "127.0.0.1";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

// F-69: STUB 시나리오(E1~E7)는 `import.meta.env.PROD` 가드 때문에 프로덕션 번들
// (build + preview)에서만 `navigator.serviceWorker.register()` 가 호출된다(§12.2).
// E2E_PREVIEW=1 로 선택 시 dev 서버 대신 `vite preview` 를 webServer 로 띄운다.
// 기본(dev 서버) 실행에서는 STUB 케이스가 스스로 skip 한다 — 이 설정은 dev 서버
// 동작 자체를 바꾸지 않는다.
const USE_PREVIEW = process.env.E2E_PREVIEW === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: USE_PREVIEW
      ? `npm run build && npm run preview -- --host ${HOST} --port ${PORT} --strictPort`
      : `npm run dev -- --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: USE_PREVIEW ? 120_000 : 60_000,
  },
});
