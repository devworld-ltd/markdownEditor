import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DOMPurify·localStorage 등 DOM API 를 쓰는 모듈이 늘어 jsdom 이 필요하다.
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    // 단위 테스트는 *.test.ts 만 대상으로 한다.
    // tests/e2e/*.spec.ts 는 Playwright 전용이므로 제외한다.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      // F-60 으로 worker/ 가 생겼다. 커버리지에서 빠지면 서버 코드가
      // 검증되지 않는 채로 남는다.
      include: ["src/**/*.ts", "worker/**/*.ts"],
    },
  },
});
