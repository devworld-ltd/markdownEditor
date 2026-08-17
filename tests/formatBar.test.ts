import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormatBarHost } from "../src/formatBar";

/**
 * #155 좁은 화면 서식 바 — 주입형 리프 (#177 에서 보강).
 *
 * E2E(KB1~KB8)는 **보이는가·같은 결과가 나오는가**를 본다. 여기서 고정하는 것은
 * 그쪽에서 볼 수 없는 것들이다: 툴바에 없는 이름이 조용히 빠지는가, 가상 키보드
 * 높이를 실제로 반영하는가, 초기화가 실패해도 앱이 사는가.
 *
 * `document.execCommand` 는 jsdom 에 없다 — **그것을 피하려고 프로덕션 코드를
 * 고치지 않는다.** 여기서 스텁한다.
 */

async function load(): Promise<typeof import("../src/formatBar")> {
  vi.resetModules();
  return import("../src/formatBar");
}

interface FakeViewport {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, fn: () => void) => void;
  fire: (type: string) => void;
}

function fakeViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    height,
    offsetTop,
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
    fire: (type) => listeners[type]?.forEach((fn) => fn()),
  };
}

function rig(extra: Partial<FormatBarHost> = {}) {
  document.body.innerHTML = `
    <div id="bar"></div>
    <textarea id="editor"></textarea>
  `;
  const barEl = document.getElementById("bar") as HTMLElement;
  const editorEl = document.getElementById("editor") as HTMLTextAreaElement;
  editorEl.value = "가나다";
  editorEl.setSelectionRange(0, 3);
  const host = { barEl, editorEl, ...extra } as FormatBarHost;
  return { host, barEl, editorEl };
}

beforeEach(() => {
  document.body.innerHTML = "";
  // 서식 액션이 이것을 쓴다. jsdom 에 없으므로 심어 둔다.
  (document as unknown as { execCommand: unknown }).execCommand = vi.fn(
    (_cmd: string, _ui: boolean, text: string) => {
      const el = document.activeElement as HTMLTextAreaElement | null;
      if (!el || el.tagName !== "TEXTAREA") return false;
      const { selectionStart: s, selectionEnd: e, value } = el;
      el.value = value.slice(0, s) + text + value.slice(e);
      el.setSelectionRange(s + text.length, s + text.length);
      return true;
    },
  );
});

describe("버튼 만들기", () => {
  it("FB1: 툴바 이름을 data-action 으로 남기고 접근 가능한 이름을 붙인다", async () => {
    const { initFormatBar } = await load();
    const { host, barEl } = rig();
    const c = initFormatBar(host);

    expect(c.count()).toBe(8);
    expect(barEl.querySelectorAll(".format-btn")).toHaveLength(8);

    const first = barEl.querySelector<HTMLButtonElement>(".format-btn")!;
    expect(first.dataset.action).toBe("Bold");
    expect(first.getAttribute("aria-label")).toBe("굵게");
    expect(first.type).toBe("button");
  });

  it("FB2: 툴바에 없는 이름은 그 버튼만 빠지고 count() 에 드러난다", async () => {
    // 이름이 바뀌면 앱 전체가 죽는 것보다 그 버튼만 빠지는 편이 낫다 —
    // 대신 **조용히** 빠지면 안 되므로 셀 수 있어야 한다.
    const { initFormatBar } = await load();
    const { host, barEl } = rig({
      items: [
        { label: "Bold", text: "굵게" },
        { label: "없는버튼", text: "없음" },
      ],
    });
    const c = initFormatBar(host);

    expect(c.count()).toBe(1);
    expect(barEl.querySelectorAll(".format-btn")).toHaveLength(1);
  });

  it("FB2-b: 항목이 하나도 없으면 버튼도 없다", async () => {
    const { initFormatBar } = await load();
    const { host } = rig({ items: [] });
    expect(initFormatBar(host).count()).toBe(0);
  });
});

describe("실행", () => {
  it("FB3: 클릭이 툴바와 같은 액션을 실행한다", async () => {
    const { initFormatBar } = await load();
    const { host, barEl, editorEl } = rig();
    initFormatBar(host);

    barEl.querySelector<HTMLButtonElement>('[data-action="Bold"]')!.click();

    // 서식 계산을 다시 구현했다면 이 값이 달라진다.
    expect(editorEl.value).toBe("**가나다**");
  });

  it("FB3-b: 실행하면 편집기로 포커스가 돌아온다 (액션이 직접 준다)", async () => {
    const { initFormatBar } = await load();
    const { host, barEl, editorEl } = rig();
    initFormatBar(host);

    const other = document.createElement("input");
    document.body.append(other);
    other.focus();

    barEl.querySelector<HTMLButtonElement>('[data-action="Italic"]')!.click();

    // 포커스가 없으면 `execCommand` 는 조용히 아무것도 안 한다. 그 포커스는
    // **서식 액션이 스스로 준다** — 서식 바가 한 번 더 부를 이유가 없다.
    expect(document.activeElement).toBe(editorEl);
    expect(editorEl.value).toBe("*가나다*");
  });

  it("FB4: pointerdown 을 취소한다 — 실기기에서 키보드가 내려가지 않는 근거", async () => {
    const { initFormatBar } = await load();
    const { host, barEl } = rig();
    initFormatBar(host);

    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    barEl.querySelector<HTMLButtonElement>(".format-btn")!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("가상 키보드", () => {
  it("FB5: 가려진 높이만큼 띄운다", async () => {
    const { initFormatBar } = await load();
    const viewport = fakeViewport(508);
    const { host, barEl } = rig({
      viewport: viewport as unknown as VisualViewport,
      windowHeight: () => 844,
    });
    const c = initFormatBar(host);

    expect(c.inset()).toBe(336);
    expect(barEl.style.bottom).toBe("336px");
  });

  it("FB6: visualViewport 가 없으면 0 — 보정하지 않는다", async () => {
    const { initFormatBar } = await load();
    const { host, barEl } = rig({ windowHeight: () => 844 });
    const c = initFormatBar(host);

    expect(c.inset()).toBe(0);
    expect(barEl.style.bottom).toBe("0px");
  });

  it("FB7: 뷰포트가 바뀌면 다시 계산한다 (resize·scroll 둘 다)", async () => {
    const { initFormatBar } = await load();
    const viewport = fakeViewport(844);
    const { host, barEl } = rig({
      viewport: viewport as unknown as VisualViewport,
      windowHeight: () => 844,
    });
    initFormatBar(host);
    expect(barEl.style.bottom).toBe("0px");

    viewport.height = 500;
    viewport.fire("resize");
    expect(barEl.style.bottom).toBe("344px");

    // 키보드가 올라온 뒤 페이지가 밀리는 브라우저는 scroll 로 온다.
    viewport.height = 600;
    viewport.fire("scroll");
    expect(barEl.style.bottom).toBe("244px");
  });
});

describe("가드", () => {
  it("FB8: 두 번 부르면 두 번째는 무동작 컨트롤러다", async () => {
    const { initFormatBar } = await load();
    initFormatBar(rig().host);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = initFormatBar(rig().host);
    expect(again.count()).toBe(0);
    expect(again.inset()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("FB8-b: host 가 망가져도 앱을 죽이지 않는다", async () => {
    const { initFormatBar } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const broken = initFormatBar({
      barEl: null as unknown as HTMLElement,
      editorEl: null as unknown as HTMLTextAreaElement,
    });

    expect(broken.count()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
