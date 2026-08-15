import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentEntry } from "../src/recentFiles";

/**
 * F-36 최근 파일 UI (이슈 #64).
 *
 * 검증의 핵심은 **핸들 생존 여부에 따라 다르게 동작하는가** 다. 이걸 구분하지
 * 않으면 사용자는 목록을 눌렀는데 파일 선택 창이 뜨는 것을 버그로 받아들인다.
 */

async function loadUi(): Promise<typeof import("../src/recentFilesUi")> {
  vi.resetModules();
  return import("../src/recentFilesUi");
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

const NOW = Date.UTC(2026, 7, 14);

function buildHost(stored: RecentEntry[] = [], liveNames: string[] = []) {
  const dialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(dialogEl);
  const listEl = document.createElement("ul");
  const emptyEl = document.createElement("p");
  const closeEl = document.createElement("button");
  const returnFocusTo = document.createElement("textarea");
  document.body.append(dialogEl, listEl, emptyEl, closeEl, returnFocusTo);

  const live = new Set(liveNames);
  const saved: RecentEntry[][] = [];
  const openedLive: string[] = [];
  const pickerCalls: number[] = [];
  const notices: string[] = [];

  return {
    dialogEl, listEl, emptyEl, closeEl, returnFocusTo,
    saved, openedLive, pickerCalls, notices, live,
    load: () => [...stored],
    save: (list: RecentEntry[]) => saved.push(list),
    isLive: (name: string) => live.has(name),
    openLive: (name: string) => openedLive.push(name),
    openPicker: () => pickerCalls.push(1),
    notify: (m: string) => notices.push(m),
    now: () => NOW,
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("recentFilesUi — 목록 표시", () => {
  it("저장된 항목을 그린다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([
      { name: "a.md", at: NOW - 60_000 },
      { name: "b.md", at: NOW - 3_600_000 },
    ], ["a.md", "b.md"]);
    initRecentFiles(host);

    const names = [...host.listEl.querySelectorAll(".recent-name")].map((el) => el.textContent);
    expect(names).toEqual(["a.md", "b.md"]);
    expect(host.emptyEl.hidden).toBe(true);
  });

  it("비어 있으면 안내를 보여준다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([]);
    initRecentFiles(host);

    expect(host.listEl.children).toHaveLength(0);
    expect(host.emptyEl.hidden).toBe(false);
  });

  it("핸들이 살아 있으면 경과 시각을, 끊겼으면 다시 선택 필요를 보여준다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([
      { name: "live.md", at: NOW - 5 * 60_000 },
      { name: "stale.md", at: NOW - 5 * 60_000 },
    ], ["live.md"]);
    initRecentFiles(host);

    const metas = [...host.listEl.querySelectorAll(".recent-meta")].map((el) => el.textContent);
    expect(metas).toEqual(["5분 전", "다시 선택 필요"]);
  });

  it("상태를 색이 아니라 접근 가능한 이름으로도 알린다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "stale.md", at: NOW }], []);
    initRecentFiles(host);

    const label = host.listEl.querySelector(".recent-open")!.getAttribute("aria-label");
    expect(label).toContain("다시 선택");
  });
});

describe("recentFilesUi — 열기", () => {
  it("살아 있는 항목은 바로 연다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "a.md", at: NOW }], ["a.md"]);
    const controller = initRecentFiles(host);
    controller.open();

    (host.listEl.querySelector(".recent-open") as HTMLElement).click();

    expect(host.openedLive).toEqual(["a.md"]);
    expect(host.pickerCalls).toHaveLength(0);
    expect(controller.isOpen()).toBe(false); // 열면서 닫힌다
  });

  it("끊긴 항목은 이유를 알리고 파일 선택 창을 연다", async () => {
    // 아무 설명 없이 선택 창이 뜨면 사용자는 버그로 받아들인다.
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "stale.md", at: NOW }], []);
    const controller = initRecentFiles(host);
    controller.open();

    (host.listEl.querySelector(".recent-open") as HTMLElement).click();

    expect(host.openedLive).toHaveLength(0);
    expect(host.pickerCalls).toHaveLength(1);
    expect(host.notices[0]).toContain("stale.md");
    // #125 이후 안내가 바뀌었다. "권한이 유지되지 않는다" 는 더 이상 사실이 아니다 —
    // 보관된 핸들이 있으면 권한을 되살릴 수 있고, 여기로 오는 것은 **그것마저 없을 때**다.
    expect(host.notices[0]).toContain("파일 위치를 알 수 없습니다");
  });

  it("열 때마다 다시 그린다 — 핸들 생존 여부가 그새 바뀔 수 있다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "a.md", at: NOW }], []);
    const controller = initRecentFiles(host);

    expect(host.listEl.querySelector(".recent-row")!.getAttribute("data-live")).toBe("false");

    host.live.add("a.md");
    controller.open();
    expect(host.listEl.querySelector(".recent-row")!.getAttribute("data-live")).toBe("true");
  });
});

