import { expect, test } from "@playwright/test";

/**
 * F-23 코드 하이라이팅 (이슈 #76).
 *
 * 토크나이저는 `highlight.test.ts` 가 맡는다. 여기서는 **정화 파이프라인을 통과한
 * 뒤에도 색이 남는지**와 라이트·다크·인쇄에서의 대비를 본다.
 */

const SAMPLE = "```js\nconst a = 1; // 주석\nconst s = \"문자열\";\n```";

function luminance(color: string): number {
  const parts = color.match(/\d+(\.\d+)?/g)!;
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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("HL1: 지원 언어의 코드블록에 토큰 span 이 붙는다", async ({ page }) => {
  await page.locator("#editor").fill(SAMPLE);
  await expect(page.locator("#preview pre code")).toBeVisible();

  // DOMPurify 가 class 를 지워 버리면 색이 아예 안 나온다.
  await expect(page.locator("#preview .tok-keyword").first()).toHaveText("const");
  await expect(page.locator("#preview .tok-comment")).toHaveText("// 주석");
  await expect(page.locator("#preview .tok-string")).toHaveText('"문자열"');
  await expect(page.locator("#preview .tok-number")).toHaveText("1");
});

test("HL2: 모르는 언어는 색이 붙지 않는다", async ({ page }) => {
  // 어설프게 칠하면 틀린 색이 오히려 읽기를 방해한다.
  await page.locator("#editor").fill("```rust\nfn main() { let a = 1; }\n```");
  await expect(page.locator("#preview pre code")).toBeVisible();
  await expect(page.locator("#preview .tok-keyword")).toHaveCount(0);
});

test("HL3: 언어 표시가 없어도 색이 붙지 않는다", async ({ page }) => {
  await page.locator("#editor").fill("```\nconst a = 1;\n```");
  await expect(page.locator("#preview pre code")).toBeVisible();
  await expect(page.locator("#preview .tok-keyword")).toHaveCount(0);
});

test("HL4: 코드 안의 태그가 실제 태그가 되지 않는다 (F-18)", async ({ page }) => {
  await page.locator("#editor").fill('```js\nconst a = "<img src=x onerror=alert(1)>";\n```');
  await expect(page.locator("#preview pre code")).toBeVisible();

  // 코드 **본문**에 "onerror" 라는 글자가 남는 것은 정상이다 — 그게 코드다.
  // 확인해야 할 것은 그것이 **속성이나 요소가 되지 않았는가** 다.
  await expect(page.locator("#preview img")).toHaveCount(0);
  const dangerous = await page.evaluate(() =>
    [...document.querySelectorAll("#preview *")].filter((el) =>
      [...el.attributes].some((a) => a.name.startsWith("on")),
    ).length,
  );
  expect(dangerous).toBe(0);
  await expect(page.locator("#preview pre code")).toContainText("<img src=x onerror=alert(1)>");
});

test("HL5: 토큰 span 에 class 외의 속성이 없다", async ({ page }) => {
  await page.locator("#editor").fill(SAMPLE);
  await expect(page.locator("#preview .tok-keyword").first()).toBeVisible();

  const attrs = await page.evaluate(() =>
    [...document.querySelectorAll("#preview [class^='tok-']")].map((el) =>
      [...el.attributes].map((a) => a.name).sort().join(","),
    ),
  );
  // style·이벤트 속성이 붙기 시작하면 DOMPurify 허용 목록을 계속 열어야 한다.
  expect(new Set(attrs)).toEqual(new Set(["class"]));
});

test("HL6: 라이트 모드에서 모든 토큰이 AA 를 넘는다", async ({ page }) => {
  await page.locator("#editor").fill(SAMPLE);
  await expect(page.locator("#preview .tok-keyword").first()).toBeVisible();

  const colors = await page.evaluate(() => {
    const pre = document.querySelector("#preview pre")!;
    const bg = getComputedStyle(pre).backgroundColor;
    return [...document.querySelectorAll("#preview [class^='tok-']")].map((el) => ({
      cls: el.className,
      color: getComputedStyle(el).color,
      bg,
    }));
  });

  expect(colors.length).toBeGreaterThan(3);
  for (const { cls, color, bg } of colors) {
    expect(contrast(color, bg), `${cls} 대비`).toBeGreaterThanOrEqual(4.5);
  }
});

test.describe("다크 모드", () => {
  test.use({ colorScheme: "dark" });

  test("HL7: 다크에서도 모든 토큰이 AA 를 넘는다", async ({ page }) => {
    // 라이트 값을 그대로 쓰면 어두운 코드 배경 위에서 전부 읽을 수 없다.
    await page.goto("/");
    await page.locator("#editor").fill(SAMPLE);
    await expect(page.locator("#preview .tok-keyword").first()).toBeVisible();

    const colors = await page.evaluate(() => {
      const pre = document.querySelector("#preview pre")!;
      const bg = getComputedStyle(pre).backgroundColor;
      return [...document.querySelectorAll("#preview [class^='tok-']")].map((el) => ({
        cls: el.className,
        color: getComputedStyle(el).color,
        bg,
      }));
    });

    for (const { cls, color, bg } of colors) {
      expect(contrast(color, bg), `${cls} 대비(다크)`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test("HL8: 인쇄에서는 라이트 팔레트로 고정된다", async ({ page }) => {
  // 다크로 보고 있어도 다크 팔레트가 종이에 인쇄되면 안 된다.
  await page.locator("#editor").fill(SAMPLE);
  await expect(page.locator("#preview .tok-keyword").first()).toBeVisible();

  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  const printed = await page.evaluate(() => ({
    keyword: getComputedStyle(document.querySelector("#preview .tok-keyword")!).color,
    bg: getComputedStyle(document.querySelector("#preview pre")!).backgroundColor,
  }));
  await page.emulateMedia({ media: "screen", colorScheme: null });

  expect(printed.bg).toBe("rgb(244, 244, 244)");
  expect(contrast(printed.keyword, printed.bg)).toBeGreaterThanOrEqual(4.5);
});

test("HL9: 큰 코드블록에서도 렌더가 느려지지 않는다", async ({ page }) => {
  const big = "```ts\n" + "const x = 1; // 줄\n".repeat(2000) + "```";
  const start = Date.now();
  await page.locator("#editor").fill(big);
  await expect(page.locator("#preview pre code")).toBeVisible();
  expect(Date.now() - start).toBeLessThan(8000);
});
