import { describe, expect, it } from "vitest";
import worker, { type Env } from "../worker/index";
import { MAX_SHARE_BYTES, computeShareId } from "../src/shareId";

/**
 * F-60 공유 Worker (이슈 #66).
 *
 * Worker 는 **익명 공개 쓰기 엔드포인트**다. 그래서 검증할 것은 "잘 되는 경로"
 * 보다 **거절해야 할 것을 거절하는가** 다 — 크기 상한, 잘못된 ID, 허용되지 않은
 * 메서드.
 *
 * R2 와 자산 바인딩을 가짜로 주입한다. `workerd` 를 띄우지 않아도 계약 전부가
 * 검증된다.
 */

function buildEnv() {
  const store = new Map<string, { body: string; meta?: Record<string, string> }>();
  const assetRequests: string[] = [];

  const env: Env & { store: typeof store; assetRequests: typeof assetRequests } = {
    store,
    assetRequests,
    ASSETS: {
      fetch: async (request: Request) => {
        assetRequests.push(new URL(request.url).pathname);
        return new Response("<!doctype html><title>app</title>", {
          headers: { "content-type": "text/html" },
        });
      },
    },
    SHARES: {
      head: async (key: string) => (store.has(key) ? ({ key } as never) : null),
      get: async (key: string) => {
        const item = store.get(key);
        return item ? ({ body: item.body } as never) : null;
      },
      put: async (key: string, value: string, options?: { customMetadata?: Record<string, string> }) => {
        store.set(key, { body: value, meta: options?.customMetadata });
        return {} as never;
      },
    } as unknown as R2Bucket,
  };
  return env;
}

function post(content: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify({ content });
  return new Request("https://md.example/api/share", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("worker — 공유 생성", () => {
  it("문서를 저장하고 ID 를 돌려준다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(post("# 문서"), env);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; reused: boolean };
    expect(body.id).toBe(await computeShareId("# 문서"));
    expect(body.reused).toBe(false);
    expect(env.store.get(body.id)?.body).toBe("# 문서");
  });

  it("같은 문서를 다시 올리면 저장하지 않고 같은 ID 를 준다", async () => {
    // 내용 주소 지정의 목적이다 — 스토리지가 단조 증가하지 않는다.
    const env = buildEnv();
    const first = (await (await worker.fetch(post("같은 내용"), env)).json()) as { id: string };
    const second = (await (await worker.fetch(post("같은 내용"), env)).json()) as {
      id: string;
      reused: boolean;
    };

    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(env.store.size).toBe(1);
  });

  it("빈 문서를 거절한다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(post(""), env);

    expect(response.status).toBe(400);
    expect(env.store.size).toBe(0);
  });

  it("상한을 넘는 문서를 거절한다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(post("a".repeat(MAX_SHARE_BYTES + 1)), env);

    expect(response.status).toBe(413);
    expect(env.store.size).toBe(0);
  });

  it("Content-Length 로 먼저 거른다 — 본문을 다 읽고 거절하면 대역폭이 낭비된다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(
      post("작음", { "content-length": String(MAX_SHARE_BYTES + 1000) }),
      env,
    );

    expect(response.status).toBe(413);
  });

  it("JSON 이 아니거나 content 가 문자열이 아니면 400", async () => {
    const env = buildEnv();

    const notJson = new Request("https://md.example/api/share", {
      method: "POST",
      body: "이건 JSON 이 아니다",
    });
    expect((await worker.fetch(notJson, env)).status).toBe(400);

    expect((await worker.fetch(post(42), env)).status).toBe(400);
    expect((await worker.fetch(post(null), env)).status).toBe(400);
    expect((await worker.fetch(post({ nested: true }), env)).status).toBe(400);
  });

  it("GET 으로는 만들 수 없다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(
      new Request("https://md.example/api/share", { method: "GET" }),
      env,
    );
    expect(response.status).toBe(405);
  });

  it("API 응답은 캐시하지 않는다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(post("# 문서"), env);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("worker — 공유 읽기", () => {
  it("저장된 원문을 돌려준다", async () => {
    const env = buildEnv();
    const { id } = (await (await worker.fetch(post("# 원문"), env)).json()) as { id: string };

    const response = await worker.fetch(
      new Request(`https://md.example/api/share/${id}`),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toBe("# 원문");
  });

  it("내용 주소 지정이라 영구 캐시할 수 있다", async () => {
    const env = buildEnv();
    const { id } = (await (await worker.fetch(post("# 원문"), env)).json()) as { id: string };
    const response = await worker.fetch(new Request(`https://md.example/api/share/${id}`), env);

    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("없는 ID 는 404", async () => {
    const env = buildEnv();
    const response = await worker.fetch(
      new Request("https://md.example/api/share/0123456789abcdef"),
      env,
    );
    expect(response.status).toBe(404);
  });

  it("형식이 틀린 ID 는 R2 를 건드리지도 않고 404", async () => {
    // 검증 없이 R2 키로 쓰면 임의 객체를 읽으려는 시도가 통한다.
    const env = buildEnv();
    let getCalls = 0;
    (env.SHARES as unknown as { get: () => Promise<null> }).get = async () => {
      getCalls++;
      return null;
    };

    for (const bad of ["../secret", "ABCDEF0123456789", "short", "x".repeat(40)]) {
      const response = await worker.fetch(
        new Request(`https://md.example/api/share/${encodeURIComponent(bad)}`),
        env,
      );
      expect(response.status, bad).toBe(404);
    }
    expect(getCalls).toBe(0);
  });

  it("POST 로는 읽을 수 없다", async () => {
    const env = buildEnv();
    const response = await worker.fetch(
      new Request("https://md.example/api/share/0123456789abcdef", { method: "POST" }),
      env,
    );
    expect(response.status).toBe(405);
  });
});

describe("worker — 자산 통과", () => {
  it("/s/<id> 는 앱을 그대로 띄운다", async () => {
    // 서버가 HTML 을 만들면 정화 정책이 두 곳으로 갈라진다.
    const env = buildEnv();
    const response = await worker.fetch(
      new Request("https://md.example/s/0123456789abcdef"),
      env,
    );

    expect(response.status).toBe(200);
    expect(env.assetRequests).toEqual(["/"]);
  });

  it("그 밖의 경로는 자산으로 넘긴다", async () => {
    const env = buildEnv();
    await worker.fetch(new Request("https://md.example/icon.svg"), env);
    expect(env.assetRequests).toEqual(["/icon.svg"]);
  });

  it("루트도 자산이다", async () => {
    const env = buildEnv();
    await worker.fetch(new Request("https://md.example/"), env);
    expect(env.assetRequests).toEqual(["/"]);
  });
});
