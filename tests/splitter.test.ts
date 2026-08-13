import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from "../src/splitLayout";

/**
 * F-32 분할 리사이저 배선 (이슈 #49).
 *
 * 계산부는 `splitLayout.test.ts` 가, 실제 드래그·복원은 `splitter.spec.ts` 가
 * 맡는다. 여기서는 **이벤트 → 계산 → 반영/저장** 배선을 본다.
 *
 * jsdom 은 레이아웃이 없어 `getBoundingClientRect()` 가 전부 0 이다. 그래서
 * 컨테이너 사각형을 직접 심는다 — 이 경계가 없으면 드래그 경로에 단위 테스트가
 * 도달조차 못 한다(`scrollSync`·`search` 와 같은 이유).
 */

async function loadSplitter(): Promise<typeof import("../src/splitter")> {
  vi.resetModules();
  return import("../src/splitter");
}

function buildHost(options: { vertical?: boolean; stored?: number } = {}) {
  const containerEl = document.createElement("div");
  const resizerEl = document.createElement("div");
  const firstPaneEl = document.createElement("textarea");
  document.body.append(containerEl, resizerEl, firstPaneEl);

  containerEl.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }) as DOMRect;
  containerEl.style.flexDirection = options.vertical ? "column" : "row";

  const saved: number[] = [];
  return {
    containerEl,
    resizerEl,
    firstPaneEl,
    saved,
    loadRatio: () => options.stored ?? DEFAULT_RATIO,
    saveRatio: (ratio: number) => saved.push(ratio),
  };
}

function pointer(type: string, init: Partial<PointerEvent> = {}): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...init,
  });
}

function drag(host: ReturnType<typeof buildHost>, to: { x?: number; y?: number }): void {
  host.resizerEl.dispatchEvent(pointer("pointerdown"));
  host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: to.x ?? 0, clientY: to.y ?? 0 }));
  host.resizerEl.dispatchEvent(pointer("pointerup"));
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("splitter — 초기 반영", () => {
  it("저장된 비율을 반영하고 aria-valuenow 를 채운다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost({ stored: 0.7 });
    const controller = initSplitter(host);

    expect(controller.getRatio()).toBe(0.7);
    // jsdom 의 CSSOM 이 "70.00%" 를 "70%" 로 정규화하므로 수치로 비교한다.
    expect(parseFloat(host.firstPaneEl.style.flexBasis)).toBeCloseTo(70, 5);
    expect(host.resizerEl.getAttribute("aria-valuenow")).toBe("70");
  });

  it("저장값이 범위를 벗어나면 잘라서 반영한다", async () => {
    const { initSplitter } = await loadSplitter();
    const controller = initSplitter(buildHost({ stored: 0.99 }));
    expect(controller.getRatio()).toBe(MAX_RATIO);
  });
});

