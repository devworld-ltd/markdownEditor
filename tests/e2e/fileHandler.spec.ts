import { expect, test } from "@playwright/test";

/**
 * #135 PWA 파일 핸들러.
 *
 * **Finder 목록에 실제로 뜨는지는 여기서 확인할 수 없다** — Launch Services 는 OS
 * 것이고 헤드리스 Chromium 에는 없다. 그 항목은 실기기 수동 확인으로 남긴다.
 *
 * 여기서 보는 것은 두 가지다:
 *   1. 배포 산출물의 매니페스트에 선언이 **실제로 들어갔는가** (빌드 경로)
 *   2. 핸들이 들어왔을 때 앱이 **탭으로 여는가** (배선)
 *
 * **`window.launchQueue` 는 대입으로 갈아끼워지지 않는다.** 플랫폼이 제공하는
 * 속성이라 Chromium 이 자기 것을 되돌려 주고, 대입 직후에는 바뀐 것처럼 보이지만
 * 앱이 읽을 때는 원래 것이 온다 — 그러면 소비자가 영영 불리지 않아 **기능이
 * 멀쩡해도 테스트만 실패한다.** `Object.defineProperty` 로 심어야 한다.
 */

/**
 * 가짜 `launchQueue` 를 심는다 — OPFS 실물 핸들을 넘긴다.
 *
 * **대입이 아니라 `defineProperty` 여야 한다**(위 주석 참조). 그리고 목 핸들이
 * 아니라 진짜 핸들을 쓴다 — `openFileFromHandle` 이 `isSameEntry`·구조화 복제를
 * 쓰므로 가짜로는 같은 경로를 검증하지 못한다(트랩 #78).
 */
function seedLaunchQueue(names: string[]) {
  Object.defineProperty(window, "launchQueue", {
    configurable: true,
    writable: true,
    value: {
      setConsumer(consumer: (p: { files: FileSystemFileHandle[] }) => void) {
        void (async () => {
          const dir = await navigator.storage.getDirectory();
          const handles: FileSystemFileHandle[] = [];
          for (const name of names) {
            const h = await dir.getFileHandle(name, { create: true });
            const w = await h.createWritable();
            await w.write(`# ${name}`);
            await w.close();
            handles.push(h);
          }
          consumer({ files: handles });
        })();
      },
    },
  });
}

test("FH1: 배포된 매니페스트에 file_handlers 가 있다", async ({ page, request }) => {
  await page.goto("/");
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);

  const manifest = await res.json();
  expect(manifest.file_handlers, "매니페스트에 file_handlers 선언이 없다").toBeTruthy();

  const accept = manifest.file_handlers[0].accept;
  const exts = Object.values(accept).flat() as string[];
  // 확장자가 1순위다 — `.md` 의 MIME 은 환경마다 다르다(트랩 #61).
  expect(exts).toContain(".md");
  expect(exts).toContain(".markdown");
  expect(manifest.file_handlers[0].action).toBe("/");
});

test("FH2: launchQueue 로 들어온 파일이 탭으로 열린다", async ({ page }) => {
  // **`goto` 전에 심어야 한다** — 앱이 소비자를 등록할 때 이미 있어야 한다.
  await page.addInitScript(seedLaunchQueue, ["launched.md"]);

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();

  // 세션 복원이 아니라 **파일 열기만이 만드는 변화**를 기다린다 (트랩 #80).
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("launched.md");
  await expect(page.locator("#editor")).toHaveValue("# launched.md");
});

test("FH3: 여러 파일이 들어오면 전부 탭으로 열린다", async ({ page }) => {
  await page.addInitScript(seedLaunchQueue, ["one.md", "two.md"]);

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();

  await expect(page.locator('#tab-bar .tab-name:text-is("one.md")')).toBeVisible();
  await expect(page.locator('#tab-bar .tab-name:text-is("two.md")')).toBeVisible();
});

test("FH4: 열린 파일이 최근 목록에 남는다 — 일반 열기와 같은 경로를 탄다", async ({
  page,
}) => {
  await page.addInitScript(seedLaunchQueue, ["recent-me.md"]);

  await page.goto("/");
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("recent-me.md");

  await page.locator('.toolbar-btn[title="Recent"]').click();
  await expect(
    page.locator('#recent-files-list .recent-name:text-is("recent-me.md")'),
  ).toBeVisible();
});

test("FH5: launchQueue 가 없어도 앱이 정상 동작한다 (Safari·Firefox)", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", { configurable: true, value: undefined });
  });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill("# 평소대로");
  await expect(page.locator("#preview h1")).toHaveText("평소대로");
  expect(errors, `페이지 오류: ${errors.join(", ")}`).toHaveLength(0);
});
