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
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      const session = createSession(
        [{ id: "tab-1", fileName: "a.md", content: "A", isDirty: true }],
        "tab-1",
      );
      expect(saveSession(session)).toBe(false);
    } finally {
      window.localStorage.setItem = original;
    }
  });

  it("clearSession 이 저장된 세션을 지운다", () => {
    saveSession(createSession([{ id: "tab-1", fileName: "a.md", content: "A", isDirty: false }], "tab-1"));
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
