import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const SW_VERSION_PLACEHOLDER = "__BUILD_ID__";

/**
 * F-69: `public/sw.js` 는 vite 가 가공 없이 그대로 dist 로 복사한다(transform 훅이
 * 닿지 않는다). 그래서 `writeBundle` 훅 — 복사가 끝난 뒤 — 에서 dist/sw.js 를 직접
 * 읽어 플레이스홀더를 빌드마다 달라지는 값으로 치환한다.
 *
 * 이 치환이 없으면 /sw.js 응답 바이트가 배포마다 동일해, 브라우저가 새 버전을
 * 절대 감지하지 못한다(updatefound 미발생 → 업데이트 알림 기능 자체가 죽는다).
 * 그래서 플레이스홀더를 찾지 못하면 침묵하지 않고 빌드를 실패시킨다.
 */
function swBuildIdPlugin(): Plugin {
  return {
    name: "sw-build-id",
    apply: "build",
    async writeBundle(options) {
      const outDir = options.dir ?? "dist";
      const swPath = resolve(outDir, "sw.js");

      const buildId =
        process.env.GITHUB_SHA?.slice(0, 7) ??
        process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ??
        Date.now().toString(36);

      const contents = await readFile(swPath, "utf-8");
      if (!contents.includes(SW_VERSION_PLACEHOLDER)) {
        throw new Error(
          `${swPath} 에서 플레이스홀더 "${SW_VERSION_PLACEHOLDER}" 를 찾지 못했습니다. ` +
            `이대로 배포하면 서비스 워커 업데이트 감지(F-69)가 동작하지 않습니다.`,
        );
      }

      await writeFile(swPath, contents.replaceAll(SW_VERSION_PLACEHOLDER, buildId), "utf-8");
    },
  };
}

export default defineConfig({
  // 웹 배포에서는 사이트 루트에서 서빙되므로 절대 경로가 맞다.
  // (네이티브 app:// 스킴 호환을 위해 쓰던 "./" 와 modulePreload:false 는 제거했다.)
  base: "/",
  root: ".",
  plugins: [swBuildIdPlugin()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
