import { expect, test } from "@playwright/test";

/** WCAG 상대 휘도. `rgb(r, g, b)` / `rgba(...)` 문자열을 받는다. */
function luminance(color: string): number {
  const parts = color.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) throw new Error(`색 파싱 실패: ${color}`);
  const [r, g, b] = parts.slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 대비비. 계산을 Node 에 두면 페이지에서 eval 을 쓸 필요가 없다. */
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * F-57 다크 모드 (이슈 #38).
 *
 * 검증의 핵심은 "어두워졌다" 가 아니라 **라이트에서 세운 두 가지 관계가 다크에서도
 * 유지되는가** 다: (1) 편집/프리뷰의 시각 구분(F-72), (2) 본문 대비 AA.
 */
test.describe("F-57 다크 모드", () => {
  test.use({ colorScheme: "dark" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
  });

  test("D1: OS 다크 설정을 따라 표면이 어두워진다", async ({ page }) => {
    const surfaces = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        editorToken: cs.getPropertyValue("--surface-editor").trim(),
        previewToken: cs.getPropertyValue("--surface-preview").trim(),
        editorBg: getComputedStyle(document.querySelector("#editor")!).backgroundColor,
        previewBg: getComputedStyle(document.querySelector("#preview")!).backgroundColor,
      };
    });

    expect(surfaces.editorToken).toBe("#2a2a2c");
    expect(surfaces.previewToken).toBe("#313134");
    // 라이트 값이 새어 나오지 않아야 한다.
    expect(surfaces.editorBg).not.toBe("rgb(242, 242, 240)");
    expect(surfaces.previewBg).not.toBe("rgb(255, 255, 255)");
  });

  test("D2: 다크에서도 편집/프리뷰 구분이 유지된다 (F-72 회귀 방지)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const editor = getComputedStyle(document.querySelector("#editor")!);
      const preview = getComputedStyle(document.querySelector("#preview")!);
      const divider = document.querySelector("#split-resizer") as HTMLElement;
      return {
        editorBg: editor.backgroundColor,
        previewBg: preview.backgroundColor,
        dividerWidth: divider.getBoundingClientRect().width,
        dividerColor: getComputedStyle(divider).backgroundColor,
      };
    });
    const ratio = contrast(result.editorBg, result.previewBg);

    expect(result.editorBg).not.toBe(result.previewBg);
    // 경계에서만 인지되는 강도 — 라이트(1.12:1)와 같은 급으로 유지한다.
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.3);
    expect(result.dividerWidth).toBeCloseTo(1, 0);
    // 경계선도 다크 토큰을 따라간다.
    expect(result.dividerColor).toBe("rgb(74, 74, 78)");
  });

  test("D3: 프리뷰가 에디터보다 밝다 — 명도 계단 방향이 라이트와 같다", async ({ page }) => {
    const bgs = await page.evaluate(() => {
      const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
      return {
        toolbar: bg(".toolbar"),
        tabBar: bg("#tab-bar"),
        editor: bg("#editor"),
        preview: bg("#preview"),
      };
    });
    const lums = {
      toolbar: luminance(bgs.toolbar),
      tabBar: luminance(bgs.tabBar),
      editor: luminance(bgs.editor),
      preview: luminance(bgs.preview),
    };

    // 툴바 → 탭바 → 에디터 → 프리뷰 순으로 밝아진다 ("원재료 → 완성물").
    expect(lums.toolbar).toBeLessThan(lums.tabBar);
    expect(lums.tabBar).toBeLessThan(lums.editor);
    expect(lums.editor).toBeLessThan(lums.preview);
  });

  test("D4: 본문 텍스트가 두 표면 모두에서 WCAG AA(4.5:1)를 넘는다", async ({ page }) => {
    await page.locator("#editor").fill("# 제목\n\n본문 문단입니다.");
    await expect(page.locator("#preview h1")).toBeVisible();

    const colors = await page.evaluate(() => {
      const editor = getComputedStyle(document.querySelector("#editor")!);
      const previewEl = document.querySelector("#preview") as HTMLElement;
      const preview = getComputedStyle(previewEl);
      const para = getComputedStyle(previewEl.querySelector("p")!);
      return {
        editorText: editor.color,
        editorBg: editor.backgroundColor,
        paraText: para.color,
        previewBg: preview.backgroundColor,
      };
    });

    expect(contrast(colors.editorText, colors.editorBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.paraText, colors.previewBg)).toBeGreaterThanOrEqual(4.5);
  });

  test("D5: 코드블록·인용문·표가 다크에서 밝은 덩어리로 남지 않는다", async ({ page }) => {
    await page.locator("#editor").fill(
      "```\ncode\n```\n\n> 인용문\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    await expect(page.locator("#preview pre")).toBeVisible();

    const colors = await page.evaluate(() => {
      const previewEl = document.querySelector("#preview") as HTMLElement;
      return {
        previewBg: getComputedStyle(previewEl).backgroundColor,
        preBg: getComputedStyle(previewEl.querySelector("pre")!).backgroundColor,
        quoteText: getComputedStyle(previewEl.querySelector("blockquote")!).color,
        cellBorder: getComputedStyle(previewEl.querySelector("td")!).borderTopColor,
      };
    });

    // 다크에서 코드 배경은 프리뷰 표면보다 **어두워야** 한다 — 밝게 올리면
    // 코드블록이 페이지에서 튀어나와 읽는 흐름을 끊는다.
    expect(luminance(colors.preBg)).toBeLessThan(luminance(colors.previewBg));
    // 인용문 보조 텍스트도 AA 를 넘어야 한다.
    expect(contrast(colors.quoteText, colors.previewBg)).toBeGreaterThanOrEqual(4.5);
    // 표 테두리가 표면보다 밝아야 셀 구분이 보인다.
    expect(luminance(colors.cellBorder)).toBeGreaterThan(luminance(colors.previewBg));
  });

  test("D6: 720px 이하 상하 분할에서도 다크 구분과 2px 경계가 유지된다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    const result = await page.evaluate(() => {
      const editor = getComputedStyle(document.querySelector("#editor")!);
      const preview = getComputedStyle(document.querySelector("#preview")!);
      const divider = document.querySelector("#split-resizer") as HTMLElement;
      return {
        dividerHeight: divider.getBoundingClientRect().height,
        dividerColor: getComputedStyle(divider).backgroundColor,
        differs: editor.backgroundColor !== preview.backgroundColor,
      };
    });

    // 다크 전용 레이아웃 분기가 없다는 증거 — 규칙은 그대로고 값만 바뀐다.
    expect(result.dividerHeight).toBeCloseTo(2, 0);
    expect(result.dividerColor).toBe("rgb(74, 74, 78)");
    expect(result.differs).toBe(true);
  });
});
