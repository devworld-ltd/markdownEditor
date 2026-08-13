import { expect, test } from "@playwright/test";
import { installFsMock, setFsMock } from "./fixtures";

/**
 * F-34 탭 드래그 재정렬 (이슈 #62).
 *
 * 인덱스 계산은 `tabOrder.test.ts` 가 맡는다. 여기서는 **실제 드래그**와
 * 세션 유지, 그리고 재정렬이 다른 탭 동작을 깨뜨리지 않는지 본다.
 */

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

/** 이름이 다른 탭 3개를 만든다. */
async function threeTabs(page: import("@playwright/test").Page) {
  for (const name of ["a.md", "b.md", "c.md"]) {
    await setFsMock(page, { openName: name, contents: { [name]: `# ${name}` } });
    await page.locator('.toolbar-btn[title="Open"]').click();
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText(name);
  }
  await expect(page.locator("#tab-bar .tab")).toHaveCount(4); // Untitled + 3
}

async function order(page: import("@playwright/test").Page) {
  return page.locator("#tab-bar .tab-name").allTextContents();
}

/** HTML5 드래그를 합성한다 — Playwright 의 mouse 로는 DnD 가 발화하지 않는다. */
async function dragTab(
  page: import("@playwright/test").Page,
  fromText: string,
  toText: string,
  after: boolean,
) {
  await page.evaluate(
    ({ fromText, toText, after }) => {
      const tabs = [...document.querySelectorAll("#tab-bar .tab")] as HTMLElement[];
      const find = (t: string) =>
        tabs.find((el) => el.querySelector(".tab-name")?.textContent?.startsWith(t))!;
      const from = find(fromText);
      const to = find(toText);

      const dt = new DataTransfer();
      from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));

      const rect = to.getBoundingClientRect();
      to.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: after ? rect.right - 2 : rect.left + 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
      to.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    },
    { fromText, toText, after },
  );
}

test("T1: 드래그로 탭 순서를 바꾼다", async ({ page }) => {
  await threeTabs(page);
  expect(await order(page)).toEqual(["Untitled", "a.md", "b.md", "c.md"]);

  await dragTab(page, "c.md", "a.md", false);
  expect(await order(page)).toEqual(["Untitled", "c.md", "a.md", "b.md"]);
});

test("T2: 맨 끝으로도 옮길 수 있다", async ({ page }) => {
  await threeTabs(page);

  await dragTab(page, "Untitled", "c.md", true);
  expect(await order(page)).toEqual(["a.md", "b.md", "c.md", "Untitled"]);
});

test("T3: 순서가 새로고침 후에도 유지된다", async ({ page }) => {
  await threeTabs(page);
  await dragTab(page, "c.md", "a.md", false);
  const expected = await order(page);

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(4);

  expect(await order(page)).toEqual(expected);
});

test("T3b: 새로고침을 기다리지 않고 즉시 저장된다", async ({ page }) => {
  // T3 만으로는 부족하다 — page.reload() 가 beforeunload 를 발화시켜 그쪽 경로가
  // 저장을 대신해 준다. 세션 영속화가 존재하는 이유는 **beforeunload 가 돌지
  // 않는 경우**(크래시·모바일 사파리 강제 종료, 트랩: beforeunload 신뢰 불가)라,
  // 언로드 없이도 저장되는지를 직접 봐야 한다.
  await threeTabs(page);

  // 탭 열기가 예약해 둔 디바운스 저장이 **먼저 끝나야** 한다. 그러지 않으면
  // 그 타이머가 재정렬 후에 발화하며 대신 저장해 주어, 재정렬 자체의 저장이
  // 빠져 있어도 테스트가 통과한다(실제로 그랬다).
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("markdown-editor:session:v1");
        return raw
          ? (JSON.parse(raw) as { tabs: Array<{ fileName: string }> }).tabs.map((t) => t.fileName)
          : null;
      }),
    )
    .toEqual(["Untitled", "a.md", "b.md", "c.md"]);

  await dragTab(page, "c.md", "a.md", false);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("markdown-editor:session:v1");
        if (!raw) return null;
        return (JSON.parse(raw) as { tabs: Array<{ fileName: string }> }).tabs.map(
          (t) => t.fileName,
        );
      }),
    )
    .toEqual(["Untitled", "c.md", "a.md", "b.md"]);
});