describe("splitter — 드래그", () => {
  it("가로 분할에서 x 좌표로 비율이 정해진다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    drag(host, { x: 300 });
    expect(controller.getRatio()).toBeCloseTo(0.3, 5);
    expect(parseFloat(host.firstPaneEl.style.flexBasis)).toBeCloseTo(30, 5);
  });

  it("세로 분할에서는 y 좌표를 쓴다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost({ vertical: true });
    const controller = initSplitter(host);

    drag(host, { y: 200 }); // height 800 → 0.25
    expect(controller.getRatio()).toBeCloseTo(0.25, 5);
  });

  it("드래그 중에는 저장하지 않고, 끝날 때 한 번만 저장한다", async () => {
    // 매 프레임 localStorage 쓰기는 낭비다.
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    initSplitter(host);

    host.resizerEl.dispatchEvent(pointer("pointerdown"));
    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 300 }));
    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 320 }));
    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 340 }));
    expect(host.saved).toHaveLength(0);

    host.resizerEl.dispatchEvent(pointer("pointerup"));
    expect(host.saved).toHaveLength(1);
    expect(host.saved[0]).toBeCloseTo(0.34, 5);
  });

  it("누르지 않은 채 움직이면 아무 일도 없다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 100 }));
    expect(controller.getRatio()).toBe(DEFAULT_RATIO);
  });

  it("좌클릭이 아니면 드래그를 시작하지 않는다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(pointer("pointerdown", { button: 2 }));
    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 100 }));
    expect(controller.getRatio()).toBe(DEFAULT_RATIO);
  });

  it("pointercancel 도 드래그를 끝낸다 — 상태가 굳지 않는다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(pointer("pointerdown"));
    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 300 }));
    host.resizerEl.dispatchEvent(pointer("pointercancel"));
    expect(host.saved).toHaveLength(1);

    // 취소 후의 움직임은 무시돼야 한다.
    host.resizerEl.dispatchEvent(pointer("pointermove", { clientX: 800 }));
    expect(controller.getRatio()).toBeCloseTo(0.3, 5);
  });

  it("드래그 중 data-dragging 이 붙고 끝나면 사라진다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    initSplitter(host);

    host.resizerEl.dispatchEvent(pointer("pointerdown"));
    expect(host.resizerEl.dataset.dragging).toBe("true");
    host.resizerEl.dispatchEvent(pointer("pointerup"));
    expect(host.resizerEl.dataset.dragging).toBeUndefined();
  });

  it("끝까지 끌어도 하한/상한을 넘지 않는다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    drag(host, { x: -9999 });
    expect(controller.getRatio()).toBe(MIN_RATIO);
    drag(host, { x: 9999 });
    expect(controller.getRatio()).toBe(MAX_RATIO);
  });
});

describe("splitter — 키보드와 복귀", () => {
  it("화살표로 한 걸음씩 움직이고 즉시 저장한다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(controller.getRatio()).toBeCloseTo(0.52, 5);
    host.resizerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(controller.getRatio()).toBeCloseTo(0.5, 5);
    expect(host.saved).toHaveLength(2);
  });

  it("↑↓ 도 동작한다 — 세로 분할에서 ←→ 만 받으면 쓸 수 없다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost({ vertical: true });
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(controller.getRatio()).toBeCloseTo(0.52, 5);
    host.resizerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(controller.getRatio()).toBeCloseTo(0.5, 5);
  });

  it("Home 과 더블클릭이 반반으로 되돌린다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost({ stored: 0.8 });
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(controller.getRatio()).toBe(DEFAULT_RATIO);

    controller.setRatio(0.8);
    host.resizerEl.dispatchEvent(new Event("dblclick", { bubbles: true }));
    expect(controller.getRatio()).toBe(DEFAULT_RATIO);
  });

  it("관계없는 키는 무시한다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter(host);

    host.resizerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(controller.getRatio()).toBe(DEFAULT_RATIO);
    expect(host.saved).toHaveLength(0);
  });
});

describe("splitter — 실패해도 편집을 막지 않는다", () => {
  it("저장이 던져도 조작은 계속된다", async () => {
    const { initSplitter } = await loadSplitter();
    const host = buildHost();
    const controller = initSplitter({
      ...host,
      saveRatio: () => {
        throw new Error("quota");
      },
    });

    expect(() => controller.setRatio(0.3)).not.toThrow();
    expect(controller.getRatio()).toBe(0.3);
  });

  it("재호출은 무시된다", async () => {
    const { initSplitter } = await loadSplitter();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initSplitter(buildHost());
    initSplitter(buildHost());

    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[splitter] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("초기화가 실패해도 던지지 않고 no-op 컨트롤러를 돌려준다", async () => {
    const { initSplitter } = await loadSplitter();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initSplitter({
      containerEl: null as unknown as HTMLElement,
      resizerEl: null as unknown as HTMLElement,
      firstPaneEl: null as unknown as HTMLElement,
    });

    expect(() => controller.setRatio(0.3)).not.toThrow();
    expect(controller.getRatio()).toBe(DEFAULT_RATIO);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[splitter] 초기화 실패:"]);
    warn.mockRestore();
  });
});
