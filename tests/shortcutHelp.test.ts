import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "../src/shortcutDefs";

/**
 * F-58 단축키 안내 UI (이슈 #40).
 *
 * `<dialog>` 의 모달 동작은 jsdom 이 구현하지 않으므로 E2E 가 맡는다. 여기서는
 * **렌더 결과**를 본다 — 특히 플랫폼 분기(⌘ vs Ctrl)는 테스트 브라우저 UA 가
 * Windows 라 E2E 만으로는 한쪽 가지가 아예 실행되지 않는다.
 */

async function loadHelp(): Promise<typeof import("../src/shortcutHelp")> {
  vi.resetModules();
  return import("../src/shortcutHelp");
}

/**
 * jsdom 은 `showModal()` 을 구현하지 않는다(호출하면 던진다). 모달 시각 동작은
 * E2E 가 확인하므로, 여기서는 열림/닫힘 **상태 전이**만 볼 수 있도록 최소 스텁을
 * 얹는다. 실제 브라우저 동작을 흉내내는 게 아니라 `open` 플래그만 맞춘다.
 */
function stubDialog(dialogEl: HTMLDialogElement): void {
  dialogEl.showModal = () => {
    dialogEl.open = true;
  };
  dialogEl.close = () => {
    dialogEl.open = false;
    dialogEl.dispatchEvent(new Event("close"));
  };
}

function buildHost(isApplePlatform: boolean) {
  const dialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(dialogEl);
  const listEl = document.createElement("div");
  const closeEl = document.createElement("button");
  const returnFocusTo = document.createElement("textarea");
  document.body.append(dialogEl, listEl, closeEl, returnFocusTo);
  return { dialogEl, listEl, closeEl, isApplePlatform, returnFocusTo };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("detectApplePlatform", () => {
  it("Apple 계열 UA 를 알아본다", async () => {
    const { detectApplePlatform } = await loadHelp();
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
    ]) {
      expect(detectApplePlatform(ua), ua).toBe(true);
    }
  });

  it("그 외 UA 는 false 다", async () => {
    const { detectApplePlatform } = await loadHelp();
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Mozilla/5.0 (X11; Linux x86_64)",
      "Mozilla/5.0 (Linux; Android 14)",
    ]) {
      expect(detectApplePlatform(ua), ua).toBe(false);
    }
  });
});

describe("shortcutHelp — 목록 렌더", () => {
  it("Apple 플랫폼에서는 ⌘·⌥ 로 표기한다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(true);
    initShortcutHelp(host);

    const caps = [...host.listEl.querySelectorAll("kbd")].map((el) => el.textContent);
    expect(caps).toContain("⌘");
    expect(caps).toContain("⌥");
    // 테스트 브라우저 UA 가 Windows 라 E2E 만으로는 이 가지가 실행되지 않는다.
    expect(caps).not.toContain("Ctrl");
    expect(caps).not.toContain("Alt");
  });

  it("그 외 플랫폼에서는 Ctrl·Alt 로 표기한다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    initShortcutHelp(host);

    const caps = [...host.listEl.querySelectorAll("kbd")].map((el) => el.textContent);
    expect(caps).toContain("Ctrl");
    expect(caps).toContain("Alt");
    expect(caps).not.toContain("⌘");
  });

  it("정의에 있는 단축키를 하나도 빠뜨리지 않는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    initShortcutHelp(host);

    const labels = [...host.listEl.querySelectorAll(".shortcut-label")].map((el) =>
      el.firstChild?.textContent,
    );
    expect(labels).toEqual(SHORTCUTS.map((s) => s.label));
    expect(host.listEl.querySelectorAll(".shortcut-keys")).toHaveLength(SHORTCUTS.length);
  });

  it("innerHTML 을 쓰지 않는다 — 목록에 마크업이 주입되지 않는다", async () => {
    // 이 목록에 사용자 입력은 없지만, 정화 파이프라인을 우회하는 DOM 주입 경로를
    // 새로 만들지 않는다는 것이 F-18 의 취지다. textContent 로만 쓰면 정의에
    // 태그가 섞여도 텍스트로 남는다.
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    initShortcutHelp(host);

    expect(host.listEl.querySelector("script")).toBeNull();
    expect(host.listEl.querySelectorAll("kbd").length).toBeGreaterThan(0);
  });

  it("재호출은 무시된다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initShortcutHelp(buildHost(false));
    initShortcutHelp(buildHost(false));

    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[shortcutHelp] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("초기화가 실패해도 no-op 컨트롤러를 돌려주고 던지지 않는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    // listEl 이 없는 잘못된 host — 동기화 실패가 에디터를 중단시키면 안 된다.
    const controller = initShortcutHelp({
      dialogEl: document.createElement("dialog"),
      listEl: null as unknown as HTMLElement,
      closeEl: document.createElement("button"),
      isApplePlatform: false,
    });

    expect(() => controller.open()).not.toThrow();
    expect(controller.isOpen()).toBe(false);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[shortcutHelp] 초기화 실패:",
    ]);
    warn.mockRestore();
  });
});

