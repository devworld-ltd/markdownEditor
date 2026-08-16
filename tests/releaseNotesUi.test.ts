import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReleaseEntry } from "../src/releaseNotes";

/**
 * #131 새 소식 화면.
 *
 * 검증의 핵심은 **자동으로 뜨는 조건**이다. 매번 뜨면 광고가 되고, 한 번도 안 뜨면
 * F-69 알림이 여전히 "무엇이" 를 말하지 못한다.
 */

async function loadUi(): Promise<typeof import("../src/releaseNotesUi")> {
  vi.resetModules();
  return import("../src/releaseNotesUi");
}

function stubDialog(dialogEl: HTMLDialogElement): void {
  dialogEl.showModal = () => {
    dialogEl.open = true;
  };
  dialogEl.close = () => {
    dialogEl.open = false;
    dialogEl.dispatchEvent(new Event("close"));
  };
}

const ENTRIES: ReleaseEntry[] = [
  { version: "2.1.0", date: "2026-08-16", body: "### 추가\n- 새 기능" },
  { version: "2.0.0", date: "2026-08-12", body: "### 변경\n- 웹 전환" },
];

function buildHost(
  currentVersion = "2.1.0",
  seen: string | null = "2.0.0",
  entries: ReleaseEntry[] = ENTRIES,
) {
  const dialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(dialogEl);
  const listEl = document.createElement("div");
  const emptyEl = document.createElement("p");
  const closeEl = document.createElement("button");
  const returnFocusTo = document.createElement("textarea");
  document.body.append(dialogEl, listEl, emptyEl, closeEl, returnFocusTo);

  const saved: string[] = [];
  return {
    dialogEl, listEl, emptyEl, closeEl, returnFocusTo, saved,
    currentVersion,
    entries,
    // 실제 앱은 `parseMarkdown` 을 넘긴다. 여기서는 호출 여부만 본다.
    render: vi.fn((md: string) => `<p>${md.replace(/[<>]/g, "")}</p>`),
    loadSeen: () => seen,
    saveSeen: (v: string) => saved.push(v),
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("목록", () => {
  it("버전마다 항목을 그린다 — 최신이 맨 위", () => {
    return loadUi().then(({ initReleaseNotes }) => {
      const host = buildHost();
      const c = initReleaseNotes(host);
      c.open();

      const items = host.listEl.querySelectorAll<HTMLElement>(".release-item");
      expect(items).toHaveLength(2);
      expect(items[0].dataset.version).toBe("2.1.0");
      expect(c.count()).toBe(2);
    });
  });

  it("최신만 펼치고 나머지는 접는다 — 이력이 길어지면 최신이 묻힌다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost();
    initReleaseNotes(host).open();

    const items = host.listEl.querySelectorAll<HTMLElement>(".release-item");
    expect(items[0].dataset.collapsed).toBeUndefined();
    expect(items[1].dataset.collapsed).toBe("true");
  });

  it("지금 쓰는 버전을 짚어 준다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost("2.0.0", "2.0.0");
    initReleaseNotes(host).open();

    const badges = host.listEl.querySelectorAll(".release-current");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest(".release-item")?.getAttribute("data-version")).toBe("2.0.0");
  });

  it("본문은 주입받은 정화 함수를 거친다 — 두 번째 렌더 경로를 만들지 않는다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost();
    initReleaseNotes(host).open();

    expect(host.render).toHaveBeenCalledTimes(2);
    expect(host.render).toHaveBeenCalledWith(ENTRIES[0].body);
  });

  it("헤딩을 누르면 접었다 폈다 한다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost();
    initReleaseNotes(host).open();

    const first = host.listEl.querySelector<HTMLElement>(".release-item")!;
    first.querySelector<HTMLElement>(".release-version")!.click();
    expect(first.dataset.collapsed).toBe("true");
    first.querySelector<HTMLElement>(".release-version")!.click();
    expect(first.dataset.collapsed).toBeUndefined();
  });

  it("항목이 없으면 안내를 보여준다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost("2.1.0", "2.0.0", []);
    initReleaseNotes(host).open();

    expect(host.emptyEl.hidden).toBe(false);
    expect(host.listEl.querySelectorAll(".release-item")).toHaveLength(0);
  });
});

