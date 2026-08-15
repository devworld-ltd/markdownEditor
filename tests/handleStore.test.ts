import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetHandle,
  isHandleStoreSupported,
  recallHandle,
  rememberHandle,
  setHandleStoreHost,
  storedNames,
} from "../src/handleStore";

/**
 * IndexedDB 자체는 주입 경계 밖이다 — jsdom 에 없고, 있어도 검증할 값어치가
 * 있는 것은 저장이 아니라 **권한 판단**이다 (이슈 #125).
 */
function fakeStore(initial: Record<string, FileSystemFileHandle> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    host: {
      isSupported: () => true,
      read: vi.fn(async (name: string) => map.get(name) ?? null),
      write: vi.fn(async (name: string, handle: FileSystemFileHandle) => {
        map.set(name, handle);
      }),
      erase: vi.fn(async (name: string) => {
        map.delete(name);
      }),
      names: vi.fn(async () => [...map.keys()]),
    },
  };
}

/** 권한 API 를 가진 가짜 핸들. 실제 핸들은 jsdom 에 없다. */
function fakeHandle(
  name: string,
  perms: { query?: PermissionState; request?: PermissionState } = {},
): FileSystemFileHandle {
  const handle = { kind: "file", name } as unknown as Record<string, unknown>;
  if (perms.query !== undefined) {
    handle.queryPermission = vi.fn(async () => perms.query);
  }
  if (perms.request !== undefined) {
    handle.requestPermission = vi.fn(async () => perms.request);
  }
  return handle as unknown as FileSystemFileHandle;
}

afterEach(() => setHandleStoreHost());

describe("보관", () => {
  it("핸들을 이름으로 넣고 뺀다", async () => {
    const { host, map } = fakeStore();
    setHandleStoreHost(host);

    await rememberHandle("note.md", fakeHandle("note.md"));
    expect(map.has("note.md")).toBe(true);
    expect(await storedNames()).toEqual(["note.md"]);

    await forgetHandle("note.md");
    expect(map.has("note.md")).toBe(false);
  });

  it("이름 앞뒤 공백을 다듬어 넣는다 — 목록의 이름과 어긋나면 못 찾는다", async () => {
    const { host, map } = fakeStore();
    setHandleStoreHost(host);

    await rememberHandle("  note.md  ", fakeHandle("note.md"));
    expect([...map.keys()]).toEqual(["note.md"]);
  });

  it("빈 이름은 넣지 않는다", async () => {
    const { host } = fakeStore();
    setHandleStoreHost(host);

    await rememberHandle("   ", fakeHandle("x"));
    expect(host.write).not.toHaveBeenCalled();
  });

  it("보관에 실패해도 예외를 올리지 않는다 — 파일 열기가 실패하면 훨씬 나쁘다", async () => {
    const { host } = fakeStore();
    host.write.mockRejectedValue(new Error("QuotaExceeded"));
    setHandleStoreHost(host);

    await expect(rememberHandle("note.md", fakeHandle("note.md"))).resolves.toBeUndefined();
  });

  it("IndexedDB 를 못 쓰면 아무것도 하지 않는다 (사생활 보호 모드)", async () => {
    const { host } = fakeStore();
    setHandleStoreHost({ ...host, isSupported: () => false });

    expect(isHandleStoreSupported()).toBe(false);
    await rememberHandle("note.md", fakeHandle("note.md"));
    expect(host.write).not.toHaveBeenCalled();
    expect(await storedNames()).toEqual([]);
    expect(await recallHandle("note.md")).toEqual({ status: "missing" });
  });

  it("목록을 못 읽어도 빈 목록을 준다", async () => {
    const { host } = fakeStore();
    host.names.mockRejectedValue(new Error("boom"));
    setHandleStoreHost(host);

    expect(await storedNames()).toEqual([]);
  });
});

describe("되찾기 — 권한", () => {
  it("권한이 이미 있으면 묻지 않는다 — 매번 물으면 목록을 안 쓰게 된다", async () => {
    const handle = fakeHandle("note.md", { query: "granted", request: "denied" });
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    expect(await recallHandle("note.md")).toEqual({ status: "ok", handle });
    expect(
      (handle as unknown as { requestPermission: ReturnType<typeof vi.fn> })
        .requestPermission,
    ).not.toHaveBeenCalled();
  });

  it("권한이 없으면 요청하고, 승인되면 핸들을 준다", async () => {
    const handle = fakeHandle("note.md", { query: "prompt", request: "granted" });
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    expect(await recallHandle("note.md")).toEqual({ status: "ok", handle });
  });

  it("거부하면 denied — 호출부가 파일 선택 창으로 되돌린다", async () => {
    const handle = fakeHandle("note.md", { query: "prompt", request: "denied" });
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    expect(await recallHandle("note.md")).toEqual({ status: "denied" });
  });

  it("`readwrite` 로 묻는다 — 읽기 권한만 받으면 다음 저장에서 다시 막힌다", async () => {
    const handle = fakeHandle("note.md", { query: "prompt", request: "granted" });
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    await recallHandle("note.md");
    const query = (handle as unknown as { queryPermission: ReturnType<typeof vi.fn> })
      .queryPermission;
    expect(query).toHaveBeenCalledWith({ mode: "readwrite" });
  });

  it("`queryPermission` 이 없는 구현이면 곧바로 요청한다", async () => {
    const handle = fakeHandle("note.md", { request: "granted" });
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    expect(await recallHandle("note.md")).toEqual({ status: "ok", handle });
  });

  it("권한 개념이 없는 구현이면 통과시킨다 — 못 읽으면 여는 쪽에서 드러난다", async () => {
    const handle = fakeHandle("note.md");
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    expect(await recallHandle("note.md")).toEqual({ status: "ok", handle });
  });

  it("권한 API 가 예외를 던져도 열어 보게 둔다", async () => {
    const handle = fakeHandle("note.md", { query: "prompt" });
    (handle as unknown as { queryPermission: ReturnType<typeof vi.fn> }).queryPermission =
      vi.fn(async () => {
        throw new Error("권한 API 고장");
      });
    setHandleStoreHost(fakeStore({ "note.md": handle }).host);

    expect(await recallHandle("note.md")).toEqual({ status: "ok", handle });
  });
});

describe("되찾기 — 없음", () => {
  it("보관된 적이 없으면 missing", async () => {
    setHandleStoreHost(fakeStore().host);
    expect(await recallHandle("note.md")).toEqual({ status: "missing" });
  });

  it("읽기가 실패해도 missing 으로 떨어진다", async () => {
    const { host } = fakeStore();
    host.read.mockRejectedValue(new Error("boom"));
    setHandleStoreHost(host);

    expect(await recallHandle("note.md")).toEqual({ status: "missing" });
  });
});
