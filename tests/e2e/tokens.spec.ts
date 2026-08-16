import { expect, test, type Page } from "@playwright/test";

/**
 * #146 디자인 토큰.
 *
 * **색 값 자체를 단언하지 않는다** — 값은 앞으로도 손볼 것이고, 값을 고정하면
 * 토큰을 조정할 때마다 테스트가 깨져 결국 지워진다. 대신 **깨지면 안 되는 관계**를
 * 단언한다: 라이트에서도 값이 있는가, 대비를 넘는가, 계단 방향이 맞는가.
 */

const TOKENS = [
  "--surface-chrome", "--surface-tabbar", "--surface-editor", "--surface-preview",
  "--border-split", "--border-strong", "--text", "--text-muted", "--text-faint",
  "--accent", "--accent-soft", "--status-ok", "--status-warn", "--status-danger",
];

async function tokenValues(page: Page): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }, TOKENS);
}

function rgb(v: string): [number, number, number] {
  const m = v.match(/#?([0-9a-f]{6})/i);
  if (m) {
    const h = m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const n = v.match(/\d+(\.\d+)?/g)!.map(Number);
  return [n[0], n[1], n[2]];
}
function lum(v: string): number {
  const f = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(v);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} 모드`, () => {
    test.use({ colorScheme: scheme });

    test(`TK1(${scheme}): 모든 토큰에 값이 있다 — 한쪽 모드에만 정의하면 UA 기본값으로 떨어진다`, async ({ page }) => {
      await page.goto("/");
      const v = await tokenValues(page);
      for (const t of TOKENS) expect(v[t], `${t} 가 비어 있다`).not.toBe("");
    });

    test(`TK2(${scheme}): 본문·보조 텍스트가 네 표면 모두에서 AA(4.5:1)`, async ({ page }) => {
      await page.goto("/");
      const v = await tokenValues(page);
      const surfaces = ["--surface-chrome", "--surface-tabbar", "--surface-editor", "--surface-preview"];
      for (const fg of ["--text", "--text-muted", "--accent"]) {
        for (const bg of surfaces) {
          const c = contrast(v[fg], v[bg]);
          expect(c, `${fg} on ${bg} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    test(`TK3(${scheme}): 상태 색이 상태 표시줄 표면에서 AA`, async ({ page }) => {
      await page.goto("/");
      const v = await tokenValues(page);
      for (const fg of ["--status-ok", "--status-warn", "--status-danger"]) {
        const c = contrast(v[fg], v["--surface-chrome"]);
        expect(c, `${fg} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`TK4(${scheme}): 명도 계단 — 툴바 < 탭바 < 에디터 < 프리뷰`, async ({ page }) => {
      await page.goto("/");
      const v = await tokenValues(page);
      const step = ["--surface-chrome", "--surface-tabbar", "--surface-editor", "--surface-preview"].map((t) => lum(v[t]));
      for (let i = 1; i < step.length; i += 1) {
        expect(step[i], `${i}단계가 앞 단계보다 밝지 않다`).toBeGreaterThan(step[i - 1]);
      }
    });

    test(`TK5(${scheme}): 툴바·탭바가 실제로 토큰을 쓴다 — 하드코딩이 남아 있지 않다`, async ({ page }) => {
      await page.goto("/");
      const v = await tokenValues(page);
      const bg = await page.evaluate(() => ({
        toolbar: getComputedStyle(document.querySelector(".toolbar")!).backgroundColor,
        tabBar: getComputedStyle(document.querySelector("#tab-bar")!).backgroundColor,
      }));
      expect(lum(bg.toolbar)).toBeCloseTo(lum(v["--surface-chrome"]), 3);
      expect(lum(bg.tabBar)).toBeCloseTo(lum(v["--surface-tabbar"]), 3);
    });
  });
}

test("TK6: 툴바 글자색이 표면과 함께 선언돼 있다 — 폼 컨트롤은 color 를 상속하지 않는다", async ({ page }) => {
  await page.goto("/");
  const c = await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>(".toolbar-btn")!;
    return getComputedStyle(btn).color;
  });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".toolbar")!).backgroundColor);
  expect(contrast(c, bg), "툴바 버튼 글자가 툴바 배경에서 안 읽힌다").toBeGreaterThanOrEqual(4.5);
});
