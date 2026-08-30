import { expect, test } from "@playwright/test";

/**
 * F-89 앱 중복 실행 방지 (이슈 #187).
 *
 * `tests/e2e/fileHandler.spec.ts`(#135)가 이미 `launchQueue` 배선의 기본
 * 동작(파일이 탭으로 열린다·여러 파일·최근 목록·미지원 브라우저)을 다룬다.
 * 여기서는 F-89 가 **새로 추가한** 것만 본다:
 *
 *   1. 매니페스트의 `launch_handler.client_mode` 가 `focus-existing` 인가(M-12/M-13)
 *   2. 이미 열린 파일이 `launchQueue` 로 다시 도착하면 새 탭을 만들지 않고
 *      그 탭으로 전환하는가(M-15/AC-18) — 기존 FH 스펙은 이 경로를 다루지 않는다
 *
 * **AC-20(실기기) 은 이 파일로 확인할 수 없다.** 헤드리스 Chromium 에는 macOS
 * Launch Services 도 창 관리자도 없다(트랩 #82) — "새 창이 안 뜨고 기존 창이
 * 앞으로 나오는가" 는 PWA 를 설치한 실기기에서만 볼 수 있다.
 */

/**
 * 가짜 `launchQueue` 를 심는다 — `fileHandler.spec.ts` 의 `seedLaunchQueue()` 와
 * 같은 원칙(대입이 아니라 `defineProperty`, 진짜 OPFS 핸들)이지만, 소비자를
 * **나중에 원하는 시점**에 호출할 수 있도록 콜백을 바깥에 노출한다.
 */
function seedControllableLaunchQueue() {
  let consumer: ((params: { files: FileSystemFileHandle[] }) => void) | null = null;
  Object.defineProperty(window, "launchQueue", {
    configurable: true,
    writable: true,
    value: {
      setConsumer(fn: (params: { files: FileSystemFileHandle[] }) => void) {
        consumer = fn;
      },
    },
  });
  (window as unknown as { __deliverLaunchFiles: (files: FileSystemFileHandle[]) => void }).__deliverLaunchFiles = (
    files,
  ) => consumer?.({ files });
}

async function seedOpfsFile(page: import("@playwright/test").Page, name: string, content: string) {
  await page.evaluate(
    async ({ name, content }) => {
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },
    { name, content },
  );
}

test("E6-1: manifest.webmanifest 의 launch_handler 가 focus-existing 이다 (M-12/M-13/AC-15/AC-16)", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();

  expect(manifest.launch_handler).toBeTruthy();
  expect(manifest.launch_handler.client_mode).toBe("focus-existing");
  expect(manifest.launch_handler.client_mode).not.toBe("navigate-existing");
});

test("E6-2: 이미 열린 파일이 다시 도착하면 새 탭 없이 그 탭으로 전환된다 (M-14/M-15/AC-17/AC-18)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // **goto 전에 심어야 한다** — 앱이 소비자를 등록할 때 이미 있어야 한다.
  await page.addInitScript(seedControllableLaunchQueue);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);

  const deliver = (files: string[]) =>
    page.evaluate(async (names) => {
      const dir = await navigator.storage.getDirectory();
      const handles: FileSystemFileHandle[] = [];
      for (const name of names) {
        handles.push(await dir.getFileHandle(name));
      }
      (window as unknown as { __deliverLaunchFiles: (files: FileSystemFileHandle[]) => void }).__deliverLaunchFiles(
        handles,
      );
    }, files);

  await seedOpfsFile(page, "readme.md", "# 읽어보세요");
  await deliver(["readme.md"]);

  // 파일 열기만이 만드는 변화를 기다린다(트랩 #80) — 탭 개수가 2로 는다.
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("readme.md");
  await expect(page.locator("#editor")).toHaveValue("# 읽어보세요");
  await expect(page.locator("#notice")).toContainText("readme.md");

  // 다른 탭으로 옮겨 둔 뒤, readme.md 를 다시 launchQueue 로 전달한다.
  await page.locator("#tab-bar .tab").first().click();
  await deliver(["readme.md"]);

  await expect(page.locator("#tab-bar .tab")).toHaveCount(2); // 늘지 않는다 (M-15)
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("readme.md");
  expect(consoleErrors).toHaveLength(0);
});
