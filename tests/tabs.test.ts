import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, saveSession, type PersistedTab } from "../src/storage";

/**
 * `tabs.ts` 는 모듈 스코프 싱글턴(`tabs` Map, `activeTabId`, `nextId`, ...)을 쓰므로
 * 테스트 간 상태가 새면 ID 시퀀스·활성 탭 판정이 뒤섞인다. `swUpdate.test.ts` 의
 * `loadSwUpdate()` 패턴을 따라 매 테스트마다 `vi.resetModules()` 로 모듈을 새로
 * 로드해 격리한다.
 */
async function loadTabs(): Promise<typeof import("../src/tabs")> {
  vi.resetModules();
  return import("../src/tabs");
}

interface Dom {
  tabBar: HTMLElement;
  editor: HTMLTextAreaElement;
  preview: HTMLElement;
  title: HTMLElement;
  notice: HTMLElement;
}

function createDom(): Dom {
  document.body.innerHTML = `
    <div id="tab-bar"></div>
    <textarea id="editor"></textarea>
    <div id="preview"></div>
    <div id="title"></div>
    <div id="notice" hidden></div>
  `;
  return {
    tabBar: document.querySelector<HTMLElement>("#tab-bar")!,
    editor: document.querySelector<HTMLTextAreaElement>("#editor")!,
    preview: document.querySelector<HTMLElement>("#preview")!,
    title: document.querySelector<HTMLElement>("#title")!,
    notice: document.querySelector<HTMLElement>("#notice")!,
  };
}

/** 가짜 FileSystemFileHandle. isSameEntry() 만 비동기 스파이로 흉내낸다. */
function makeFakeHandle(
  matches: (other: unknown) => boolean,
): FileSystemFileHandle {
  return {
    isSameEntry: vi.fn(async (other: unknown) => matches(other)),
  } as unknown as FileSystemFileHandle;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTab", () => {
  it("ID 시퀀스가 tab-1 부터 순차 증가한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    // initTabs() 가 복원할 세션이 없으면 기본 Untitled 탭(tab-1)을 만든다.
    expect(tabs.getActiveTab()!.id).toBe("tab-1");

    const second = tabs.createTab();
    const third = tabs.createTab();
    expect(second).toBe("tab-2");
    expect(third).toBe("tab-3");
  });

  it("기본값(content/handle/fileName/isDirty/scroll/selection)을 갖는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const id = tabs.createTab();
    const tab = tabs.getAllTabs().find((t) => t.id === id)!;
    expect(tab.content).toBe("");
    expect(tab.handle).toBeNull();
    expect(tab.fileName).toBe(tabs.UNTITLED);
    expect(tab.isDirty).toBe(false);
    expect(tab.scrollTop).toBe(0);
    expect(tab.selectionStart).toBe(0);
    expect(tab.selectionEnd).toBe(0);
  });

  it("인자로 넘긴 content/handle/fileName 을 그대로 반영한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const handle = makeFakeHandle(() => false);
    const id = tabs.createTab("본문", handle, "note.md");
    const tab = tabs.getAllTabs().find((t) => t.id === id)!;
    expect(tab.content).toBe("본문");
    expect(tab.handle).toBe(handle);
    expect(tab.fileName).toBe("note.md");
  });

  it("생성 즉시 활성 탭이 되고 에디터에 내용이 반영된다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const id = tabs.createTab("hello world");
    expect(tabs.getActiveTab()!.id).toBe(id);
    expect(dom.editor.value).toBe("hello world");
  });
});