describe("자동 표시", () => {
  it("갱신 뒤 처음이면 뜬다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost("2.1.0", "2.0.0");
    const c = initReleaseNotes(host);

    expect(c.maybeAutoShow()).toBe(true);
    expect(c.isOpen()).toBe(true);
  });

  it("이미 본 버전이면 뜨지 않는다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost("2.1.0", "2.1.0");
    const c = initReleaseNotes(host);

    expect(c.maybeAutoShow()).toBe(false);
    expect(c.isOpen()).toBe(false);
  });

  it("처음 온 사람에게는 뜨지 않되, 지금 버전을 본 것으로 기록한다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost("2.1.0", null);
    const c = initReleaseNotes(host);

    expect(c.maybeAutoShow()).toBe(false);
    // 기록하지 않으면 다음 갱신 때가 아니라 **다음 방문 때** 뜬다.
    expect(host.saved).toEqual(["2.1.0"]);
  });

  it("여는 순간 기록한다 — 닫을 때 기록하면 새로고침으로 닫은 사용자에게 영원히 뜬다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost("2.1.0", "2.0.0");
    const c = initReleaseNotes(host);

    c.maybeAutoShow();
    expect(host.saved).toEqual(["2.1.0"]);
  });

  it("한 번 뜬 뒤에는 다시 뜨지 않는다", async () => {
    const { initReleaseNotes } = await loadUi();
    let seen: string | null = "2.0.0";
    const base = buildHost("2.1.0", "2.0.0");
    const host = { ...base, loadSeen: () => seen, saveSeen: (v: string) => { seen = v; } };
    const c = initReleaseNotes(host);

    expect(c.maybeAutoShow()).toBe(true);
    c.close();
    expect(c.maybeAutoShow()).toBe(false);
  });

  it("기록을 읽지 못하면 띄우지 않는다 — 모르는 채로 방해하지 않는다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = {
      ...buildHost(),
      loadSeen: () => {
        throw new Error("localStorage 접근 불가");
      },
    };
    const c = initReleaseNotes(host);
    expect(c.maybeAutoShow()).toBe(false);
  });

  it("기록에 실패해도 화면은 뜬다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = {
      ...buildHost("2.1.0", "2.0.0"),
      saveSeen: () => {
        throw new Error("용량 초과");
      },
    };
    const c = initReleaseNotes(host);
    expect(() => c.maybeAutoShow()).not.toThrow();
    expect(c.isOpen()).toBe(true);
  });

  it("보여줄 항목이 없으면 뜨지 않는다", async () => {
    const { initReleaseNotes } = await loadUi();
    const c = initReleaseNotes(buildHost("2.1.0", "2.0.0", []));
    expect(c.maybeAutoShow()).toBe(false);
  });
});

describe("견고함", () => {
  it("초기화 실패해도 앱을 멈추지 않는다", async () => {
    const { initReleaseNotes } = await loadUi();
    const c = initReleaseNotes(null as unknown as Parameters<typeof initReleaseNotes>[0]);
    expect(() => c.open()).not.toThrow();
    expect(c.count()).toBe(0);
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const { initReleaseNotes } = await loadUi();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    initReleaseNotes(buildHost());
    const second = initReleaseNotes(buildHost());
    second.open();
    expect(second.isOpen()).toBe(false);
    warn.mockRestore();
  });

  it("닫으면 편집기로 포커스를 돌려준다", async () => {
    const { initReleaseNotes } = await loadUi();
    const host = buildHost();
    const spy = vi.spyOn(host.returnFocusTo, "focus");
    const c = initReleaseNotes(host);
    c.open();
    c.close();
    expect(spy).toHaveBeenCalled();
  });
});
