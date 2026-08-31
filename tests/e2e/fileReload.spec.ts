import { expect, test, type Page } from "@playwright/test";
import { clickToolbarAction, installFallbackMode, installRealHandleMock } from "./fixtures";

/**
 * F-88 파일 변경 감지 새로고침 (이슈 #187).
 *
 * 핸들이 필요한 시나리오는 반드시 `installRealHandleMock()`(OPFS 실물 핸들)을
 * 쓴다 — `installFsMock()` 의 목 핸들은 `lastModified` 가 진짜가 아니라서
 * 변경 감지를 증명하지 못한다(기술 스펙 D-8 / 트랩 #78).
 *
 * 디스크 쓰기 직후 곧바로 읽으면 스왑 파일 커밋 중간 상태가 보일 수 있다 —
 * 그래서 `expect.poll()` 로 확인한다(트랩 #79, `recentReopen.spec.ts` RS2 와 동일 패턴).
 */

async function writeDisk(page: Page, name: string, content: string): Promise<void> {
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

/**
 * 트랩 #79: 쓰기는 스왑 파일을 거쳐 커밋되므로, 교체되는 찰나에 읽으면
 * `NotFoundError` 가 난다. 던지면 `expect.poll` 이 재시도하지 못하고 즉사하므로
 * null 로 바꿔 폴링이 다음 회차를 돌게 한다 (CI 에서 간헐 실패로 실측).
 */
async function readDisk(page: Page, name: string): Promise<string | null> {
  return page.evaluate(async (name) => {
    try {
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle(name);
      return await (await handle.getFile()).text();
    } catch {
      return null;
    }
  }, name);
}

/** I-1: 창 포커스 복귀 신호. `window.addEventListener("focus", ...)` 를 그대로 발화한다. */
async function refocusWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test.describe("E1: 깨끗한 탭 자동 반영", () => {
  test.beforeEach(async ({ page }) => {
    await installRealHandleMock(page, { "note.md": "# 원본\n\n본문" });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#editor")).toHaveValue("# 원본\n\n본문");
  });

  test("디스크가 바뀌면 포커스 복귀 시 본문이 자동으로 바뀌고 알린다 (M-5/AC-2/AC-6)", async ({
    page,
  }) => {
    await writeDisk(page, "note.md", "# 디스크에서 바뀐 내용\n\n새 본문");
    await refocusWindow(page);

    await expect(page.locator("#editor")).toHaveValue("# 디스크에서 바뀐 내용\n\n새 본문");
    await expect(page.locator("#notice")).toContainText("다시 읽었습니다");
    await expect(page.locator("#preview h1")).toHaveText("디스크에서 바뀐 내용");
    await expect(page.locator("#save-state-text")).toHaveText("저장됨");
  });

  test("mtime 만 바뀌고 내용이 같으면 아무 표시도 하지 않는다 (S-3/AC-12)", async ({ page }) => {
    // 같은 문자열을 다시 써서 mtime 만 올린다.
    await writeDisk(page, "note.md", "# 원본\n\n본문");
    await refocusWindow(page);

    await page.waitForTimeout(300); // 감지 처리 여유
    await expect(page.locator("#editor")).toHaveValue("# 원본\n\n본문");
    await expect(page.locator("#notice")).toBeHidden();
    await expect(page.locator("#reload-banner")).toBeHidden();
  });

  test("5분 방치 — 폴링 없음: 아무 조작 없이는 아무 일도 일어나지 않는다 (M-2/AC-13)", async ({
    page,
  }) => {
    await writeDisk(page, "note.md", "# 디스크에서 바뀐 내용");
    // focus 신호를 주지 않고 시간만 흘려보낸다. 폴링이 있다면 이 사이 반영됐을 것이다.
    await page.waitForTimeout(1500);

    await expect(page.locator("#editor")).toHaveValue("# 원본\n\n본문");
  });
});

test.describe("E2: 더티 탭 보호 — 본문을 지키고 배너로만 알린다", () => {
  test.beforeEach(async ({ page }) => {
    await installRealHandleMock(page, { "note.md": "# 원본" });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#editor")).toHaveValue("# 원본");
  });

  test("더티 탭은 본문이 그대로고 배너·배지만 뜬다 (M-4/AC-3), 포커스도 유지된다 (A-1)", async ({
    page,
  }) => {
    const editor = page.locator("#editor");
    await editor.click();
    await editor.press("End");
    await editor.type("\n내가 쓴 줄");
    await expect(editor).toHaveValue(/내가 쓴 줄/);

    await writeDisk(page, "note.md", "# 남이 바꾼 내용");
    await refocusWindow(page);

    await expect(editor).toHaveValue(/내가 쓴 줄/);
    await expect(editor).not.toHaveValue(/남이 바꾼 내용/);
    await expect(page.locator("#reload-banner")).toBeVisible();
    await expect(page.locator("#reload-banner")).toContainText("note.md");
    await expect(page.locator("#reload-banner")).toContainText("디스크에서 변경되었습니다");
    await expect(page.locator("#reload-banner-reload")).toBeVisible();
    await expect(page.locator("#reload-banner-keep")).toBeVisible();

    const activeTabName = page.locator("#tab-bar .tab.active .tab-name");
    await expect(activeTabName).toHaveAttribute("aria-label", /디스크에서 변경됨/);

    // A-1: 배너가 뜬 뒤에도 포커스가 편집 영역에 남아 있다.
    await expect(editor).toBeFocused();
  });

  test("권한이 prompt 인 조용한 경로에서는 권한 창을 띄우지 않고 아무 표시도 없다 (M-7/AC-9/E-2)", async ({
    page,
  }) => {
    // 트랩 #81 과 같은 성격 — 실물 핸들의 프로토타입 메서드를 갈아끼운다.
    await page.evaluate(() => {
      const proto = (
        window as unknown as { FileSystemFileHandle?: { prototype: FileSystemFileHandle } }
      ).FileSystemFileHandle?.prototype as unknown as
        | { queryPermission?: (...args: unknown[]) => Promise<string> }
        | undefined;
      if (proto) {
        proto.queryPermission = async () => "prompt";
      }
    });

    const editor = page.locator("#editor");
    await editor.click();
    await editor.type(" 더티");

    await writeDisk(page, "note.md", "# 남이 바꾼 내용");
    await refocusWindow(page);
    await page.waitForTimeout(300);

    await expect(page.locator("#reload-banner")).toBeHidden();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.waitForTimeout(100);
    expect(consoleErrors).toHaveLength(0);
  });
});

test.describe("E3: 더티 탭에서 재읽기 확정 — 되돌릴 수 없는 동작의 확인 절차", () => {
  test.beforeEach(async ({ page }) => {
    await installRealHandleMock(page, { "note.md": "# 원본" });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator('.toolbar-btn[title="Open"]').click();

    const editor = page.locator("#editor");
    await editor.click();
    await editor.press("End");
    await editor.type("\n내가 쓴 줄");

    await writeDisk(page, "note.md", "# 남이 바꾼 내용");
    await refocusWindow(page);
    await expect(page.locator("#reload-banner")).toBeVisible();
  });

  test("취소하면 배너가 남고 본문도 그대로다 — 확정하면 디스크 내용으로 바뀐다 (AC-4/AC-5)", async ({
    page,
  }) => {
    await page.locator("#reload-banner-reload").click();
    const dialog = page.locator("#reload-dialog");
    await expect(dialog).toBeVisible();
    // D-6: 기본 포커스는 취소.
    await expect(page.locator("#reload-dialog-cancel")).toBeFocused();

    await page.locator("#reload-dialog-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#editor")).toHaveValue(/내가 쓴 줄/);
    await expect(page.locator("#reload-banner")).toBeVisible(); // 배너 유지

    await page.locator("#reload-banner-reload").click();
    await expect(dialog).toBeVisible();
    await page.locator("#reload-dialog-ok").click();

    await expect(page.locator("#editor")).toHaveValue("# 남이 바꾼 내용");
    await expect(page.locator("#editor")).not.toHaveValue(/내가 쓴 줄/);
    await expect(page.locator("#reload-banner")).toBeHidden();
    await expect(page.locator("#save-state-text")).toHaveText("저장됨");
  });

  test("Esc 로 닫으면 취소와 같이 동작한다", async ({ page }) => {
    await page.locator("#reload-banner-reload").click();
    await expect(page.locator("#reload-dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#reload-dialog")).toBeHidden();
    await expect(page.locator("#editor")).toHaveValue(/내가 쓴 줄/);
  });
});

