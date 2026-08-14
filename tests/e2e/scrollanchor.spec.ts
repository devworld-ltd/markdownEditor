import { expect, test, type Page } from "@playwright/test";

/**
 * 이슈 #114 — 스크롤할 때 양쪽 내용이 어긋나던 문제.
 *
 * 확인하는 것은 스크롤 **값**이 아니라 **보이는 내용**이다. 비율 동기화는 값이
 * 비례한다는 성질은 만족하면서도 사용자가 보는 줄은 어긋났기 때문이다.
 */

/** 제목·코드블록·긴 문단이 섞여야 두 패널의 높이비가 국소적으로 달라진다. */
const DOC = Array.from({ length: 40 }, (_, i) =>
  i % 4 === 0
    ? `# 제목 ${i}`
    : i % 4 === 1
      ? "```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```"
      : `본문 ${i} 입니다. `.repeat(6),
).join("\n\n");

/**
 * 편집기에서 `line` 번째 줄의 y 를 잰다.
 *
 * textarea 는 "이 줄의 위치" 를 알려주지 않아, 앱과 같은 미러 기법으로 잰다.
 * **줄 높이 × 줄 번호로 어림하면 안 된다** — 긴 문단이 접히면 곧바로 어긋난다.
 */
async function lineTop(page: Page, line: number): Promise<number> {
  return page.evaluate((line) => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    const style = getComputedStyle(editor);
    const mirror = document.createElement("div");
    mirror.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;width:${style.width};padding:${style.padding};border:${style.border};font:${style.font};line-height:${style.lineHeight};box-sizing:${style.boxSizing};tab-size:${style.tabSize};`;

    const lines = editor.value.split("\n");
    const before = lines.slice(0, line).join("\n");
    mirror.appendChild(document.createTextNode(before ? `${before}\n` : ""));
    const marker = document.createElement("span");
    mirror.appendChild(marker);
    mirror.appendChild(document.createTextNode(lines.slice(line).join("\n")));

    document.body.appendChild(mirror);
    const y = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    mirror.remove();
    return y;
  }, line);
}

/** 두 프레임 기다린다 — 동기화는 rAF 를 거친다. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function scrollEditorToLine(page: Page, line: number): Promise<void> {
  const top = await lineTop(page, line);
  await page.evaluate((top) => {
    document.querySelector<HTMLTextAreaElement>("#editor")!.scrollTop = top;
  }, top);
  await settle(page);
}

/** 프리뷰 맨 위에 보이는 블록의 텍스트. */
async function previewTopText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>("#preview")!;
    const base = preview.getBoundingClientRect().top - preview.scrollTop;
    const visible = [...preview.children].filter(
      (child) => child.getBoundingClientRect().top - base + child.clientHeight >= preview.scrollTop,
    );
    return (visible[0]?.textContent ?? "").trim().slice(0, 30);
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill(DOC);
  await expect(page.locator("#preview h1").first()).toBeVisible();
  // 렌더 디바운스(150ms)가 끝나야 프리뷰 블록이 제자리에 있다.
  await page.waitForTimeout(300);
});

for (const heading of [8, 16, 20]) {
  test(`AS1(제목 ${heading}): 편집기 상단의 제목이 프리뷰 상단에도 보인다`, async ({
    page,
  }) => {
    const line = DOC.split("\n").findIndex((l) => l === `# 제목 ${heading}`);
    expect(line).toBeGreaterThan(0);

    await scrollEditorToLine(page, line);
    expect(await previewTopText(page)).toContain(`제목 ${heading}`);
  });
}

test("AS2: 프리뷰에서 제목을 상단으로 옮기면 편집기도 그 줄을 보여준다", async ({ page }) => {
  const target = "제목 16";
  const line = DOC.split("\n").findIndex((l) => l === `# ${target}`);

  await page.evaluate((target) => {
    const preview = document.querySelector<HTMLElement>("#preview")!;
    const base = preview.getBoundingClientRect().top - preview.scrollTop;
    const heading = [...preview.querySelectorAll("h1")].find(
      (h) => h.textContent?.trim() === target,
    )!;
    preview.scrollTop = heading.getBoundingClientRect().top - base;
  }, target);
  await settle(page);

  const [editorTop, want] = await Promise.all([
    page.evaluate(() => document.querySelector<HTMLTextAreaElement>("#editor")!.scrollTop),
    lineTop(page, line),
  ]);

  // 40px = 편집기 두 줄 남짓. 사용자가 "같은 자리" 로 인식하는 범위다.
  expect(Math.abs(editorTop - want)).toBeLessThanOrEqual(40);
});

test("AS2b: 문서 끝 근처의 제목은 프리뷰 화면 안에 보인다", async ({ page }) => {
  // 프리뷰가 더 짧아 맨 아래에서는 상단 정렬이 불가능하다 — 보이는지로 확인한다.
  const line = DOC.split("\n").findIndex((l) => l === "# 제목 32");
  await scrollEditorToLine(page, line);

  const visible = await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>("#preview")!;
    const base = preview.getBoundingClientRect().top - preview.scrollTop;
    const heading = [...preview.querySelectorAll("h1")].find(
      (h) => h.textContent?.trim() === "제목 32",
    )!;
    const top = heading.getBoundingClientRect().top - base;
    return top >= preview.scrollTop - 2 && top <= preview.scrollTop + preview.clientHeight;
  });
  expect(visible).toBe(true);
});

test("AS3: 편집기를 맨 아래로 내리면 프리뷰도 맨 아래다", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = editor.scrollHeight;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const preview = document.querySelector<HTMLElement>("#preview")!;
        return preview.scrollHeight - preview.clientHeight - preview.scrollTop;
      }),
    )
    .toBeLessThanOrEqual(2);
});

test("AS4: 편집기를 맨 위로 올리면 프리뷰도 맨 위다", async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = editor.scrollHeight;
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    document.querySelector<HTMLTextAreaElement>("#editor")!.scrollTop = 0;
  });

  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>("#preview")!.scrollTop),
    )
    .toBeLessThanOrEqual(1);
});

test("AS5: 앵커를 만들 수 없는 문서에서도 스크롤이 동작한다", async ({ page }) => {
  // 블록이 하나뿐이면 대응표가 성립하지 않는다 → 기존 비율 동기화로 되돌아간다.
  await page.locator("#editor").fill(`${"아주 긴 한 문단. ".repeat(400)}`);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = Math.round((editor.scrollHeight - editor.clientHeight) / 2);
  });

  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>("#preview")!.scrollTop),
    )
    .toBeGreaterThan(0);
});

test("AS6: 큰 문서에서도 스크롤이 막히지 않는다", async ({ page }) => {
  await page.locator("#editor").fill(
    Array.from({ length: 1000 }, (_, i) => (i % 5 === 0 ? `## 절 ${i}` : `본문 ${i}`)).join("\n\n"),
  );
  await page.waitForTimeout(500);

  const start = Date.now();
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = Math.round((editor.scrollHeight - editor.clientHeight) * 0.6);
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>("#preview")!.scrollTop),
    )
    .toBeGreaterThan(0);
  expect(Date.now() - start).toBeLessThan(5000);
});
