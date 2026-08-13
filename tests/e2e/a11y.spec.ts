import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * F-59 접근성 정밀 점검 (이슈 #53).
 *
 * 두 층으로 본다:
 *
 * 1) **자동 점검(axe-core)** — 기계가 잡을 수 있는 위반을 상태별로 훑는다.
 *    기능이 빠르게 늘었으므로 상태 조합마다 돌려야 의미가 있다. axe 는
 *    `devDependencies` 이고 런타임 번들에는 들어가지 않는다.
 * 2) **수동 시나리오** — 자동 점검이 절대 못 잡는 것: 키보드만으로 전 기능에
 *    도달하는가, 포커스가 보이는가, 상태 변화가 전달되는가.
 *
 * 자동 점검만 두면 "위반 0" 이 곧 "쓸 수 있다" 로 오해된다. 실제로 이 저장소의
 * 탭은 axe 를 통과하면서도 **키보드로는 전환할 수 없었다.**
 */

const HOME = "/";

async function open(page: import("@playwright/test").Page) {
  await page.goto(HOME);
  await expect(page.locator("#editor")).toBeVisible();
}

const SAMPLE = "# 제목\n\n본문 [링크](https://example.com)\n\n- 항목\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";

const STATES: Array<{
  name: string;
  setup: (p: import("@playwright/test").Page) => Promise<void>;
}> = [
  { name: "빈 문서", setup: async () => {} },
  {
    name: "문서 있음",
    setup: async (p) => {
      await p.locator("#editor").fill(SAMPLE);
      await expect(p.locator("#preview h1")).toBeVisible();
    },
  },
  { name: "검색 열림", setup: async (p) => void (await p.keyboard.press("ControlOrMeta+f")) },
  {
    name: "치환 열림",
    setup: async (p) => {
      await p.keyboard.press("ControlOrMeta+f");
      await p.locator("#search-toggle-replace").click();
    },
  },
  {
    name: "단축키 안내",
    setup: async (p) => void (await p.locator('.toolbar-btn[title="Shortcuts"]').click()),
  },
  { name: "편집 전용", setup: async (p) => void (await p.locator("#view-mode").click()) },
  {
    name: "미리보기 전용",
    setup: async (p) => {
      await p.locator("#view-mode").click();
      await p.locator("#view-mode").click();
    },
  },
  {
    name: "탭 2개",
    setup: async (p) => {
      await p.locator("#editor").fill("첫 문서");
      await p.locator('.toolbar-btn[title="New"]').click();
    },
  },
];

for (const state of STATES) {
  test(`A1-${state.name}: axe 위반이 없다`, async ({ page }) => {
    await open(page);
    await state.setup(page);

    const results = await new AxeBuilder({ page }).analyze();
    // 실패 시 어떤 규칙이 어디서 걸렸는지 바로 보이게 요약해 단언한다.
    expect(
      results.violations.map((v) => `${v.id}(${v.impact}) @ ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);
  });
}

test("A2: 다크 모드에서도 axe 위반이 없다", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await page.locator("#editor").fill(SAMPLE);
  await expect(page.locator("#preview h1")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("A3: 키보드만으로 탭을 전환할 수 있다", async ({ page }) => {
  // 예전에는 탭이 <div> 라 클릭으로만 전환됐다 — axe 는 통과하면서도
  // 키보드 사용자는 탭을 아예 바꿀 수 없었다. 자동 점검의 한계를 보여주는 예다.
  await open(page);
  await page.locator("#editor").fill("첫 문서");
  await page.locator('.toolbar-btn[title="New"]').click();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
  await expect(page.locator("#editor")).toHaveValue("");

  await page.locator("#tab-bar .tab-name").first().focus();
  await expect(page.locator("#tab-bar .tab-name").first()).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator("#editor")).toHaveValue("첫 문서");
});

test("A4: 키보드만으로 탭을 닫을 수 있다", async ({ page }) => {
  await open(page);
  await page.locator('.toolbar-btn[title="New"]').click();
  await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

  await page.locator("#tab-bar .tab-close").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
});

test("A5: 모든 인터랙티브 요소에 접근 가능한 이름이 있다", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator("#search-toggle-replace").click();

  const unnamed = await page.evaluate(() => {
    const selector = "button, [role='separator'], input, textarea, a[href]";
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        // `<label for="...">` 연결도 **유효한 접근 가능한 이름**이다. 이걸 빼먹으면
        // 제대로 이름이 붙은 체크박스를 결함으로 잘못 보고한다(실제로 그랬다).
        const labelled = el.id
          ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
          : null;
        const name =
          el.getAttribute("aria-label") ??
          el.getAttribute("title") ??
          labelled ??
          (el.textContent ?? "").trim();
        return !name;
      })
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || "(no id)"}.${el.className}`);
  });

  expect(unnamed).toEqual([]);
});

