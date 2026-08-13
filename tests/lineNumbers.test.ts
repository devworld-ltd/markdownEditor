import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-24 줄 번호 (이슈 #77).
 *
 * jsdom 에는 레이아웃이 없어 실제 측정은 E2E 가 맡는다. 여기서는 **측정값을
 * 어떻게 쓰는지** — 특히 줄바꿈된 줄의 높이를 그대로 반영하는지 — 를 본다.
 */

async function load(): Promise<typeof import("../src/lineNumbers")> {
  vi.resetModules();
  return import("../src/lineNumbers");
}

function buildHost(text = "", heights: number[] = [], enabled = true) {
  const gutterEl = document.createElement("div");
  const editorEl = document.createElement("textarea");
  editorEl.value = text;
  document.body.append(gutterEl, editorEl);

  const saved: boolean[] = [];
  return {
    gutterEl,
    editorEl,
    saved,
    measureLineHeights: () => heights,
    loadEnabled: () => enabled,
    saveEnabled: (v: boolean) => saved.push(v),
  };
}

const rows = (gutterEl: HTMLElement) =>
  [...gutterEl.querySelectorAll(".line-number")].map((el) => ({
    text: el.textContent,
    height: (el as HTMLElement).style.height,
  }));

beforeEach(() => {
  document.body.textContent = "";
});

describe("lineNumbers — 렌더", () => {
  it("줄 수만큼 번호를 그린다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a\nb\nc", [20, 20, 20]);
    initLineNumbers(host);

    expect(rows(host.gutterEl).map((r) => r.text)).toEqual(["1", "2", "3"]);
  });

  it("줄바꿈된 줄은 잰 높이를 그대로 쓴다", async () => {
    // 같은 간격으로 찍으면 긴 줄 뒤 번호가 전부 밀린다.
    const { initLineNumbers } = await load();
    const host = buildHost("짧음\n아주 긴 줄\n짧음", [22, 66, 22]);
    initLineNumbers(host);

    expect(rows(host.gutterEl).map((r) => r.height)).toEqual(["22px", "66px", "22px"]);
  });

  it("측정값이 없으면 높이를 지정하지 않는다 — 0 을 넣으면 번호가 겹친다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a\nb", []);
    initLineNumbers(host);

    expect(rows(host.gutterEl).map((r) => r.height)).toEqual(["", ""]);
  });

  it("0 이하 측정값도 무시한다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a\nb", [0, -5]);
    initLineNumbers(host);
    expect(rows(host.gutterEl).map((r) => r.height)).toEqual(["", ""]);
  });

  it("빈 문서도 1번 줄을 보여준다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("", [20]);
    initLineNumbers(host);
    expect(rows(host.gutterEl).map((r) => r.text)).toEqual(["1"]);
  });

  it("끝 개행이 마지막 빈 줄을 만든다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a\n", [20, 20]);
    initLineNumbers(host);
    expect(rows(host.gutterEl).map((r) => r.text)).toEqual(["1", "2"]);
  });
});

describe("lineNumbers — 켜고 끄기", () => {
  it("꺼져 있으면 아무것도 그리지 않고 숨긴다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a\nb", [20, 20], false);
    const controller = initLineNumbers(host);

    expect(controller.isEnabled()).toBe(false);
    expect(host.gutterEl.hidden).toBe(true);
    expect(rows(host.gutterEl)).toHaveLength(0);
  });

  it("toggle 이 상태를 뒤집고 저장한다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a", [20], false);
    const controller = initLineNumbers(host);

    controller.toggle();
    expect(controller.isEnabled()).toBe(true);
    expect(host.gutterEl.hidden).toBe(false);
    expect(host.saved).toEqual([true]);

    controller.toggle();
    expect(host.saved).toEqual([true, false]);
  });

  it("초기 반영은 저장하지 않는다 — 바뀐 게 없다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a", [20], true);
    initLineNumbers(host);
    expect(host.saved).toEqual([]);
  });

  it("refresh 는 켜져 있을 때만 다시 그린다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a", [20], false);
    const controller = initLineNumbers(host);

    host.editorEl.value = "a\nb\nc";
    controller.refresh();
    expect(rows(host.gutterEl)).toHaveLength(0);

    controller.setEnabled(true);
    host.editorEl.value = "a\nb\nc\nd";
    controller.refresh();
    expect(rows(host.gutterEl)).toHaveLength(4);
  });

  it("저장이 던져도 표시 전환은 계속된다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a", [20], false);
    const controller = initLineNumbers({
      ...host,
      saveEnabled: () => {
        throw new Error("quota");
      },
    });

    expect(() => controller.toggle()).not.toThrow();
    expect(controller.isEnabled()).toBe(true);
  });
});

describe("lineNumbers — 스크롤", () => {
  it("편집 영역 스크롤을 그대로 따라간다", async () => {
    const { initLineNumbers } = await load();
    const host = buildHost("a\nb", [20, 20]);
    initLineNumbers(host);

    host.editorEl.scrollTop = 120;
    host.editorEl.dispatchEvent(new Event("scroll"));

    expect(host.gutterEl.style.transform).toBe("translateY(-120px)");
  });
});

describe("lineNumbers — 초기화", () => {
  it("재호출은 무시되고 잘못된 host 로도 던지지 않는다", async () => {
    const { initLineNumbers } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initLineNumbers(buildHost("a", [20]));
    initLineNumbers(buildHost("a", [20]));
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[lineNumbers] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("host 가 비어도 no-op 컨트롤러를 돌려준다", async () => {
    const { initLineNumbers } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initLineNumbers({
      gutterEl: null as unknown as HTMLElement,
      editorEl: null as unknown as HTMLTextAreaElement,
    });
    expect(() => controller.toggle()).not.toThrow();
    expect(controller.isEnabled()).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[lineNumbers] 초기화 실패:"]);
    warn.mockRestore();
  });
});
