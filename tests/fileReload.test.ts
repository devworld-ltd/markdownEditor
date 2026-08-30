import { beforeEach, describe, expect, it, vi } from "vitest";
import { initFileReload, type ReloadHost, type ReloadTabView } from "../src/fileReload";
import type { DiskStamp } from "../src/diskStamp";

/**
 * F-88 파일 변경 감지 새로고침 — `fileReload.ts` 는 주입형 배선 리프라
 * `ReloadHost` 를 평범한 객체로 흉내 내면 권한 3상태 × 더티 2상태 × 판정
 * 4결과 전 분기를 단위로 돌 수 있다(트랩 #15 / 기술 스펙 §12).
 *
 * 목 핸들은 그냥 `{}` 다 — `fileReload.ts` 자신은 `FileSystemFileHandle` 을
 * 직접 만지지 않고 host 로 넘길 뿐이라 여기서는 진짜 핸들이 필요 없다
 * (진짜 핸들 검증은 `installRealHandleMock()` 을 쓰는 E2E 의 몫이다, D-8).
 */

function fakeHandle(): FileSystemFileHandle {
  return {} as FileSystemFileHandle;
}

interface FakeTab extends ReloadTabView {
  content: string;
  diskText: string;
}

interface BuiltHost {
  host: ReloadHost;
  tabs: Map<string, FakeTab>;
  calls: {
    notify: Array<{ message: string; kind?: string }>;
    showBanner: Array<{ tabId: string; fileName: string }>;
    hideBanner: Array<string | undefined>;
  };
  setActive: (id: string) => void;
}

function buildHost(overrides: Partial<ReloadHost> = {}): BuiltHost {
  const tabs = new Map<string, FakeTab>();
  const calls = {
    notify: [] as Array<{ message: string; kind?: string }>,
    showBanner: [] as Array<{ tabId: string; fileName: string }>,
    hideBanner: [] as Array<string | undefined>,
  };
  let activeTabId = "";

  const host: ReloadHost = {
    readStamp: vi.fn(async (handle: FileSystemFileHandle) => {
      const tab = [...tabs.values()].find((t) => t.handle === handle);
      // 기본 기준값(addTab)과 겹치지 않는 고정 mtime — "changed" 1차 판정이
      // 항상 걸리게 해, 실제 결과는 2차 내용 비교(isRealChange)가 가른다.
      return tab ? ({ lastModified: 999999, size: tab.diskText.length } satisfies DiskStamp) : null;
    }),
    readText: vi.fn(async (handle: FileSystemFileHandle) => {
      const tab = [...tabs.values()].find((t) => t.handle === handle);
      if (!tab) throw new Error("not found");
      return tab.diskText;
    }),
    queryPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
    getTabs: () => [...tabs.values()],
    getActiveTabId: () => activeTabId,
    getTabText: (tabId) => tabs.get(tabId)?.content ?? "",
    applyReload: vi.fn((tabId, text, stamp) => {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tab.content = text;
      tab.isDirty = false;
      tab.diskStamp = stamp;
    }),
    setStamp: vi.fn((tabId, stamp) => {
      const tab = tabs.get(tabId);
      if (tab) tab.diskStamp = stamp;
    }),
    setChanged: vi.fn(() => {}),
    notify: vi.fn((message, kind) => calls.notify.push({ message, kind })),
    showBanner: vi.fn((tabId, fileName) => calls.showBanner.push({ tabId, fileName })),
    hideBanner: vi.fn((tabId) => calls.hideBanner.push(tabId)),
    confirmReload: vi.fn(async () => true),
    confirmSaveConflict: vi.fn(async () => "overwrite" as const),
    isModalOpen: vi.fn(() => false),
    ...overrides,
  };

  return {
    host,
    tabs,
    calls,
    setActive: (id: string) => {
      activeTabId = id;
    },
  };
}

function addTab(
  tabs: Map<string, FakeTab>,
  overrides: Partial<FakeTab> & Pick<FakeTab, "id">,
): FakeTab {
  const tab: FakeTab = {
    id: overrides.id,
    fileName: overrides.fileName ?? `${overrides.id}.md`,
    // ??(nullish 병합)는 명시적 null 도 대체해버린다 — "핸들 없음"을 표현하려면
    // "in" 으로 키 존재 여부부터 봐야 한다.
    handle: "handle" in overrides ? overrides.handle! : fakeHandle(),
    isDirty: overrides.isDirty ?? false,
    diskStamp: overrides.diskStamp ?? { lastModified: 1, size: 3 },
    content: overrides.content ?? "old",
    diskText: overrides.diskText ?? "old",
  };
  tabs.set(tab.id, tab);
  return tab;
}

