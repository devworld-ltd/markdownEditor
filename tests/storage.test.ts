import { describe, it, expect, beforeEach } from "vitest";
import {
  clearSession,
  createSession,
  isStorageAvailable,
  loadSession,
  saveSession,
} from "../src/storage";

const STORAGE_KEY = "markdown-editor:session:v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("storage", () => {
  it("jsdom 환경에서 localStorage 를 사용할 수 있다", () => {
    expect(isStorageAvailable()).toBe(true);
  });

  it("저장한 세션을 그대로 복원한다", () => {
    const session = createSession(
      [{ id: "tab-1", fileName: "a.md", content: "# A", isDirty: true }],
      "tab-1",
    );
    expect(saveSession(session)).toBe(true);

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.activeTabId).toBe("tab-1");
    expect(loaded!.tabs).toHaveLength(1);
    expect(loaded!.tabs[0]).toEqual({
      id: "tab-1",
      fileName: "a.md",
      content: "# A",
      isDirty: true,
    });
  });

  it("저장된 세션이 없으면 null 을 반환한다", () => {
    expect(loadSession()).toBeNull();
  });

  it("손상된 JSON 은 null 로 처리한다", () => {
    window.localStorage.setItem(STORAGE_KEY, "{ not json");
    expect(loadSession()).toBeNull();
  });

  it("스키마 버전이 다르면 무시한다", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 99, activeTabId: "tab-1", tabs: [{ id: "tab-1" }] }),
    );
    expect(loadSession()).toBeNull();
  });

  it("형식이 깨진 탭 항목은 걸러낸다", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeTabId: "tab-2",
        tabs: [
          { id: "tab-1" },
          { id: "tab-2", fileName: "b.md", content: "B", isDirty: false },
        ],
      }),
    );
    const loaded = loadSession();
    expect(loaded!.tabs).toHaveLength(1);
    expect(loaded!.tabs[0].id).toBe("tab-2");
  });

  it("남은 탭이 하나도 없으면 null 을 반환한다", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, activeTabId: "", tabs: [] }),
    );
    expect(loadSession()).toBeNull();
  });

  it("용량 초과(QuotaExceededError)면 saveSession 이 false 를 반환한다", () => {
    // jsdom 의 Storage 는 Proxy 라 `localStorage.setItem = fn` 이 메서드 교체가 아니라
    // "setItem" 이라는 이름의 항목 저장으로 처리된다. 환경에 관계없이 확실히 스텁하려면
    // window.localStorage 속성 자체를 갈아끼워야 한다.
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const backing = new Map<string, string>();

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
          // 세션 키만 실패시켜 "저장소는 쓸 수 있는데 용량이 찬" 상태를 만든다.
          // (전부 실패시키면 isStorageAvailable() 의 probe 도 막혀 다른 경로를 탄다)
          if (k.startsWith("markdown-editor:session")) {
            throw new DOMException("quota", "QuotaExceededError");
          }
          backing.set(k, v);
        },
      } satisfies Storage,
    });

    try {
      // 저장소 자체는 사용 가능한 상태여야 한다.
      expect(isStorageAvailable()).toBe(true);

      const session = createSession(
        [{ id: "tab-1", fileName: "a.md", content: "A", isDirty: true }],
        "tab-1",
      );
      expect(saveSession(session)).toBe(false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "localStorage", originalDescriptor);
      } else {
        // 원래 own 속성이 아니었다면(프로토타입 접근자) 덮어쓴 own 속성을 지워야
        // 원래 접근자가 다시 보인다. 지우지 않으면 이후 테스트가 스텁을 물려받는다.
        delete (window as { localStorage?: Storage }).localStorage;
      }
    }
  });

  it("clearSession 이 저장된 세션을 지운다", () => {
    saveSession(createSession([{ id: "tab-1", fileName: "a.md", content: "A", isDirty: false }], "tab-1"));
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
