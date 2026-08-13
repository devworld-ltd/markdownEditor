import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FONT_ID, DEFAULT_FONT_SIZE, FONT_CHOICES } from "../src/editorPrefs";

/**
 * F-35 편집 설정 배선 (이슈 #63).
 *
 * 계산은 `editorPrefs.test.ts`, 실제 글자 변화는 `settings.spec.ts` 가 맡는다.
 * 여기서는 **이벤트 → 계산 → CSS 변수/저장** 배선을 본다.
 */

async function loadSettings(): Promise<typeof import("../src/editorSettings")> {
  vi.resetModules();
  return import("../src/editorSettings");
}

/** jsdom 은 showModal 을 구현하지 않는다 — 열림 상태만 흉내낸다. */
function stubDialog(dialogEl: HTMLDialogElement): void {
  dialogEl.showModal = () => {
    dialogEl.open = true;
  };
  dialogEl.close = () => {
    dialogEl.open = false;
    dialogEl.dispatchEvent(new Event("close"));
  };
}

function buildHost(stored: { fontId?: unknown; fontSize?: unknown } = {}) {
  const rootEl = document.createElement("div");
  const dialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(dialogEl);
  const fontSelectEl = document.createElement("select");
  const sizeValueEl = document.createElement("span");
  const decreaseEl = document.createElement("button");
  const increaseEl = document.createElement("button");
  const resetEl = document.createElement("button");
  const closeEl = document.createElement("button");
  const returnFocusTo = document.createElement("textarea");
  document.body.append(
    rootEl, dialogEl, fontSelectEl, sizeValueEl, decreaseEl, increaseEl, resetEl, closeEl, returnFocusTo,
  );

  const saved: Array<{ fontId: string; fontSize: number }> = [];
  return {
    rootEl, dialogEl, fontSelectEl, sizeValueEl, decreaseEl, increaseEl, resetEl, closeEl,
    returnFocusTo, saved,
    loadPrefs: () => stored,
    savePrefs: (p: { fontId: string; fontSize: number }) => saved.push(p),
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("editorSettings — 초기 반영", () => {
  it("저장된 설정을 CSS 변수로 심는다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost({ fontId: "serif", fontSize: 18 });
    const controller = initEditorSettings(host);

    expect(controller.getPrefs()).toEqual({ fontId: "serif", fontSize: 18 });
    expect(host.rootEl.style.getPropertyValue("--editor-font-size")).toBe("18px");
    expect(host.rootEl.style.getPropertyValue("--editor-font-family")).toContain("serif");
    expect(host.sizeValueEl.textContent).toBe("18px");
  });

  it("손상된 저장값은 기본값으로 떨어진다", async () => {
    const { initEditorSettings } = await loadSettings();
    const controller = initEditorSettings(buildHost({ fontId: "comic", fontSize: "크게" }));
    expect(controller.getPrefs()).toEqual({
      fontId: DEFAULT_FONT_ID,
      fontSize: DEFAULT_FONT_SIZE,
    });
  });

  it("초기 반영은 저장하지 않는다 — 바뀐 게 없다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost({ fontId: "sans", fontSize: 16 });
    initEditorSettings(host);
    expect(host.saved).toEqual([]);
  });

  it("글꼴 목록을 정의에서 만든다 — HTML 에 다시 적으면 어긋난다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost();
    initEditorSettings(host);

    expect([...host.fontSelectEl.options].map((o) => o.value)).toEqual(
      FONT_CHOICES.map((c) => c.id),
    );
  });
});

describe("editorSettings — 조작", () => {
  it("크기 버튼이 한 단계씩 바꾸고 즉시 저장한다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost();
    const controller = initEditorSettings(host);

    host.increaseEl.click();
    expect(controller.getPrefs().fontSize).toBe(DEFAULT_FONT_SIZE + 1);
    expect(host.rootEl.style.getPropertyValue("--editor-font-size")).toBe("15px");

    host.decreaseEl.click();
    expect(controller.getPrefs().fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(host.saved).toHaveLength(2);
  });

  it("글꼴 변경이 반영·저장된다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost();
    const controller = initEditorSettings(host);

    host.fontSelectEl.value = "sans";
    host.fontSelectEl.dispatchEvent(new Event("change", { bubbles: true }));

    expect(controller.getPrefs().fontId).toBe("sans");
    expect(host.saved.at(-1)).toEqual({ fontId: "sans", fontSize: DEFAULT_FONT_SIZE });
  });

  it("기본값으로 되돌린다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost({ fontId: "serif", fontSize: 20 });
    const controller = initEditorSettings(host);

    host.resetEl.click();
    expect(controller.getPrefs()).toEqual({
      fontId: DEFAULT_FONT_ID,
      fontSize: DEFAULT_FONT_SIZE,
    });
  });

  it("열고 닫으면 포커스가 돌아온다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost();
    const controller = initEditorSettings(host);

    controller.open();
    expect(controller.isOpen()).toBe(true);
    host.returnFocusTo.blur();

    host.closeEl.click();
    expect(controller.isOpen()).toBe(false);
    expect(document.activeElement).toBe(host.returnFocusTo);
  });

  it("바깥 pointerdown 은 닫고 안쪽은 닫지 않는다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost();
    const controller = initEditorSettings(host);
    host.dialogEl.getBoundingClientRect = () =>
      ({ left: 100, top: 100, right: 300, bottom: 300 }) as DOMRect;

    const down = (x: number, y: number) =>
      document.dispatchEvent(
        Object.assign(new Event("pointerdown", { bubbles: true }), { clientX: x, clientY: y }),
      );

    controller.open();
    down(200, 200);
    expect(controller.isOpen()).toBe(true);
    down(10, 10);
    expect(controller.isOpen()).toBe(false);
  });
});

describe("editorSettings — 실패해도 편집을 막지 않는다", () => {
  it("저장이 던져도 설정 변경은 계속된다", async () => {
    const { initEditorSettings } = await loadSettings();
    const host = buildHost();
    const controller = initEditorSettings({
      ...host,
      savePrefs: () => {
        throw new Error("quota");
      },
    });

    expect(() => host.increaseEl.click()).not.toThrow();
    expect(controller.getPrefs().fontSize).toBe(DEFAULT_FONT_SIZE + 1);
  });

  it("재호출은 무시되고, 잘못된 host 로도 던지지 않는다", async () => {
    const { initEditorSettings } = await loadSettings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initEditorSettings(buildHost());
    initEditorSettings(buildHost());
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[editorSettings] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("host 가 비어도 no-op 컨트롤러를 돌려준다", async () => {
    const { initEditorSettings } = await loadSettings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initEditorSettings({
      rootEl: null as unknown as HTMLElement,
      dialogEl: null as unknown as HTMLDialogElement,
      fontSelectEl: null as unknown as HTMLSelectElement,
      sizeValueEl: null as unknown as HTMLElement,
      decreaseEl: null as unknown as HTMLElement,
      increaseEl: null as unknown as HTMLElement,
      resetEl: null as unknown as HTMLElement,
      closeEl: null as unknown as HTMLElement,
    });

    expect(() => controller.open()).not.toThrow();
    expect(controller.getPrefs()).toEqual({
      fontId: DEFAULT_FONT_ID,
      fontSize: DEFAULT_FONT_SIZE,
    });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[editorSettings] 초기화 실패:"]);
    warn.mockRestore();
  });
});
