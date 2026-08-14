import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MermaidLike, MermaidViewHost } from "../src/mermaidView";

async function load(): Promise<typeof import("../src/mermaidView")> {
  vi.resetModules();
  return import("../src/mermaidView");
}

/** 가짜 mermaid. 진짜는 레이아웃이 필요해 jsdom 에서 돌지 않는다 — E2E 가 본다. */
function fakeMermaid(overrides: Partial<MermaidLike> = {}) {
  return {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async (id: string, text: string) => ({
      svg: `<svg id="${id}"><text>${text.slice(0, 12)}</text></svg>`,
    })),
    ...overrides,
  } satisfies MermaidLike & { initialize: ReturnType<typeof vi.fn> };
}

function buildHost(markdownRendered: string, mermaid = fakeMermaid()) {
  document.body.innerHTML = `<div id="preview">${markdownRendered}</div>`;
  const previewEl = document.querySelector<HTMLElement>("#preview")!;

  const notices: Array<{ message: string; kind?: string }> = [];
  const host = {
    previewEl,
    load: vi.fn(async () => mermaid),
    // 실제 앱은 `parser.sanitizeHtml` 을 넘긴다. 여기서는 호출 여부만 본다.
    sanitize: vi.fn((html: string) => html.replace(/ onclick="[^"]*"/g, "")),
    isDark: vi.fn(() => false),
    onRendered: vi.fn(),
    notify: (message: string, kind?: "info" | "error") => notices.push({ message, kind }),
  } satisfies MermaidViewHost & Record<string, unknown>;

  return { host, mermaid, previewEl, notices };
}

const BLOCK = (src = "flowchart LR\n  A --> B") =>
  `<p>본문</p><pre><code class="language-mermaid">${src}</code></pre>`;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("지연 로드", () => {
  it("mermaid 블록이 없으면 라이브러리를 부르지 않는다", async () => {
    const { initMermaidView } = await load();
    const { host } = buildHost("<p>그냥 본문</p><pre><code>코드</code></pre>");

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(host.load).not.toHaveBeenCalled());
    expect(c.isLoaded()).toBe(false);
  });

  it("블록이 있으면 그때 한 번만 부른다", async () => {
    const { initMermaidView } = await load();
    const { host } = buildHost(BLOCK());

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(c.isLoaded()).toBe(true));

    c.render();
    await vi.waitFor(() => expect(host.load).toHaveBeenCalledTimes(1));
  });
});

describe("렌더", () => {
  it("코드블록을 SVG 로 바꾼다", async () => {
    const { initMermaidView } = await load();
    const { host, previewEl } = buildHost(BLOCK());

    initMermaidView(host).render();

    await vi.waitFor(() => expect(previewEl.querySelector("svg")).not.toBeNull());
    expect(previewEl.querySelector("pre")).toBeNull();
    expect(previewEl.querySelector(".mermaid-figure")).not.toBeNull();
    // 본문의 다른 요소는 그대로다.
    expect(previewEl.querySelector("p")?.textContent).toBe("본문");
  });

  it("그린 SVG 도 정화를 통과한다 — 경로를 둘로 만들지 않는다", async () => {
    const { initMermaidView } = await load();
    const mermaid = fakeMermaid({
      render: vi.fn(async () => ({ svg: `<svg onclick="alert(1)"><text>x</text></svg>` })),
    });
    const { host, previewEl } = buildHost(BLOCK(), mermaid);

    initMermaidView(host).render();

    await vi.waitFor(() => expect(previewEl.querySelector("svg")).not.toBeNull());
    expect(host.sanitize).toHaveBeenCalled();
    expect(previewEl.innerHTML).not.toContain("onclick");
  });

  it("HTML 라벨을 끄고 초기화한다 — DOMPurify 가 foreignObject 를 지운다", async () => {
    const { initMermaidView } = await load();
    const { host, mermaid } = buildHost(BLOCK());

    initMermaidView(host).render();

    await vi.waitFor(() => expect(mermaid.initialize).toHaveBeenCalled());
    const config = mermaid.initialize.mock.calls[0][0] as Record<string, unknown>;
    expect((config.flowchart as { htmlLabels: boolean }).htmlLabels).toBe(false);
    expect(config.securityLevel).toBe("strict");
  });

  it("다 그리면 알린다 — 그림 높이가 바뀌므로 앵커를 다시 재야 한다", async () => {
    const { initMermaidView } = await load();
    const { host } = buildHost(BLOCK());

    initMermaidView(host).render();
    await vi.waitFor(() => expect(host.onRendered).toHaveBeenCalled());
  });

  it("여러 블록을 모두 바꾼다", async () => {
    const { initMermaidView } = await load();
    const { host, previewEl } = buildHost(`${BLOCK("flowchart LR\n A-->B")}${BLOCK("flowchart TB\n C-->D")}`);

    initMermaidView(host).render();
    await vi.waitFor(() => expect(previewEl.querySelectorAll("svg")).toHaveLength(2));
  });
});

