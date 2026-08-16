import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const SW_VERSION_PLACEHOLDER = "__BUILD_ID__";

const RELEASE_MODULE_ID = "virtual:release-notes";
const RELEASE_RESOLVED_ID = `\0${RELEASE_MODULE_ID}`;

/**
 * #131: `CHANGELOG.md` 와 `package.json` 의 버전을 **빌드 시각에** 번들로 넣는다.
 *
 * 받아오지 않는 이유: 이 앱은 공유(F-60)를 쓰지 않는 한 네트워크 요청이 한 건도
 * 없고 E2E `SH8` 이 그것을 단언한다. `fetch("/releases.json")` 하나면 그 성질이 깨진다.
 *
 * 커밋되는 생성 `.ts` 를 만들지 않는 이유: 재생성을 잊으면 **빌드도 테스트도
 * 통과하면서 화면만 옛 내용으로 남는다**(트랩 #22 의 아이콘 사고와 같은 구조).
 * 가상 모듈은 매 빌드에 원본을 다시 읽으므로 낡을 수가 없다.
 */
function releaseNotesPlugin(): Plugin {
  return {
    name: "release-notes",
    resolveId(id) {
      return id === RELEASE_MODULE_ID ? RELEASE_RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RELEASE_RESOLVED_ID) return null;

      const [changelog, pkg] = await Promise.all([
        readFile(resolve(process.cwd(), "CHANGELOG.md"), "utf-8"),
        readFile(resolve(process.cwd(), "package.json"), "utf-8"),
      ]);
      const version = String(JSON.parse(pkg).version ?? "");

      // 원문을 그대로 넘기고 파싱은 `releaseNotes.ts` 가 한다 — 파서가 하나여야
      // 단위 테스트가 실제로 쓰이는 그 코드를 검증한다.
      return `export const changelog = ${JSON.stringify(changelog)};\n` +
        `export const version = ${JSON.stringify(version)};\n`;
    },
    /** 개발 중 CHANGELOG 를 고치면 즉시 반영한다. */
    configureServer(server) {
      const watched = [
        resolve(process.cwd(), "CHANGELOG.md"),
        resolve(process.cwd(), "package.json"),
      ];
      server.watcher.add(watched);
      server.watcher.on("change", (file) => {
        if (!watched.includes(file)) return;
        const mod = server.moduleGraph.getModuleById(RELEASE_RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

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
  plugins: [releaseNotesPlugin(), swBuildIdPlugin()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
