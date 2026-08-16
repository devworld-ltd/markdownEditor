import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LaunchFilesHost, LaunchParamsLike, LaunchQueueLike } from "../src/launchFiles";

/**
 * #135 PWA 파일 핸들러.
 *
 * Finder 목록에 실제로 뜨는지는 여기서 볼 수 없다(Launch Services 는 OS 것이다).
 * 여기서 확인하는 것은 **핸들이 들어왔을 때 무엇을 하는가** 다.
 */

async function load(): Promise<typeof import("../src/launchFiles")> {
  vi.resetModules();
  return import("../src/launchFiles");
}

/** 소비자를 붙잡아 두고 나중에 발화시키는 가짜 큐. */
function fakeQueue() {
  let consumer: ((p: LaunchParamsLike) => void) | null = null;
  const queue: LaunchQueueLike = {
    setConsumer: vi.fn((c) => {
      consumer = c;
    }),
  };
  return {
    queue,
    fire: (files: unknown[]) => consumer?.({ files: files as FileSystemFileHandle[] }),
    hasConsumer: () => consumer !== null,
  };
}

function handle(name: string): FileSystemFileHandle {
  return { kind: "file", name } as unknown as FileSystemFileHandle;
}

function buildHost(overrides: Partial<LaunchFilesHost> = {}) {
  const opened: string[] = [];
  const notices: Array<{ message: string; kind?: string }> = [];
  const q = fakeQueue();
  const host: LaunchFilesHost = {
    queue: q.queue,
    openHandle: vi.fn(async (h: FileSystemFileHandle) => {
      opened.push(h.name);
    }),
    notify: (message, kind) => notices.push({ message, kind }),
    ...overrides,
  };
  return { host, q, opened, notices };
}

beforeEach(() => vi.resetModules());

describe("등록", () => {
  it("소비자를 등록한다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q } = buildHost();

    expect(initLaunchFiles(host).isListening()).toBe(true);
    expect(q.hasConsumer()).toBe(true);
  });

  it("launchQueue 가 없으면 아무 일도 하지 않는다 (Safari·Firefox)", async () => {
    const { initLaunchFiles } = await load();
    const { host } = buildHost({ queue: null });

    expect(initLaunchFiles(host).isListening()).toBe(false);
  });

  it("setConsumer 가 없는 이상한 객체에도 던지지 않는다", async () => {
    const { initLaunchFiles } = await load();
    const { host } = buildHost({ queue: {} as unknown as LaunchQueueLike });

    expect(() => initLaunchFiles(host)).not.toThrow();
    expect(initLaunchFiles(host).isListening()).toBe(false);
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const { initLaunchFiles } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = buildHost();
    initLaunchFiles(a.host);
    const b = buildHost();
    expect(initLaunchFiles(b.host).isListening()).toBe(false);
    expect(b.q.hasConsumer()).toBe(false);
    warn.mockRestore();
  });
});

describe("파일 열기", () => {
  it("핸들을 그대로 넘긴다 — 파일을 직접 읽지 않는다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q } = buildHost();
    initLaunchFiles(host);

    const h = handle("a.md");
    q.fire([h]);
    await vi.waitFor(() => expect(host.openHandle).toHaveBeenCalledWith(h));
  });

  it("여러 개면 전부 연다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q, opened } = buildHost();
    initLaunchFiles(host);

    q.fire([handle("a.md"), handle("b.md"), handle("c.md")]);
    await vi.waitFor(() => expect(opened).toEqual(["a.md", "b.md", "c.md"]));
  });

  it("순서를 지켜 하나씩 연다 — 동시에 열면 탭 순서와 중복 판정이 어긋난다", async () => {
    const { initLaunchFiles } = await load();
    const inFlight: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const { host, q } = buildHost({
      openHandle: async (h: FileSystemFileHandle) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        inFlight.push(h.name);
        concurrent -= 1;
      },
    });
    initLaunchFiles(host);

    q.fire([handle("a.md"), handle("b.md")]);
    await vi.waitFor(() => expect(inFlight).toHaveLength(2));
    expect(maxConcurrent).toBe(1);
    expect(inFlight).toEqual(["a.md", "b.md"]);
  });

  it("파일이 없으면 아무 일도 하지 않는다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q } = buildHost();
    initLaunchFiles(host);

    q.fire([]);
    await new Promise((r) => setTimeout(r, 5));
    expect(host.openHandle).not.toHaveBeenCalled();
  });

  it("files 가 아예 없어도 던지지 않는다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q } = buildHost();
    initLaunchFiles(host);

    expect(() => q.fire(undefined as unknown as unknown[])).not.toThrow();
  });
});

describe("실패", () => {
  it("하나가 실패해도 나머지는 연다", async () => {
    const { initLaunchFiles } = await load();
    const opened: string[] = [];
    const { host, q, notices } = buildHost({
      openHandle: async (h: FileSystemFileHandle) => {
        if (h.name === "bad.md") throw new Error("권한 없음");
        opened.push(h.name);
      },
    });
    initLaunchFiles(host);

    q.fire([handle("bad.md"), handle("good.md")]);
    await vi.waitFor(() => expect(opened).toEqual(["good.md"]));
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0].kind).toBe("error");
    expect(notices[0].message).toContain("1개");
  });

  it("전부 실패하면 개수를 세지 않고 한 문장으로 알린다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q, notices } = buildHost({
      openHandle: async () => {
        throw new Error("실패");
      },
    });
    initLaunchFiles(host);

    q.fire([handle("a.md")]);
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0].message).toBe("파일을 열지 못했습니다.");
  });

  it("성공하면 알리지 않는다 — 열린 것은 화면에 보인다", async () => {
    const { initLaunchFiles } = await load();
    const { host, q, notices, opened } = buildHost();
    initLaunchFiles(host);

    q.fire([handle("a.md")]);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(notices).toHaveLength(0);
  });
});