describe("shortcutHelp — 열림/닫힘 전이", () => {
  it("toggle() 이 상태를 뒤집는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    const controller = initShortcutHelp(host);

    expect(controller.isOpen()).toBe(false);
    controller.toggle();
    expect(controller.isOpen()).toBe(true);
    controller.toggle();
    expect(controller.isOpen()).toBe(false);
  });

  it("이미 열려 있으면 open() 이 다시 열지 않는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    const controller = initShortcutHelp(host);

    let opens = 0;
    const original = host.dialogEl.showModal.bind(host.dialogEl);
    host.dialogEl.showModal = () => {
      opens++;
      original();
    };

    controller.open();
    controller.open();
    expect(opens).toBe(1);
  });

  it("닫으면 포커스가 지정한 요소로 돌아간다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    const controller = initShortcutHelp(host);

    controller.open();
    host.returnFocusTo.blur();
    controller.close();

    expect(document.activeElement).toBe(host.returnFocusTo);
  });

  it("닫기 버튼 클릭이 닫는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    const controller = initShortcutHelp(host);

    controller.open();
    host.closeEl.click();
    expect(controller.isOpen()).toBe(false);
  });

  it("바깥 pointerdown 은 닫고, 안쪽 pointerdown 은 닫지 않는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    const controller = initShortcutHelp(host);

    // jsdom 은 레이아웃이 없어 getBoundingClientRect 가 전부 0 이다. 판정 로직만
    // 보기 위해 사각형을 직접 심는다 — (100,100)~(300,300).
    host.dialogEl.getBoundingClientRect = () =>
      ({ left: 100, top: 100, right: 300, bottom: 300 }) as DOMRect;

    const down = (x: number, y: number) =>
      document.dispatchEvent(
        Object.assign(new Event("pointerdown", { bubbles: true }), { clientX: x, clientY: y }),
      );

    controller.open();
    down(200, 200); // 안쪽
    expect(controller.isOpen()).toBe(true);

    down(10, 10); // 바깥
    expect(controller.isOpen()).toBe(false);
  });

  it("닫혀 있을 때의 바깥 pointerdown 은 아무 일도 하지 않는다", async () => {
    const { initShortcutHelp } = await loadHelp();
    const host = buildHost(false);
    const controller = initShortcutHelp(host);

    let closes = 0;
    const original = host.dialogEl.close.bind(host.dialogEl);
    host.dialogEl.close = () => {
      closes++;
      original();
    };

    document.dispatchEvent(
      Object.assign(new Event("pointerdown", { bubbles: true }), { clientX: 0, clientY: 0 }),
    );
    expect(closes).toBe(0);
    expect(controller.isOpen()).toBe(false);
  });
});
