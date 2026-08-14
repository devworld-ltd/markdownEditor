import { expect, test, type Page } from "@playwright/test";

/** F-23 잔여 — 편집 영역 하이라이팅 오버레이 (이슈 #95). */

const SAMPLE = [
  "# 제목",
  "",
  "**굵게** 와 *기울임* 그리고 [링크](https://example.com) 와 `코드`.",
  "",
  "> 인용문",
  "- 목록 항목",
  "",
  "```ts",
  "const answer = 42; // 주석",
  "```",
].join("\n");

async function enableHighlight(page: Page): Promise<void> {
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-highlight").check();
  await page.locator("#editor-settings-close").click();
}

/** 두 레이어의 글자 배치를 좌우하는 값들. 하나라도 다르면 정렬이 어긋난다. */
const METRICS = [
  "font-family",
  "font-size",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "white-space",
  "overflow-wrap",
  "tab-size",
] as const;

async function metricsOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((el, props) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
  }, METRICS as unknown as string[]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("EH1: 기본은 꺼져 있다", async ({ page }) => {
  await expect(page.locator("#editor-pane")).toHaveAttribute("data-overlay", "false");
  await expect(page.locator("#editor-overlay")).toBeHidden();
});

test("EH2: 켜면 마크다운 서식이 칠해진다", async ({ page }) => {
  await page.locator("#editor").fill(SAMPLE);
  await enableHighlight(page);

  await expect(page.locator("#editor-overlay .md-heading")).toHaveText("제목");
  await expect(page.locator("#editor-overlay .md-strong")).toHaveText("굵게");
  await expect(page.locator("#editor-overlay .md-em")).toHaveText("기울임");
  await expect(page.locator("#editor-overlay .md-url")).toHaveText("https://example.com");
  await expect(page.locator("#editor-overlay .md-list")).toHaveText("-");
  // 코드블록 안쪽은 기존 F-23 토크나이저가 칠한다.
  await expect(page.locator("#editor-overlay .tok-keyword").first()).toBeVisible();
});

test("EH3: 오버레이 텍스트가 본문과 정확히 같다 — 한 글자만 달라도 정렬이 밀린다", async ({
  page,
}) => {
  await page.locator("#editor").fill(SAMPLE);
  await enableHighlight(page);

  const overlayText = await page.locator("#editor-overlay").innerText();
  // 마지막에 덧붙인 개행 하나만 차이 (pre-wrap 이 끝 개행을 접는 것을 보정).
  expect(overlayText.replace(/\n$/, "")).toBe(SAMPLE);
});

test("EH4: 배치를 좌우하는 CSS 값이 textarea 와 같다", async ({ page }) => {
  await enableHighlight(page);
  expect(await metricsOf(page, "#editor-overlay")).toEqual(
    await metricsOf(page, "#editor"),
  );
});

test("EH5: 줄바꿈 위치가 같다 — 높이가 어긋나면 아래 전부가 밀린다", async ({ page }) => {
  // 여러 번 접히는 긴 줄로 확인한다. 한글·영문·긴 URL 을 섞는다.
  // **끝을 빈 줄로 둔다.** textarea 는 마지막 개행 뒤의 빈 줄을 보여주지만
  // `pre-wrap` 은 그 개행을 접는다 — 보정하지 않으면 여기서 높이가 갈린다.
  // 창보다 확실히 길어야 한다 — 내용이 화면에 다 들어가면 두 높이가 모두
  // 창 높이로 잘려, 어긋나 있어도 같아 보인다.
  const long = `${`${"아주 긴 한글 문장을 반복해서 넣는다. ".repeat(20)}\n${"english words ".repeat(40)}\nhttps://example.com/${"a".repeat(200)}\n`.repeat(5)}`;
  await page.locator("#editor").fill(long);
  await enableHighlight(page);

  const sizes = await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
    return { editor: editor.scrollHeight, overlay: overlay.scrollHeight };
  });
  expect(sizes.overlay).toBe(sizes.editor);
});