describe("switchTab", () => {
  it("떠나는 탭의 content/scrollTop/selection 을 스냅샷으로 저장한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    dom.editor.value = "첫 탭 수정된 내용";
    dom.editor.scrollTop = 77;
    dom.editor.focus();
    dom.editor.setSelectionRange(2, 5);

    const secondId = tabs.createTab("두번째 탭");

    const firstTab = tabs.getAllTabs().find((t) => t.id === firstId)!;
    expect(firstTab.content).toBe("첫 탭 수정된 내용");
    expect(firstTab.scrollTop).toBe(77);
    expect(firstTab.selectionStart).toBe(2);
    expect(firstTab.selectionEnd).toBe(5);
    expect(tabs.getActiveTab()!.id).toBe(secondId);
  });

  it("대상 탭으로 전환하면 content/scrollTop/selection 이 복원된다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    dom.editor.value = "탭1 내용";
    dom.editor.scrollTop = 10;
    dom.editor.focus();
    dom.editor.setSelectionRange(1, 3);

    tabs.createTab("탭2 내용");

    tabs.switchTab(firstId);

    expect(dom.editor.value).toBe("탭1 내용");
    expect(dom.editor.scrollTop).toBe(10);
    expect(dom.editor.selectionStart).toBe(1);
    expect(dom.editor.selectionEnd).toBe(3);
  });

  it("focus() 를 setSelectionRange() 보다 먼저 호출한다 (F-69 순서 보장)", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    const secondId = tabs.createTab("두번째");

    const focusSpy = vi.spyOn(dom.editor, "focus");
    const selectSpy = vi.spyOn(dom.editor, "setSelectionRange");

    tabs.switchTab(firstId);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy.mock.invocationCallOrder[0]).toBeLessThan(
      selectSpy.mock.invocationCallOrder[0],
    );
    // switchTab 이 실제로 대상을 바꿨는지도 함께 확인 (secondId 는 더 이상 활성 아님)
    expect(tabs.getActiveTab()!.id).toBe(firstId);
    expect(secondId).not.toBe(firstId);
  });

  it("프리뷰 패널을 대상 탭 content 로 갱신한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    tabs.createTab("# 제목");
    tabs.switchTab(firstId);
    tabs.switchTab(tabs.getAllTabs().find((t) => t.content === "# 제목")!.id);

    expect(dom.preview.innerHTML).toContain("<h1");
  });

  it("존재하지 않는 id 면 아무 것도 하지 않는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const before = tabs.getActiveTab()!.id;
    tabs.switchTab("tab-does-not-exist");
    expect(tabs.getActiveTab()!.id).toBe(before);
  });
});

describe("closeTab", () => {
  it("마지막 탭을 닫으면 새 Untitled 탭이 생성된다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const onlyId = tabs.getActiveTab()!.id;
    tabs.closeTab(onlyId);

    expect(tabs.getAllTabs()).toHaveLength(1);
    const remaining = tabs.getActiveTab()!;
    expect(remaining.id).not.toBe(onlyId);
    expect(remaining.fileName).toBe(tabs.UNTITLED);
  });

  it("활성 탭을 닫으면 남은 탭 중 마지막 탭으로 전환된다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    const secondId = tabs.createTab("두번째");
    const thirdId = tabs.createTab("세번째");
    // 현재 활성 = thirdId. thirdId 를 닫으면 [firstId, secondId] 중 마지막(secondId)로 전환.
    tabs.closeTab(thirdId);

    expect(tabs.getAllTabs().map((t) => t.id)).toEqual([firstId, secondId]);
    expect(tabs.getActiveTab()!.id).toBe(secondId);
  });

  it("비활성 탭을 닫으면 활성 탭은 그대로 유지된다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    const secondId = tabs.createTab("두번째");
    // 활성 = secondId. 비활성인 firstId 를 닫는다.
    tabs.closeTab(firstId);

    expect(tabs.getAllTabs().map((t) => t.id)).toEqual([secondId]);
    expect(tabs.getActiveTab()!.id).toBe(secondId);
  });

  it("존재하지 않는 id 면 아무 것도 하지 않는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const before = tabs.getAllTabs().length;
    tabs.closeTab("tab-nope");
    expect(tabs.getAllTabs()).toHaveLength(before);
  });
});

describe("closeTab dirty 확인", () => {
  it("확인 콜백이 false 를 반환하면 닫히지 않는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const id = tabs.getActiveTab()!.id;
    tabs.markActiveTabDirty();

    const confirmFn = vi.fn(() => false);
    tabs.setCloseConfirm(confirmFn);

    tabs.closeTab(id);

    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(tabs.getAllTabs().map((t) => t.id)).toEqual([id]);
  });

  it("확인 콜백이 true 를 반환하면 닫힌다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const id = tabs.getActiveTab()!.id;
    tabs.markActiveTabDirty();

    const confirmFn = vi.fn(() => true);
    tabs.setCloseConfirm(confirmFn);

    tabs.closeTab(id);

    expect(confirmFn).toHaveBeenCalledTimes(1);
    // 마지막 탭이었으므로 닫힌 뒤 새 Untitled 탭이 생겼을 것 — id 는 달라야 한다.
    expect(tabs.getAllTabs().map((t) => t.id)).not.toEqual([id]);
  });

  it("확인 콜백을 등록하지 않으면 확인 없이 닫힌다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const id = tabs.getActiveTab()!.id;
    tabs.markActiveTabDirty();
    // setCloseConfirm 미호출

    tabs.closeTab(id);

    expect(tabs.getAllTabs().map((t) => t.id)).not.toEqual([id]);
  });

  it("dirty 가 아니면 확인 콜백을 호출하지 않는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const id = tabs.getActiveTab()!.id;
    const confirmFn = vi.fn(() => false);
    tabs.setCloseConfirm(confirmFn);

    tabs.closeTab(id);

    expect(confirmFn).not.toHaveBeenCalled();
  });
});

