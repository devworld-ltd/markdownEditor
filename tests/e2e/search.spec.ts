import { expect, test } from "@playwright/test";

/**
 * F-22 문서 내 검색 (이슈 #41).
 *
 * 계산부(`searchEngine.test.ts`)가 경계·겹침·순환을 맡으므로 여기서는
 * **브라우저에서만 확인되는 것**만 본다: `Cmd/Ctrl+F` 가 실제로 가로채지는지,
 * 선택이 textarea 에 실제로 걸리는지, 화면 밖 일치로 **스크롤**되는지.
 */

const BAR = "#search-bar";
const INPUT = "#search-input";

/** 화면을 넘는 문서. 마지막 줄의 일치는 스크롤 없이는 보이지 않는다. */
function longDocument(): string {
  const filler = Array.from({ length: 120 }, (_, i) => `${i}번째 줄 채우기 텍스트`);
  return ["처음에 바늘 하나", ...filler, "마지막에 바늘 하나"].join("\n");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("F1: Cmd/Ctrl+F 가 검색 바를 연다 (브라우저 찾기 대신)", async ({ page }) => {
  await expect(page.locator(BAR)).toBeHidden();

  await page.locator("#editor").click();
  await page.keyboard.press("ControlOrMeta+f");

  await expect(page.locator(BAR)).toBeVisible();
  await expect(page.locator(INPUT)).toBeFocused();
});

test("F2: 일치 개수를 1부터 세어 보여준다", async ({ page }) => {
  await page.locator("#editor").fill("바늘 하나 바늘 둘 바늘 셋");
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");

  await expect(page.locator("#search-count")).toHaveText("1/3");
});

test("F3: 결과가 없으면 그렇게 알린다", async ({ page }) => {
  await page.locator("#editor").fill("건초 더미");
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");

  await expect(page.locator("#search-count")).toHaveText("결과 없음");
  await expect(page.locator(BAR)).toHaveAttribute("data-state", "empty");
});

test("F4: Enter 로 다음, Shift+Enter 로 이전으로 이동하며 끝에서 순환한다", async ({ page }) => {
  await page.locator("#editor").fill("바늘 A 바늘 B 바늘 C");
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");
  await expect(page.locator("#search-count")).toHaveText("1/3");

  await page.keyboard.press("Enter");
  await expect(page.locator("#search-count")).toHaveText("2/3");
  await page.keyboard.press("Enter");
  await expect(page.locator("#search-count")).toHaveText("3/3");

  // 끝에서 멈추면 사용자는 위쪽 일치를 놓친다.
  await page.keyboard.press("Enter");
  await expect(page.locator("#search-count")).toHaveText("1/3");

  await page.keyboard.press("Shift+Enter");
  await expect(page.locator("#search-count")).toHaveText("3/3");
});

test("F5: 찾은 대목이 에디터에 실제로 선택되고, 포커스는 검색창에 남는다", async ({
  page,
}) => {
  await page.locator("#editor").fill("건초 바늘 건초");
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");

  const selection = await page
    .locator("#editor")
    .evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
  expect(selection).toEqual([3, 5]);

  // 포커스를 에디터로 옮기면 Enter 가 본문에 개행을 넣어 방금 찾은 일치를 지운다.
  await expect(page.locator(INPUT)).toBeFocused();
});

test("F5b: 다음/이전 버튼으로 이동해도 선택이 유지된다", async ({ page }) => {
  // 포커스 없는 textarea 의 선택은 클릭 이벤트가 끝나며 브라우저가 되돌린다.
  await page.locator("#editor").fill("건초 바늘 건초 바늘");
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");

  await page.locator("#search-next").click();
  await expect(page.locator("#search-count")).toHaveText("2/2");

  await expect
    .poll(() =>
      page.locator("#editor").evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    )
    .toEqual([9, 11]); // "건초 바늘 건초 바늘" 의 두 번째 "바늘"
});

test("F6: 화면 밖의 일치로 스크롤한다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill(longDocument());
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = 0;
  });

  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("마지막에 바늘");

  // 선택만 하고 스크롤하지 않으면 찾아도 보이지 않는다.
  await expect
    .poll(() => editor.evaluate((el: HTMLTextAreaElement) => el.scrollTop))
    .toBeGreaterThan(100);
});

