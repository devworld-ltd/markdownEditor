import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `shortcuts.ts` 는 `fileOps.ts`(파일 I/O, 이번 범위 밖)와 `tabs.ts` 를 직접 호출한다.
 * 키 매핑 자체만 검증하면 되므로 두 모듈을 전부 모킹해 `document` 의 keydown 리스너
 * 동작만 격리해서 확인한다.
 */
vi.mock("../src/fileOps", () => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
}));

vi.mock("../src/tabs", () => ({
  UNTITLED: "Untitled",
  closeTab: vi.fn(),
  createTab: vi.fn(),
  getActiveTab: vi.fn(),
}));

import { openFile, saveFile, saveFileAs } from "../src/fileOps";
import { UNTITLED, closeTab, createTab, getActiveTab } from "../src/tabs";
import { initShortcuts } from "../src/shortcuts";

function dispatchKeydown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

// initShortcuts() 는 document 에 keydown 리스너를 등록만 하고 참조를 돌려주지
// 않는다. 테스트마다 새로 호출하면 리스너가 계속 쌓여 이벤트가 여러 번 처리되므로,
// addEventListener 를 스파이해 핸들러를 붙잡아뒀다가 매 테스트 후 직접 제거한다.
let capturedHandler: EventListenerOrEventListenerObject | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  const spy = vi.spyOn(document, "addEventListener");
  initShortcuts();
  capturedHandler = spy.mock.calls[0]?.[1] as EventListenerOrEventListenerObject;
  spy.mockRestore();
});

afterEach(() => {
  if (capturedHandler) document.removeEventListener("keydown", capturedHandler);
  capturedHandler = null;
});

describe("initShortcuts — 파일 단축키", () => {
  it("Cmd/Ctrl+O 는 openFile() 을 호출하고 기본 동작을 막는다", () => {
    const event = dispatchKeydown({ key: "o", metaKey: true });
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Cmd/Ctrl+S(shift 없음) 는 saveFile() 을 호출한다", () => {
    dispatchKeydown({ key: "s", metaKey: true });
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFileAs).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl+Shift+S 는 saveFileAs() 를 호출한다", () => {
    dispatchKeydown({ key: "s", metaKey: true, shiftKey: true });
    expect(saveFileAs).toHaveBeenCalledTimes(1);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("ctrlKey 로도 동일하게 동작한다 (metaKey 대체)", () => {
    dispatchKeydown({ key: "o", ctrlKey: true });
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("매핑되지 않은 mod+키는 아무 것도 호출하지 않는다", () => {
    dispatchKeydown({ key: "x", metaKey: true });
    expect(openFile).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(saveFileAs).not.toHaveBeenCalled();
  });
});

describe("initShortcuts — 탭 단축키 (Alt)", () => {
  it("Alt+N 은 새 Untitled 탭을 만든다", () => {
    const event = dispatchKeydown({ code: "KeyN", altKey: true });
    expect(createTab).toHaveBeenCalledWith("", null, UNTITLED);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Alt+W 는 활성 탭이 있으면 closeTab(id) 을 호출한다", () => {
    vi.mocked(getActiveTab).mockReturnValue({ id: "tab-3" } as ReturnType<
      typeof getActiveTab
    >);

    const event = dispatchKeydown({ code: "KeyW", altKey: true });
    expect(closeTab).toHaveBeenCalledWith("tab-3");
    expect(event.defaultPrevented).toBe(true);
  });

  it("Alt+W 인데 활성 탭이 없으면 closeTab 을 호출하지 않는다", () => {
    vi.mocked(getActiveTab).mockReturnValue(undefined);

    dispatchKeydown({ code: "KeyW", altKey: true });
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("매핑되지 않은 Alt+키는 아무 것도 호출하지 않는다", () => {
    dispatchKeydown({ code: "KeyZ", altKey: true });
    expect(createTab).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });
});

describe("initShortcuts — 수식어 조합", () => {
  it("mod 와 Alt 가 동시에 눌리면 어느 분기도 타지 않는다", () => {
    dispatchKeydown({ key: "o", metaKey: true, altKey: true });
    dispatchKeydown({ code: "KeyN", metaKey: true, altKey: true });

    expect(openFile).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });

  it("수식어가 전혀 없으면 아무 것도 호출하지 않는다", () => {
    dispatchKeydown({ key: "s" });
    dispatchKeydown({ code: "KeyN" });

    expect(saveFile).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });
});