test.describe("E4: 저장 충돌 경고 — 모르는 사이 디스크를 덮어쓰지 않는다", () => {
  test.beforeEach(async ({ page }) => {
    await installRealHandleMock(page, { "note.md": "# 원본" });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator('.toolbar-btn[title="Open"]').click();

    const editor = page.locator("#editor");
    await editor.click();
    await editor.press("End");
    await editor.type("\n내가 쓴 줄");

    await writeDisk(page, "note.md", "# 남이 바꾼 내용");
    await refocusWindow(page);
    await expect(page.locator("#reload-banner")).toBeVisible();
    await page.locator("#reload-banner-keep").click();
    await expect(page.locator("#reload-banner")).toBeHidden();
  });

  test("취소하면 디스크가 보존되고, 덮어쓰면 저장되며 경고가 해소된다 (AC-11)", async ({
    page,
  }) => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    const conflict = page.locator("#save-conflict-dialog");
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText("디스크에서 변경되었습니다");
    await expect(page.locator("#save-conflict-cancel")).toBeFocused();

    await page.locator("#save-conflict-cancel").click();
    await expect(conflict).toBeHidden();
    await expect.poll(() => readDisk(page, "note.md")).toBe("# 남이 바꾼 내용");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(conflict).toBeVisible();
    await page.locator("#save-conflict-overwrite").click();

    await expect.poll(() => readDisk(page, "note.md")).toContain("내가 쓴 줄");
    const activeTabName = page.locator("#tab-bar .tab.active .tab-name");
    await expect(activeTabName).not.toHaveAttribute("aria-label", /디스크에서 변경됨/);
  });

  test("파일이 삭제되면 재읽기는 탭 내용을 지키고 오류만 알린다 (E-1)", async ({ page }) => {
    await page.evaluate(async () => {
      const dir = await navigator.storage.getDirectory();
      await dir.removeEntry("note.md");
    });

    const before = await page.locator("#editor").inputValue();
    await clickToolbarAction(page, "Reload");

    await expect(page.locator("#notice")).toContainText("찾을 수 없습니다");
    await expect(page.locator("#editor")).toHaveValue(before);
  });
});