test("F7: 스크롤 이동에 프리뷰가 따라온다 (F-25 와 어긋나지 않는다)", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill(longDocument());
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = 0;
  });
  await expect(page.locator("#preview")).not.toBeEmpty();

  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("마지막에 바늘");

  await expect
    .poll(() => page.locator("#preview").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});

test("F8: Esc 로 닫히고 포커스가 에디터로 돌아온다", async ({ page }) => {
  await page.locator("#editor").fill("건초 바늘 건초");
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(BAR)).toBeVisible();

  await page.locator(INPUT).fill("바늘");
  await page.keyboard.press("Escape");
  await expect(page.locator(BAR)).toBeHidden();
  await expect(page.locator("#editor")).toBeFocused();

  // 닫는 순간 찾아 둔 선택이 활성 선택이 되어, 그 자리에서 편집을 이어갈 수 있다.
  const selection = await page
    .locator("#editor")
    .evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
  expect(selection).toEqual([3, 5]);
});

test("F9: 선택 영역이 있으면 그것을 질의로 채운다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("건초 바늘 건초 바늘");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 5));

  await page.keyboard.press("ControlOrMeta+f");

  await expect(page.locator(INPUT)).toHaveValue("바늘");
  await expect(page.locator("#search-count")).toHaveText("1/2");
});

test("F10: 본문을 고치면 일치 개수가 따라 바뀐다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("바늘 바늘");
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");
  await expect(page.locator("#search-count")).toHaveText("1/2");

  await editor.click();
  await editor.fill("바늘 바늘 바늘");

  // 캐시해 두면 없는 좌표로 이동하는 사고가 난다.
  await expect(page.locator("#search-count")).toHaveText(/\/3$/);
});

test("F11: 탭을 바꿔도 다른 문서의 좌표로 이동하지 않는다", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.fill("첫 탭에는 바늘 바늘 바늘");

  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(INPUT).fill("바늘");
  await expect(page.locator("#search-count")).toHaveText("1/3");

  // 새 탭은 input 이벤트 없이 editorEl.value 를 바꾼다 — 캐시했다면 3 이 남는다.
  await page.locator('.toolbar-btn[title="New"]').click();
  await page.locator(INPUT).click();
  await page.keyboard.press("Enter");

  await expect(page.locator("#search-count")).toHaveText("결과 없음");
});

test("F12: 안내 목록에 검색 단축키가 나타난다", async ({ page }) => {
  // 단일 출처(shortcutDefs.ts)에 추가했으므로 안내 UI 는 자동 반영돼야 한다.
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();

  const labels = await page.locator("#shortcut-help-list .shortcut-label").allTextContents();
  expect(labels.join(" ")).toContain("문서 내 검색");
});

test("F13: 검색 바가 본문을 가리지 않는다", async ({ page }) => {
  const editorBefore = await page.locator("#editor").boundingBox();
  await page.locator("#editor").click();
  await page.keyboard.press("ControlOrMeta+f");
  const editorAfter = await page.locator("#editor").boundingBox();

  // 모달이면 본문 위에 겹친다. 상단 바는 편집 영역을 밀어낸다.
  expect(editorAfter!.y).toBeGreaterThan(editorBefore!.y);
  expect(editorAfter!.height).toBeLessThan(editorBefore!.height);
});

/**
 * F-22 잔여 — 치환.
 *
 * 단위 테스트가 "삽입을 몇 번 하는가" 를 세지만, **실행 취소가 정말 되는지**는
 * 실제 `execCommand` 가 있는 브라우저에서만 확인된다. jsdom 은 이 API 자체가
 * 없어 주입으로 대체하므로, undo 는 여기서만 증명된다.
 */