describe("syncActiveTab", () => {
  it("활성 탭에만 반영되고 비활성 탭은 영향받지 않는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const firstId = tabs.getActiveTab()!.id;
    // 아직 스냅샷되지 않은 첫 탭의 "진짜" 내용을 만들어 둔다.
    tabs.createTab("두번째 원본"); // 활성 = second, 이 시점 switchTab 이 first 를 스냅샷(빈 문자열)

    const secondId = tabs.getActiveTab()!.id;
    dom.editor.value = "두번째 수정중 (아직 sync 안 됨)";

    // sync 전에는 TabState.content 가 stale 하다.
    expect(tabs.getAllTabs().find((t) => t.id === secondId)!.content).toBe(
      "두번째 원본",
    );

    tabs.syncActiveTab();

    expect(tabs.getAllTabs().find((t) => t.id === secondId)!.content).toBe(
      "두번째 수정중 (아직 sync 안 됨)",
    );
    // 비활성 탭(first)은 무영향.
    expect(tabs.getAllTabs().find((t) => t.id === firstId)!.content).toBe("");
  });

  it("활성 탭이 없으면 아무 동작도 하지 않는다 (throw 하지 않음)", async () => {
    const tabs = await loadTabs();
    expect(() => tabs.syncActiveTab()).not.toThrow();
  });
});

describe("markActiveTabDirty", () => {
  it("깨끗한 탭을 dirty 로 바꾸고 탭바를 다시 렌더링한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    expect(tabs.getActiveTab()!.isDirty).toBe(false);
    tabs.markActiveTabDirty();
    expect(tabs.getActiveTab()!.isDirty).toBe(true);

    const nameSpan = dom.tabBar.querySelector(".tab-name")!;
    expect(nameSpan.textContent).toContain("*");
  });

  it("이미 dirty 면 재렌더링을 스킵한다 (no-op)", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    tabs.markActiveTabDirty();
    const tabElBefore = dom.tabBar.querySelector(".tab")!;

    tabs.markActiveTabDirty(); // 이미 dirty
    const tabElAfter = dom.tabBar.querySelector(".tab")!;

    // renderTabs() 는 tabBarEl.innerHTML = "" 후 재생성하므로, 다시 렌더링됐다면
    // DOM 노드 참조가 바뀐다. no-op 이면 참조가 그대로다.
    expect(tabElAfter).toBe(tabElBefore);
  });
});

describe("restoreSession", () => {
  it("저장된 세션을 그대로 복원한다", async () => {
    const persisted: PersistedTab[] = [
      { id: "tab-3", fileName: "a.md", content: "A", isDirty: false },
      { id: "tab-7", fileName: "b.md", content: "B", isDirty: true },
    ];
    saveSession(createSession(persisted, "tab-7"));

    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    expect(tabs.getAllTabs().map((t) => t.id)).toEqual(["tab-3", "tab-7"]);
    expect(tabs.getActiveTab()!.id).toBe("tab-7");
    expect(tabs.getActiveTab()!.isDirty).toBe(true);
    expect(dom.editor.value).toBe("B");
    // 복원된 탭은 handle 을 가질 수 없다.
    expect(tabs.getAllTabs().every((t) => t.handle === null)).toBe(true);
  });

  it("ID 시퀀스가 복원된 최대값 뒤로 밀려 충돌을 막는다", async () => {
    const persisted: PersistedTab[] = [
      { id: "tab-2", fileName: "a.md", content: "A", isDirty: false },
      { id: "tab-9", fileName: "b.md", content: "B", isDirty: false },
    ];
    saveSession(createSession(persisted, "tab-2"));

    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const newId = tabs.createTab();
    expect(newId).toBe("tab-10");
  });

  it("세션이 없으면 기본 Untitled 탭으로 시작한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    expect(tabs.getAllTabs()).toHaveLength(1);
    expect(tabs.getActiveTab()!.fileName).toBe(tabs.UNTITLED);
    expect(tabs.getActiveTab()!.id).toBe("tab-1");
  });

  it("세션의 activeTabId 가 유효하지 않으면 첫 탭이 활성화된다", async () => {
    const persisted: PersistedTab[] = [
      { id: "tab-1", fileName: "a.md", content: "A", isDirty: false },
    ];
    saveSession(createSession(persisted, "tab-does-not-exist"));

    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    expect(tabs.getActiveTab()!.id).toBe("tab-1");
  });
});

