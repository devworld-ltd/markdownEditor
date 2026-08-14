import { expect, test, type Page } from "@playwright/test";

import { getWrites, installFsMock, setFsMock } from "./fixtures";

/** 이슈 #118 — 프리뷰에서 mermaid 코드블록을 다이어그램으로 렌더. */

const SAMPLE = [
  "```mermaid",
  "flowchart LR",
  '  subgraph U1["사용자가 보는 곳"]',
  '    A["① 자료를 연결한다"]',
  "  end",
  '  subgraph S1["뒤에서 도는 곳"]',
  '    B["② 코드와 문서를 살펴본다"]',
  "  end",
  "  A --> B",
  "```",
].join("\n");

async function waitForDiagram(page: Page) {
  await expect(page.locator("#preview .mermaid-figure svg")).toBeVisible({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
  await installFsMock(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("MD1: mermaid 블록이 다이어그램으로 그려진다", async ({ page }) => {
  await page.locator("#editor").fill(`# 문서\n\n${SAMPLE}`);
  await waitForDiagram(page);

  // 코드블록은 사라지고 그림이 남는다.
  await expect(page.locator("#preview pre code.language-mermaid")).toHaveCount(0);
  await expect(page.locator("#preview .mermaid-figure svg")).toContainText("자료를 연결한다");
  // 본문의 다른 요소는 그대로다.
  await expect(page.locator("#preview h1")).toHaveText("문서");
});

test("MD2: 문법이 틀리면 코드블록이 남고 이유가 보인다", async ({ page }) => {
  await page.locator("#editor").fill("```mermaid\nflowchart LR\n  A -->\n```\n\n뒤 문단");

  await expect(page.locator("#preview .mermaid-error")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#preview pre code.language-mermaid")).toBeVisible();
  // 프리뷰의 나머지는 정상이어야 한다.
  await expect(page.locator("#preview p").last()).toHaveText("뒤 문단");
});

test("MD3: 같은 다이어그램을 다시 그리지 않고, 타이핑이 막히지 않는다", async ({ page }) => {
  await page.locator("#editor").fill(`${SAMPLE}\n\n본문`);
  await waitForDiagram(page);

  const firstId = await page.locator("#preview .mermaid-figure svg").getAttribute("id");

  const start = Date.now();
  await page.locator("#editor").press("End");
  await page.keyboard.type(" 추가");
  await expect(page.locator("#editor")).toHaveValue(/추가/);
  await waitForDiagram(page);
  expect(Date.now() - start).toBeLessThan(8000);

  // 캐시가 돌면 같은 SVG(같은 id)가 다시 쓰인다 — 새로 그렸다면 id 가 올라간다.
  expect(await page.locator("#preview .mermaid-figure svg").getAttribute("id")).toBe(firstId);
});

test("MD4: 내보낸 HTML 에도 그림이 들어간다", async ({ page }) => {
  await setFsMock(page, { saveName: "note.html" });
  await page.locator("#editor").fill(SAMPLE);
  await waitForDiagram(page);

  await page.locator('.toolbar-btn[title="Export HTML"]').click();

  const writes = await getWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0].content).toContain("<svg");

  // 라벨은 `<tspan>` 으로 쪼개져 나가므로 **원문 문자열로 찾으면 안 된다.**
  // 내보낸 HTML 을 실제로 파싱해 그림의 글자를 읽는다.
  const label = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.querySelector("svg")?.textContent ?? "";
  }, writes[0].content);
  expect(label).toContain("자료를 연결한다");
});

test("MD5: 다크 모드에서도 그림 글자가 읽힌다", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("#editor").fill(SAMPLE);
  await waitForDiagram(page);

  const contrast = await page.evaluate(() => {
    const lum = (color: string) => {
      const parts = color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
      const [r, g, b] = parts.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const text = document.querySelector("#preview .mermaid-figure svg text")!;
    const bg = getComputedStyle(document.querySelector("#preview")!).backgroundColor;
    const fg = getComputedStyle(text).fill || getComputedStyle(text).color;
    const [la, lb] = [lum(fg), lum(bg)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  });

  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("MD6: mermaid 가 없는 문서에서는 라이브러리를 내려받지 않는다", async ({ page }) => {
  // **네트워크 리스너를 이동 전에 붙여야 한다.** beforeEach 의 goto 뒤에 붙이면
  // 앱 기동 때 나가는 요청을 통째로 놓쳐, 지연 로드를 없애도 통과한다(실제로 그랬다).
  const requested: string[] = [];
  page.on("request", (request) => {
    // 우리 모듈(`src/mermaidView.ts`)이 아니라 **라이브러리 자체**만 센다.
    if (/deps\/mermaid|mermaid\.core|cytoscape|katex|dagre/i.test(request.url())) {
      requested.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill("# 제목\n\n본문 **굵게**\n\n```ts\nconst a = 1;\n```");
  await expect(page.locator("#preview h1")).toBeVisible();
  await page.waitForTimeout(1000);

  expect(requested).toEqual([]);
});

test("MD7: 그림이 들어와도 스크롤이 어긋나지 않는다 (#114 무회귀)", async ({ page }) => {
  const long = [
    ...Array.from({ length: 12 }, (_, i) => `## 절 ${i}\n\n본문 ${i} 입니다.`),
    SAMPLE,
    ...Array.from({ length: 12 }, (_, i) => `## 뒷절 ${i}\n\n본문 ${i} 입니다.`),
  ].join("\n\n");

  await page.locator("#editor").fill(long);
  await waitForDiagram(page);

  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = Math.round((editor.scrollHeight - editor.clientHeight) * 0.5);
  });

  // 양 끝이 아닌 지점에서 프리뷰가 따라 움직여야 한다.
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>("#preview")!.scrollTop),
    )
    .toBeGreaterThan(0);

  // 맨 아래로 내리면 프리뷰도 맨 아래.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
    editor.scrollTop = editor.scrollHeight;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = document.querySelector<HTMLElement>("#preview")!;
        return p.scrollHeight - p.clientHeight - p.scrollTop;
      }),
    )
    .toBeLessThanOrEqual(2);
});