test.describe("E5: 수동 진입점과 폴백 브라우저 안내", () => {
  test("폴백 모드에서는 Reload 버튼이 비활성이고 이유를 안내한다 (M-9/AC-7)", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await installFallbackMode(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    const reloadBtn = page.locator("#toolbar-reload");
    await expect(reloadBtn).toHaveAttribute("aria-disabled", "true");

    // aria-disabled 는 시각·의미상의 표시일 뿐 실제 클릭은 여전히 된다(M-9) —
    // Playwright 는 aria-disabled="true" 를 "비활성"으로 보고 기본 클릭을
    // 거부하므로 강제한다(swupdate.spec.ts 와 같은 패턴).
    await reloadBtn.click({ force: true });
    await expect(page.locator("#notice")).toContainText("핸들이 없어");
    expect(consoleErrors).toHaveLength(0);
  });

  test("정상 모드 — 변경이 없으면 최신 상태 알림, Alt+R 도 같은 동작을 한다", async ({ page }) => {
    await installRealHandleMock(page, { "note.md": "# 원본" });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#toolbar-reload")).toHaveAttribute("aria-disabled", "false");

    await clickToolbarAction(page, "Reload");
    await expect(page.locator("#notice")).toContainText("최신 상태입니다");
    await expect(page.locator("#reload-banner")).toBeHidden();

    await page.locator("#editor").click();
    await page.keyboard.press("Alt+r");
    await expect(page.locator("#notice")).toContainText("최신 상태입니다");
  });

  test("단축키 도움말에 다시 읽기 항목이 보인다 (트랩 #24 — 단일 출처에서 자동 반영)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await clickToolbarAction(page, "Shortcuts");
    await expect(page.locator("#shortcut-help-list")).toContainText("디스크에서 다시 읽기");
  });

  test("네트워크 0건 — 공유를 쓰지 않는 흐름 전체에서 /api/ 요청이 나가지 않는다 (SH8 과 같은 방식)", async ({
    page,
  }) => {
    // SH8(share.spec.ts) 와 같은 방식 — 이 앱에서 유일한 네트워크 예외는 F-60
    // 공유(/api/) 뿐이다. 문서 로드에 쓰이는 정적 자산 요청은 대상이 아니다.
    const apiRequests: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith("/api/")) apiRequests.push(r.url());
    });

    await installRealHandleMock(page, { "note.md": "# 원본" });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator('.toolbar-btn[title="Open"]').click();
    await clickToolbarAction(page, "Reload");
    await expect(page.locator("#notice")).toContainText("최신 상태입니다");

    expect(apiRequests).toEqual([]);
  });
});