describe("persistNow", () => {
  it("성공하면 true 를 반환하고 활성 탭의 최신 본문(editorEl.value)을 저장한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    dom.editor.value = "저장될 최신 내용";
    const result = tabs.persistNow();

    expect(result).toBe(true);
    const { loadSession } = await import("../src/storage");
    const loaded = loadSession();
    expect(loaded!.tabs[0].content).toBe("저장될 최신 내용");
  });

  it("디바운스 타이머가 걸려 있어도 즉시 저장하고 타이머를 취소한다", async () => {
    vi.useFakeTimers();
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    tabs.markActiveTabDirty(); // schedulePersist() 로 500ms 타이머 예약
    const result = tabs.persistNow();
    expect(result).toBe(true);

    // 타이머가 취소됐으므로 이후 시간이 흘러도 추가 저장 호출에서 예외가 없어야 한다.
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});

describe("findTabByHandle", () => {
  it("isSameEntry() 로 일치하는 탭을 찾는다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const targetHandle = makeFakeHandle(() => true);
    const otherHandle = makeFakeHandle(() => false);

    tabs.updateActiveTab({ handle: otherHandle });
    const secondId = tabs.createTab("두번째");
    tabs.updateActiveTab({ handle: targetHandle });

    const searchHandle = makeFakeHandle(() => false); // 실제 비교는 handle.isSameEntry 쪽에서 처리
    const found = await tabs.findTabByHandle(searchHandle);

    expect(found?.id).toBe(secondId);
  });

  it("일치하는 탭이 없으면 undefined 를 반환한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    const handle = makeFakeHandle(() => false);
    tabs.updateActiveTab({ handle });

    const searchHandle = makeFakeHandle(() => false);
    const found = await tabs.findTabByHandle(searchHandle);
    expect(found).toBeUndefined();
  });

  it("handle 이 없는 탭은 건너뛴다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);
    // handle 없는 기본 탭만 있는 상태.

    const searchHandle = makeFakeHandle(() => true);
    const found = await tabs.findTabByHandle(searchHandle);
    expect(found).toBeUndefined();
  });
});

describe("hasDirtyTabs / getActiveContent", () => {
  it("dirty 탭이 하나도 없으면 false", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    expect(tabs.hasDirtyTabs()).toBe(false);
  });

  it("dirty 탭이 있으면 true", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    tabs.markActiveTabDirty();
    expect(tabs.hasDirtyTabs()).toBe(true);
  });

  it("hasDirtyTabs 는 판정 전 활성 탭을 동기화한다", async () => {
    const tabs = await loadTabs();
    const dom = createDom();
    tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

    tabs.markActiveTabDirty();
    tabs.createTab("두번째"); // 첫 탭은 이제 비활성, dirty=true 로 스냅샷됨
    dom.editor.value = "안 저장된 새 변경";

    // getActiveContent() 는 항상 editorEl.value 그대로.
    expect(tabs.getActiveContent()).toBe("안 저장된 새 변경");
    expect(tabs.hasDirtyTabs()).toBe(true);
  });
});

