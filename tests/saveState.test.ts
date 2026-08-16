import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveStateHost, SaveStateView } from "../src/saveState";

/**
 * #148 저장 상태.
 *
 * 여기서 고정하는 것은 **무엇을 보여주는가** 다 — 특히 "색 없이도 상태를 알 수
 * 있는가". 색은 CSS 가 정하므로 단언하지 않고, `data-status` 와 글자를 본다.
 */

async function load(): Promise<typeof import("../src/saveState")> {
  vi.resetModules();
  return import("../src/saveState");
}

function buildHost(view: SaveStateView | null): SaveStateHost & { els: Record<string, HTMLElement> } {
  const rootEl = document.createElement("span");
  const iconEl = document.createElement("span");
  const textEl = document.createElement("span");
  const nameEl = document.createElement("span");
  rootEl.append(iconEl, textEl, nameEl);
  document.body.append(rootEl);
  return {
    rootEl, iconEl, textEl, nameEl,
    read: () => view,
    els: { rootEl, iconEl, textEl, nameEl },
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("표시", () => {
  it("저장됨 — 글자로도 알 수 있다", async () => {
    const { initSaveState } = await load();
    const host = buildHost({ status: "saved", fileName: "note.md" });
    const c = initSaveState(host);

    expect(c.current()).toBe("saved");
    expect(host.rootEl.dataset.status).toBe("saved");
    expect(host.textEl.textContent).toBe("저장됨");
    expect(host.nameEl.textContent).toBe("note.md");
    expect(host.rootEl.hidden).toBe(false);
  });

  it("저장하지 않은 변경", async () => {
    const { initSaveState } = await load();
    const host = buildHost({ status: "dirty", fileName: "note.md" });
    initSaveState(host);

    expect(host.rootEl.dataset.status).toBe("dirty");
    expect(host.textEl.textContent).toBe("저장하지 않은 변경");
  });

  it("저장한 적 없음 — 파일명을 감춘다", async () => {
    const { initSaveState } = await load();
    const host = buildHost({ status: "unsaved", fileName: null });
    initSaveState(host);

    expect(host.textEl.textContent).toBe("저장한 적 없음");
    expect(host.nameEl.hidden).toBe(true);
  });

  it("상태마다 아이콘이 있다 — 색만으로 구분하지 않는다", async () => {
    const { initSaveState } = await load();
    for (const s of ["saved", "dirty", "unsaved"] as const) {
      document.body.textContent = "";
      vi.resetModules();
      const { initSaveState: init } = await import("../src/saveState");
      const host = buildHost({ status: s, fileName: "a.md" });
      init(host);
      expect(host.iconEl.textContent, `${s} 아이콘 없음`).not.toBe("");
      expect(host.textEl.textContent, `${s} 글자 없음`).not.toBe("");
    }
    void initSaveState;
  });

  it("탭이 없으면 통째로 감춘다", async () => {
    const { initSaveState } = await load();
    const host = buildHost(null);
    const c = initSaveState(host);

    expect(host.rootEl.hidden).toBe(true);
    expect(c.current()).toBeNull();
  });
});

describe("갱신", () => {
  it("refresh 로 상태가 따라온다", async () => {
    const { initSaveState } = await load();
    let view: SaveStateView = { status: "dirty", fileName: "note.md" };
    const base = buildHost(view);
    const c = initSaveState({ ...base, read: () => view });

    expect(c.current()).toBe("dirty");
    view = { status: "saved", fileName: "note.md" };
    c.refresh();
    expect(c.current()).toBe("saved");
    expect(base.textEl.textContent).toBe("저장됨");
  });

  it("상태를 못 읽으면 감춘다 — 틀린 상태를 보여주는 것보다 낫다", async () => {
    const { initSaveState } = await load();
    const base = buildHost(null);
    const c = initSaveState({
      ...base,
      read: () => {
        throw new Error("읽기 실패");
      },
    });
    expect(base.rootEl.hidden).toBe(true);
    expect(() => c.refresh()).not.toThrow();
  });
});

describe("견고함", () => {
  it("초기화 실패해도 앱을 멈추지 않는다", async () => {
    const { initSaveState } = await load();
    const c = initSaveState(null as unknown as SaveStateHost);
    expect(() => c.refresh()).not.toThrow();
    expect(c.current()).toBeNull();
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const { initSaveState } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    initSaveState(buildHost({ status: "saved", fileName: "a.md" }));
    const second = initSaveState(buildHost({ status: "dirty", fileName: "b.md" }));
    expect(second.current()).toBeNull();
    warn.mockRestore();
  });
});
