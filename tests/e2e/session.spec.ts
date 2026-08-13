import { test, expect } from "@playwright/test";
import { installFsMock, setFsMock } from "./fixtures";

const STORAGE_KEY = "markdown-editor:session:v1";

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("편집 내용이 localStorage 에 자동 저장된다", async ({ page }) => {
  await page.locator("#editor").fill("# 자동 저장 확인");

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("자동 저장 확인");
});

test("새로고침 후 편집 중이던 내용이 복원된다", async ({ page }) => {
  await page.locator("#editor").fill("# 복원될 문서");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("복원될 문서");

  await page.reload();

  await expect(page.locator("#editor")).toHaveValue("# 복원될 문서");
  await expect(page.locator("#preview h1")).toHaveText("복원될 문서");
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
});

test("여러 탭과 활성 탭 위치가 함께 복원된다", async ({ page }) => {
  await page.locator("#editor").fill("첫 탭");

  await setFsMock(page, { openName: "second.md", contents: { "second.md": "둘째 탭" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("둘째 탭");

  await page.reload();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("second.md");
  await expect(page.locator("#editor")).toHaveValue("둘째 탭");

  await page.locator("#tab-bar .tab").first().click();
  await expect(page.locator("#editor")).toHaveValue("첫 탭");
});

test("복원된 탭은 파일 핸들이 없어 저장 시 위치를 다시 묻는다", async ({ page }) => {
  await setFsMock(page, { openName: "doc.md", contents: { "doc.md": "본문" } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#editor")).toHaveValue("본문");

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toContain("doc.md");

  await page.reload();
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("doc.md");

  // 핸들이 없으므로 showSaveFilePicker 경로(saveName)로 저장된다.
  await setFsMock(page, { saveName: "재선택.md" });
  await page.locator("#editor").fill("수정");
  await page.keyboard.press("ControlOrMeta+s");

  await expect
    .poll(() => page.evaluate(() => window.__fsMock!.writes))
    .toEqual([{ name: "재선택.md", content: "수정" }]);
});

test("저장된 세션이 없으면 빈 Untitled 탭으로 시작한다", async ({ page }) => {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled");
  await expect(page.locator("#editor")).toHaveValue("");
});

test("손상된 세션 데이터는 무시하고 정상 기동한다", async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, "{ 깨진 JSON"), STORAGE_KEY);

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.reload();

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await expect(page.locator("#editor")).toBeVisible();
  expect(errors).toEqual([]);
});

/**
 * F-54 잔여 — 용량 초과 시 회수 (이슈 #84).
 *
 * 실제 5MB 한도를 채우면 테스트가 느리고 브라우저마다 다르므로, 세션 키 저장에만
 * 크기 상한을 씌워 QuotaExceededError 를 재현한다.
 */
async function capSessionStorage(
  page: import("@playwright/test").Page,
  limit: number,
  seed?: unknown,
) {
  await page.addInitScript(
    ({ limit, seed }) => {
      const proto = Object.getPrototypeOf(window.localStorage) as Storage;
      const original = proto.setItem;
      // 세션 심기는 문서 시작 시점에 해야 한다. 나중에 심고 reload 하면 이전
      // 페이지의 beforeunload 저장이 그 위를 덮어써 복원할 것이 사라진다.
      if (seed) original.call(window.localStorage, "markdown-editor:session:v1", JSON.stringify(seed));
      proto.setItem = function (key: string, value: string) {
        if (key.startsWith("markdown-editor:session") && value.length > limit) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
    },
    { limit, seed },
  );
}

test("SR1: 공간이 부족하면 다시 열 수 있는 탭을 회수하고 자동 저장을 이어간다", async ({
  page,
}) => {
  await capSessionStorage(page, 600, {
    version: 1,
    activeTabId: "tab-2",
    tabs: [
      { id: "tab-1", fileName: "큰.md", content: "x".repeat(800), isDirty: false },
      { id: "tab-2", fileName: "Untitled", content: "", isDirty: false },
    ],
  });
  await page.goto("/");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  // 편집하면 자동 저장이 돌고, 그 저장은 회수를 거쳐 성공해야 한다.
  await page.locator("#editor").fill("새 글");
  await expect(page.locator("#notice")).toContainText("큰.md");
  await expect(page.locator("#notice")).toContainText("편집 중인 내용은 그대로");

  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("markdown-editor:session:v1")!) as {
        tabs: Array<{ fileName: string; content: string }>;
      },
  );
  expect(stored.tabs.find((t) => t.fileName === "큰.md")!.content).toBe("");
  // 편집 중인 탭의 내용은 저장돼야 한다 — 그러려고 회수한 것이다.
  expect(stored.tabs.find((t) => t.fileName === "Untitled")!.content).toBe("새 글");

  // 탭은 닫히지 않는다 — 사용자가 열어 둔 것이다.
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
});

test("SR2: 회수해도 안 되면 기존 실패 알림이 뜬다", async ({ page }) => {
  await capSessionStorage(page, 50);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();

  await page.locator("#editor").fill("x".repeat(200));
  await expect(page.locator("#notice")).toContainText("저장 공간이 부족");
});