test("A6: 포커스가 보인다 — 툴바·탭·리사이저·편집 영역", async ({ page }) => {
  await open(page);

  // UA 기본 링은 어두운 툴바 위에서 거의 보이지 않는다.
  const outlines = await page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      el.focus();
      const cs = getComputedStyle(el);
      return { width: cs.outlineWidth, style: cs.outlineStyle };
    };
    return {
      toolbar: read(".toolbar-btn"),
      tab: read("#tab-bar .tab-name"),
      resizer: read("#split-resizer"),
      editor: read("#editor"),
      preview: read("#preview"),
    };
  });

  for (const [where, outline] of Object.entries(outlines)) {
    expect(parseFloat(outline.width), `${where} 포커스 윤곽선 두께`).toBeGreaterThanOrEqual(2);
    expect(outline.style, `${where} 포커스 윤곽선 스타일`).not.toBe("none");
  }
});

test("A7: 프리뷰를 키보드로 스크롤할 수 있다", async ({ page }) => {
  // tabindex 가 없으면 포커스를 줄 수 없고, 마우스 없이는 렌더 결과를
  // 읽어 내려갈 방법이 아예 없다.
  await open(page);
  await page.locator("#editor").fill(Array.from({ length: 200 }, (_, i) => `${i}번째 줄`).join("\n"));
  await expect(page.locator("#preview")).not.toBeEmpty();

  await page.locator("#preview").focus();
  await expect(page.locator("#preview")).toBeFocused();

  await page.keyboard.press("PageDown");
  await expect
    .poll(() => page.locator("#preview").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});

test("A8: 랜드마크로 주요 영역이 구분된다", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+f");

  const landmarks = await page.evaluate(() =>
    [...document.querySelectorAll("header, nav, main, [role='search'], [role='region']")].map(
      (el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        label: el.getAttribute("aria-label"),
      }),
    ),
  );

  // 스크린리더 사용자가 영역 단위로 건너뛸 수 있어야 한다.
  expect(landmarks.some((l) => l.tag === "header")).toBe(true);
  expect(landmarks.some((l) => l.tag === "nav" && l.label)).toBe(true);
  expect(landmarks.some((l) => l.tag === "main")).toBe(true);
  expect(landmarks.some((l) => l.role === "search" && l.label)).toBe(true);
  expect(landmarks.some((l) => l.role === "region" && l.label)).toBe(true);
});

test("A9: 상태 변화가 스크린리더에 전달된다", async ({ page }) => {
  await open(page);

  const live = await page.evaluate(() => ({
    notice: document.querySelector("#notice")?.getAttribute("aria-live"),
    searchCount: document.querySelector("#search-count")?.getAttribute("aria-live"),
  }));
  expect(live.notice).toBe("polite");
  expect(live.searchCount).toBe("polite");

  // 토글 상태는 aria-pressed / aria-expanded 로 노출된다.
  await expect(page.locator("#view-mode")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#view-mode").click();
  await expect(page.locator("#view-mode")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator("#search-toggle-replace")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#search-toggle-replace").click();
  await expect(page.locator("#search-toggle-replace")).toHaveAttribute("aria-expanded", "true");
});

test("A10: 애니메이션을 줄이는 설정을 존중한다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  const transition = await page
    .locator(".toolbar-btn")
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition).toBe("0s");
});

test("A11: 활성 탭이 프로그램적으로 구분된다", async ({ page }) => {
  await open(page);
  await page.locator('.toolbar-btn[title="New"]').click();

  const current = await page.evaluate(() =>
    [...document.querySelectorAll("#tab-bar .tab-name")].map((el) =>
      el.getAttribute("aria-current"),
    ),
  );

  // 색(.active 클래스)만으로 구분하면 스크린리더에는 전달되지 않는다.
  expect(current.filter((c) => c === "true")).toHaveLength(1);
});
