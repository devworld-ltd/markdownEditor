import { expect, test } from "@playwright/test";
import { installRealHandleMock, setRealMockOpenName } from "./fixtures";

/**
 * #125 — 최근 목록에서 고르면 **새로고침 뒤에도** 파일이 바로 열린다.
 *
 * 여기서 쓰는 핸들은 목이 아니라 OPFS 의 **진짜 `FileSystemFileHandle`** 이다.
 * 이 기능의 전제가 "브라우저가 핸들을 IndexedDB 에 복제·복원한다" 이므로,
 * 그 전제를 가짜 객체로 확인하면 통과해도 아무것도 증명하지 못한다.
 */

const BTN = '.toolbar-btn[title="Recent"]';
const ROW = "#recent-files-list .recent-row";

test.beforeEach(async ({ page }) => {
  await installRealHandleMock(page, { "note.md": "# 보관된 문서" });
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("RS0: 브라우저가 진짜 파일 핸들을 IndexedDB 에 보관·복원한다", async ({ page }) => {
  // 이 단언이 이 기능 전체의 전제다. 깨지면 나머지는 볼 것도 없다.
  const before = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle("probe.md", { create: true });
    const w = await handle.createWritable();
    await w.write("# 왕복");
    await w.close();

    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("probe-db", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("s");
      open.onsuccess = () => {
        const tx = open.result.transaction("s", "readwrite");
        tx.objectStore("s").put(handle, "k");
        tx.oncomplete = () => (open.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    return handle.name;
  });
  expect(before).toBe("probe.md");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  const after = await page.evaluate(async () => {
    const handle = await new Promise<FileSystemFileHandle>((resolve, reject) => {
      const open = indexedDB.open("probe-db", 1);
      open.onsuccess = () => {
        const req = open.result.transaction("s", "readonly").objectStore("s").get("k");
        req.onsuccess = () => (open.result.close(), resolve(req.result));
        req.onerror = () => reject(req.error);
      };
      open.onerror = () => reject(open.error);
    });
    // 되살아난 핸들로 **실제 내용**을 읽는다 — 이름만 맞고 못 읽으면 소용없다.
    return { name: handle.name, text: await (await handle.getFile()).text() };
  });
  expect(after).toEqual({ name: "probe.md", text: "# 왕복" });
});

test("RS1: 새로고침해도 목록에서 고르면 바로 열린다 — 선택 창이 뜨지 않는다", async ({
  page,
}) => {
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#editor")).toHaveValue("# 보관된 문서");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  // 세션 복원이 **내용을 되살려 놓기 때문에**, 화면에 글이 있다는 것만으로는
  // 파일을 열었는지 알 수 없다. 다른 글로 바꿔 두고 원본이 돌아오는지 본다.
  await page.locator("#editor").fill("# 전혀 다른 내용");
  await expect(page.locator("#editor")).toHaveValue("# 전혀 다른 내용");

  // 선택 창이 열리면 실패시킨다 — 이 기능은 "선택 창을 안 띄우는 것" 이 전부다.
  await page.evaluate(() => {
    window.showOpenFilePicker = async () => {
      throw new Error("선택 창이 열렸다 — 보관된 핸들을 쓰지 않았다");
    };
  });

  await page.locator(BTN).click();
  await expect(page.locator(ROW)).toHaveAttribute("data-state", "stored");
  await page.locator("#recent-files-list .recent-open").click();

  await expect(page.locator("#editor")).toHaveValue("# 보관된 문서");
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("note.md");
});

test("RS2: 되살린 파일에 그대로 저장된다 — 읽기 권한만 받으면 여기서 막힌다", async ({
  page,
}) => {
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#editor")).toHaveValue("# 보관된 문서");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  const tabsBefore = await page.locator("#tab-bar .tab").count();

  await page.locator(BTN).click();
  // 보관 목록은 IndexedDB 라 비동기다 — 상태가 붙기 전에 누르면 옛 경로로 간다.
  await expect(page.locator(ROW)).toHaveAttribute("data-state", "stored");
  await page.locator("#recent-files-list .recent-open").click();

  // **내용으로 기다리면 안 된다** — 세션이 복원해 둔 탭이 이미 같은 글을 보여주고
  // 있어서 조건이 곧바로 참이 된다. 그 상태에서 고쳐 쓰면 새 탭이 뜨며 덮어써,
  // 저장되는 것은 옛 내용이다(실측: 이 단언 없이 5회 중 2회 실패).
  await expect(page.locator("#tab-bar .tab")).toHaveCount(tabsBefore + 1);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("note.md");
  await expect(page.locator("#editor")).toHaveValue("# 보관된 문서");

  await page.locator("#editor").fill("# 고쳐 씀");
  await page.locator('.toolbar-btn[title="Save"]').click();
  await expect(page.locator("#notice")).toBeVisible();

  // **한 번만 읽으면 안 된다.** 쓰기는 스왑 파일을 거쳐 커밋되므로, 알림이 뜬
  // 직후에 읽으면 새 내용 뒤에 옛 꼬리가 남은 중간 상태가 보인다(실측: 5회 중 2회).
  // 트랩 #43(클립보드 E2E)과 같은 성격이다.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const dir = await navigator.storage.getDirectory();
        return (await (await dir.getFileHandle("note.md")).getFile()).text();
      }),
    )
    .toBe("# 고쳐 씀");
});

test("RS3: 목록에서 지우면 보관된 핸들도 사라진다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#editor")).toHaveValue("# 보관된 문서");

  await page.locator(BTN).click();
  await page.locator("#recent-files-list .recent-remove").click();
  await expect(page.locator(ROW)).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const open = indexedDB.open("markdown-editor-handles", 1);
            open.onsuccess = () => {
              const req = open.result
                .transaction("handles", "readonly")
                .objectStore("handles")
                .getAllKeys();
              req.onsuccess = () =>
                (open.result.close(), resolve(req.result as string[]));
            };
            open.onerror = () => resolve([]);
          }),
      ),
    )
    .toEqual([]);
});

test("RS4: 보관된 핸들에도 문서 내용은 들어가지 않는다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#editor")).toHaveValue("# 보관된 문서");
  await page.locator("#editor").fill("# 비밀 문서 내용");
  await page.waitForTimeout(300);

  const dump = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open("markdown-editor-handles", 1);
        open.onsuccess = () => {
          const req = open.result
            .transaction("handles", "readonly")
            .objectStore("handles")
            .getAll();
          req.onsuccess = () => {
            // 핸들은 JSON 이 되지 않으므로 키 이름만 훑는다.
            const keys = req.result.flatMap((h: object) => Object.keys(h ?? {}));
            open.result.close();
            resolve(keys.join(","));
          };
        };
        open.onerror = () => resolve("");
      }),
  );
  expect(dump).not.toContain("비밀");
  expect(dump.toLowerCase()).not.toContain("content");
});
