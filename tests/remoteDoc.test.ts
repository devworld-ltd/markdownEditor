import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteDocHost } from "../src/remoteDoc";
import { MAX_REMOTE_BYTES } from "../src/openParams";

/**
 * F-90 원격 문서 가져오기 — 가짜 fetch 주입, DOM 없음(이슈 #195).
 *
 * CORS 거부 갈래는 `page.route()` 로 결정론적 재현이 불가능해 E2E 에서
 * `tests/e2e/openUrl.spec.ts` 가 skip 으로 내렸다 — 이 파일이 그 갈래를 대신
 * 결정적으로 고정한다(기술 스펙 §10-2).
 */

async function load(): Promise<typeof import("../src/remoteDoc")> {
  vi.resetModules();
  return import("../src/remoteDoc");
}

function textResponse(
  body: string,
  init: { status?: number; contentType?: string | null; contentLength?: string | null } = {},
): Response {
  const headers = new Headers();
  if (init.contentType !== null) headers.set("content-type", init.contentType ?? "text/markdown");
  if (init.contentLength) headers.set("content-length", init.contentLength);
  return new Response(body, { status: init.status ?? 200, headers });
}

/** 청크로 스트리밍하는 응답 — Content-Length 헤더 없이 본문 누적 검사를 태운다. */
function streamedResponse(totalBytes: number, chunkSize = 100_000): Response {
  const headers = new Headers({ "content-type": "text/markdown" });
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(120)); // 'x'
      sent += size;
    },
  });
  return new Response(stream, { status: 200, headers });
}

function buildHost(overrides: Partial<RemoteDocHost> = {}): RemoteDocHost {
  return {
    fetch: vi.fn(async () => textResponse("# 안녕")),
    isOnline: () => true,
    timeoutMs: 200,
    probeTimeoutMs: 200,
    ...overrides,
  };
}

beforeEach(() => vi.resetModules());

describe("성공", () => {
  it("본문을 그대로 돌려주고 탐침 없이 1회만 호출한다", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => textResponse("# 안녕"));
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: true, content: "# 안녕", contentType: "text/markdown" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("요청 옵션이 계약대로다 — accept 헤더가 안전목록을 벗어나지 않는다", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => textResponse("ok"));
    const host = buildHost({ fetch: fetchFn });

    await fetchRemoteDocument(host, "https://raw.test/a.md");

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.mode).toBe("cors");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("follow");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const accept = (init.headers as Record<string, string>).accept;
    expect(accept).toBeTruthy();
    // CORS 안전목록을 벗어나는 바이트가 없어야 preflight 가 발생하지 않는다.
    expect(/["():<>?@[\]{}\x7f]/.test(accept)).toBe(false);
  });

  it("UTF-8 BOM 이 결과에 남지 않는다", async () => {
    const { fetchRemoteDocument } = await load();
    const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("# 안녕")]);
    const host = buildHost({
      fetch: vi.fn(async () => new Response(bomBytes, { status: 200, headers: { "content-type": "text/markdown" } })),
    });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.charCodeAt(0)).not.toBe(0xfeff);
      expect(result.content).toBe("# 안녕");
    }
  });
});

describe("오류 4분류", () => {
  it("HTTP 오류 — 탐침을 돌지 않는다", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => textResponse("not found", { status: 404 }));
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "http", status: 404 } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("CORS 거부 — 탐침이 opaque 를 주면 cors, fetch 2회", async () => {
    const { fetchRemoteDocument } = await load();
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new TypeError("Failed to fetch");
      return { type: "opaque" } as Response;
    });
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "cors" } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("네트워크 실패 — 탐침도 거부되면 network, fetch 2회", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "network" } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("오프라인 — 탐침을 건너뛴다, fetch 1회", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const host = buildHost({ fetch: fetchFn, isOnline: () => false });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "offline" } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("탐침 불가 — 합본(ambiguous) 로 저하된다(S-1)", async () => {
    const { fetchRemoteDocument } = await load();
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new TypeError("Failed to fetch");
      return { type: "basic" } as Response;
    });
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "ambiguous" } });
  });

  it("타임아웃 — network 로 오분류되지 않는다(§4-3 순서 불변식)", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("timeout", "AbortError"));
          });
        }),
    );
    const host = buildHost({ fetch: fetchFn as unknown as typeof fetch, timeoutMs: 20 });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "timeout" } });
    expect(fetchFn).toHaveBeenCalledTimes(1); // 탐침을 돌지 않는다
  });
});

describe("2단 용량 상한", () => {
  it("Content-Length 사전검사 — 본문을 읽기 전에 끊는다", async () => {
    const { fetchRemoteDocument } = await load();
    const body = "x".repeat(8); // 실제 바이트는 작다
    const fetchFn = vi.fn(async () =>
      textResponse(body, { contentLength: String(MAX_REMOTE_BYTES + 1) }),
    );
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "too-large" } });
  });

  it("본문 누적검사 — 헤더 없이 상한을 넘기면 걸린다", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => streamedResponse(MAX_REMOTE_BYTES + 500_000));
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "too-large" } });
  });

  it("정상 크기는 통과한다", async () => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => streamedResponse(1024));
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result.ok).toBe(true);
  });
});

describe("빈 본문", () => {
  it.each(["", "   \n"])("%j 는 empty 로 분류된다 — 빈 탭을 만들 재료를 주지 않는다", async (body) => {
    const { fetchRemoteDocument } = await load();
    const fetchFn = vi.fn(async () => textResponse(body));
    const host = buildHost({ fetch: fetchFn });

    const result = await fetchRemoteDocument(host, "https://raw.test/a.md");
    expect(result).toEqual({ ok: false, reason: { kind: "empty" } });
  });
});