test("T4: 재정렬해도 활성 탭과 내용이 바뀌지 않는다", async ({ page }) => {
  await threeTabs(page);
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("c.md");
  await expect(page.locator("#editor")).toHaveValue("# c.md");

  await dragTab(page, "a.md", "c.md", true);

  // 순서만 바뀌어야 한다 — 활성 탭이 따라 움직이면 편집 중이던 문서가 바뀐다.
  await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("c.md");
  await expect(page.locator("#editor")).toHaveValue("# c.md");
});

test("T5: 재정렬 후에도 탭 전환이 정상 동작한다", async ({ page }) => {
  await threeTabs(page);
  await dragTab(page, "c.md", "Untitled", false);

  await page.locator("#tab-bar .tab-name", { hasText: "a.md" }).click();
  await expect(page.locator("#editor")).toHaveValue("# a.md");
});

test("T6: 자기 자신에게 놓으면 아무 일도 없다", async ({ page }) => {
  await threeTabs(page);
  const before = await order(page);

  await dragTab(page, "b.md", "b.md", true);
  expect(await order(page)).toEqual(before);
});

test("T7: 키보드로 탭을 옮길 수 있다", async ({ page }) => {
  // 드래그 전용이면 키보드 사용자에게는 없는 기능이다 (F-59 기준).
  await threeTabs(page);
  expect(await order(page)).toEqual(["Untitled", "a.md", "b.md", "c.md"]);

  await page.locator("#editor").click();
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  expect(await order(page)).toEqual(["Untitled", "a.md", "c.md", "b.md"]);

  await page.keyboard.press("Alt+Shift+ArrowLeft");
  expect(await order(page)).toEqual(["Untitled", "c.md", "a.md", "b.md"]);

  await page.keyboard.press("Alt+Shift+ArrowRight");
  expect(await order(page)).toEqual(["Untitled", "a.md", "c.md", "b.md"]);
});

test("T8: 끝에서는 더 옮겨지지 않는다", async ({ page }) => {
  await threeTabs(page);
  await page.locator("#editor").click();

  // 활성 탭(c.md)은 이미 마지막이다.
  await page.keyboard.press("Alt+Shift+ArrowRight");
  expect(await order(page)).toEqual(["Untitled", "a.md", "b.md", "c.md"]);
});

test("T9: 드래그 중 놓을 위치가 보인다", async ({ page }) => {
  await threeTabs(page);

  const marker = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("#tab-bar .tab")] as HTMLElement[];
    const from = tabs[3];
    const to = tabs[1];
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const rect = to.getBoundingClientRect();
    to.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    // dragover 에서 preventDefault 를 하지 않으면 실제 브라우저는 "놓을 수
    // 없음" 으로 판정해 drop 이 **아예 발생하지 않는다.** 합성 이벤트로는
    // 그 결과를 재현할 수 없으므로, 취소 여부 자체를 단언한다.
    const overCancelled = !to.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + 2,
        clientY: rect.top + rect.height / 2,
      }),
    );

    const result = {
      marker: to.className,
      dragging: from.classList.contains("dragging"),
      overCancelled,
    };
    from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    return result;
  });

  expect(marker.marker).toContain("drop-before");
  expect(marker.dragging).toBe(true);
  expect(marker.overCancelled).toBe(true);
});

test("T10: 안내 목록에 탭 이동 단축키가 자동으로 나타난다", async ({ page }) => {
  await page.locator('.toolbar-btn[title="Shortcuts"]').click();
  const labels = await page.locator("#shortcut-help-list .shortcut-label").allTextContents();
  expect(labels.join(" ")).toContain("탭을 왼쪽으로 옮기기");
  expect(labels.join(" ")).toContain("탭을 오른쪽으로 옮기기");
});
