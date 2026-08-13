import { test, expect } from "@playwright/test";

/**
 * F-70 오프라인 상태 표시.
 *
 * `online`/`offline` 이벤트는 서비스 워커·`_headers` 와 달리 배포 환경에 의존하지
 * 않으므로(§design) 로컬 dev 서버에서도 그대로 검증한다(hardening.spec.ts 의
 * isRemote 스킵 패턴 불필요). `context.setOffline()` 으로 실제 오프라인을 재현한다.
 */
test.describe("F-70 오프라인 상태 표시", () => {
  test("페이지 로드 후 오프라인 전환 시 배지가 뜨고, 온라인 복귀 시 사라진다", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    const indicator = page.locator("#offline-indicator");
    await expect(indicator).toBeHidden();

    await context.setOffline(true);
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveText(/오프라인/);

    await context.setOffline(false);
    await expect(indicator).toBeHidden();
  });

  test("오프라인 상태에서도 편집·프리뷰가 계속 동작한다", async ({ page, context }) => {
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator("#offline-indicator")).toBeVisible();

    await editor.fill("# 오프라인 편집");
    await expect(page.locator("#preview h1")).toHaveText("오프라인 편집");

    await context.setOffline(false);
  });

  // 참고: "최초 로드부터 오프라인" 케이스(로드 시점 navigator.onLine === false)는
  // 서비스 워커가 앱 셸을 캐시해야만 오프라인 상태에서 페이지 자체가 열리므로
  // (§7.1, dev 서버는 SW 미등록) 이 스펙에서는 재현하지 않는다 — 대신
  // `tests/offline.test.ts` 단위 테스트가 가짜 host 로 이 경로를 전량 검증한다.

  test("기존 알림(#notice)·갱신 알림(#sw-update) id/구조를 건드리지 않는다", async ({
    page,
  }) => {
    await page.goto("/");

    // F-70 이전부터 있던 알림 요소들이 그대로 존재해야 한다(회귀 방지).
    await expect(page.locator("#notice")).toBeAttached();
    await expect(page.locator("#sw-update")).toBeAttached();
    await expect(page.locator("#sw-update-text-idle")).toBeAttached();
    await expect(page.locator("#sw-update-text-updating")).toBeAttached();
    await expect(page.locator("#sw-update-later")).toBeAttached();
    await expect(page.locator("#sw-update-reload")).toBeAttached();
  });
});
