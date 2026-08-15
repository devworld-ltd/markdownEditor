import { expect, test } from "@playwright/test";
import { installFallbackMode, installFsMock, setFsMock } from "./fixtures";

/**
 * F-36 최근 파일 목록 (이슈 #64).
 *
 * 계산과 렌더는 단위 테스트가 맡는다. 여기서는 **파일 I/O 와의 연결**과
 * 핸들 수명(트랩 #6)이 실제로 어떻게 드러나는지 본다.
 */

const BTN = '.toolbar-btn[title="Recent"]';
const DIALOG = "#recent-files";

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

async function openMock(page: import("@playwright/test").Page, name: string) {
  await setFsMock(page, { openName: name, contents: { [name]: `# ${name}` } });
  await page.locator('.toolbar-btn[title="Open"]').click();
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText(name);
}

test("R1: 파일을 열면 최근 목록에 남는다", async ({ page }) => {
  await openMock(page, "a.md");
  await openMock(page, "b.md");

  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();

  const names = await page.locator("#recent-files-list .recent-name").allTextContents();
  expect(names).toEqual(["b.md", "a.md"]); // 최신이 위
});

test("R2: 같은 파일을 다시 열어도 중복되지 않는다", async ({ page }) => {
  await openMock(page, "a.md");
  await openMock(page, "b.md");
  await openMock(page, "a.md");

  await page.locator(BTN).click();
  const names = await page.locator("#recent-files-list .recent-name").allTextContents();
  expect(names).toEqual(["a.md", "b.md"]);
});

test("R3: 목록에서 고르면 그 문서로 간다 (같은 세션)", async ({ page }) => {
  await openMock(page, "a.md");
  await openMock(page, "b.md");
  await expect(page.locator("#editor")).toHaveValue("# b.md");

  await page.locator(BTN).click();
  await page.locator("#recent-files-list .recent-open", { hasText: "a.md" }).click();

  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(page.locator("#editor")).toHaveValue("# a.md");
});

test("R4: 이미 열려 있는 문서를 고르면 그 탭으로 전환된다", async ({ page }) => {
  await openMock(page, "a.md");
  await openMock(page, "b.md");
  const tabsBefore = await page.locator("#tab-bar .tab").count();

  await page.locator(BTN).click();
  await page.locator("#recent-files-list .recent-open", { hasText: "a.md" }).click();

  // 중복 탭이 생기면 안 된다 — 일반 열기와 같은 경로를 써야 하는 이유다.
  await expect(page.locator("#tab-bar .tab")).toHaveCount(tabsBefore);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("a.md");
});

test("R5: 핸들을 보관할 수 없으면 새로고침 뒤 '다시 선택 필요' 로 바뀐다", async ({ page }) => {
  // #125 로 핸들은 IndexedDB 에 보관된다. 다만 **여기 목 핸들은 메서드를 가진
  // 평범한 객체라 구조화 복제가 안 되므로**(DataCloneError) 보관되지 않는다 —
  // 보관이 불가능한 브라우저·상황과 같은 경로다. 진짜 핸들의 보관·복원은
  // `recentReopen.spec.ts` 가 OPFS 실물 핸들로 검증한다.
  //
  // 이 한계를 숨기면 사용자는 목록을 눌렀는데 선택 창이 뜨는 것을 버그로 받아들인다.
  await openMock(page, "a.md");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  await page.locator(BTN).click();
  await expect(page.locator("#recent-files-list .recent-name")).toHaveText("a.md");
  await expect(page.locator("#recent-files-list .recent-meta")).toHaveText("다시 선택 필요");
  await expect(page.locator("#recent-files-list .recent-row")).toHaveAttribute(
    "data-live",
    "false",
  );
});

test("R6: 끊긴 항목을 고르면 이유를 알리고 선택 창을 연다", async ({ page }) => {
  await openMock(page, "a.md");
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  await setFsMock(page, { openName: "a.md", contents: { "a.md": "# a.md" } });
  await page.locator(BTN).click();
  await page.locator("#recent-files-list .recent-open").click();

  await expect(page.locator("#notice")).toBeVisible();
  // #125 이후 안내가 바뀌었다 — "권한이 유지되지 않는다" 는 더 이상 사실이 아니다.
  await expect(page.locator("#notice")).toContainText("파일 위치를 알 수 없습니다");
  // 선택 창(목)이 열려 실제로 파일이 열린다.
  await expect(page.locator("#editor")).toHaveValue("# a.md");
});

test("R7: 목록에서 항목을 지운다", async ({ page }) => {
  await openMock(page, "a.md");
  await openMock(page, "b.md");

  await page.locator(BTN).click();
  await page.locator("#recent-files-list .recent-remove").first().click();

  await expect(page.locator("#recent-files-list .recent-name")).toHaveText("a.md");
});

test("R8: 목록이 새로고침 후에도 유지된다", async ({ page }) => {
  await openMock(page, "a.md");
  await openMock(page, "b.md");

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  await page.locator(BTN).click();
  const names = await page.locator("#recent-files-list .recent-name").allTextContents();
  expect(names).toEqual(["b.md", "a.md"]);
});

test("R9: 문서 내용은 저장하지 않는다", async ({ page }) => {
  // localStorage 용량은 세션 문서가 이미 쓰고 있다. 최근 목록까지 내용을 들면
  // 자동 저장이 먼저 죽는다.
  await openMock(page, "a.md");

  const raw = await page.evaluate(() => localStorage.getItem("markdown-editor:recent:v1"));
  expect(raw).toBeTruthy();
  expect(raw).not.toContain("# a.md");
  expect(JSON.parse(raw!)).toEqual([{ name: "a.md", at: expect.any(Number) }]);
});

test("R10: 세션·레이아웃과 다른 키를 쓴다", async ({ page }) => {
  await openMock(page, "a.md");
  // 세션 저장은 디바운스(500ms)라 곧바로 쓰이지 않는다.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).sort()))
    .toEqual(expect.arrayContaining([
      "markdown-editor:recent:v1",
      "markdown-editor:session:v1",
    ]));
});

test("R11: 손상된 목록이 있어도 앱이 정상적으로 뜬다", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("markdown-editor:recent:v1", '[{"name":"ok.md","at":1},null,42,"x"]');
  });
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();

  await page.locator(BTN).click();
  // 손상된 항목만 버리고 나머지는 살린다.
  await expect(page.locator("#recent-files-list .recent-name")).toHaveText("ok.md");
});

test.describe("폴백 브라우저", () => {
  test.beforeEach(async ({ page }) => {
    await installFallbackMode(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("R12: 핸들이 없는 브라우저에서도 목록은 쌓이고, 항상 '다시 선택 필요' 다", async ({
    page,
  }) => {
    await page.locator("#editor").fill("내용");
    const download = page.waitForEvent("download");
    await page.locator('.toolbar-btn[title="Save As"]').click();
    await download;

    await page.locator(BTN).click();
    await expect(page.locator("#recent-files-list .recent-name")).toHaveText("Untitled.md");
    await expect(page.locator("#recent-files-list .recent-meta")).toHaveText("다시 선택 필요");
  });
});
