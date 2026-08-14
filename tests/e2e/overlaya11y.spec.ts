import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * F-59 재검증 — 편집 하이라이팅 오버레이가 접근성을 해치지 않는다 (이슈 #99).
 *
 * 오버레이는 **보조 표시**다. 같은 글자가 화면에 두 번 존재하므로, 스크린리더에
 * 노출되면 문서를 두 번 읽고 포커스가 잡히면 키보드 사용자가 빈 요소에 갇힌다.
 * 자동 점검(axe)만으로는 이런 것을 못 잡으므로 수동 시나리오를 함께 둔다
 * (F-59 의 원래 교훈: axe 통과가 "쓸 수 있다"를 뜻하지 않는다).
 */

/** WCAG 상대 휘도. `darkmode.spec.ts` 와 같은 계산이다. */
function luminance(color: string): number {
  const parts = color.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) throw new Error(`색 파싱 실패: ${color}`);
  const [r, g, b] = parts.slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const SAMPLE = [
  "# 제목",
  "",
  "**굵게** 와 *기울임*, [링크](https://example.com), `코드`.",
  "",
  "> 인용",
  "- 목록",
  "",
  "```ts",
  "const answer = 42; // 주석",
  "```",
].join("\n");

async function openWithOverlay(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#editor").fill(SAMPLE);
  await page.locator('.toolbar-btn[title="Settings"]').click();
  await page.locator("#setting-highlight").check();
  await page.locator("#editor-settings-close").click();
  await expect(page.locator("#editor-overlay")).toBeVisible();
}

test("OA1: 오버레이를 켜도 axe 위반이 없다", async ({ page }) => {
  await openWithOverlay(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}(${v.impact}) @ ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
});

test("OA2: 다크 모드 + 오버레이에서도 axe 위반이 없다", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openWithOverlay(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("OA3: 오버레이는 접근성 트리에 노출되지 않는다 — 문서를 두 번 읽으면 안 된다", async ({
  page,
}) => {
  await openWithOverlay(page);
  await expect(page.locator("#editor-overlay")).toHaveAttribute("aria-hidden", "true");

  // 오버레이 자체는 접근성 트리에서 비어 있어야 한다. (편집기 textarea 는
  // 당연히 자기 값을 노출한다 — 확인하려는 것은 **같은 글자가 두 번** 잡히지
  // 않는가다.)
  expect((await page.locator("#editor-overlay").ariaSnapshot()).trim()).toBe("");
});

test("OA4: 오버레이에는 포커스가 가지 않는다", async ({ page }) => {
  await openWithOverlay(page);

  // 툴바 첫 버튼부터 Tab 을 눌러 편집기까지 간다. 중간에 오버레이가 잡히면 안 된다.
  const seen: string[] = [];
  await page.keyboard.press("Tab");
  for (let i = 0; i < 25; i += 1) {
    seen.push(
      await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || ""),
    );
    if (seen[seen.length - 1] === "editor") break;
    await page.keyboard.press("Tab");
  }

  expect(seen).not.toContain("editor-overlay");
  expect(seen).toContain("editor");
});

test("OA5: 오버레이를 클릭해도 편집기가 포커스를 받는다", async ({ page }) => {
  await openWithOverlay(page);
  // 오버레이가 덮고 있는 자리를 클릭한다.
  await page.locator("#editor").click({ position: { x: 60, y: 30 } });
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("editor");
});

test("OA6: 서식 색이 편집 표면에서 AA 대비를 지킨다 (라이트)", async ({ page }) => {
  await openWithOverlay(page);

  const colors = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector("#editor-pane")!).backgroundColor;
    const of = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).color;
    return {
      bg,
      marker: of(".md-marker"),
      heading: of(".md-heading"),
      code: of(".md-code"),
      link: of(".md-link-text"),
      url: of(".md-url"),
      list: of(".md-list"),
    };
  });

  for (const [name, color] of Object.entries(colors)) {
    if (name === "bg") continue;
    expect(
      contrast(color, colors.bg),
      `${name} 대비가 낮다: ${color} on ${colors.bg}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("OA7: 다크 모드에서도 서식 색이 AA 대비를 지킨다", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openWithOverlay(page);

  const colors = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector("#editor-pane")!).backgroundColor;
    const of = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).color;
    return {
      bg,
      marker: of(".md-marker"),
      heading: of(".md-heading"),
      code: of(".md-code"),
      link: of(".md-link-text"),
      url: of(".md-url"),
      list: of(".md-list"),
    };
  });

  for (const [name, color] of Object.entries(colors)) {
    if (name === "bg") continue;
    expect(
      contrast(color, colors.bg),
      `${name} 대비가 낮다: ${color} on ${colors.bg}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("OA8: 인쇄에는 오버레이가 나오지 않는다", async ({ page }) => {
  await openWithOverlay(page);
  await page.emulateMedia({ media: "print" });

  const visible = await page.evaluate(
    () => document.querySelector("#editor-overlay")!.getClientRects().length > 0,
  );
  await page.emulateMedia({ media: "screen" });
  expect(visible).toBe(false);
});

test("OA9: 커서는 오버레이가 켜져도 보인다", async ({ page }) => {
  await openWithOverlay(page);

  // 글자는 투명해지지만 caret 색은 남아야 한다 — 아니면 커서가 사라진다.
  const caret = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector("#editor")!);
    return { color: style.color, caretColor: style.caretColor };
  });
  expect(caret.color).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(caret.caretColor).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});
