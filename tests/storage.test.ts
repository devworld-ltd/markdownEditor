import { describe, it, expect, beforeEach } from "vitest";
import {
  clearSession,
  createSession,
  isStorageAvailable,
  loadSession,
  saveSession,
  loadSplitRatio,
  saveSplitRatio,
  loadViewMode,
  saveViewMode,
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

describe("분할 비율 영속화 (F-32)", () => {
  it("저장한 값을 그대로 읽는다", () => {
    saveSplitRatio(0.7);
    expect(loadSplitRatio()).toBe(0.7);
  });

  it("저장된 적이 없으면 null — 호출부가 기본값을 정한다", () => {
    localStorage.removeItem("markdown-editor:layout:v1");
    expect(loadSplitRatio()).toBeNull();
  });

  it("JSON 이 깨져 있으면 null", () => {
    localStorage.setItem("markdown-editor:layout:v1", "{not json");
    expect(loadSplitRatio()).toBeNull();
  });

  it("파싱은 되지만 타입이 틀린 값도 null", () => {
    // 이쪽이 더 위험하다 — 예외가 안 나므로 그대로 흘러가 레이아웃 계산이
    // 조용히 NaN 이 된다. clampRatio 가 2차 방어를 하지만, 경계에서 막는 것이
    // 이 함수의 계약이다.
    for (const raw of ['{"ratio":"0.7"}', '{"ratio":null}', '{"ratio":{}}', '{"ratio":[]}', "[]", "null", "42"]) {
      localStorage.setItem("markdown-editor:layout:v1", raw);
      expect(loadSplitRatio(), raw).toBeNull();
    }
  });

  it("모드를 저장해도 비율이 지워지지 않는다 — 항목별 병합 쓰기", () => {
    // 통째로 덮어쓰면 나중에 저장한 항목이 앞선 항목을 지운다.
    saveSplitRatio(0.4);
    saveViewMode("editor");
    expect(loadSplitRatio()).toBe(0.4);
    expect(loadViewMode()).toBe("editor");

    saveSplitRatio(0.6);
    expect(loadViewMode()).toBe("editor");
  });

  it("레이아웃 값이 객체가 아니면 통째로 무시한다", () => {
    // 배열도 typeof "object" 다 — 확인하지 않으면 인덱스가 키처럼 읽힌다.
    for (const raw of ["[]", '"문자열"', "42", "true"]) {
      localStorage.setItem("markdown-editor:layout:v1", raw);
      expect(loadSplitRatio(), raw).toBeNull();
      expect(loadViewMode(), raw).toBeNull();
    }
  });

  it("문서 세션과 다른 키를 쓴다 — 한쪽이 깨져도 다른 쪽은 멀쩡하다", () => {
    saveSplitRatio(0.4);
    localStorage.setItem("markdown-editor:session:v1", "{손상됨");
    expect(loadSplitRatio()).toBe(0.4);
  });
});
