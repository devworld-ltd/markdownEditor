import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { installFallbackMode } from "./fixtures";

/**
 * F-90(원격 URL 열기) · F-91(로컬 열기 파라미터) — 이슈 #195.
 *
 * **이 파일이 작성된 시점에는 아직 구현이 없다**(`src/openParams.ts` · `remoteDoc.ts` ·
 * `openUrlUi.ts` · `#open-url-dialog` 전부 미존재). devflow STEP 5 구현자가 이 시나리오를
 * 테스트가 실제로 활성화된다. 단언은 지금도 전부 실제 값으로 채워져 있다(빈 테스트
 * 금지 — 다음 사람이 통과한 줄 착각하면 안 된다).
 *
 * 기준 문서: context/03_tech_spec.md §11 (E1~E9). 여기서 다루지 않는 것은 §10
 * 단위 테스트(tests/openParams.test.ts · tests/remoteDoc.test.ts · tests/openUrlUi.test.ts)
 * 가 맡는다.
 *
 * 선택된 DOM 계약(§9 `index.html` 변경 계획, 아직 실물 없음):
 *   #open-url-dialog · #open-url-title · #open-url-body · #open-url-target ·
 *   #open-url-cancel · #open-url-confirm
 */

const TARGET_ORIGIN = "https://example.test";
const TARGET_PATH = "/docs/guide.md";
const TARGET_URL = `${TARGET_ORIGIN}${TARGET_PATH}`;

const DIALOG = "#open-url-dialog";
const CONFIRM = "#open-url-confirm";
const CANCEL = "#open-url-cancel";
const TARGET_BOX = "#open-url-target";

/**
 * 대상 호스트로 나가는 요청을 `goto` **앞에서** 세기 시작한다(트랩 #74).
 * 뒤에 붙이면 기동 시 요청을 놓쳐, 기능을 통째로 빼도 이 배열이 비어 있는 채로
 * "요청 0건" 이 거짓으로 통과한다.
 */
function watchRequestsTo(page: Page, urlSubstring: string): string[] {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(urlSubstring)) hits.push(r.url());
  });
  return hits;
}

/** SH8 과 같은 성격의 전역 감시 — 외부 오리진 + `/api/` 요청을 모두 담는다(E2). */
function watchExternalRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    const isExternal = url.origin !== "http://127.0.0.1:5173" && !url.hostname.match(/^(127\.0\.0\.1|localhost)$/);
    if (isExternal || url.pathname.startsWith("/api/")) hits.push(r.url());
  });
  return hits;
}

/** 대상 주소에 성공 응답을 흉내 낸다. ACAO 는 기본적으로 허용한다. */
async function stubSuccess(
  page: Page,
  body: string,
  opts: { contentType?: string; acao?: boolean } = {},
): Promise<void> {
  const { contentType = "text/markdown", acao = true } = opts;
  await page.route(TARGET_URL, async (route) => {
    const headers: Record<string, string> = { "content-type": contentType };
    if (acao) headers["access-control-allow-origin"] = "*";
    await route.fulfill({ status: 200, headers, body });
  });
}

/** 404 등 HTTP 오류를 흉내 낸다. */
async function stubHttpError(page: Page, status: number): Promise<void> {
  await page.route(TARGET_URL, async (route) => {
    await route.fulfill({
      status,
      headers: { "access-control-allow-origin": "*" },
      body: "not found",
    });
  });
}

/** 연결 자체가 실패하는 상황(끊긴 포트·DNS 없음과 같은 성격)을 흉내 낸다. */
async function stubNetworkFailure(page: Page): Promise<void> {
  await page.route(TARGET_URL, (route) => route.abort("connectionrefused"));
}

/** `Content-Length` 헤더로 2MB 상한을 초과시킨다 — 본문을 읽기 전에 걸려야 한다. */
async function stubTooLargeByHeader(page: Page): Promise<void> {
  await page.route(TARGET_URL, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/markdown",
        "access-control-allow-origin": "*",
        "content-length": "3000000",
      },
      // 실제 바이트는 작다 — 사전검사가 헤더만 보고 먼저 끊는지가 이 케이스의 요점이다.
      body: "# 헤더만 큼",
    });
  });
}

/**
 * `Content-Length` 없이 실제로 2MB 를 넘는 본문을 청크 전송한다(부정 케이스, §1-2).
 * Playwright `route.fulfill()` 은 넘긴 body 길이로 `Content-Length` 를 자동 계산해
 * 버려서 "헤더가 없는" 상황을 재현하지 못한다 — 그래서 실제 Node HTTP 서버를 띄워
 * 청크 전송 인코딩(헤더 미기재)으로 스트리밍한다. 서버는 우리가 만든 것이므로
 * ACAO 를 직접 붙일 수 있다.
 */