describe("initFileReload — 조용한 경로 (checkAll/checkTab)", () => {
  it("깨끗한 탭은 변경이 있으면 자동 반영하고 알린다 (M-5/AC-2)", async () => {
    const { host, tabs, calls, setActive } = buildHost();
    addTab(tabs, { id: "t1", isDirty: false, content: "old", diskText: "new" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(tabs.get("t1")!.content).toBe("new");
    expect(tabs.get("t1")!.isDirty).toBe(false);
    expect(calls.notify.some((n) => n.message.includes("다시 읽었습니다"))).toBe(true);
    expect(host.setChanged).not.toHaveBeenCalledWith("t1", true);
  });

  it("더티 탭은 본문을 건드리지 않고 배지·배너만 세운다 (M-4/AC-3)", async () => {
    const { host, tabs, calls, setActive } = buildHost();
    addTab(tabs, { id: "t1", isDirty: true, content: "mine", diskText: "theirs" });
    setActive("t1"); // 활성 탭이라 배너까지 뜬다

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(tabs.get("t1")!.content).toBe("mine"); // 본문 불변
    expect(host.setChanged).toHaveBeenCalledWith("t1", true);
    expect(calls.showBanner).toEqual([{ tabId: "t1", fileName: "t1.md" }]);
    expect(host.applyReload).not.toHaveBeenCalled();
  });

  it("비활성 더티 탭은 배지만 — 배너는 뜨지 않는다 (E-9)", async () => {
    const { host, tabs, calls, setActive } = buildHost();
    addTab(tabs, { id: "t1", isDirty: true, content: "mine", diskText: "theirs" });
    setActive("other"); // t1 은 비활성

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.setChanged).toHaveBeenCalledWith("t1", true);
    expect(calls.showBanner).toHaveLength(0);
  });

  it("핸들이 없으면 조용히 종료한다 (M-9)", async () => {
    const { host, tabs, calls } = buildHost();
    addTab(tabs, { id: "t1", handle: null });

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.readStamp).not.toHaveBeenCalled();
    expect(calls.notify).toHaveLength(0);
  });

  it("권한이 granted 가 아니면 조용히 건너뛴다 — 권한 창을 띄우지 않는다 (M-7/AC-9/E-2)", async () => {
    const { host, tabs, calls } = buildHost({
      queryPermission: vi.fn(async () => "prompt" as const),
    });
    addTab(tabs, { id: "t1", diskText: "changed" });

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.requestPermission).not.toHaveBeenCalled();
    expect(host.readStamp).not.toHaveBeenCalled();
    expect(calls.notify).toHaveLength(0);
  });

  it("unsupported 권한은 granted 처럼 관대하게 통과시킨다", async () => {
    const { host, tabs } = buildHost({
      queryPermission: vi.fn(async () => "unsupported" as const),
    });
    addTab(tabs, { id: "t1", isDirty: false, content: "old", diskText: "new" });

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.readStamp).toHaveBeenCalled();
  });

  it("파일이 사라졌으면(readStamp null) 조용히 종료 — 탭 내용 무변경 (M-10/E-1)", async () => {
    const { host, tabs, calls } = buildHost({
      readStamp: vi.fn(async () => null),
    });
    addTab(tabs, { id: "t1", content: "mine" });

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(tabs.get("t1")!.content).toBe("mine");
    expect(calls.notify).toHaveLength(0);
  });

  it("기준값이 같으면(same) 아무 표시도 하지 않는다 (AC-12 1차 방어)", async () => {
    const { host, tabs, calls } = buildHost({
      readStamp: vi.fn(async () => ({ lastModified: 1, size: 3 })), // addTab 기본 stamp 와 동일
    });
    addTab(tabs, { id: "t1", diskStamp: { lastModified: 1, size: 3 } });

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.readText).not.toHaveBeenCalled();
    expect(calls.notify).toHaveLength(0);
  });

  it("S-3: mtime 만 바뀌고 내용이 같으면 기준값만 갱신하고 표시하지 않는다 (AC-12)", async () => {
    const { host, tabs, calls } = buildHost();
    addTab(tabs, { id: "t1", content: "same", diskText: "same" });

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.setStamp).toHaveBeenCalled();
    expect(host.setChanged).not.toHaveBeenCalledWith("t1", true);
    expect(calls.notify).toHaveLength(0);
    expect(calls.showBanner).toHaveLength(0);
  });

  it("checkAll 은 핸들 있는 탭만, 직렬로 순회한다 (P-4)", async () => {
    const order: string[] = [];
    const { host, tabs } = buildHost({
      readStamp: vi.fn(async (handle) => {
        order.push("readStamp");
        const tab = [...tabs.values()].find((t) => t.handle === handle);
        return tab ? { lastModified: 1, size: tab.diskText.length } : null;
      }),
    });
    addTab(tabs, { id: "t1", content: "old", diskText: "new" });
    addTab(tabs, { id: "t2", handle: null }); // 핸들 없음 — 건너뛴다
    addTab(tabs, { id: "t3", content: "old3", diskText: "new3" });

    const controller = initFileReload(host);
    await controller.checkAll();

    expect(order).toEqual(["readStamp", "readStamp"]); // t2 는 제외
  });

  it("모달이 열려 있으면 더티 탭 배너를 미룬다 (E-11/트랩 #57)", async () => {
    const { host, tabs, calls, setActive } = buildHost({
      isModalOpen: vi.fn(() => true),
    });
    addTab(tabs, { id: "t1", isDirty: true, content: "mine", diskText: "theirs" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.checkTab("t1");

    expect(host.setChanged).toHaveBeenCalledWith("t1", true); // 배지는 세운다
    expect(calls.showBanner).toHaveLength(0); // 배너는 미룬다
  });
});

