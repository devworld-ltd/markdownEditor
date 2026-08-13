import { afterEach, describe, expect, it, vi } from "vitest";
import type { FsLimitNoticeHost } from "../src/fsLimitNotice";

/**
 * `fsLimitNotice.ts` 는 offline.ts/swUpdate.ts 와 동일하게 앱 모듈을 import 하지
 * 않는 리프 모듈이다. DOM 요소만 주입받아 가짜 host 로 전량 검증한다. `initialized`
 * ·`shown` 은 모듈 스코프 상태라 테스트 간 누수를 막기 위해 매 테스트마다
 * `vi.resetModules()` 로 모듈을 새로 로드한다.
 */
async function loadFsLimitNotice(): Promise<typeof import("../src/fsLimitNotice")> {
  vi.resetModules();
  return import("../src/fsLimitNotice");
}

function createPanel(): HTMLElement {
  document.body.innerHTML = `
    <div id="fs-limit-notice" hidden>
      <button type="button" id="fs-limit-notice-dismiss"></button>
    </div>
  `;
  return document.querySelector<HTMLElement>("#fs-limit-notice")!;
}

function makeHost(
  panelEl: HTMLElement,
  overrides: Partial<FsLimitNoticeHost> = {},
): FsLimitNoticeHost {
  return { panelEl, returnFocusTo: null, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fsLimitNotice — 트리거 전에는 아무 일도 하지 않는다", () => {
  it("init 하지 않고 notifyFallbackSave() 를 불러도 표시되지 않는다", async () => {
    const { notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();

    notifyFallbackSave();

    expect(panelEl.hidden).toBe(true);
  });

  it("init 직후에는 아직 표시되지 않는다(트리거 전)", async () => {
    const { initFsLimitNotice } = await loadFsLimitNotice();
    const panelEl = createPanel();

    initFsLimitNotice(makeHost(panelEl));

    expect(panelEl.hidden).toBe(true);
  });
});

describe("fsLimitNotice — 저장 시도 시 표시(판단 1: 첫 저장 시점)", () => {
  it("notifyFallbackSave() 호출 시 알림을 표시한다", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    initFsLimitNotice(makeHost(panelEl));

    notifyFallbackSave();

    expect(panelEl.hidden).toBe(false);
  });

  it("세션당 1회만 표시한다 — 두 번째 저장 시도에는 이미 닫은 알림을 다시 열지 않는다", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    initFsLimitNotice(makeHost(panelEl));

    notifyFallbackSave();
    expect(panelEl.hidden).toBe(false);

    panelEl.hidden = true; // 사용자가 확인을 눌러 닫았다고 가정
    notifyFallbackSave(); // 두 번째 저장 시도

    expect(panelEl.hidden).toBe(true);
  });
});

describe("fsLimitNotice — 닫기 동작", () => {
  it("확인 버튼 클릭 시 알림을 숨기고 포커스를 되돌린다", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    const returnFocusTo = document.createElement("textarea");
    document.body.appendChild(returnFocusTo);
    const focusSpy = vi.spyOn(returnFocusTo, "focus");

    initFsLimitNotice(makeHost(panelEl, { returnFocusTo }));
    notifyFallbackSave();
    expect(panelEl.hidden).toBe(false);

    panelEl.querySelector<HTMLButtonElement>("#fs-limit-notice-dismiss")!.click();

    expect(panelEl.hidden).toBe(true);
    expect(focusSpy).toHaveBeenCalled();
  });

  it("Esc 키 입력 시 알림을 숨긴다", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    initFsLimitNotice(makeHost(panelEl));
    notifyFallbackSave();
    expect(panelEl.hidden).toBe(false);

    panelEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(panelEl.hidden).toBe(true);
  });

  it("Esc 이외의 키 입력은 무시한다", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    initFsLimitNotice(makeHost(panelEl));
    notifyFallbackSave();

    panelEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(panelEl.hidden).toBe(false);
  });
});

describe("fsLimitNotice — 재진입 가드", () => {
  it("두 번째 초기화 호출은 무시된다(첫 host 로 등록된 리스너만 유효)", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    const returnFocusTo1 = document.createElement("textarea");
    const returnFocusTo2 = document.createElement("textarea");
    const focus1 = vi.spyOn(returnFocusTo1, "focus");
    const focus2 = vi.spyOn(returnFocusTo2, "focus");

    initFsLimitNotice(makeHost(panelEl, { returnFocusTo: returnFocusTo1 }));
    initFsLimitNotice(makeHost(panelEl, { returnFocusTo: returnFocusTo2 }));
    notifyFallbackSave();

    panelEl.querySelector<HTMLButtonElement>("#fs-limit-notice-dismiss")!.click();

    expect(focus1).toHaveBeenCalled();
    expect(focus2).not.toHaveBeenCalled();
  });

  it("두 번째 초기화 시도는 console.warn 을 남긴다", async () => {
    const { initFsLimitNotice } = await loadFsLimitNotice();
    const panelEl = createPanel();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    initFsLimitNotice(makeHost(panelEl));
    initFsLimitNotice(makeHost(panelEl));

    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("fsLimitNotice — 예외 격리 (NFR-2 와 동일 원칙)", () => {
  it("querySelector 가 예외를 던져도 초기화 자체가 앱을 중단시키지 않는다", async () => {
    const { initFsLimitNotice } = await loadFsLimitNotice();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const brokenPanelEl = {
      querySelector: () => {
        throw new Error("boom");
      },
    } as unknown as HTMLElement;

    expect(() => initFsLimitNotice(makeHost(brokenPanelEl))).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("표시 도중 예외가 발생해도 앱을 중단시키지 않는다", async () => {
    const { initFsLimitNotice, notifyFallbackSave } = await loadFsLimitNotice();
    const panelEl = createPanel();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    initFsLimitNotice(makeHost(panelEl));

    Object.defineProperty(panelEl, "hidden", {
      set: () => {
        throw new Error("boom");
      },
    });

    expect(() => notifyFallbackSave()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});
