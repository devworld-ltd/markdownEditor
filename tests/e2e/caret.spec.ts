import { expect, test } from "@playwright/test";

/**
 * #152 커서 위치.
 *
 * **디바운스에 얹지 않았다**는 것이 이 기능의 본체다. 그래서 여기서는 대기 없이
 * 바로 단언한다 — 폴링으로 여유를 주면 150ms 디바운스에 얹어도 통과해 버린다
 * (트랩 #68 의 커서 버전).
 */

const CARET = "#status-caret";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test("CP1: 캐럿을 옮기면 행·열이 따라온다", async ({ page }) => {
  await page.locator("#editor").fill("첫 줄\n둘째 줄\n셋째 줄입니다");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    const third = el.value.lastIndexOf("셋");
    el.setSelectionRange(third + 4, third + 4);
  });

  await expect(page.locator(CARET)).toHaveText("3행 5열");
});

test("CP2: 선택하면 선택 정보가 함께 보인다", async ({ page }) => {
  await page.locator("#editor").fill("첫 줄\n둘째 줄\n셋째 줄");
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 8);
  });

  await expect(page.locator(CARET)).toContainText("선택");
  await expect(page.locator(CARET)).toContainText("줄");
});

test("CP3: 입력하면 곧바로 따라온다 — 렌더 디바운스를 기다리지 않는다", async ({
  page,
}) => {
  await page.locator("#editor").click();
  await page.locator("#editor").pressSequentially("가나다");

  /**
   * **한 번만 읽지 말 것.** `selectionchange` 는 작업(task)으로 큐에 들어가므로
   * 마지막 입력 직후의 단 한 번 읽기는 도착 전일 수 있다 — 실제로 로컬에서는
   * 통과하고 prod 검증에서만 실패했다(그리고 다시 돌리면 로컬에서도 실패했다).
   *
   * 그렇다고 여유를 넉넉히 주면 **150ms 렌더 디바운스에 얹어도 통과**해 이
   * 테스트가 지키려는 것이 사라진다(트랩 #68). 그래서 **디바운스보다 짧은
   * 100ms 안에** 도착하는지를 본다.
   */
  await expect(page.locator(CARET)).toHaveText("1행 4열", { timeout: 100 });
});

test("CP4: 큰 문서(10만 자)에서도 캐럿을 옮기는 동안 멈추지 않는다", async ({ page }) => {
  const big = Array.from(
    { length: 2000 },
    (_, i) => `${i}번째 줄입니다 ${"가나다라마바사아자차".repeat(5)}`,
  ).join("\n");
  await page.locator("#editor").fill(big);
  expect(big.length).toBeGreaterThan(100_000);

  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  const elapsed = await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    const t = performance.now();
    for (let i = 0; i < 2000; i += 1) {
      el.setSelectionRange(el.value.length - i, el.value.length - i);
    }
    return performance.now() - t;
  });

  /**
   * **이 단언은 캐시나 이진 탐색을 구별하지 못한다.** `selectionchange` 는
   * 작업(task)당 한 번으로 합쳐지므로, 위 2000회 이동은 갱신을 **한 번** 부른다
   * (둘 다 지우고 재실행해 확인했다). 여기서 지키는 것은 "큰 문서에서 캐럿을
   * 움직여도 편집이 멈추지 않는다" 라는 훨씬 느슨한 성질이다.
   *
   * 계산 비용의 근거는 `caretPosition.ts` 머리의 실측표에 있다.
   */
  expect(elapsed).toBeLessThan(500);
  // 마지막에서 200자 뒤로 물러난 자리 — 문서 끝 근처의 줄이어야 한다.
  const shown = (await page.locator(CARET).textContent()) ?? "";
  expect(shown).toMatch(/^\d+행 \d+열$/);
  expect(Number(shown.match(/^(\d+)행/)?.[1])).toBeGreaterThan(1900);
});

test("CP5: 상태 표시줄에 aria-live 를 붙이지 않는다 — 글자마다 읽히면 편집 불가", async ({
  page,
}) => {
  const bar = page.locator("#status-bar");
  await expect(bar).not.toHaveAttribute("aria-live", /.+/);
  await expect(bar).not.toHaveAttribute("role", "status");
  await expect(page.locator(CARET)).not.toHaveAttribute("aria-live", /.+/);
});

test("CP6: 저장 상태·커서·통계가 한 줄에 겹치지 않고 놓인다", async ({ page }) => {
  await page.locator("#editor").fill("가나다");
  const caret = await page.locator(CARET).boundingBox();
  const stats = await page.locator("#status-stats").boundingBox();
  expect(caret).not.toBeNull();
  // 커서는 통계보다 왼쪽에 있어야 한다 — 오른쪽 끝은 통계와 버전 자리다.
  expect(caret!.x).toBeLessThan(stats!.x);
});
