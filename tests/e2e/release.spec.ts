import { expect, test } from "@playwright/test";

/**
 * #131 릴리스 노트.
 *
 * 단위 테스트가 파싱과 "언제 띄우는가" 를 맡는다. 여기서는 **빌드가 실제로
 * CHANGELOG 를 넣었는지**와 네트워크를 늘리지 않았는지를 본다 — 가상 모듈은
 * 빌드 경로라 단위 테스트로는 닿지 않는다.
 */

const VERSION_BTN = "#release-open";
const DIALOG = "#release-notes";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("RN1: 상태 표시줄에 현재 버전이 보인다", async ({ page }) => {
  await expect(page.locator(VERSION_BTN)).toBeVisible();
  await expect(page.locator("#release-version")).toHaveText(/^v\d+\.\d+\.\d+$/);
});

test("RN2: 버전을 누르면 새 소식이 열리고 CHANGELOG 내용이 보인다", async ({ page }) => {
  await page.locator(VERSION_BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();

  // 빌드가 CHANGELOG 를 번들에 넣지 않았다면 여기서 0 이 된다.
  await expect(page.locator("#release-notes .release-item").first()).toBeVisible();
  const count = await page.locator("#release-notes .release-item").count();
  expect(count).toBeGreaterThanOrEqual(2);
});

test("RN3: 화면의 버전과 목록의 '지금 버전' 이 일치한다", async ({ page }) => {
  const shown = (await page.locator("#release-version").textContent())?.replace("v", "");
  await page.locator(VERSION_BTN).click();

  const current = page.locator(".release-item:has(.release-current)");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute("data-version", shown!);
});

test("RN4: 본문이 마크다운으로 렌더된다 — 원문이 그대로 보이면 안 된다", async ({ page }) => {
  await page.locator(VERSION_BTN).click();
  const body = page.locator(".release-item").first().locator(".release-body");
  await expect(body.locator("li").first()).toBeVisible();
  await expect(body).not.toContainText("### 추가");
});

test("RN5: 최신만 펼쳐져 있고 헤딩을 누르면 접힌다", async ({ page }) => {
  await page.locator(VERSION_BTN).click();
  const items = page.locator(".release-item");

  await expect(items.first()).not.toHaveAttribute("data-collapsed", "true");
  await expect(items.nth(1)).toHaveAttribute("data-collapsed", "true");

  await items.nth(1).locator(".release-version").click();
  await expect(items.nth(1)).not.toHaveAttribute("data-collapsed", "true");
});

test("RN6: 갱신 뒤 처음 열면 자동으로 뜨고, 다음 번에는 뜨지 않는다", async ({ page }) => {
  // 예전 버전을 본 것으로 심는다.
  //
  // **`addInitScript` 를 쓰면 안 된다** — 매 내비게이션마다 다시 실행되어 두 번째
  // 새로고침에서도 값이 되살아나고, 그러면 "한 번만 뜬다" 를 검증할 수 없다
  // (실측: 이 테스트가 그것 때문에 실패했다).
  await page.evaluate(() =>
    localStorage.setItem("markdown-editor:seen-version:v1", "0.0.1"),
  );
  await page.reload();
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.locator("#release-close").click();
  await expect(page.locator(DIALOG)).toBeHidden();

  // 연 순간 기록했으므로 다시 열어도 자동으로 뜨지 않는다.
  await page.reload();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(DIALOG)).toBeHidden();
});

test("RN7: 처음 온 사람에게는 뜨지 않는다 — 그 사람에게는 전부가 처음이다", async ({ page }) => {
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator(DIALOG)).toBeHidden();
});

test("RN8: 릴리스 노트 때문에 네트워크 요청이 늘지 않는다", async ({ page, baseURL }) => {
  // 리스너는 반드시 goto 앞에 붙인다 — 뒤에 붙이면 기동 요청을 통째로 놓친다(트랩 #74).
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator(VERSION_BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await page.waitForTimeout(300);

  // 문서·자산 외의 데이터 요청이 없어야 한다.
  const data = requests.filter((u) => /\.(json|md|txt)(\?|$)/.test(u) || /\/api\//.test(u));
  expect(data, `예상 밖 요청: ${data.join(", ")}`).toHaveLength(0);
  expect(baseURL).toBeTruthy();
});

test("RN9: 통계 표시와 버전이 함께 보인다 — 한쪽이 다른 쪽을 지우지 않는다", async ({
  page,
}) => {
  await page.locator("#editor").fill("가 나 다");
  await expect(page.locator("#status-stats")).toContainText("3어절");
  await expect(page.locator("#release-version")).toHaveText(/^v\d/);
});
