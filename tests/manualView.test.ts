import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ManualHost } from "../src/manualView";

/**
 * #141 사용 설명서 화면.
 *
 * 문서 **내용**은 여기서 검증하지 않는다 — 그건 사람이 읽고 판단할 글이고,
 * 문장을 단언하면 문서를 고칠 때마다 테스트가 깨진다. 여기서 고정하는 것은
 * **경로**다: 정화를 거치는가, 한 번만 그리는가, 없을 때 무엇을 보여주는가.
 */

async function load(): Promise<typeof import("../src/manualView")> {
  vi.resetModules();
  return import("../src/manualView");
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

function buildHost(markdown = "# 사용 설명서\n\n본문입니다."): ManualHost & {
  render: ReturnType<typeof vi.fn>;
} {
  const dialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(dialogEl);
  const bodyEl = document.createElement("div");
  const closeEl = document.createElement("button");
  const returnFocusTo = document.createElement("textarea");
  document.body.append(dialogEl, bodyEl, closeEl, returnFocusTo);

  return {
    dialogEl,
    bodyEl,
    closeEl,
    markdown,
    // 실제 앱은 `parseMarkdown` 을 넘긴다. 여기서는 거쳐 갔는지만 본다.
    render: vi.fn((md: string) => `<p>${md.replace(/[<>]/g, "")}</p>`),
    returnFocusTo,
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("열기·닫기", () => {
  it("열면 본문을 그린다", async () => {
    const { initManual } = await load();
    const host = buildHost();
    const c = initManual(host);

    expect(c.isRendered()).toBe(false);
    c.open();
    expect(c.isOpen()).toBe(true);
    expect(c.isRendered()).toBe(true);
    expect(host.bodyEl.innerHTML).toContain("사용 설명서");
  });

  it("앱 기동 때 미리 그리지 않는다 — 열어 보지도 않을 문서로 첫 화면이 느려진다", async () => {
    const { initManual } = await load();
    const host = buildHost();
    initManual(host);

    expect(host.render).not.toHaveBeenCalled();
    expect(host.bodyEl.innerHTML).toBe("");
  });

  it("두 번 열어도 한 번만 그린다", async () => {
    const { initManual } = await load();
    const host = buildHost();
    const c = initManual(host);

    c.open();
    c.close();
    c.open();
    expect(host.render).toHaveBeenCalledTimes(1);
  });

  it("열 때마다 처음부터 읽도록 되돌린다", async () => {
    const { initManual } = await load();
    const host = buildHost();
    const c = initManual(host);

    c.open();
    host.bodyEl.scrollTop = 500;
    c.close();
    c.open();
    expect(host.bodyEl.scrollTop).toBe(0);
  });

  it("닫기 버튼으로 닫힌다", async () => {
    const { initManual } = await load();
    const host = buildHost();
    const c = initManual(host);

    c.open();
    host.closeEl.click();
    expect(c.isOpen()).toBe(false);
  });

  it("닫으면 편집기로 포커스를 돌려준다", async () => {
    const { initManual } = await load();
    const host = buildHost();
    const spy = vi.spyOn(host.returnFocusTo as HTMLElement, "focus");
    const c = initManual(host);

    c.open();
    c.close();
    expect(spy).toHaveBeenCalled();
  });
});

describe("정화", () => {
  it("본문은 주입받은 정화 함수를 거친다 — 두 번째 렌더 경로를 만들지 않는다", async () => {
    const { initManual } = await load();
    const host = buildHost("# 제목\n\n<script>alert(1)</script>");
    initManual(host).open();

    expect(host.render).toHaveBeenCalledWith("# 제목\n\n<script>alert(1)</script>");
    expect(host.bodyEl.innerHTML).not.toContain("<script>");
  });
});

describe("문서가 없을 때", () => {
  it("빈 문자열이면 이유를 보여준다 — 빈 화면은 고장으로 읽힌다", async () => {
    const { initManual } = await load();
    const host = buildHost("");
    initManual(host).open();

    expect(host.bodyEl.textContent).toContain("불러오지 못했습니다");
    expect(host.render).not.toHaveBeenCalled();
  });

  it("공백뿐이어도 같다", async () => {
    const { initManual } = await load();
    const host = buildHost("   \n  ");
    initManual(host).open();

    expect(host.bodyEl.textContent).toContain("불러오지 못했습니다");
  });
});

describe("견고함", () => {
  it("초기화 실패해도 앱을 멈추지 않는다", async () => {
    const { initManual } = await load();
    const c = initManual(null as unknown as ManualHost);
    expect(() => c.open()).not.toThrow();
    expect(c.isRendered()).toBe(false);
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const { initManual } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    initManual(buildHost());
    const second = initManual(buildHost());
    second.open();
    expect(second.isOpen()).toBe(false);
    warn.mockRestore();
  });
});
