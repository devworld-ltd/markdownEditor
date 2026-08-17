import { test, expect } from "@playwright/test";
import { clickToolbarAction, getWrites, installFallbackMode, installFsMock, setFsMock } from "./fixtures";

test.describe("File System Access API 경로 (Chrome·Edge)", () => {
  test.beforeEach(async ({ page }) => {
    await installFsMock(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("지원 여부가 body 데이터 속성에 표시된다", async ({ page }) => {
    await expect(page.locator("body")).toHaveAttribute("data-fs-access", "true");
  });

  test("Open 버튼이 파일을 새 탭으로 연다", async ({ page }) => {
    await setFsMock(page, { openName: "spec.md", contents: { "spec.md": "# 스펙" } });
    await page.locator('.toolbar-btn[title="Open"]').click();

    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("spec.md");
    await expect(page.locator("#editor")).toHaveValue("# 스펙");
    await expect(page.locator("#preview h1")).toHaveText("스펙");
    await expect(page).toHaveTitle("spec.md");
  });

  test("같은 파일을 다시 열면 새 탭 대신 기존 탭으로 전환한다", async ({ page }) => {
    await setFsMock(page, { openName: "a.md", contents: { "a.md": "A" } });
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

    await setFsMock(page, { openName: "b.md", contents: { "b.md": "B" } });
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#tab-bar .tab")).toHaveCount(3);

    await setFsMock(page, { openName: "a.md" });
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#tab-bar .tab")).toHaveCount(3);
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("a.md");
  });

  test("미저장 문서 저장은 저장 위치를 물은 뒤 기록한다", async ({ page }) => {
    await setFsMock(page, { saveName: "새문서.md" });
    await page.locator("#editor").fill("# 새 문서");
    await page.keyboard.press("ControlOrMeta+s");

    await expect.poll(() => getWrites(page)).toEqual([
      { name: "새문서.md", content: "# 새 문서" },
    ]);
    await expect(page.locator("#tab-bar .tab-name")).toHaveText("새문서.md");
    await expect(page.locator("#notice")).toContainText("새문서.md 에 저장했습니다");
  });

  test("핸들이 있는 문서는 대화상자 없이 덮어쓴다", async ({ page }) => {
    await setFsMock(page, { openName: "doc.md", contents: { "doc.md": "원본" } });
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#editor")).toHaveValue("원본");

    await page.locator("#editor").fill("수정본");
    await page.keyboard.press("ControlOrMeta+s");

    await expect.poll(() => getWrites(page)).toEqual([
      { name: "doc.md", content: "수정본" },
    ]);
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("doc.md");
  });

  test("저장 후 dirty 마커가 사라진다", async ({ page }) => {
    await setFsMock(page, { saveName: "x.md" });
    await page.locator("#editor").fill("내용");
    await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");

    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator("#tab-bar .tab-name")).toHaveText("x.md");
    await expect(page).toHaveTitle("x.md");
  });

  test("Save As 는 핸들이 있어도 새 위치를 묻는다", async ({ page }) => {
    await setFsMock(page, { openName: "doc.md", contents: { "doc.md": "본문" } });
    await page.locator('.toolbar-btn[title="Open"]').click();

    await setFsMock(page, { saveName: "사본.md" });
    await clickToolbarAction(page, "Save As");

    await expect.poll(() => getWrites(page)).toEqual([
      { name: "사본.md", content: "본문" },
    ]);
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("사본.md");
  });

  test("Shift+Cmd+S 단축키가 Save As 를 호출한다", async ({ page }) => {
    await setFsMock(page, { saveName: "shortcut.md" });
    await page.locator("#editor").fill("단축키 저장");
    await page.keyboard.press("ControlOrMeta+Shift+s");

    await expect.poll(() => getWrites(page)).toEqual([
      { name: "shortcut.md", content: "단축키 저장" },
    ]);
  });

  test("대화상자를 취소하면 아무 일도 일어나지 않는다", async ({ page }) => {
    await setFsMock(page, { cancel: true });
    await page.locator('.toolbar-btn[title="Open"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
    await expect(page.locator("#notice")).toBeHidden();
  });

  test("쓰기 실패는 사용자에게 오류로 표시된다", async ({ page }) => {
    await setFsMock(page, { saveName: "denied.md", failWrite: true });
    await page.locator("#editor").fill("저장 실패할 내용");
    await page.keyboard.press("ControlOrMeta+s");

    const notice = page.locator("#notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("data-kind", "error");
    await expect(notice).toContainText("저장하지 못했습니다");
    // 실패했으므로 dirty 마커는 유지되어야 한다.
    await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
  });
});

test.describe("폴백 경로 (Safari·Firefox)", () => {
  test.beforeEach(async ({ page }) => {
    await installFallbackMode(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("미지원 여부가 body 데이터 속성에 표시된다", async ({ page }) => {
    await expect(page.locator("body")).toHaveAttribute("data-fs-access", "false");
  });

  test("Open 은 숨김 file input 을 사용한다", async ({ page }) => {
    const input = page.locator("#file-input");
    await expect(input).toBeHidden();
    await expect(input).toHaveAttribute("type", "file");
  });

  test("업로드한 파일이 새 탭으로 열린다", async ({ page }) => {
    await page.locator("#file-input").setInputFiles({
      name: "uploaded.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 업로드됨", "utf-8"),
    });

    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText(
      "uploaded.md",
    );
    await expect(page.locator("#editor")).toHaveValue("# 업로드됨");
    await expect(page.locator("#preview h1")).toHaveText("업로드됨");
  });

  test("저장은 파일 다운로드로 대체된다", async ({ page }) => {
    await page.locator("#editor").fill("내려받을 내용");

    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("Untitled.md");
    await expect(page.locator("#notice")).toContainText("내려받았습니다");
    await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled.md");
  });

  test("파일명이 있으면 확장자를 유지해 내려받는다", async ({ page }) => {
    await page.locator("#file-input").setInputFiles({
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("본문", "utf-8"),
    });
    await expect(page.locator("#editor")).toHaveValue("본문");

    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("note.md");
  });
});

test.describe("F-58 브라우저별 기능 한계 안내 (폴백 경로 전용)", () => {
  test.beforeEach(async ({ page }) => {
    await installFallbackMode(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("앱 진입 직후에는 안내가 뜨지 않는다 — 저장을 시도할 때까지는 조용하다", async ({
    page,
  }) => {
    await expect(page.locator("#fs-limit-notice")).toBeHidden();
  });

  test("첫 저장 시도에 브라우저 한계를 안내한다", async ({ page }) => {
    await page.locator("#editor").fill("내려받을 내용");

    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    await downloadPromise;

    const notice = page.locator("#fs-limit-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("덮어쓸 수 없어");
    // 저장 성공 토스트(#notice)도 그대로 뜬다 — 서로 다른 요소라 겹쳐 써지지 않는다.
    await expect(page.locator("#notice")).toContainText("내려받았습니다");
  });

  test("두 번째 저장부터는 다시 뜨지 않는다(세션당 1회)", async ({ page }) => {
    await page.locator("#editor").fill("첫 번째 저장");
    const firstDownload = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    await firstDownload;

    await page
      .locator("#fs-limit-notice-dismiss")
      .click();
    await expect(page.locator("#fs-limit-notice")).toBeHidden();

    await page.locator("#editor").fill("두 번째 저장");
    const secondDownload = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    await secondDownload;

    await expect(page.locator("#fs-limit-notice")).toBeHidden();
  });

  test("확인 버튼으로 안내를 닫을 수 있다", async ({ page }) => {
    await page.locator("#editor").fill("내용");
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    await downloadPromise;

    const notice = page.locator("#fs-limit-notice");
    await expect(notice).toBeVisible();

    await page.locator("#fs-limit-notice-dismiss").click();
    await expect(notice).toBeHidden();
  });
});

test.describe("F-58 — Chrome·Edge 경로에서는 안 보인다", () => {
  test.beforeEach(async ({ page }) => {
    await installFsMock(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("File System Access API 지원 브라우저에서는 저장해도 안내가 뜨지 않는다", async ({
    page,
  }) => {
    await setFsMock(page, { saveName: "새문서.md" });
    await page.locator("#editor").fill("# 새 문서");
    await page.keyboard.press("ControlOrMeta+s");

    await expect.poll(() => getWrites(page)).toEqual([
      { name: "새문서.md", content: "# 새 문서" },
    ]);
    await expect(page.locator("#fs-limit-notice")).toBeHidden();
    // DOM 에 아예 표시되지 않아야 한다는 요구를 강하게 검증한다 — hidden 속성 유지 확인.
    await expect(page.locator("#fs-limit-notice")).toHaveAttribute("hidden", "");
  });
});
