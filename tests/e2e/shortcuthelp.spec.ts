import { expect, test } from "@playwright/test";

/**
 * F-58 잔여 — 단축키 안내 UI (이슈 #40).
 *
 * 단위 테스트(`shortcutDefs.test.ts`)가 "정의와 판별이 일치하는가" 를 맡으므로
 * 여기서는 **브라우저에서만 확인할 수 있는 것**만 본다: `<dialog>` 의 모달 동작,
 * 실제 키 이벤트, 포커스 복귀, 그리고 목록이 정의에서 파생되는지.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

const DIALOG = "#shortcut-help";

test("S1: 툴바 버튼으로 단축키 목록을 연다", async ({ page }) => {
  await expect(page.locator(DIALOG)).toBeHidden();

  await page.locator('.toolbar-btn[title="Shortcuts"]').click();

  await expect(page.locator(DIALOG)).toBeVisible();
  await expect(page.locator("#shortcut-help-title")).toHaveText("단축키");

  // 전역 리셋의 `* { margin: 0 }` 이 UA 의 `dialog:modal { margin: auto }` 를
  // 덮어쓰면 다이얼로그가 화면 좌상단에 붙는다. 눈에 띄지만 기능은 동작해서
  // 테스트 없이는 그대로 배포된다.
  const centered = await page.evaluate(() => {
    const rect = document.querySelector("#shortcut-help")!.getBoundingClientRect();
    return {
      leftGap: Math.round(rect.left),
      rightGap: Math.round(window.innerWidth - rect.right),
      topGap: Math.round(rect.top),
    };
  });
  expect(centered.leftGap).toBeGreaterThan(0);
  expect(centered.topGap).toBeGreaterThan(0);
  expect(Math.abs(centered.leftGap - centered.rightGap)).toBeLessThanOrEqual(2);
});

test("S2: Alt+/ 로 열고 다시 눌러 닫는다", async ({ page }) => {
  await page.locator("#editor").click();

  await page.keyboard.press("Alt+Slash");
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.keyboard.press("Alt+Slash");
  await expect(page.locator(DIALOG)).toBeHidden();
});

test("S3: Alt+/ 가 본문에 문자를 남기지 않는다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.click();
  await editor.fill("본문");

  await page.keyboard.press("Alt+Slash");
  await expect(page.locator(DIALOG)).toBeVisible();

  // preventDefault 가 빠지면 '/' 나 '÷' 가 본문에 들어간다.
  await expect(editor).toHaveValue("본문");
});

test("S4: Esc 로 닫히고 포커스가 에디터로 돌아온다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.click();
  await page.keyboard.press("Alt+Slash");
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();

  // 포커스가 허공에 남으면 다음 타이핑이 어디로도 가지 않는다.
  await expect(editor).toBeFocused();
});

test("S5: 닫기 버튼으로도 닫히고 포커스가 돌아온다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.locator("#shortcut-help-close").click();
  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(page.locator("#editor")).toBeFocused();
});

test("S6: 목록이 실제 단축키 전부를 보여준다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();

  const labels = await page.locator("#shortcut-help-list .shortcut-label").allTextContents();
  const joined = labels.join(" ");

  // 정의(shortcutDefs.ts)에 있는 것이 모두 노출돼야 한다.
  for (const expected of [
    "파일 열기",
    "저장",
    "다른 이름으로 저장",
    "문서 내 검색",
    "새 문서",
    "탭 닫기",
    "단축키 목록 열기 / 닫기",
  ]) {
    expect(joined, `"${expected}" 가 목록에 없다`).toContain(expected);
  }

  // 개수를 하드코딩하지 않는다 — 라벨 행과 키 캡 행이 1:1 이면 충분하고,
  // 단축키가 늘 때마다 이 테스트를 손대야 하는 결합을 만들지 않는다.
  await expect(page.locator("#shortcut-help-list .shortcut-keys")).toHaveCount(labels.length);
});

test("S7: 비표준 Alt 조합에 이유가 함께 표시된다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();

  // 이유 없이 특이한 조합만 보여주면 사용자는 앱이 이상하다고 판단한다.
  const notes = await page.locator("#shortcut-help-list .shortcut-note").allTextContents();
  expect(notes.join(" ")).toContain("선점");
  expect(notes.length).toBeGreaterThanOrEqual(2); // 새 문서 · 탭 닫기
});

test("S8: 안내에 적힌 조합이 실제로 동작한다 (⌥N → 새 탭)", async ({ page }) => {
  // 안내와 동작이 어긋나는 것이 이 기능의 핵심 실패 모드다. 목록에서 키 캡을
  // 읽어 그대로 눌러 본다 — 안내를 신뢰할 수 있는지 실물로 확인한다.
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();

  // 순번이 아니라 **라벨로** 찾는다. 단축키가 추가되면 순번은 밀리지만
  // "새 문서" 라는 사실은 변하지 않는다.
  const newDocKeys = await page
    .locator("#shortcut-help-list dt")
    .filter({ has: page.locator("xpath=following-sibling::dd[1][contains(., '새 문서')]") })
    .locator("kbd")
    .allTextContents();

  await page.locator("#shortcut-help-close").click();
  await expect(page.locator(DIALOG)).toBeHidden();

  // 표기가 ⌥/Alt + N 이어야 한다.
  expect(newDocKeys[0]).toMatch(/⌥|Alt/);
  expect(newDocKeys[1]).toBe("N");

  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  await page.locator("#editor").click();
  await page.keyboard.press("Alt+KeyN");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
});

test("S9: 백드롭 클릭으로 닫힌다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();

  // 다이얼로그 바깥(백드롭) 좌표를 클릭한다.
  await page.mouse.click(5, 5);
  await expect(page.locator(DIALOG)).toBeHidden();
});

test("S10: 열려 있는 동안 바깥 요소가 조작되지 않는다 (모달)", async ({ page }) => {
  await page.locator("#editor").fill("원본");
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();
  await expect(page.locator(DIALOG)).toBeVisible();

  // showModal() 이 아니라 show() 를 쓰면 이 타이핑이 에디터로 들어간다.
  await page.keyboard.type("침입");
  await expect(page.locator("#editor")).toHaveValue("원본");
});

/**
 * 테스트 브라우저 UA 는 Windows 라 위 시나리오는 항상 Ctrl/Alt 표기만 지난다.
 * macOS 사용자가 보는 화면은 여기서만 확인된다 — 단위 테스트가 렌더 분기를 맡고,
 * 여기서는 UA → 표기까지의 실제 연결(main.ts 배선 포함)을 본다.
 */
test.describe("macOS 표기", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  });

  test("S11: Apple 계열에서는 ⌘·⌥ 로 표기된다", async ({ page }) => {
    await page.goto("/");
    await page.locator('.toolbar-btn[title="Shortcuts"]').click();

    const caps = await page.locator("#shortcut-help-list kbd").allTextContents();
    expect(caps).toContain("⌘");
    expect(caps).toContain("⌥");
    expect(caps).not.toContain("Ctrl");
  });
});