describe("캐시", () => {
  it("같은 내용은 다시 그리지 않는다 — 타이핑마다 재렌더하면 입력이 멈춘다", async () => {
    const { initMermaidView } = await load();
    const { host, mermaid, previewEl } = buildHost(BLOCK());

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

    // 프리뷰가 다시 그려진 상황을 재현한다 (같은 내용).
    previewEl.innerHTML = BLOCK();
    c.render();
    await vi.waitFor(() => expect(previewEl.querySelector("svg")).not.toBeNull());
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it("내용이 바뀌면 다시 그린다", async () => {
    const { initMermaidView } = await load();
    const { host, mermaid, previewEl } = buildHost(BLOCK("flowchart LR\n A-->B"));

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

    previewEl.innerHTML = BLOCK("flowchart LR\n A-->C");
    c.render();
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
  });

  it("테마가 바뀌면 다시 그린다 — 예전 그림은 색이 맞지 않는다", async () => {
    const { initMermaidView } = await load();
    const { host, mermaid, previewEl } = buildHost(BLOCK());

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

    host.isDark.mockReturnValue(true);
    previewEl.innerHTML = BLOCK();
    c.render();
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect((mermaid.initialize.mock.calls[1][0] as { theme: string }).theme).toBe("dark");
  });
});

describe("실패", () => {
  it("문법이 틀리면 코드블록을 남기고 이유를 적는다", async () => {
    const { initMermaidView } = await load();
    const mermaid = fakeMermaid({
      parse: vi.fn(async () => {
        throw new Error("Parse error on line 2");
      }),
    });
    const { host, previewEl } = buildHost(BLOCK("flowchart LR\n A -->"), mermaid);

    initMermaidView(host).render();

    await vi.waitFor(() => expect(previewEl.querySelector(".mermaid-error")).not.toBeNull());
    // 빈 자리를 남기지 않는다 — 원래 코드가 그대로 보여야 한다.
    expect(previewEl.querySelector("pre code")).not.toBeNull();
    expect(previewEl.querySelector(".mermaid-error")?.textContent).toContain("Parse error");
  });

  it("한 블록이 실패해도 다른 블록은 그려진다", async () => {
    const { initMermaidView } = await load();
    let call = 0;
    const mermaid = fakeMermaid({
      parse: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error("bad");
        return true;
      }),
    });
    const { host, previewEl } = buildHost(`${BLOCK("나쁨")}${BLOCK("좋음")}`, mermaid);

    initMermaidView(host).render();

    await vi.waitFor(() => expect(previewEl.querySelector("svg")).not.toBeNull());
    expect(previewEl.querySelectorAll(".mermaid-error")).toHaveLength(1);
  });

  it("라이브러리를 못 받으면 알리고 코드블록을 남긴다 (오프라인)", async () => {
    const { initMermaidView } = await load();
    const { host, previewEl, notices } = buildHost(BLOCK());
    host.load.mockRejectedValue(new Error("network"));

    initMermaidView(host).render();

    await vi.waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0].kind).toBe("error");
    expect(previewEl.querySelector("pre code")).not.toBeNull();
  });
});

describe("경합", () => {
  it("그리는 도중 본문이 바뀌면 낡은 결과를 붙이지 않는다", async () => {
    const { initMermaidView } = await load();
    let release: (() => void) | null = null;
    const mermaid = fakeMermaid({
      render: vi.fn(
        async (id: string) =>
          new Promise<{ svg: string }>((resolve) => {
            release = () => resolve({ svg: `<svg id="${id}"><text>낡음</text></svg>` });
          }),
      ),
    });
    const { host, previewEl } = buildHost(BLOCK(), mermaid);

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(release).not.toBeNull());

    // 그리는 사이에 사용자가 문서를 통째로 바꿨다.
    previewEl.innerHTML = "<p>다른 문서</p>";
    c.render();
    release!();

    await new Promise((r) => setTimeout(r, 10));
    expect(previewEl.textContent).toBe("다른 문서");
    expect(previewEl.querySelector("svg")).toBeNull();
  });

  it("본문이 바뀌면 낡은 블록은 그리다 만다 — 새 문서가 늦어지면 안 된다", async () => {
    const { initMermaidView } = await load();
    const releases: Array<() => void> = [];
    const mermaid = fakeMermaid({
      render: vi.fn(
        async (id: string) =>
          new Promise<{ svg: string }>((resolve) => {
            releases.push(() => resolve({ svg: `<svg id="${id}"><text>x</text></svg>` }));
          }),
      ),
    });
    // 블록 두 개 — 첫 번째를 그리는 동안 문서가 바뀐다.
    const { host, previewEl } = buildHost(`${BLOCK("가")}${BLOCK("나")}`, mermaid);

    const c = initMermaidView(host);
    c.render();
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    previewEl.innerHTML = "<p>다른 문서</p>";
    releases[0]();

    await new Promise((r) => setTimeout(r, 20));
    // 두 번째 블록은 이미 화면에 없다 — 그리지 않아야 한다.
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

});

describe("견고함", () => {
  it("초기화 실패해도 앱을 멈추지 않는다", async () => {
    const { initMermaidView } = await load();
    const c = initMermaidView(null as unknown as MermaidViewHost);
    expect(() => c.render()).not.toThrow();
    expect(c.isLoaded()).toBe(false);
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const { initMermaidView } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host } = buildHost(BLOCK());

    initMermaidView(host);
    const second = initMermaidView(host);
    second.render();
    expect(second.isLoaded()).toBe(false);
    warn.mockRestore();
  });
});
