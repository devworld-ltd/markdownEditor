import { expect, test } from "@playwright/test";

/**
 * #141 사용 설명서.
 *
 * 단위 테스트가 "정화를 거치는가·한 번만 그리는가" 를 맡는다. 여기서는 **빌드가
 * 실제로 `docs/manual.md` 를 번들에 넣었는지**와 네트워크를 늘리지 않았는지를 본다 —
 * 가상 모듈은 빌드 경로라 단위 테스트로는 닿지 않는다.
 *
 * **문장을 단언하지 않는다.** 문서는 사람이 고칠 글이고, 문구를 고정하면 손댈 때마다
 * 테스트가 깨져 결국 문서를 안 고치게 된다. 구조(제목·표·코드블록)만 본다.
 */

const BTN = '.toolbar-btn[title="Manual"]';
const DIALOG = "#manual";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("MA1: 툴바 매뉴얼 버튼으로 연다", async ({ page }) => {
  await expect(page.locator(BTN)).toBeVisible();
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();
});

test("MA2: 빌드가 docs/manual.md 를 번들에 넣었다", async ({ page }) => {
  await page.locator(BTN).click();

  const body = page.locator("#manual-body");
  // 번들에 안 들어갔다면 "불러오지 못했습니다" 가 뜬다.
  await expect(body).not.toContainText("불러오지 못했습니다");
  await expect(body.locator("h1")).toBeVisible();

  // 사용 설명서라면 절이 여럿이고 표가 있다 — 문장이 아니라 구조를 본다.
  expect(await body.locator("h2").count()).toBeGreaterThanOrEqual(5);
  expect(await body.locator("table").count()).toBeGreaterThanOrEqual(3);
});

test("MA3: 마크다운이 렌더된다 — 원문이 그대로 보이면 안 된다", async ({ page }) => {
  await page.locator(BTN).click();
  const body = page.locator("#manual-body");

  await expect(body).not.toContainText("## 1.");
  await expect(body.locator("code").first()).toBeVisible();
});

test("MA4: 닫으면 편집기로 포커스가 돌아온다", async ({ page }) => {
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.locator("#manual-close").click();
  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(page.locator("#editor")).toBeFocused();
});

test("MA5: Esc 로도 닫힌다", async ({ page }) => {
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
});

test("MA6: 본문을 키보드로 내려 읽을 수 있다", async ({ page }) => {
  await page.locator(BTN).click();
  const body = page.locator("#manual-body");

  // `tabindex` 가 없으면 스크롤 컨테이너에 포커스가 가지 않아 키보드만으로는 못 읽는다.
  await expect(body).toHaveAttribute("tabindex", "0");
  await body.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // **닫기 버튼이 화면에 남아 있어야 한다.** 대화상자가 통째로 스크롤되면 제목과
  // 닫기 버튼이 같이 밀려 올라가, 긴 문서를 내려 읽는 도중 닫을 방법이 사라진다.
  const close = page.locator("#manual-close");
  await expect(close).toBeInViewport();
  expect(await page.locator(DIALOG).evaluate((el) => el.scrollTop)).toBe(0);
});

test("MA7: 설명서 때문에 네트워크 요청이 늘지 않는다", async ({ page }) => {
  // 리스너는 반드시 goto 앞에 붙인다 (트랩 #74).
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await page.waitForTimeout(300);

  const data = requests.filter((u) => /\.(json|md|txt)(\?|$)/.test(u) || /\/api\//.test(u));
  expect(data, `예상 밖 요청: ${data.join(", ")}`).toHaveLength(0);
});

test("MA8: 설명서를 열어도 편집 중인 문서가 바뀌지 않는다", async ({ page }) => {
  await page.locator("#editor").fill("# 내 문서");
  const tabsBefore = await page.locator("#tab-bar .tab").count();

  await page.locator(BTN).click();
  await page.locator("#manual-close").click();

  // 새 탭으로 열지 않는다 — 사용자가 그것을 고쳐 저장하려 드는 것을 막기 위해서다.
  await expect(page.locator("#tab-bar .tab")).toHaveCount(tabsBefore);
  await expect(page.locator("#editor")).toHaveValue("# 내 문서");
});

/** #151 차례 사이드바. */

async function openManual(page: import("@playwright/test").Page) {
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();
}

const TOC = "#manual-toc .manual-toc-link";

test("MT1: 차례 항목 수가 본문 절 개수와 같다 — 손으로 적은 목록이 아니다", async ({
  page,
}) => {
  await openManual(page);
  const sections = await page.locator("#manual-body h2").count();
  expect(sections).toBeGreaterThan(5);
  await expect(page.locator(TOC)).toHaveCount(sections);
});

test("MT2: 차례를 누르면 본문이 그 절로 이동한다", async ({ page }) => {
  await openManual(page);
  const body = page.locator("#manual-body");
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0);

  await page.locator(TOC).nth(4).click();

  expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(TOC).nth(4)).toHaveAttribute("aria-current", "true");
  // 이동은 **대화상자 안에서만** 일어나야 한다. 기본 동작을 막지 않으면 주소에
  // `#manual-…` 이 남고, 그 주소를 새로고침하면 앱이 엉뚱한 자리에서 뜬다.
  expect(page.url()).not.toContain("#");
});

test("MT3: 본문을 스크롤하면 강조가 따라온다", async ({ page }) => {
  await openManual(page);
  await expect(page.locator(TOC).first()).toHaveAttribute("aria-current", "true");

  await page.locator("#manual-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2;
  });

  await expect(page.locator(`${TOC}[aria-current="true"]`)).toHaveCount(1);
  await expect(page.locator(TOC).first()).not.toHaveAttribute("aria-current", "true");
});

test("MT4: 끝까지 내리면 마지막 절이 강조된다", async ({ page }) => {
  await openManual(page);
  await page.locator("#manual-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(TOC).last()).toHaveAttribute("aria-current", "true");
});

test("MT5: 끝까지 내려도 닫기 버튼이 화면에 남는다 — 스크롤하는 것은 본문뿐", async ({
  page,
}) => {
  await openManual(page);
  await page.locator("#manual-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  const close = page.locator("#manual-close");
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
});

test("MT6: 다시 열면 처음 절로 돌아온다", async ({ page }) => {
  await openManual(page);
  await page.locator(TOC).nth(4).click();
  await page.locator("#manual-close").click();
  await openManual(page);

  expect(await page.locator("#manual-body").evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.locator(TOC).first()).toHaveAttribute("aria-current", "true");
});

test("MT7: 좁은 화면에서도 본문이 읽을 수 있는 폭을 갖는다", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await openManual(page);

  const tocBox = await page.locator("#manual-toc").boundingBox();
  const bodyBox = await page.locator("#manual-body").boundingBox();
  // 옆으로 두면 본문이 절반 이하로 좁아진다 — 위아래로 쌓여야 한다.
  expect(bodyBox!.y).toBeGreaterThan(tocBox!.y);
  expect(bodyBox!.width).toBeGreaterThan(300);
});