test("EH6: 스크롤을 곧바로 따라간다", async ({ page }) => {
  await page.locator("#editor").fill("줄\n".repeat(300));
  await enableHighlight(page);

  // **두 프레임 안에** 맞아야 한다. 여유를 주고 폴링하면 150ms 렌더 디바운스가
  // 대신 맞춰 주기 때문에, 스크롤 리스너를 통째로 지워도 테스트가 통과한다
  // (실제로 그랬다). 한 프레임 늦으면 글자가 따로 노는 게 눈에 보인다.
  const overlayTop = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
        const overlay = document.querySelector<HTMLElement>("#editor-overlay")!;
        editor.scrollTop = 500;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(overlay.scrollTop)),
        );
      }),
  );
  expect(overlayTop).toBe(500);
});

test("EH7: 타이핑하면 즉시 따라 칠해진다", async ({ page }) => {
  await enableHighlight(page);
  await page.locator("#editor").click();
  await page.keyboard.type("## 새 제목");

  await expect(page.locator("#editor-overlay .md-heading")).toHaveText("새 제목");
});

test("EH8: 끄면 다시 단색이 되고 설정이 유지된다", async ({ page }) => {
  await page.locator("#editor").fill(SAMPLE);
  await enableHighlight(page);
  await expect(page.locator("#editor-overlay")).toBeVisible();

  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-highlight").uncheck();
  await page.locator("#editor-settings-close").click();
  await expect(page.locator("#editor-overlay")).toBeHidden();

  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#editor-pane")).toHaveAttribute("data-overlay", "false");
});

test("EH9: 켠 상태가 새로고침 후에도 유지된다", async ({ page }) => {
  await enableHighlight(page);
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#editor-pane")).toHaveAttribute("data-overlay", "true");
});

test("EH10: 커서와 선택은 여전히 진짜 textarea 의 것이다", async ({ page }) => {
  await enableHighlight(page);
  await page.locator("#editor").fill("첫 줄\n둘째 줄");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 3);
  });

  // 오버레이가 아니라 textarea 가 포커스를 갖는다.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("editor");
  const selection = await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => [
    el.selectionStart,
    el.selectionEnd,
  ]);
  expect(selection).toEqual([0, 3]);

  // 입력도 그대로 된다 (실행 취소 스택 포함).
  await page.keyboard.type("바꿈");
  await expect(page.locator("#editor")).toHaveValue("바꿈\n둘째 줄");

  // 한 글자씩 되돌릴 수도 있어(브라우저가 정하는 묶음 단위) 원래 값이 될
  // 때까지 누른다. 확인하려는 것은 "묶음 크기" 가 아니라 **스택이 살아 있는지**다.
  for (let i = 0; i < 5; i += 1) {
    if ((await page.locator("#editor").inputValue()) === "첫 줄\n둘째 줄") break;
    await page.keyboard.press("ControlOrMeta+z");
  }
  await expect(page.locator("#editor")).toHaveValue("첫 줄\n둘째 줄");
});

test("EH11: 오버레이는 클릭을 가로채지 않는다", async ({ page }) => {
  await enableHighlight(page);
  await page.locator("#editor").fill("본문을 클릭한다");

  // 오버레이가 포인터를 먹으면 여기서 편집기가 포커스를 얻지 못한다.
  await page.locator("#editor").click();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("editor");
});

test("EH12: 큰 문서에서도 타이핑이 막히지 않는다", async ({ page }) => {
  const big = `${"# 제목\n본문 **굵게** `코드` [링크](url)\n".repeat(500)}`;
  await page.locator("#editor").fill(big);
  await enableHighlight(page);

  const start = Date.now();
  await page.locator("#editor").press("End");
  await page.keyboard.type("추가");
  await expect(page.locator("#editor")).toHaveValue(/추가/);
  expect(Date.now() - start).toBeLessThan(5000);
});
