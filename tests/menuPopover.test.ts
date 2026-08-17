import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuEntry } from "../src/menuPopover";

/**
 * `menuPopover.ts` 단위 테스트.
 *
 * 키보드·포커스 동작은 E2E(`tests/e2e/menuPopover.spec.ts`)가 본다 — jsdom 은 실제
 * 포커스·레이아웃을 흉내만 낸다. 여기서는 **jsdom 에서 진짜로 관측되는 것**만 본다:
 * 그리기, 실행 경로, 실패했을 때 앱을 안 죽이는지.
 */

/** 모듈의 1회 초기화 가드 때문에 **테스트마다 새로 불러온다**. */
async function load(): Promise<typeof import("../src/menuPopover")> {
  vi.resetModules();
  return import("../src/menuPopover");
}

async function build(entries: readonly MenuEntry[]) {
  const { initMenuPopover } = await load();
  document.body.innerHTML = `
    <button id="trigger">더보기</button>
    <div id="panel" hidden></div>
  `;
  const triggerEl = document.getElementById("trigger") as HTMLElement;
  const panelEl = document.getElementById("panel") as HTMLElement;
  return { triggerEl, panelEl, controller: initMenuPopover({ triggerEl, panelEl, entries }) };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("그리기", () => {
  it("항목마다 버튼을 만들고 이름을 넣는다", async () => {
    const { panelEl } = await build([{ label: "가", action: () => {} }, { label: "나", action: () => {} }]);
    const labels = [...panelEl.querySelectorAll(".menu-label")].map((el) => el.textContent);
    expect(labels).toEqual(["가", "나"]);
  });

  it("구분선은 항목으로 세지 않는다", async () => {
    const { panelEl, controller } = await build([
      { label: "가", action: () => {} },
      null,
      { label: "나", action: () => {} },
    ]);
    expect(panelEl.querySelectorAll(".menu-separator")).toHaveLength(1);
    // 화살표 이동이 빈 칸에 멈추면 안 되므로 개수에서 빠져야 한다.
    expect(controller.count()).toBe(2);
  });

  it("구분선을 스크린리더에서 숨긴다", async () => {
    const { panelEl } = await build([{ label: "가", action: () => {} }, null]);
    expect(panelEl.querySelector(".menu-separator")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("툴바에서 쓰던 이름을 data-action 으로 남긴다", async () => {
    const { panelEl } = await build([{ id: "Save As", label: "다른 이름으로 저장", action: () => {} }]);
    expect(panelEl.querySelector<HTMLElement>(".menu-item")?.dataset.action).toBe("Save As");
  });

  it("항목은 Tab 순서에서 뺀다 — 이동은 화살표로만 한다", async () => {
    const { panelEl } = await build([{ label: "가", action: () => {} }]);
    expect(panelEl.querySelector<HTMLButtonElement>(".menu-item")?.tabIndex).toBe(-1);
  });

  it("단축키 표시는 있을 때만 만든다", async () => {
    const { panelEl } = await build([
      { label: "가", hint: "⌘S", action: () => {} },
      { label: "나", action: () => {} },
    ]);
    expect(panelEl.querySelectorAll(".menu-hint")).toHaveLength(1);
  });
});

describe("여닫기", () => {
  it("열면 aria-expanded 가 켜지고 패널이 보인다", async () => {
    const { triggerEl, panelEl, controller } = await build([{ label: "가", action: () => {} }]);
    expect(panelEl.hidden).toBe(true);
    controller.open();
    expect(panelEl.hidden).toBe(false);
    expect(triggerEl.getAttribute("aria-expanded")).toBe("true");
  });

  it("닫으면 되돌아온다", async () => {
    const { triggerEl, panelEl, controller } = await build([{ label: "가", action: () => {} }]);
    controller.open();
    controller.close();
    expect(panelEl.hidden).toBe(true);
    expect(triggerEl.getAttribute("aria-expanded")).toBe("false");
  });

  it("항목이 하나도 없으면 열지 않는다 — 빈 상자를 띄우지 않는다", async () => {
    const { panelEl, controller } = await build([]);
    controller.open();
    expect(controller.isOpen()).toBe(false);
    expect(panelEl.hidden).toBe(true);
  });

  it("트리거를 누르면 열리고 다시 누르면 닫힌다", async () => {
    const { triggerEl, controller } = await build([{ label: "가", action: () => {} }]);
    triggerEl.click();
    expect(controller.isOpen()).toBe(true);
    triggerEl.click();
    expect(controller.isOpen()).toBe(false);
  });

  it("메뉴임을 알린다", async () => {
    const { triggerEl, panelEl } = await build([{ label: "가", action: () => {} }]);
    expect(panelEl.getAttribute("role")).toBe("menu");
    expect(triggerEl.getAttribute("aria-haspopup")).toBe("true");
    expect(panelEl.querySelector(".menu-item")?.getAttribute("role")).toBe("menuitem");
  });
});

describe("실행", () => {
  it("누르면 동작을 실행한다", async () => {
    const action = vi.fn();
    const { panelEl, controller } = await build([{ label: "가", action }]);
    controller.open();
    panelEl.querySelector<HTMLButtonElement>(".menu-item")?.click();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("**동작보다 먼저 닫는다** — 대화상자를 여는 항목 위에 팝오버가 남으면 안 된다", async () => {
    let openWhenRun: boolean | null = null;
    const { panelEl, controller } = await build([
      { label: "가", action: () => { openWhenRun = controller.isOpen(); } },
    ]);
    controller.open();
    panelEl.querySelector<HTMLButtonElement>(".menu-item")?.click();
    expect(openWhenRun).toBe(false);
  });

  it("동작이 실패하면 붙잡아 기록한다", async () => {
    // `.click()` 은 리스너의 예외를 되던지지 않는다 — `not.toThrow()` 로 두면
    // try/catch 를 통째로 지워도 통과하는 **빈 단언**이 된다(실측). 그래서
    // 붙잡았다는 증거인 경고 기록을 본다.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { panelEl, controller } = await build([
      { label: "가", action: () => { throw new Error("실패"); } },
    ]);
    controller.open();
    panelEl.querySelector<HTMLButtonElement>(".menu-item")?.click();
    expect(warn).toHaveBeenCalledWith("[menuPopover] 항목 실행 실패:", expect.any(Error));
    expect(controller.isOpen()).toBe(false);
    warn.mockRestore();
  });
});

describe("초기화", () => {
  it("두 번 부르면 두 번째는 무동작 컨트롤러를 준다", async () => {
    await build([{ label: "가", action: () => {} }]);
    const { initMenuPopover } = await import("../src/menuPopover");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = initMenuPopover({
      triggerEl: document.getElementById("trigger") as HTMLElement,
      panelEl: document.getElementById("panel") as HTMLElement,
      entries: [{ label: "나", action: () => {} }],
    });
    again.open();
    expect(again.isOpen()).toBe(false);
    expect(again.count()).toBe(0);
    warn.mockRestore();
  });
});
