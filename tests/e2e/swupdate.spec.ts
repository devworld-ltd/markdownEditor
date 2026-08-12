import { test, expect } from "@playwright/test";
import {
  installSwUpdateStub,
  triggerSwUpdateFound,
  triggerSwControllerChange,
  getSwWaitingPostMessageCalls,
} from "./fixtures";

/**
 * F-69 서비스 워커 업데이트 알림 — E1~E7 (기술 스펙 §E2E 검증 시나리오).
 *
 * 전부 STUB 환경이다. `navigator.serviceWorker.register()` 는 `import.meta.env.PROD`
 * 에서만 호출되므로(F-61), 이 스펙은 프로덕션 번들(`npm run test:e2e:preview`)로 실행할
 * 때만 유효하다. 기본 dev 서버 실행에서는 전부 skip 한다 — 사유 문구는 기술 스펙
 * §12.2 그대로 통일한다.
 *
 * 실제 SW 바이트 교체로 인한 감지(REMOTE)는 검증 대상이 아니다 — 그 부분은
 * `hardening.spec.ts` 의 "F-61 PWA" 블록에 추가된 E8 이 담당한다(U10).
 */

const SESSION_KEY = "markdown-editor:session:v1";

test.describe("F-69 서비스 워커 업데이트 알림", () => {
  test.skip(
    process.env.E2E_PREVIEW !== "1",
    "프로덕션 번들에서만 서비스 워커가 등록된다",
  );

  test.afterEach(async ({ page }) => {
    // 세션 저장소만 쓰므로 케이스 종료 시 정리한다.
    await page.evaluate((key) => localStorage.removeItem(key), SESSION_KEY).catch(() => undefined);
  });

  test("E1 최초 설치에는 알림이 뜨지 않는다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: false, waitingOnLoad: true });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    // I-02 의 1000ms 지연을 넘겨 넉넉히 기다린다.
    await page.waitForTimeout(3000);

    await expect(page.locator("#sw-update")).toBeHidden();
    // 텍스트 자체는 정적 마크업으로 DOM 에 존재하지만(§10.1), hidden 인 조상 때문에
    // 화면에는 보이지 않아야 한다.
    await expect(page.locator("#sw-update-text")).toBeHidden();
    await expect(page.locator("#sw-update-reload")).not.toBeVisible();
  });

  test("E2 대기 중인 새 버전을 알아차린다 — (a) 로드 시점에 이미 대기 중", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: true });
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    await editor.fill("# 작업중");
    await editor.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(el.value.length, el.value.length),
    );

    // 첫 화면 진입을 가리지 않도록 즉시는 나타나지 않는다(D1-A).
    await expect(page.locator("#sw-update")).toBeHidden();

    await expect(page.locator("#sw-update")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#sw-update-text")).toContainText("새 버전이 준비됐습니다.");
    await expect(page.locator("#sw-update-later")).toBeVisible();
    await expect(page.locator("#sw-update-reload")).toBeVisible();

    // 알림 등장이 에디터 포커스/커서를 빼앗지 않는다.
    await expect(editor).toBeFocused();
    const selectionStart = await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart);
    expect(selectionStart).toBe("# 작업중".length);

    // 툴바·탭 바·에디터가 가려지지 않는다.
    await expect(page.locator(".toolbar")).toBeVisible();
    await expect(page.locator("#tab-bar")).toBeVisible();
  });

  test("E2 대기 중인 새 버전을 알아차린다 — (b) 세션 중 새로 설치된다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    await expect(page.locator("#sw-update")).toBeHidden();

    await triggerSwUpdateFound(page);

    await expect(page.locator("#sw-update")).toBeVisible();
    await expect(page.locator("#sw-update-text")).toContainText("새 버전이 준비됐습니다.");
  });

  test("E3 새로고침으로 갱신하고 세션이 그대로 돌아온다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    // 탭 1 — "# 하나" (미저장)
    await editor.fill("# 하나");

    // 탭 2 — "# 둘\n본문" (미저장, 이후 활성 탭으로 남긴다)
    await page.locator('.toolbar-btn[title="New"]').click();
    await editor.fill("# 둘\n본문");

    // 탭 3 — "# 셋" (미저장)
    await page.locator('.toolbar-btn[title="New"]').click();
    await editor.fill("# 셋");

    await expect(page.locator("#tab-bar .tab")).toHaveCount(3);

    // 두 번째 탭을 활성으로 되돌린다.
    await page.locator("#tab-bar .tab").nth(1).click();
    await expect(editor).toHaveValue("# 둘\n본문");
    await expect(page.locator("#tab-bar .tab").nth(1)).toHaveClass(/active/);

    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    let dialogCount = 0;
    page.on("dialog", (dialog) => {
      dialogCount += 1;
      void dialog.dismiss();
    });

    const loadPromise = page.waitForEvent("load");
    await page.locator("#sw-update-reload").click();
    await triggerSwControllerChange(page).catch(() => undefined);
    await loadPromise;

    // 리로드 과정에서 브라우저 기본 이탈 확인 대화상자가 뜨지 않는다(AC-06).
    expect(dialogCount).toBe(0);

    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.locator("#sw-update")).toBeHidden();

    await expect(page.locator("#tab-bar .tab")).toHaveCount(3);
    await expect(page.locator("#tab-bar .tab").nth(1)).toHaveClass(/active/);
    await expect(page.locator("#editor")).toHaveValue("# 둘\n본문");
    await expect(page.locator("#tab-bar .tab-name").nth(1)).toHaveText("Untitled *");

    await page.locator("#tab-bar .tab").nth(0).click();
    await expect(page.locator("#editor")).toHaveValue("# 하나");

    await page.locator("#tab-bar .tab").nth(2).click();
    await expect(page.locator("#editor")).toHaveValue("# 셋");
  });

  test("E4 무시해도 아무 일도 일어나지 않는다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    await editor.fill("무시 테스트");
    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    let navigated = false;
    page.once("load", () => {
      navigated = true;
    });

    // 60초 연속 편집 대신, 실행 시간을 위해 짧게 반복 타이핑해 "계속 편집 가능"을 검증한다.
    for (let i = 0; i < 5; i++) {
      await editor.pressSequentially(" 추가");
      await page.waitForTimeout(200);
    }

    expect(navigated).toBe(false);
    await expect(page.locator("#sw-update")).toBeVisible();
    await expect(editor).toHaveValue(/무시 테스트( 추가){5}/);
    await expect(page.locator("#preview")).toContainText("무시 테스트");
  });

  test("E4 나중에로 닫으면 같은 버전으로는 다시 뜨지 않는다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    await page.goto("/");
    await expect(page.locator("#editor")).toBeVisible();

    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    await page.locator("#sw-update-later").click();

    await expect(page.locator("#sw-update")).toBeHidden();
    await expect(page.locator("#editor")).toBeFocused();

    // 재발화 없이 유지되는지 확인한다(내부적으로 60분 주기 확인 외에는 재트리거 수단이
    // 없으므로, 짧은 대기만으로도 "자동 재표시"가 없음을 검증하는 데 충분하다).
    await page.waitForTimeout(1500);
    await expect(page.locator("#sw-update")).toBeHidden();
  });

  test("E4 Esc 범위 — 알림 포커스에서만 닫힌다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    // (a) 에디터에 포커스를 둔 채 Esc — 알림은 그대로 남는다.
    await editor.click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#sw-update")).toBeVisible();

    // (b) 알림 내부(액션)에 포커스를 둔 채 Esc — 닫힌다.
    await page.locator("#sw-update-later").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#sw-update")).toBeHidden();
  });

  test("E5 저장할 수 없을 때는 확인을 받고, 취소하면 알림이 복귀하며, 계속하면 갱신된다", async ({
    page,
  }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    // 세션 저장만 실패시키고 나머지는 정상 동작시킨다(F-54 패턴과 동일).
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
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();
    await editor.fill("저장 실패 시나리오");

    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    // (a) 새로고침 → 확인 → 취소
    // window.confirm() 은 렌더러를 블로킹하므로, 리스너 안에서 곧바로 dismiss() 해야
    // click() 이 정상적으로 반환된다(리스너 밖에서 await 로 늦게 처리하면 교착된다).
    let dialog1: { type: string; message: string } | null = null;
    page.once("dialog", (dialog) => {
      dialog1 = { type: dialog.type(), message: dialog.message() };
      void dialog.dismiss();
    });
    await page.locator("#sw-update-reload").click();
    await expect.poll(() => dialog1).not.toBeNull();
    expect(dialog1!.type).toBe("confirm");
    expect(dialog1!.message).toContain("자동 저장을 할 수 없습니다");

    await expect(page.locator("#sw-update")).toBeVisible();
    await expect(page.locator("#sw-update")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#sw-update-reload")).toBeEnabled();
    await expect(page.locator("#sw-update-text")).toContainText("새 버전이 준비됐습니다.");
    await expect(editor).toHaveValue("저장 실패 시나리오");

    // (b) 취소 직후 일반 이탈 경고는 그대로 살아 있다(억제가 남아있지 않음, AC-08).
    // 실제 브라우저 네비게이션으로 beforeunload 대화상자를 재현하면 취소 시 내비게이션
    // 자체가 보류돼 테스트가 불안정해지므로, 동일한 리스너가 실제로 호출하는
    // preventDefault() 여부를 직접 확인한다 — 이것이 AC-08 이 요구하는 불변식이다.
    const prevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);

    // 취소했으므로 리로드되지 않았고 편집 상태가 유지된다.
    await expect(editor).toHaveValue("저장 실패 시나리오");
    await expect(page.locator("#sw-update")).toBeVisible();

    // (c) 새로고침 → 확인 → 계속
    let dialog2Type: string | null = null;
    page.once("dialog", (dialog) => {
      dialog2Type = dialog.type();
      void dialog.accept();
    });

    const loadPromise = page.waitForEvent("load");
    await page.locator("#sw-update-reload").click();
    await expect.poll(() => dialog2Type).toBe("confirm");
    await triggerSwControllerChange(page).catch(() => undefined);
    await loadPromise;

    await expect(page.locator("#editor")).toBeVisible();
  });

  test("E6 두 알림이 동시에 떠도 서로를 지우지 않는다", async ({ page }) => {
    test.setTimeout(30_000);

    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    // 저장 시도만 실패시켜 자동 저장 실패 토스트를 유발한다.
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
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();

    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    await editor.fill("동시 표시 테스트");

    const notice = page.locator("#notice");
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(notice).toContainText("자동 저장이 중단");

    // 두 알림이 동시에, 겹치지 않게 세로로 쌓인다.
    const swUpdateBoxBefore = await page.locator("#sw-update").boundingBox();
    const noticeBox = await notice.boundingBox();
    expect(swUpdateBoxBefore).not.toBeNull();
    expect(noticeBox).not.toBeNull();
    // 겹치지 않음: 위(#notice)의 아래쪽 경계가 아래(#sw-update)의 위쪽 경계보다 위에 있다.
    expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(swUpdateBoxBefore!.y + 1);

    // #notice 는 자기 수명(10초)대로 사라지고, #sw-update 는 위치·상태 그대로 남는다.
    await expect(notice).toBeHidden({ timeout: 12_000 });
    await expect(page.locator("#sw-update")).toBeVisible();
    await expect(page.locator("#sw-update-text")).toContainText("새 버전이 준비됐습니다.");

    const swUpdateBoxAfter = await page.locator("#sw-update").boundingBox();
    expect(swUpdateBoxAfter).not.toBeNull();
    expect(swUpdateBoxAfter!.y).toBeCloseTo(swUpdateBoxBefore!.y, 0);
  });

  test("E7 연타해도 한 번만 갱신되고, 응답이 없어도 멈추지 않는다", async ({ page }) => {
    await installSwUpdateStub(page, { controlled: true, waitingOnLoad: false });
    await page.goto("/");
    const editor = page.locator("#editor");
    await expect(editor).toBeVisible();
    await editor.fill("연타 테스트");

    await triggerSwUpdateFound(page);
    await expect(page.locator("#sw-update")).toBeVisible();

    const reloadBtn = page.locator("#sw-update-reload");
    for (let i = 0; i < 5; i++) {
      await reloadBtn.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(200);
    }

    await expect(page.locator("#sw-update-text")).toContainText("전환하는 중입니다");
    await expect(reloadBtn).toBeDisabled();

    const calls = await getSwWaitingPostMessageCalls(page);
    expect(calls).toHaveLength(1);

    // controllerchange 를 발화하지 않는다 — 타임아웃(3000ms) 경로를 검증한다.
    const loadPromise = page.waitForEvent("load", { timeout: 5000 });
    await loadPromise;

    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.locator("#editor")).toHaveValue("연타 테스트");
  });
});