describe("recentFilesUi — 기록과 삭제", () => {
  it("record() 가 맨 앞에 넣고 저장한다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "a.md", at: NOW - 1000 }]);
    const controller = initRecentFiles(host);

    controller.record("b.md");
    expect(controller.list().map((e) => e.name)).toEqual(["b.md", "a.md"]);
    expect(host.saved).toHaveLength(1);
  });

  it("같은 이름을 다시 기록하면 중복 없이 앞으로 옮긴다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([
      { name: "a.md", at: NOW - 2000 },
      { name: "b.md", at: NOW - 1000 },
    ]);
    const controller = initRecentFiles(host);

    controller.record("a.md");
    expect(controller.list().map((e) => e.name)).toEqual(["a.md", "b.md"]);
  });

  it("빈 이름은 기록하지 않는다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([]);
    const controller = initRecentFiles(host);

    controller.record("   ");
    expect(controller.list()).toHaveLength(0);
    expect(host.saved).toHaveLength(0);
  });

  it("항목을 지우면 목록과 저장본에서 사라진다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "a.md", at: NOW }, { name: "b.md", at: NOW }], ["a.md"]);
    const controller = initRecentFiles(host);

    (host.listEl.querySelector(".recent-remove") as HTMLElement).click();

    expect(controller.list().map((e) => e.name)).toEqual(["b.md"]);
    expect(host.saved.at(-1)!.map((e) => e.name)).toEqual(["b.md"]);
  });

  it("저장이 던져도 목록 사용은 계속된다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([]);
    const controller = initRecentFiles({
      ...host,
      save: () => {
        throw new Error("quota");
      },
    });

    expect(() => controller.record("a.md")).not.toThrow();
    expect(controller.list().map((e) => e.name)).toEqual(["a.md"]);
  });
});

