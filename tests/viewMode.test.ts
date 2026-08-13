import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODE,
  VIEW_MODES,
  modeButtonLabel,
  nextViewMode,
  parseViewMode,
} from "../src/viewMode";

async function loadViewMode(): Promise<typeof import("../src/viewMode")> {
  vi.resetModules();
  return import("../src/viewMode");
}

function buildHost(stored?: string) {
  const containerEl = document.createElement("div");
  const buttonEl = document.createElement("button");
  document.body.append(containerEl, buttonEl);
  const saved: string[] = [];
  return {
    containerEl,
    buttonEl,
    saved,
    loadMode: () => parseViewMode(stored),
    saveMode: (mode: string) => saved.push(mode),
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("viewMode — 순수 계산", () => {
  it("모드는 분할 → 편집 → 미리보기 → 분할 순으로 순환한다", () => {
    expect(nextViewMode("split")).toBe("editor");
    expect(nextViewMode("editor")).toBe("preview");
    expect(nextViewMode("preview")).toBe("split");
  });

  it("모르는 저장값은 기본값 — 설정 때문에 앱이 깨지면 안 된다", () => {
    for (const bad of [null, undefined, "", "zoom", 42, {}, []]) {
      expect(parseViewMode(bad)).toBe(DEFAULT_MODE);
    }
  });

  it("아는 값은 그대로", () => {
    for (const mode of VIEW_MODES) expect(parseViewMode(mode)).toBe(mode);
  });

  it("버튼 이름이 현재 상태와 다음 동작을 함께 알린다", () => {
    // "전환" 만 있으면 스크린리더 사용자는 지금 어느 모드인지 알 수 없다.
    const label = modeButtonLabel("split");
    expect(label).toContain("분할");
    expect(label).toContain("편집 전용");
  });
});

describe("viewMode — 배선", () => {
  it("초기 모드를 data-mode 로 반영한다", async () => {
    const { initViewMode } = await loadViewMode();
    const host = buildHost("preview");
    const controller = initViewMode(host);

    expect(controller.get()).toBe("preview");
    expect(host.containerEl.dataset.mode).toBe("preview");
  });

  it("cycle() 이 모드를 순환시키고 저장한다", async () => {
    const { initViewMode } = await loadViewMode();
    const host = buildHost();
    const controller = initViewMode(host);

    controller.cycle();
    expect(controller.get()).toBe("editor");
    expect(host.containerEl.dataset.mode).toBe("editor");

    controller.cycle();
    expect(controller.get()).toBe("preview");
    controller.cycle();
    expect(controller.get()).toBe("split");

    expect(host.saved).toEqual(["editor", "preview", "split"]);
  });

  it("버튼 클릭을 직접 듣지 않는다 — 툴바가 이미 다루므로 두 번 세면 안 된다", async () => {
    const { initViewMode } = await loadViewMode();
    const host = buildHost();
    const controller = initViewMode(host);

    host.buttonEl.click();
    expect(controller.get()).toBe("split");
  });

  it("aria-pressed 는 분할이 아닐 때만 true 다", async () => {
    // 기본 상태를 눌린 것으로 표시하면 늘 뭔가 켜져 있다고 오해된다.
    const { initViewMode } = await loadViewMode();
    const host = buildHost();
    const controller = initViewMode(host);

    expect(host.buttonEl.getAttribute("aria-pressed")).toBe("false");
    controller.set("editor");
    expect(host.buttonEl.getAttribute("aria-pressed")).toBe("true");
    controller.set("split");
    expect(host.buttonEl.getAttribute("aria-pressed")).toBe("false");
  });

  it("버튼 이름이 모드에 따라 갱신된다", async () => {
    const { initViewMode } = await loadViewMode();
    const host = buildHost();
    const controller = initViewMode(host);

    const before = host.buttonEl.getAttribute("aria-label");
    controller.set("preview");
    expect(host.buttonEl.getAttribute("aria-label")).not.toBe(before);
    expect(host.buttonEl.getAttribute("aria-label")).toContain("미리보기");
  });

  it("모르는 모드를 넣어도 기본값으로 떨어진다", async () => {
    const { initViewMode } = await loadViewMode();
    const host = buildHost();
    const controller = initViewMode(host);

    controller.set("zoom" as never);
    expect(controller.get()).toBe(DEFAULT_MODE);
  });

  it("저장이 던져도 화면 전환은 계속된다", async () => {
    const { initViewMode } = await loadViewMode();
    const host = buildHost();
    const controller = initViewMode({
      ...host,
      saveMode: () => {
        throw new Error("quota");
      },
    });

    expect(() => controller.cycle()).not.toThrow();
    expect(controller.get()).toBe("editor");
  });

  it("재호출은 무시되고, 초기화 실패해도 던지지 않는다", async () => {
    const { initViewMode } = await loadViewMode();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initViewMode(buildHost());
    initViewMode(buildHost());
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[viewMode] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("잘못된 host 로도 던지지 않는다", async () => {
    const { initViewMode } = await loadViewMode();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initViewMode({ containerEl: null as unknown as HTMLElement });
    expect(() => controller.cycle()).not.toThrow();
    expect(controller.get()).toBe(DEFAULT_MODE);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[viewMode] 초기화 실패:"]);
    warn.mockRestore();
  });
});
