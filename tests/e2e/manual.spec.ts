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
