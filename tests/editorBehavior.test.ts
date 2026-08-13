import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-26·F-27 편집 키 배선 (이슈 #78·#79).
 *
 * 계산은 `editorKeys.test.ts`, 실제 실행 취소·포커스는 `editorkeys.spec.ts` 가
 * 맡는다. 여기서는 **키 이벤트가 계산에 어떻게 연결되는지** 를 본다 — 특히
 * 가로채지 **말아야** 할 경우들.
 */

async function load(): Promise<typeof import("../src/editorBehavior")> {
  vi.resetModules();
  return import("../src/editorBehavior");
}

function buildHost(value = "", caret = value.length) {
  const editorEl = document.createElement("textarea");
  editorEl.value = value;
  document.body.append(editorEl);
  editorEl.setSelectionRange(caret, caret);

  const notices: string[] = [];
  return {
    editorEl,
    notices,
    // jsdom 은 execCommand 를 구현하지 않는다. 선택 영역 교체만 흉내낸다.
    insertText: (ta: HTMLTextAreaElement, text: string) => {
      const { selectionStart, selectionEnd } = ta;
      ta.value = ta.value.slice(0, selectionStart) + text + ta.value.slice(selectionEnd);
      const caretAfter = selectionStart + text.length;
      ta.setSelectionRange(caretAfter, caretAfter);
    },
    notify: (m: string) => notices.push(m),
  };
}

function key(
  el: HTMLElement,
  init: Partial<KeyboardEventInit> & { key: string },
  composing = false,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (composing) Object.defineProperty(event, "isComposing", { value: true });
  el.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("editorBehavior — 목록 이어쓰기", () => {
  it("목록 줄에서 Enter 를 가로채 표식을 넣는다", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("- 첫째");
    initEditorBehavior(host);

    const event = key(host.editorEl, { key: "Enter" });
    expect(event.defaultPrevented).toBe(true);
    expect(host.editorEl.value).toBe("- 첫째\n- ");
  });

  it("목록이 아니면 가로채지 않는다 — 기본 줄바꿈에 맡긴다", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("그냥 글");
    initEditorBehavior(host);

    const event = key(host.editorEl, { key: "Enter" });
    expect(event.defaultPrevented).toBe(false);
    expect(host.editorEl.value).toBe("그냥 글");
  });

  it("Shift+Enter 는 가로채지 않는다", async () => {
    // 줄바꿈만 넣고 싶을 때 쓰는 조합이다.
    const { initEditorBehavior } = await load();
    const host = buildHost("- 첫째");
    initEditorBehavior(host);

    expect(key(host.editorEl, { key: "Enter", shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("조합 입력 중에는 가로채지 않는다", async () => {
    // 한글 조합 중 Enter 는 글자를 확정하는 키다.
    const { initEditorBehavior } = await load();
    const host = buildHost("- 첫째");
    initEditorBehavior(host);

    expect(key(host.editorEl, { key: "Enter" }, true).defaultPrevented).toBe(false);
    expect(host.editorEl.value).toBe("- 첫째");
  });

  it("keyCode 229 도 조합으로 본다 — 오래된 IME 대응", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("- 첫째");
    initEditorBehavior(host);

    expect(key(host.editorEl, { key: "Enter", keyCode: 229 }).defaultPrevented).toBe(false);
  });
});

describe("editorBehavior — Tab", () => {
  it("Tab 이 들여쓰기를 넣는다", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("코드", 0);
    initEditorBehavior(host);

    const event = key(host.editorEl, { key: "Tab" });
    expect(event.defaultPrevented).toBe(true);
    expect(host.editorEl.value).toBe("  코드");
  });

  it("Shift+Tab 이 내어쓴다", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("  코드");
    initEditorBehavior(host);

    key(host.editorEl, { key: "Tab", shiftKey: true });
    expect(host.editorEl.value).toBe("코드");
  });

  it("Esc 뒤의 첫 Tab 은 흘려보낸다 — 갇히지 않게", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("내용");
    const controller = initEditorBehavior(host);

    key(host.editorEl, { key: "Escape" });
    expect(controller.isTabCapturing()).toBe(false);
    expect(host.notices[0]).toContain("Tab");

    const event = key(host.editorEl, { key: "Tab" });
    expect(event.defaultPrevented).toBe(false);
    expect(host.editorEl.value).toBe("내용");
  });

  it("탈출은 한 번뿐 — 그 다음 Tab 은 다시 들여쓰기다", async () => {
    // 영구히 꺼지면 다시 켜는 방법을 사용자가 알 수 없다.
    const { initEditorBehavior } = await load();
    const host = buildHost("내용", 0);
    const controller = initEditorBehavior(host);

    key(host.editorEl, { key: "Escape" });
    key(host.editorEl, { key: "Tab" });
    expect(controller.isTabCapturing()).toBe(true);

    const event = key(host.editorEl, { key: "Tab" });
    expect(event.defaultPrevented).toBe(true);
    expect(host.editorEl.value).toBe("  내용");
  });

  it("다른 키를 누르면 탈출 예약이 사라진다", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("내용", 0);
    const controller = initEditorBehavior(host);

    key(host.editorEl, { key: "Escape" });
    key(host.editorEl, { key: "x" });
    expect(controller.isTabCapturing()).toBe(true);
    expect(key(host.editorEl, { key: "Tab" }).defaultPrevented).toBe(true);
  });

  it("Esc 를 여러 번 눌러도 안내는 한 번만", async () => {
    const { initEditorBehavior } = await load();
    const host = buildHost("내용");
    initEditorBehavior(host);

    key(host.editorEl, { key: "Escape" });
    key(host.editorEl, { key: "Escape" });
    expect(host.notices).toHaveLength(1);
  });
});

describe("editorBehavior — 초기화", () => {
  it("재호출은 무시되고 잘못된 host 로도 던지지 않는다", async () => {
    const { initEditorBehavior } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initEditorBehavior(buildHost());
    initEditorBehavior(buildHost());
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[editorBehavior] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("host 가 비어도 no-op 컨트롤러를 돌려준다", async () => {
    const { initEditorBehavior } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initEditorBehavior({
      editorEl: null as unknown as HTMLTextAreaElement,
    });
    expect(controller.isTabCapturing()).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[editorBehavior] 초기화 실패:"]);
    warn.mockRestore();
  });
});