describe("용량 초과 알림", () => {
  /**
   * `limit` 을 주면 **세션 payload 가 그보다 클 때만** 실패한다 — 회수(F-54 잔여)로
   * 공간을 벌면 성공하는, 실제 QuotaExceededError 와 같은 모양이 된다.
   */
  function stubQuotaExceeded(limit?: number) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const backing = new Map<string, string>();
    let fail = true;

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return backing.size;
        },
        clear: () => backing.clear(),
        getItem: (k: string) => backing.get(k) ?? null,
        key: (i: number) => [...backing.keys()][i] ?? null,
        removeItem: (k: string) => backing.delete(k),
        setItem: (k: string, v: string) => {
          const tooBig = limit === undefined || v.length > limit;
          if (fail && tooBig && k.startsWith("markdown-editor:session")) {
            throw new DOMException("quota", "QuotaExceededError");
          }
          backing.set(k, v);
        },
      } satisfies Storage,
    });

    return {
      setFail: (v: boolean) => {
        fail = v;
      },
      restore: () => {
        if (originalDescriptor) {
          Object.defineProperty(window, "localStorage", originalDescriptor);
        } else {
          delete (window as { localStorage?: Storage }).localStorage;
        }
      },
    };
  }

  it("저장 실패 시 1회만 알리고, 다시 성공하면 재알림 가능 상태로 돌아간다", async () => {
    const stub = stubQuotaExceeded();
    try {
      const tabs = await loadTabs();
      // tabs.ts 는 내부적으로 "./notice" 를 import 한다. vi.resetModules() 이후
      // 같은 모듈 레지스트리에서 동적 import 해야 tabs.ts 가 실제로 쓰는
      // notice 모듈 인스턴스(= containerEl 전역)를 공유할 수 있다. 정적 import
      // 를 쓰면 리셋 이전의 별도 인스턴스를 잡아 showNotice 호출이 반영되지 않는다.
      const { initNotice } = await import("../src/notice");
      const dom = createDom();
      initNotice(dom.notice);
      tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

      expect(tabs.persistNow()).toBe(false);
      expect(dom.notice.hidden).toBe(false);
      expect(dom.notice.textContent).toContain("저장 공간이 부족");

      // 알림을 수동으로 닫아 둔 뒤 재실패시켜도 다시 뜨지 않아야 한다 (플래그).
      dom.notice.hidden = true;
      expect(tabs.persistNow()).toBe(false);
      expect(dom.notice.hidden).toBe(true);

      // 저장이 다시 성공하면 플래그가 풀린다.
      stub.setFail(false);
      expect(tabs.persistNow()).toBe(true);

      // 다시 실패하면 알림이 재차 뜬다.
      stub.setFail(true);
      dom.notice.hidden = true;
      expect(tabs.persistNow()).toBe(false);
      expect(dom.notice.hidden).toBe(false);
    } finally {
      stub.restore();
    }
  });

  it("공간이 부족하면 다시 열 수 있는 탭의 사본을 비우고 저장에 성공한다 (F-54 잔여)", async () => {
    const stub = stubQuotaExceeded(400);
    try {
      const tabs = await loadTabs();
      const { initNotice } = await import("../src/notice");
      const dom = createDom();
      initNotice(dom.notice);
      tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

      // 깨끗하고 이름이 있는 큰 탭 — 회수 대상
      tabs.createTab("x".repeat(500), null, "큰.md");
      // 활성 탭은 건드리면 안 된다
      tabs.createTab("작업 중", null, "활성.md");

      expect(tabs.persistNow()).toBe(true);
      expect(dom.notice.textContent).toContain("큰.md");
      expect(dom.notice.textContent).toContain("편집 중인 내용은 그대로");

      const stored = JSON.parse(
        window.localStorage.getItem("markdown-editor:session:v1")!,
      ) as { tabs: Array<{ fileName: string; content: string; reclaimed?: boolean }> };

      const big = stored.tabs.find((t) => t.fileName === "큰.md")!;
      expect(big.content).toBe("");
      expect(big.reclaimed).toBe(true);
      // 활성 탭은 그대로다.
      expect(stored.tabs.find((t) => t.fileName === "활성.md")!.content).toBe("작업 중");
    } finally {
      stub.restore();
    }
  });

  it("더티 탭의 내용은 절대 버리지 않는다 — 그럴 바에는 저장 실패로 남긴다", async () => {
    const stub = stubQuotaExceeded(200);
    try {
      const tabs = await loadTabs();
      const { initNotice } = await import("../src/notice");
      const dom = createDom();
      initNotice(dom.notice);
      tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

      tabs.createTab("x".repeat(500), null, "미저장.md");
      tabs.markActiveTabDirty();
      tabs.createTab("", null, "활성.md");

      expect(tabs.persistNow()).toBe(false);
      expect(dom.notice.textContent).toContain("저장 공간이 부족");
      // 회수 안내가 아니라 기존 실패 안내가 떠야 한다.
      expect(dom.notice.textContent).not.toContain("임시 사본을 비웠습니다");
    } finally {
      stub.restore();
    }
  });

  it("회수된 탭을 복원하면 왜 비었는지 알린다", async () => {
    const stub = stubQuotaExceeded(400);
    try {
      const tabs = await loadTabs();
      const { initNotice } = await import("../src/notice");
      const dom = createDom();
      initNotice(dom.notice);
      tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);

      tabs.createTab("x".repeat(500), null, "큰.md");
      tabs.createTab("작업 중", null, "활성.md");
      expect(tabs.persistNow()).toBe(true);

      // 새 모듈 인스턴스로 다시 띄우면 저장된 세션을 복원한다.
      const reloaded = await loadTabs();
      const { initNotice: initNotice2 } = await import("../src/notice");
      const dom2 = createDom();
      initNotice2(dom2.notice);
      reloaded.initTabs(dom2.tabBar, dom2.editor, dom2.preview, dom2.title);

      expect(dom2.notice.textContent).toContain("큰.md");
      expect(dom2.notice.textContent).toContain("다시 열어주세요");
    } finally {
      stub.restore();
    }
  });
});
