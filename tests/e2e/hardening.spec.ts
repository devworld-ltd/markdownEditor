import { test, expect } from "@playwright/test";
import { installFsMock } from "./fixtures";

/**
 * F-54 자동 저장 실패 알림 / F-61 PWA / F-62 보안 헤더 검증.
 *
 * `_headers` 와 서비스 워커는 **배포 환경에서만** 유효하다.
 * - `_headers` 는 Cloudflare Workers 가 적용한다 (vite 개발 서버는 무시).
 * - 서비스 워커는 `import.meta.env.PROD` 일 때만 등록한다.
 * 따라서 해당 테스트는 원격 baseURL 로 실행할 때만 수행하고 로컬에서는 skip 한다.
 */
function isRemote(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  return !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseURL);
}

test.describe("F-54 자동 저장 실패 알림", () => {
  test("저장소 용량이 초과되면 사용자에게 알린다", async ({ page }) => {
    await installFsMock(page);
    // 저장 시도만 실패시키고 읽기는 정상 동작시켜, "쓸 수 있는데 실패한" 상태를 만든다.
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith("markdown-editor:session")) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
    });

    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    await page.locator("#editor").fill("# 저장 실패를 유발하는 내용");

    const notice = page.locator("#notice");
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(notice).toHaveAttribute("data-kind", "error");
    await expect(notice).toContainText("자동 저장이 중단");

    // 알림이 떠도 편집은 계속 가능해야 한다.
    await page.locator("#editor").fill("계속 편집 가능");
    await expect(page.locator("#editor")).toHaveValue("계속 편집 가능");
  });

  test("저장이 정상이면 실패 알림이 뜨지 않는다", async ({ page }) => {
    await installFsMock(page);
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    await page.locator("#editor").fill("정상 저장");
    await page.waitForTimeout(1000);

    await expect(page.locator("#notice")).toBeHidden();
  });
});

test.describe("F-61 PWA", () => {
  test("manifest 가 서빙되고 필수 필드를 갖춘다", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe("Markdown Editor");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#1e1e1e");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  test("아이콘과 서비스 워커 스크립트가 서빙된다", async ({ request }) => {
    const icon = await request.get("/icon.svg");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("svg");

    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(await sw.text()).toContain("addEventListener");
  });

  test("문서에 manifest 링크가 있다", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/icon.svg");
  });

  test("배포 환경에서 서비스 워커가 등록된다", async ({ page, baseURL }) => {
    test.skip(!isRemote(baseURL), "서비스 워커는 프로덕션 빌드에서만 등록된다");

    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.scope;
    });
    expect(scope).toContain(new URL(baseURL!).host);
  });

  // F-69 E8 — 실제 서비스 워커 회귀: 오프라인 동작과 등록이 그대로 유지된다(U10 REMOTE).
  // 스텁 주입 없이 실제 원격 배포 워커를 대상으로 하므로 이 블록(같은 isRemote 판정,
  // 같은 관심사)에 추가한다. 기존 3건의 순서·내용은 건드리지 않는다.
  test("배포 환경에서 오프라인 동작과 업데이트 감지가 회귀 없이 유지된다 (F-69 E8)", async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(!isRemote(baseURL), "서비스 워커는 배포 환경에서만 등록된다");

    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    // 서비스 워커가 활성화될 때까지 기다린다.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    // 방금 배포된 단일 버전이므로 대기 워커가 없어야 하고, 업데이트 알림도 뜨지 않는다.
    await page.waitForTimeout(1500);
    await expect(page.locator("#sw-update")).toBeHidden();

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator("#editor")).toBeVisible();

      await page.locator("#editor").fill("# 오프라인");
      await expect(page.locator("#preview h1")).toHaveText("오프라인");
    } finally {
      await context.setOffline(false);
    }

    await expect(page.locator("#sw-update")).toBeHidden();
  });
});

test.describe("F-62 보안 헤더", () => {
  test("CSP 와 보안 헤더가 적용된다", async ({ request, baseURL }) => {
    test.skip(!isRemote(baseURL), "_headers 는 Cloudflare 배포 환경에서만 적용된다");

    const res = await request.get("/");
    const headers = res.headers();

    const csp = headers["content-security-policy"];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // 인라인 스크립트·eval 은 어떤 경우에도 허용하지 않는다.
    expect(csp).not.toContain("'unsafe-inline'; script-src");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("'unsafe-eval'");
    // 외부 스크립트는 Cloudflare Web Analytics 비콘만 허용한다.
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    const allowedHosts = scriptSrc
      .replace("script-src", "")
      .trim()
      .split(/\s+/)
      .filter((t) => t !== "'self'");
    expect(allowedHosts).toEqual(["https://static.cloudflareinsights.com"]);

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  test("해시 자산은 장기 캐시, 진입 문서는 no-cache 다", async ({ request, baseURL }) => {
    test.skip(!isRemote(baseURL), "_headers 는 Cloudflare 배포 환경에서만 적용된다");

    const html = await request.get("/");
    expect(html.headers()["cache-control"]).toContain("no-cache");

    const body = await html.text();
    const asset = body.match(/\/assets\/[^"]+\.js/)?.[0];
    expect(asset).toBeTruthy();

    const js = await request.get(asset!);
    expect(js.headers()["cache-control"]).toContain("immutable");
  });

  test("CSP 위반 없이 페이지가 동작한다", async ({ page, baseURL }) => {
    test.skip(!isRemote(baseURL), "_headers 는 Cloudflare 배포 환경에서만 적용된다");

    const violations: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) {
        violations.push(msg.text());
      }
    });

    await page.goto("/");
    await page.locator("#editor").fill("# 제목\n\n**굵게**");
    await expect(page.locator("#preview h1")).toHaveText("제목");

    expect(violations).toEqual([]);
  });
});