describe("initFileReload — reloadActive (수동, 제스처 안)", () => {
  it("핸들이 없으면 이유를 안내한다 (M-9/AC-7)", async () => {
    const { host, tabs, calls, setActive } = buildHost();
    addTab(tabs, { id: "t1", handle: null });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(calls.notify.some((n) => n.kind === "error")).toBe(true);
  });

  it("조용한 경로에서 권한이 없으면 요청하고, 거부되면 안내한다 (M-8/AC-10/E-3)", async () => {
    const { host, tabs, calls, setActive } = buildHost({
      queryPermission: vi.fn(async () => "prompt" as const),
      requestPermission: vi.fn(async () => "denied" as const),
    });
    addTab(tabs, { id: "t1" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(host.requestPermission).toHaveBeenCalled();
    expect(calls.notify.some((n) => n.message.includes("권한이 없습니다"))).toBe(true);
  });

  it("권한 요청이 허용되면 재읽기가 성공한다 (AC-10)", async () => {
    const { host, tabs, setActive } = buildHost({
      queryPermission: vi.fn(async () => "prompt" as const),
      requestPermission: vi.fn(async () => "granted" as const),
    });
    addTab(tabs, { id: "t1", content: "old", diskText: "new" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(tabs.get("t1")!.content).toBe("new");
  });

  it("변경이 없으면 최신 상태 알림만 준다", async () => {
    const { host, tabs, calls, setActive } = buildHost();
    addTab(tabs, { id: "t1", content: "same", diskText: "same" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(calls.notify.some((n) => n.message === "최신 상태입니다.")).toBe(true);
  });

  it("파일을 찾을 수 없으면 탭 내용을 지키고 오류만 알린다 (E-1/AC-8)", async () => {
    const { host, tabs, calls, setActive } = buildHost({
      readStamp: vi.fn(async () => null),
    });
    addTab(tabs, { id: "t1", content: "mine" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(tabs.get("t1")!.content).toBe("mine");
    expect(calls.notify.some((n) => n.message.includes("찾을 수 없습니다"))).toBe(true);
  });

  it("더티 탭은 확인 대화상자를 거친다 — 취소하면 본문이 그대로다 (AC-4/AC-5)", async () => {
    const { host, tabs, setActive } = buildHost({
      confirmReload: vi.fn(async () => false),
    });
    addTab(tabs, { id: "t1", isDirty: true, content: "mine", diskText: "theirs" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(host.confirmReload).toHaveBeenCalled();
    expect(tabs.get("t1")!.content).toBe("mine");
  });

  it("더티 탭에서 확인하면 본문이 디스크 내용으로 바뀐다 (AC-4)", async () => {
    const { host, tabs, setActive } = buildHost({
      confirmReload: vi.fn(async () => true),
    });
    addTab(tabs, { id: "t1", isDirty: true, content: "mine", diskText: "theirs" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(tabs.get("t1")!.content).toBe("theirs");
    expect(tabs.get("t1")!.isDirty).toBe(false);
  });

  it("깨끗한 탭은 확인 없이 즉시 반영한다 (AC-2 는 조용한 경로지만 수동도 확인을 요구하지 않는다)", async () => {
    const { host, tabs, setActive } = buildHost();
    addTab(tabs, { id: "t1", isDirty: false, content: "old", diskText: "new" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.reloadActive();

    expect(host.confirmReload).not.toHaveBeenCalled();
    expect(tabs.get("t1")!.content).toBe("new");
  });
});

describe("initFileReload — keepMine (I-9/I-10)", () => {
  it("배너를 닫지만 배지(diskChanged)는 setChanged 로 해제하지 않는다", async () => {
    const { host, tabs, calls, setActive } = buildHost();
    addTab(tabs, { id: "t1", isDirty: true, content: "mine", diskText: "theirs" });
    setActive("t1");

    const controller = initFileReload(host);
    await controller.checkTab("t1"); // 배너를 띄운다
    calls.hideBanner.length = 0;
    (host.setChanged as ReturnType<typeof vi.fn>).mockClear();

    controller.keepMine();

    expect(calls.hideBanner).toEqual(["t1"]);
    expect(host.setChanged).not.toHaveBeenCalled(); // ⚠ 배지는 남는다
  });
});

describe("initFileReload — confirmBeforeSave (S-1/AC-11)", () => {
  it("변경이 없으면 저장을 허용한다", async () => {
    const { host, tabs } = buildHost();
    addTab(tabs, { id: "t1", content: "same", diskText: "same" });

    const controller = initFileReload(host);
    expect(await controller.confirmBeforeSave("t1")).toBe(true);
    expect(host.confirmSaveConflict).not.toHaveBeenCalled();
  });

  it("변경이 있으면 충돌 대화상자를 띄운다 — 취소하면 저장을 막는다", async () => {
    const { host, tabs } = buildHost({
      confirmSaveConflict: vi.fn(async () => "cancel" as const),
    });
    addTab(tabs, { id: "t1", content: "mine", diskText: "theirs" });

    const controller = initFileReload(host);
    expect(await controller.confirmBeforeSave("t1")).toBe(false);
  });

  it("덮어쓰기를 고르면 저장을 진행한다", async () => {
    const { host, tabs } = buildHost({
      confirmSaveConflict: vi.fn(async () => "overwrite" as const),
    });
    addTab(tabs, { id: "t1", content: "mine", diskText: "theirs" });

    const controller = initFileReload(host);
    expect(await controller.confirmBeforeSave("t1")).toBe(true);
  });

  it("다시 읽기를 고르면 저장을 막고 대신 재읽기를 적용한다", async () => {
    const { host, tabs } = buildHost({
      confirmSaveConflict: vi.fn(async () => "reload" as const),
    });
    addTab(tabs, { id: "t1", isDirty: false, content: "mine", diskText: "theirs" });

    const controller = initFileReload(host);
    const proceed = await controller.confirmBeforeSave("t1");

    expect(proceed).toBe(false);
    expect(tabs.get("t1")!.content).toBe("theirs");
  });

  it("핸들이 없으면 저장을 막지 않는다", async () => {
    const { host, tabs } = buildHost();
    addTab(tabs, { id: "t1", handle: null });

    const controller = initFileReload(host);
    expect(await controller.confirmBeforeSave("t1")).toBe(true);
  });
});

describe("initFileReload — canReloadActive", () => {
  it("활성 탭에 핸들이 있으면 true", () => {
    const { host, tabs, setActive } = buildHost();
    addTab(tabs, { id: "t1" });
    setActive("t1");
    expect(initFileReload(host).canReloadActive()).toBe(true);
  });

  it("활성 탭에 핸들이 없으면 false", () => {
    const { host, tabs, setActive } = buildHost();
    addTab(tabs, { id: "t1", handle: null });
    setActive("t1");
    expect(initFileReload(host).canReloadActive()).toBe(false);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