test.describe("F-22 잔여: 치환", () => {
  async function openReplace(page: import("@playwright/test").Page, text: string, query: string) {
    await page.locator("#editor").fill(text);
    await page.keyboard.press("ControlOrMeta+f");
    await page.locator(INPUT).fill(query);
    await page.locator("#search-toggle-replace").click();
    await expect(page.locator("#search-replace-row")).toBeVisible();
  }

  test("R1: 치환 행은 기본으로 접혀 있고 토글로 열린다", async ({ page }) => {
    await page.locator("#editor").click();
    await page.keyboard.press("ControlOrMeta+f");

    await expect(page.locator("#search-replace-row")).toBeHidden();
    await expect(page.locator("#search-toggle-replace")).toHaveAttribute("aria-expanded", "false");

    await page.locator("#search-toggle-replace").click();
    await expect(page.locator("#search-replace-row")).toBeVisible();
    await expect(page.locator("#search-toggle-replace")).toHaveAttribute("aria-expanded", "true");
  });

  test("R2: 현재 일치 1건만 바꾼다", async ({ page }) => {
    await openReplace(page, "바늘 A 바늘", "바늘");
    await page.locator("#search-replace-input").fill("실");
    await page.locator("#search-replace-one").click();

    await expect(page.locator("#editor")).toHaveValue("실 A 바늘");
  });

  test("R3: 모두 바꾸기가 전부 바꾼다", async ({ page }) => {
    await openReplace(page, "바늘 A 바늘 B 바늘", "바늘");
    await page.locator("#search-replace-input").fill("실");
    await page.locator("#search-replace-all").click();

    await expect(page.locator("#editor")).toHaveValue("실 A 실 B 실");
  });

  test("R4: 모두 바꾸기가 Cmd+Z 한 번으로 되돌아간다", async ({ page }) => {
    // value 직접 대입이면 undo 스택이 통째로 날아가 되돌릴 수 없다.
    // 부분 치환을 반복하면 3번 눌러야 한다.
    const original = "바늘 A 바늘 B 바늘";
    await openReplace(page, original, "바늘");
    await page.locator("#search-replace-input").fill("실");
    await page.locator("#search-replace-all").click();
    await expect(page.locator("#editor")).toHaveValue("실 A 실 B 실");

    await page.locator("#editor").click();
    await page.keyboard.press("ControlOrMeta+z");

    await expect(page.locator("#editor")).toHaveValue(original);
  });

  test("R5: 1건 치환도 Cmd+Z 로 되돌아간다", async ({ page }) => {
    await openReplace(page, "바늘 A 바늘", "바늘");
    await page.locator("#search-replace-input").fill("실");
    await page.locator("#search-replace-one").click();
    await expect(page.locator("#editor")).toHaveValue("실 A 바늘");

    await page.locator("#editor").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator("#editor")).toHaveValue("바늘 A 바늘");
  });

  test("R6: 치환 결과가 프리뷰에 반영된다", async ({ page }) => {
    await openReplace(page, "# 바늘", "바늘");
    await page.locator("#search-replace-input").fill("실");
    await page.locator("#search-replace-all").click();

    await expect(page.locator("#preview h1")).toHaveText("실");
  });

  test("R7: 치환 후에도 포커스가 본문으로 새지 않는다", async ({ page }) => {
    await openReplace(page, "바늘 바늘", "바늘");
    const replaceInput = page.locator("#search-replace-input");
    await replaceInput.fill("실");
    await page.locator("#search-replace-one").click();

    // 포커스가 에디터에 남으면 다음 타이핑이 본문으로 들어간다.
    await expect(page.locator("#editor")).not.toBeFocused();
  });

  test("R8: 치환이 탭의 dirty 표시를 갱신한다", async ({ page }) => {
    await openReplace(page, "바늘", "바늘");
    await page.locator("#search-replace-input").fill("실");
    await page.locator("#search-replace-all").click();

    // execCommand 는 input 이벤트를 발생시키므로 탭 상태가 따라와야 한다.
    await expect(page.locator("#tab-bar .tab-name")).toHaveText("Untitled *");
  });

  test("R9: 검색을 닫으면 치환 행도 접힌다", async ({ page }) => {
    await openReplace(page, "바늘", "바늘");
    await page.keyboard.press("Escape");

    await expect(page.locator(BAR)).toBeHidden();
    await expect(page.locator("#search-replace-row")).toBeHidden();
  });
});
