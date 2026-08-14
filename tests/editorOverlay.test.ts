import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorOverlayHost } from "../src/editorOverlay";

async function load(): Promise<typeof import("../src/editorOverlay")> {
  vi.resetModules();
  return import("../src/editorOverlay");
}

function buildHost(enabled = false) {
  document.body.innerHTML = `
    <div id="pane">
      <div id="overlay"></div>
      <textarea id="editor"></textarea>
    </div>
  `;
  const editorEl = document.querySelector<HTMLTextAreaElement>("#editor")!;
  const overlayEl = document.querySelector<HTMLElement>("#overlay")!;
  const paneEl = document.querySelector<HTMLElement>("#pane")!;

  // jsdom 은 레이아웃을 계산하지 않는다 — 위치는 고정값으로 둔다.
  Object.defineProperty(editorEl, "offsetLeft", { value: 40, configurable: true });

  const saved: boolean[] = [];
  return {
    editorEl,
    overlayEl,
    paneEl,
    saved,
    loadEnabled: () => enabled,
    saveEnabled: (value: boolean) => saved.push(value),
  } satisfies EditorOverlayHost & { saved: boolean[] };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("켜짐 / 꺼짐", () => {
  it("기본은 꺼짐이다 — 사용자가 켠 적 없는 기능에 발목 잡히면 안 된다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost();
    const c = initEditorOverlay(host);

    expect(c.isEnabled()).toBe(false);
    expect(host.paneEl.dataset.overlay).toBe("false");
  });

  it("꺼져 있으면 아무것도 그리지 않는다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost();
    const c = initEditorOverlay(host);

    host.editorEl.value = "# 제목";
    c.refresh();
    expect(host.overlayEl.innerHTML).toBe("");
  });

  it("켜면 그리고 상태를 저장한다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost();
    const c = initEditorOverlay(host);

    host.editorEl.value = "# 제목";
    c.setEnabled(true);

    expect(host.paneEl.dataset.overlay).toBe("true");
    expect(host.overlayEl.innerHTML).toContain("md-heading");
    expect(host.saved).toEqual([true]);
  });

  it("끄면 DOM 을 비운다 — 큰 문서를 들고 있을 이유가 없다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost(true);
    const c = initEditorOverlay(host);

    host.editorEl.value = "# 제목";
    c.refresh();
    expect(host.overlayEl.innerHTML).not.toBe("");

    c.setEnabled(false);
    expect(host.overlayEl.innerHTML).toBe("");
  });

  it("같은 값으로 다시 설정하면 저장하지 않는다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost();
    const c = initEditorOverlay(host);

    c.setEnabled(false);
    expect(host.saved).toEqual([]);
  });

  it("저장된 값이 켜짐이면 처음부터 켜서 뜬다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost(true);
    const c = initEditorOverlay(host);

    expect(c.isEnabled()).toBe(true);
    expect(host.paneEl.dataset.overlay).toBe("true");
  });

  it("저장이 실패해도 표시 전환은 된다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost();
    const c = initEditorOverlay({
      ...host,
      saveEnabled: () => {
        throw new Error("quota");
      },
    });

    expect(() => c.setEnabled(true)).not.toThrow();
    expect(c.isEnabled()).toBe(true);
  });
});

describe("정렬", () => {
  it("끝에 개행을 덧붙인다 — pre-wrap 이 끝 개행을 접어 높이가 어긋난다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost(true);
    const c = initEditorOverlay(host);

    host.editorEl.value = "한 줄";
    c.refresh();
    expect(host.overlayEl.innerHTML.endsWith("\n")).toBe(true);
  });

  it("textarea 의 실제 위치에서 왼쪽 시작점을 잰다 (줄 번호 칸 대응)", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost(true);
    const c = initEditorOverlay(host);

    c.refresh();
    expect(host.overlayEl.style.left).toBe("40px");
  });

  it("스크롤을 그대로 옮긴다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost(true);
    initEditorOverlay(host);

    host.editorEl.scrollTop = 120;
    host.editorEl.scrollLeft = 30;
    host.editorEl.dispatchEvent(new Event("scroll"));

    expect(host.overlayEl.scrollTop).toBe(120);
    expect(host.overlayEl.scrollLeft).toBe(30);
  });

  it("꺼져 있으면 스크롤도 따라가지 않는다", async () => {
    const { initEditorOverlay } = await load();
    const host = buildHost();
    initEditorOverlay(host);

    host.editorEl.scrollTop = 120;
    host.editorEl.dispatchEvent(new Event("scroll"));
    expect(host.overlayEl.scrollTop).toBe(0);
  });
});

describe("견고함", () => {
  it("초기화 실패해도 앱을 멈추지 않는다", async () => {
    const { initEditorOverlay } = await load();
    const c = initEditorOverlay(null as unknown as EditorOverlayHost);
    expect(() => c.refresh()).not.toThrow();
    expect(c.isEnabled()).toBe(false);
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const { initEditorOverlay } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    initEditorOverlay(buildHost());
    const second = initEditorOverlay(buildHost());
    second.setEnabled(true);
    expect(second.isEnabled()).toBe(false);
    warn.mockRestore();
  });
});