describe("recentFilesUi — 초기화", () => {
  it("재호출은 무시된다", async () => {
    const { initRecentFiles } = await loadUi();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initRecentFiles(buildHost());
    initRecentFiles(buildHost());
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[recentFiles] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("잘못된 host 로도 던지지 않는다", async () => {
    const { initRecentFiles } = await loadUi();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initRecentFiles({
      dialogEl: null as unknown as HTMLDialogElement,
      listEl: null as unknown as HTMLElement,
      emptyEl: null as unknown as HTMLElement,
      closeEl: null as unknown as HTMLElement,
      load: () => [],
      save: () => {},
      isLive: () => false,
      openLive: () => {},
      openPicker: () => {},
    });

    expect(() => controller.record("a.md")).not.toThrow();
    expect(controller.list()).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[recentFiles] 초기화 실패:"]);
    warn.mockRestore();
  });
});

/**
 * #125 — 보관된 핸들 경로.
 *
 * 여기서 확인하는 것은 **세 상태가 서로 다른 동작으로 이어지는가** 다.
 * `stored` 를 `live` 처럼 다루면 권한 창이 뜨는 순간을 안내 없이 맞게 되고,
 * `stale` 처럼 다루면 바로 열 수 있는 파일에 대고 파일 선택 창을 띄운다.
 */
function buildStoredHost(
  stored: RecentEntry[],
  liveNames: string[],
  storedNames: string[],
  openStoredResult: boolean | (() => Promise<boolean>) = true,
) {
  const base = buildHost(stored, liveNames);
  const openStoredCalls: string[] = [];
  const forgotten: string[] = [];
  return {
    ...base,
    openStoredCalls,
    forgotten,
    openStored: async (name: string) => {
      openStoredCalls.push(name);
      return typeof openStoredResult === "function"
        ? await openStoredResult()
        : openStoredResult;
    },
    listStored: async () => [...storedNames],
    forgetStored: (name: string) => forgotten.push(name),
  };
}

/** 대화상자를 열고 보관 목록(비동기)이 반영될 때까지 기다린다. */
async function openAndSettle(controller: { open: () => void }): Promise<void> {
  controller.open();
  await Promise.resolve();
  await Promise.resolve();
}

describe("recentFilesUi — 보관된 핸들 (#125)", () => {
  it("보관된 항목은 `stale` 이 아니라 `stored` 로 표시된다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildStoredHost([{ name: "a.md", at: NOW }], [], ["a.md"]);

    await openAndSettle(initRecentFiles(host));

    const row = host.listEl.querySelector<HTMLElement>(".recent-row")!;
    expect(row.dataset.state).toBe("stored");
    expect(row.dataset.live).toBe("true");
    expect(row.querySelector(".recent-meta")?.textContent).toContain("접근 허용 필요");
  });

  it("보관된 항목을 누르면 파일 선택 창이 아니라 보관 경로로 연다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildStoredHost([{ name: "a.md", at: NOW }], [], ["a.md"]);

    await openAndSettle(initRecentFiles(host));
    host.listEl.querySelector<HTMLButtonElement>(".recent-open")!.click();
    await Promise.resolve();

    expect(host.openStoredCalls).toEqual(["a.md"]);
    expect(host.pickerCalls).toHaveLength(0);
  });

  it("보관 경로가 실패하면 안내하고 파일 선택 창으로 되돌아간다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildStoredHost([{ name: "a.md", at: NOW }], [], ["a.md"], false);

    await openAndSettle(initRecentFiles(host));
    host.listEl.querySelector<HTMLButtonElement>(".recent-open")!.click();
    await vi.waitFor(() => expect(host.pickerCalls).toHaveLength(1));

    expect(host.notices.join(" ")).toContain("a.md");
  });

  it("이번 세션에 살아 있으면 보관 경로를 거치지 않는다 — 권한을 두 번 물을 이유가 없다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildStoredHost([{ name: "a.md", at: NOW }], ["a.md"], ["a.md"]);

    await openAndSettle(initRecentFiles(host));
    const row = host.listEl.querySelector<HTMLElement>(".recent-row")!;
    expect(row.dataset.state).toBe("live");

    row.querySelector<HTMLButtonElement>(".recent-open")!.click();
    expect(host.openedLive).toEqual(["a.md"]);
    expect(host.openStoredCalls).toHaveLength(0);
  });

  it("보관도 세션도 없으면 예전처럼 파일 선택 창을 연다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildStoredHost([{ name: "a.md", at: NOW }], [], []);

    await openAndSettle(initRecentFiles(host));
    const row = host.listEl.querySelector<HTMLElement>(".recent-row")!;
    expect(row.dataset.state).toBe("stale");

    row.querySelector<HTMLButtonElement>(".recent-open")!.click();
    await Promise.resolve();
    expect(host.pickerCalls).toHaveLength(1);
    expect(host.openStoredCalls).toHaveLength(0);
  });

  it("목록에서 지우면 보관된 핸들도 버린다 — 목록에 없는 핸들은 쓸 데가 없다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildStoredHost([{ name: "a.md", at: NOW }], [], ["a.md"]);

    await openAndSettle(initRecentFiles(host));
    host.listEl.querySelector<HTMLButtonElement>(".recent-remove")!.click();

    expect(host.forgotten).toEqual(["a.md"]);
  });

  it("보관 경로를 주입하지 않으면 예전 동작 그대로다 (구형 브라우저)", async () => {
    const { initRecentFiles } = await loadUi();
    const host = buildHost([{ name: "a.md", at: NOW }], []);

    await openAndSettle(initRecentFiles(host));
    const row = host.listEl.querySelector<HTMLElement>(".recent-row")!;
    expect(row.dataset.state).toBe("stale");

    row.querySelector<HTMLButtonElement>(".recent-open")!.click();
    expect(host.pickerCalls).toHaveLength(1);
  });

  it("보관 목록 조회가 실패해도 목록은 쓸 수 있다", async () => {
    const { initRecentFiles } = await loadUi();
    const host = {
      ...buildHost([{ name: "a.md", at: NOW }], []),
      listStored: async () => {
        throw new Error("IndexedDB 고장");
      },
    };

    await openAndSettle(initRecentFiles(host));
    expect(host.listEl.querySelectorAll(".recent-row")).toHaveLength(1);
  });
});