async function startChunkedOversizeServer(
  totalBytes: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/markdown",
      "access-control-allow-origin": "*",
      // Content-Length 를 의도적으로 쓰지 않는다 — Node 가 chunked 로 폴백한다.
    });
    const chunk = "x".repeat(64 * 1024);
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= totalBytes) {
        clearInterval(timer);
        res.end();
        return;
      }
      const piece = chunk.slice(0, Math.min(chunk.length, totalBytes - sent));
      res.write(piece);
      sent += piece.length;
    }, 1);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/large.md`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe("E1: 링크로 받은 원격 마크다운을 확인하고 연다 (AC-1·AC-3·AC-14)", () => {
  test("확인 전 요청 0건 → 열기 → 새로고침해도 다시 받지 않는다", async ({ page }) => {

    const hits = watchRequestsTo(page, TARGET_ORIGIN);
    await stubSuccess(page, "# 안녕");

    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);

    // ① 대화상자가 뜬 채로 아무것도 하지 않는다 — 요청은 아직 0건.
    await expect(page.locator(DIALOG)).toBeVisible();
    await expect(page.locator("#open-url-body")).toContainText("example.test");
    await expect(page.locator(TARGET_BOX)).toHaveText(TARGET_URL);
    expect(hits, "확인 전에 대상으로 요청이 나갔다").toHaveLength(0);

    // ② "열기"
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
    await page.locator(CONFIRM).click();

    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("guide.md");
    await expect(page.locator("#editor")).toHaveValue("# 안녕");
    await expect(page.locator("#preview")).toContainText("안녕");
    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "info");
    await expect(page.locator("#notice")).toContainText("example.test");
    await expect.poll(() => new URL(page.url()).search).toBe("");

    // ③ 새로고침 — 다시 받아오지 않는다.
    const afterOpenCount = hits.length;
    await page.reload();
    await expect(page.locator("#editor")).toBeVisible();
    expect(hits.length, "새로고침 뒤 대상으로 추가 요청이 나갔다").toBe(afterOpenCount);
    await expect(page.locator(DIALOG)).toBeHidden();
  });

  test("같은 주소를 두 번 열면 탭이 2개 더 생긴다 — 중복 방지를 하지 않는다 (§7-1)", async ({
    page,
  }) => {

    await stubSuccess(page, "# 안녕");
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();
    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();
    await expect(page.locator("#tab-bar .tab")).toHaveCount(3);
  });
});

test.describe("E2: 파라미터 없이 평소대로 쓴다 — 네트워크 0건 (AC-2)", () => {
  test("외부·/api/ 요청 0건, 확인 대화상자는 존재하되 열려 있지 않다", async ({ page }) => {

    const external = watchExternalRequests(page);

    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    // 대화상자 자체는 DOM 에 존재해야 한다 — <dialog> 는 닫힌 채로 마크업에 있다.
    await expect(page.locator(DIALOG)).toBeAttached();
    await expect(page.locator(DIALOG)).toBeHidden();

    await page.locator("#editor").fill("hello");
    await page.waitForTimeout(400);

    await expect(page.locator("#preview")).toContainText("hello");
    expect(external, `외부/API 요청 발생: ${external.join(", ")}`).toHaveLength(0);
  });

  test("?url= 이 빈 값이면 요청·대화상자·알림이 전부 없다", async ({ page }) => {

    const external = watchExternalRequests(page);

    await page.goto("/?url=");
    await expect(page.locator("#editor")).toBeVisible();

    await expect(page.locator(DIALOG)).toBeHidden();
    await expect(page.locator("#notice")).toBeHidden();
    expect(external).toHaveLength(0);
  });
});

test.describe("E3: 실패를 갈래별로 구별해 안내받고, 앱은 멀쩡히 남는다 (AC-6~AC-9·AC-16)", () => {
  test("http(404) — 문구에 404 가 포함되고 탭은 늘지 않는다", async ({ page }) => {

    await stubHttpError(page, 404);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();

    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
    await expect(page.locator("#notice")).toContainText("404");
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);

    await page.locator("#editor").fill("계속");
    await expect(page.locator("#preview")).toContainText("계속");
  });

  test("network(연결 실패) — 문구에 '닿지 못했습니다' 가 포함된다", async ({ page }) => {

    await stubNetworkFailure(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();

    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
    await expect(page.locator("#notice")).toContainText("닿지 못했습니다");
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  });

  test("too-large(Content-Length 사전검사) — 문구에 2MB 가 포함된다", async ({ page }) => {

    await stubTooLargeByHeader(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();

    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
    await expect(page.locator("#notice")).toContainText("2MB");
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
  });

  test("too-large(부정 케이스 — 헤더 없이 본문 누적 초과) — 헤더가 없어도 상한이 걸린다", async ({
    page,
  }) => {

    const server = await startChunkedOversizeServer(2_600_000); // > MAX_REMOTE_BYTES(2MB)
    try {
      await page.goto(`/?url=${encodeURIComponent(server.url)}`);
      await page.locator(CONFIRM).click();

      await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
      await expect(page.locator("#notice")).toContainText("2MB");
      await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
    } finally {
      await server.close();
    }
  });

  test("네 문구가 서로 다르다 — 구별이 실제로 유지된다 (불변식)", async ({ page }) => {

    const messages: string[] = [];

    // http
    await stubHttpError(page, 404);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();
    // "가져오는 중…"(info) 은 곧바로 뜨므로, 최종 error 알림으로 바뀔 때까지
    // 기다린 뒤에 읽는다 — 아니면 세 갈래가 전부 같은 진행 문구로 겹쳐 보인다.
    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
    messages.push((await page.locator("#notice").textContent()) ?? "");
    await page.unrouteAll();

    // network
    await stubNetworkFailure(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();
    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
    messages.push((await page.locator("#notice").textContent()) ?? "");
    await page.unrouteAll();

    // too-large(헤더)
    await stubTooLargeByHeader(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();
    await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
    messages.push((await page.locator("#notice").textContent()) ?? "");

    expect(new Set(messages).size, "실패 문구가 서로 겹친다").toBe(messages.length);
  });

  test.skip(
    "CORS 거부 — page.route() 로는 재현 불가, 단위 테스트로 하향한다",
    () => {
      /**
       * tech spec(§ 지시)에 따라 ACAO 헤더 누락을 통한 진짜 CORS 거부는 이
       * 프로젝트의 route 기반 인터셉션 방식으로 결정적으로 재현할 수 없는 것으로
       * 판단해 이 시나리오를 내린다(재시도해도 브라우저별로 동일 오리진처럼
       * 응답할 위험이 있어 신뢰할 수 없는 단언이 된다).
       *
       * 대신 이 갈래(§4-3 `cors` reason, `fetchErrorMessage` 의 "CORS" 단어)는
       * `tests/remoteDoc.test.ts`(§10-2, 가짜 fetch 로 `TypeError` → `no-cors`
       * 탐침이 `{type:"opaque"}` 를 주는 상황을 직접 구성)가 결정적으로 고정한다.
       * 여기서는 그 사실만 기록해 둔다 — 통과하는 척하는 가짜 E2E 를 만들지 않는다.
       */
    },
  );
});

test.describe("E4: 위험하거나 열 수 없는 주소를 거절한다 — 요청 0건 (AC-5·AC-13)", () => {
  const rejects: Array<{ label: string; query: string; expectWord: string }> = [
    { label: "file:", query: "url=file:///Users/me/a.md", expectWord: "http" },
    { label: "javascript:", query: "url=javascript:alert(1)", expectWord: "http" },
    { label: "notaurl", query: "url=notaurl", expectWord: "http" },
    { label: "data:", query: "url=data:text/markdown,%23x", expectWord: "http" },
    {
      label: "http(비-localhost 평문)",
      query: "url=" + encodeURIComponent("http://example.com/a.md"),
      expectWord: "http",
    },
    { label: "?file=", query: "file=/Users/me/a.md", expectWord: "파일 선택" },
  ];

  for (const { label, query, expectWord } of rejects) {
    test(`거절: ${label}`, async ({ page }) => {

      const external = watchExternalRequests(page);

      await page.goto(`/?${query}`);
      await expect(page.locator("#editor")).toBeVisible();

      await expect(page.locator(DIALOG)).toBeHidden();
      await expect(page.locator("#notice")).toHaveAttribute("data-kind", "error");
      await expect(page.locator("#notice")).toContainText(expectWord);
      expect(external, "거절 대상인데 요청이 나갔다").toHaveLength(0);
      await expect(page.locator("#tab-bar .tab")).toHaveCount(1);

      await page.locator("#editor").fill("계속 편집");
      await expect(page.locator("#preview")).toContainText("계속 편집");
    });
  }

  test("?file= 경로에서 파일 선택창이 뜨지 않는다", async ({ page }) => {

    const chooserEvents: string[] = [];
    page.on("filechooser", () => chooserEvents.push("fired"));

    await page.goto("/?file=/Users/me/a.md");
    await expect(page.locator("#editor")).toBeVisible();
    await page.waitForTimeout(300);

    expect(chooserEvents, "?file= 만으로 파일 선택창이 열렸다").toHaveLength(0);
  });
});

test.describe("E5: 취소하면 아무 일도 일어나지 않는다 (AC-4·AC-10)", () => {
  async function setupDirtyFirstTab(page: Page): Promise<void> {
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator("#editor").fill("작성 중");
  }

  test("취소 버튼", async ({ page }) => {

    const hits = watchRequestsTo(page, TARGET_ORIGIN);
    await stubSuccess(page, "# 안녕"); // 받아오지 않아야 한다 — 응답은 정상이어도 무관

    await setupDirtyFirstTab(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.locator(CANCEL).click();

    await expect(page.locator(DIALOG)).toBeHidden();
    expect(hits).toHaveLength(0);
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.locator("#editor")).toHaveValue("작성 중");
  });

  test("Esc", async ({ page }) => {

    const hits = watchRequestsTo(page, TARGET_ORIGIN);
    await stubSuccess(page, "# 안녕");

    await setupDirtyFirstTab(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator(DIALOG)).toBeHidden();
    expect(hits).toHaveLength(0);
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
    await expect(page.locator("#editor")).toHaveValue("작성 중");
  });

  test("바깥(백드롭) 클릭 — 트랩 #25: 히트 타깃은 dialog 가 아니다, 좌표로 클릭한다", async ({
    page,
  }) => {

    const hits = watchRequestsTo(page, TARGET_ORIGIN);
    await stubSuccess(page, "# 안녕");

    await setupDirtyFirstTab(page);
    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await expect(page.locator(DIALOG)).toBeVisible();

    // 다이얼로그 바깥 좌표(좌상단)를 클릭한다 — click 이 아니라 앱은 pointerdown 으로
    // 들어야 여는 클릭이 곧바로 닫는 경합을 피한다(트랩 #25). 여기서는 사용자가
    // "이미 열린 상태에서" 바깥을 누르는 결과만 확인한다.
    await page.mouse.click(5, 5);

    await expect(page.locator(DIALOG)).toBeHidden();
    expect(hits).toHaveLength(0);
    await expect(page.locator("#tab-bar .tab")).toHaveCount(1);
    await expect(page.locator("#editor")).toHaveValue("작성 중");
  });
});

test.describe("E6: 남이 준 문서의 스크립트가 실행되지 않는다 (AC-11, F-18)", () => {
  test("script·onerror·javascript: 링크가 전부 무력화된다", async ({ page }) => {

    const malicious =
      "# 제목\n\n" +
      '<script>window.__pwned=1</script>\n\n' +
      '<img src=x onerror="window.__pwned=1">\n\n' +
      "[링크](javascript:window.__pwned=1)";
    await stubSuccess(page, malicious);

    await page.goto(`/?url=${encodeURIComponent(TARGET_URL)}`);
    await page.locator(CONFIRM).click();

    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

    const preview = page.locator("#preview");
    await expect(preview.locator("script")).toHaveCount(0);
    const html = await preview.innerHTML();
    expect(html).not.toContain("onerror");

    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();

    // 부정 케이스: javascript: 링크가 있어도 눌렀을 때 실행되지 않아야 한다.
    const link = preview.locator("a", { hasText: "링크" });
    if ((await link.count()) > 0) {
      await link.click({ trial: false }).catch(() => {});
    }
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });
});

test.describe("E7: 링크로 로컬 파일 열기를 시작한다 (AC-12)", () => {
  test("주소만으로는 파일 선택창이 안 열리고, 클릭해야 정확히 1건 열린다", async ({ page }) => {

    // 폴백 모드(<input type=file>)를 강제한다 — File System Access API 경로는
    // OS 네이티브 창이라 Playwright 의 `filechooser` 이벤트로 관측할 수 없다.
    await installFallbackMode(page);

    const chooserEvents: string[] = [];
    page.on("filechooser", () => chooserEvents.push("fired"));

    await page.goto("/?open=local");
    await expect(page.locator(DIALOG)).toBeVisible();

    // ① 대조군 — 아무것도 누르지 않고 1초 대기.
    await page.waitForTimeout(1000);
    expect(chooserEvents, "클릭 전에 파일 선택창이 열렸다(대조군 실패)").toHaveLength(0);

    // ② "파일 선택" 클릭 → 정확히 1건.
    await page.locator(CONFIRM).click();
    await expect.poll(() => chooserEvents.length).toBe(1);

    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("?open=local&url=<유효 주소> 는 로컬이 아니라 원격 확인창을 띄운다", async ({ page }) => {

    await stubSuccess(page, "# 안녕");
    await page.goto(`/?open=local&url=${encodeURIComponent(TARGET_URL)}`);

    await expect(page.locator(DIALOG)).toBeVisible();
    await expect(page.locator("#open-url-body")).toContainText("example.test");
  });
});

test.describe("E8: PWA 로 설치된 창에 링크가 도착한다 (AC-15 배선분, M-13)", () => {
  /**
   * 실측(§1-3, 트랩 #81): `window.launchQueue = fake` 는 통하지 않는다 —
   * `Object.defineProperty` 로만 심을 수 있다. 대입으로 바꾸면 이 테스트 자체가
   * 무의미해진다(심겼는지 확인할 방법이 없다).
   */
  function seedLaunchQueueWithTargetUrl(href: string) {
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      writable: true,
      value: {
        setConsumer(consumer: (p: { targetURL?: string; files?: unknown[] }) => void) {
          consumer({ targetURL: href, files: [] });
        },
      },
    });
  }

  test("targetURL 로 온 주소도 같은 확인창을 탄다 — 주소창은 건드리지 않는다", async ({
    page,
  }) => {

    await stubSuccess(page, "# 안녕");
    // goto 전에 심어야 한다 — 앱이 소비자를 등록할 때 이미 있어야 한다.
    await page.addInitScript(seedLaunchQueueWithTargetUrl, `/?url=${encodeURIComponent(TARGET_URL)}`);

    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    await expect(page.locator(DIALOG)).toBeVisible();
    await expect(page.locator("#open-url-body")).toContainText("example.test");

    await page.locator(CONFIRM).click();
    await expect(page.locator("#tab-bar .tab")).toHaveCount(2);

    // 주소창은 애초에 파라미터가 없었다 — 건드리지 않는다.
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("F-89 회귀 방지 — files 가 있으면 파일이 열리고 확인창은 뜨지 않는다", async ({
    page,
  }) => {

    await page.addInitScript(() => {
      Object.defineProperty(window, "launchQueue", {
        configurable: true,
        writable: true,
        value: {
          setConsumer(consumer: (p: { files: unknown[]; targetURL?: string }) => void) {
            void (async () => {
              const dir = await navigator.storage.getDirectory();
              const handle = await dir.getFileHandle("launched.md", { create: true });
              const w = await handle.createWritable();
              await w.write("# launched.md");
              await w.close();
              // F-89 실측대로 파일 연결 실행에도 targetURL 이 "/" 로 항상 채워져 온다 —
              // 그것이 사용자가 준 주소로 오분류되면 안 된다.
              consumer({ files: [handle], targetURL: "/" });
            })();
          },
        },
      });
    });

    await page.goto("/");
    await expect(page.locator("#tab-bar .tab.active .tab-name")).toHaveText("launched.md");
    await expect(page.locator(DIALOG)).toBeHidden();
  });
});

test.describe("E9: 배포 환경의 CSP 가 의도대로 좁다 (M-12)", () => {
  function isRemote(baseURL: string | undefined): boolean {
    if (!baseURL) return false;
    return !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseURL);
  }

  test("connect-src 만 넓어지고 script-src 는 그대로다", async ({ request, baseURL }) => {
    // `_headers` 는 Cloudflare 배포 환경에서만 적용된다(트랩 #9) — 로컬에서는
    // 항상 건너뛴다. 이것은 "건너뛰는 것"이지 "통과"가 아니다. F-90 미구현과
    // 무관하게, 이 테스트는 로컬 CI 에서는 원래도 항상 skip 상태다.
    test.skip(!isRemote(baseURL), "_headers 는 Cloudflare 배포 환경에서만 적용된다");

    const res = await request.get("/");
    const headers = res.headers();
    const csp = headers["content-security-policy"];
    expect(csp).toBeTruthy();

    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");

    const connectSrc = csp.split(";").find((d: string) => d.trim().startsWith("connect-src"));
    expect(connectSrc, "connect-src 지시자가 없다").toBeTruthy();
    expect(connectSrc).toContain("https:");
  });
});
