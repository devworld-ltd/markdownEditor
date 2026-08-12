import { defineConfig } from "vite";

export default defineConfig({
  // 웹 배포에서는 사이트 루트에서 서빙되므로 절대 경로가 맞다.
  // (네이티브 app:// 스킴 호환을 위해 쓰던 "./" 와 modulePreload:false 는 제거했다.)
  base: "/",
  root: ".",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
