import { describe, expect, it, vi } from "vitest";

import {
  isReclaimable,
  reclaimCandidates,
  reclaimMessage,
  reclaimTab,
  restoredEmptyMessage,
  saveWithReclaim,
} from "../src/sessionReclaim";
import type { PersistedSession, PersistedTab } from "../src/storage";

function tab(over: Partial<PersistedTab> = {}): PersistedTab {
  return {
    id: "tab-1",
    fileName: "a.md",
    content: "내용",
    isDirty: false,
    ...over,
  };
}

function session(tabs: PersistedTab[], activeTabId = "none"): PersistedSession {
  return { version: 1, activeTabId, tabs };
}

describe("isReclaimable — 규칙을 못 박는다", () => {
  it("깨끗하고 활성이 아니고 이름이 있고 내용이 있으면 회수 가능", () => {
    expect(isReclaimable(tab(), "other")).toBe(true);
  });

  it("더티 탭은 절대 아니다 — 미저장 편집분은 여기에만 있다", () => {
    expect(isReclaimable(tab({ isDirty: true }), "other")).toBe(false);
  });

  it("활성 탭은 아니다", () => {
    expect(isReclaimable(tab({ id: "tab-1" }), "tab-1")).toBe(false);
  });

  it("Untitled 는 아니다 — 디스크에 원본이 없다", () => {
    expect(isReclaimable(tab({ fileName: "Untitled" }), "other")).toBe(false);
    expect(isReclaimable(tab({ fileName: "  " }), "other")).toBe(false);
  });

  it("이미 빈 탭은 아니다 — 회수해도 얻는 게 없다", () => {
    expect(isReclaimable(tab({ content: "" }), "other")).toBe(false);
  });
});

describe("reclaimCandidates", () => {
  it("큰 것부터 나열한다 — 건드리는 탭 수를 최소화한다", () => {
    const s = session([
      tab({ id: "tab-1", fileName: "작은.md", content: "1" }),
      tab({ id: "tab-2", fileName: "큰.md", content: "1234567890" }),
      tab({ id: "tab-3", fileName: "중간.md", content: "12345" }),
    ]);
    expect(reclaimCandidates(s).map((t) => t.fileName)).toEqual([
      "큰.md",
      "중간.md",
      "작은.md",
    ]);
  });

  it("더티·활성·Untitled 를 모두 빼고 나열한다", () => {
    const s = session(
      [
        tab({ id: "tab-1", fileName: "더티.md", isDirty: true, content: "xxxxx" }),
        tab({ id: "tab-2", fileName: "활성.md", content: "xxxxx" }),
        tab({ id: "tab-3", fileName: "Untitled", content: "xxxxx" }),
        tab({ id: "tab-4", fileName: "후보.md", content: "x" }),
      ],
      "tab-2",
    );
    expect(reclaimCandidates(s).map((t) => t.fileName)).toEqual(["후보.md"]);
  });

  it("후보가 없으면 빈 배열", () => {
    expect(reclaimCandidates(session([tab({ isDirty: true })]))).toEqual([]);
  });
});

describe("reclaimTab", () => {
  it("내용만 비우고 탭은 남긴다 — 사용자가 열어 둔 것이다", () => {
    const s = session([tab({ id: "tab-1", fileName: "a.md" })]);
    const next = reclaimTab(s, "tab-1");
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].fileName).toBe("a.md");
    expect(next.tabs[0].content).toBe("");
    expect(next.tabs[0].reclaimed).toBe(true);
  });

  it("원본을 바꾸지 않는다 — 저장이 끝내 실패하면 되돌아가야 한다", () => {
    const s = session([tab({ id: "tab-1" })]);
    reclaimTab(s, "tab-1");
    expect(s.tabs[0].content).toBe("내용");
  });

  it("다른 탭은 그대로 둔다", () => {
    const s = session([tab({ id: "tab-1" }), tab({ id: "tab-2", content: "남김" })]);
    expect(reclaimTab(s, "tab-1").tabs[1].content).toBe("남김");
  });
});

describe("saveWithReclaim", () => {
  it("한 번에 성공하면 아무것도 회수하지 않는다", () => {
    const save = vi.fn(() => true);
    const result = saveWithReclaim(session([tab()]), save);
    expect(result).toEqual({ saved: true, reclaimed: [] });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("공간이 나면 거기서 멈춘다 — 필요 이상으로 비우지 않는다", () => {
    const s = session([
      tab({ id: "tab-1", fileName: "큰.md", content: "x".repeat(100) }),
      tab({ id: "tab-2", fileName: "작은.md", content: "x" }),
    ]);
    let attempt = 0;
    const result = saveWithReclaim(s, () => ++attempt > 1);

    expect(result.saved).toBe(true);
    expect(result.reclaimed).toEqual(["큰.md"]);
  });

  it("저장되는 세션에서 회수한 탭이 실제로 비어 있다", () => {
    const s = session([tab({ id: "tab-1", fileName: "a.md" })]);
    const seen: PersistedSession[] = [];
    saveWithReclaim(s, (candidate) => {
      seen.push(candidate);
      return seen.length > 1;
    });
    expect(seen[1].tabs[0].content).toBe("");
  });

  it("더티 탭만 있으면 회수하지 못하고 실패를 알린다", () => {
    const s = session([tab({ isDirty: true, content: "x".repeat(100) })]);
    const result = saveWithReclaim(s, () => false);
    expect(result).toEqual({ saved: false, reclaimed: [] });
  });

  it("다 비워도 실패하면 회수하지 않은 것으로 보고한다", () => {
    // 공간도 못 벌고 사본만 잃는 최악을 피한다.
    const s = session([
      tab({ id: "tab-1", fileName: "a.md" }),
      tab({ id: "tab-2", fileName: "b.md" }),
    ]);
    const result = saveWithReclaim(s, () => false);
    expect(result).toEqual({ saved: false, reclaimed: [] });
  });

  it("여러 개가 필요하면 큰 것부터 차례로 비운다", () => {
    const s = session([
      tab({ id: "tab-1", fileName: "작은.md", content: "x" }),
      tab({ id: "tab-2", fileName: "큰.md", content: "x".repeat(100) }),
    ]);
    let attempt = 0;
    const result = saveWithReclaim(s, () => ++attempt > 2);
    expect(result.reclaimed).toEqual(["큰.md", "작은.md"]);
  });
});

describe("안내 문구", () => {
  it("무엇을 비웠고 무엇이 무사한지 함께 말한다", () => {
    const message = reclaimMessage(["a.md", "b.md"]);
    expect(message).toContain("a.md");
    expect(message).toContain("b.md");
    // 편집 중인 내용은 그대로라는 사실이 가장 중요하다.
    expect(message).toContain("편집 중인 내용은 그대로");
  });

  it("복원 시에는 되찾는 방법을 알린다", () => {
    const message = restoredEmptyMessage(["a.md"]);
    expect(message).toContain("a.md");
    expect(message).toContain("다시 열어주세요");
  });
});
