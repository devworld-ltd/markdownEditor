import { beforeEach, describe, expect, it, vi } from "vitest";

/** F-29 통계 표시 배선 (이슈 #81). */

async function load(): Promise<typeof import("../src/statusBar")> {
  vi.resetModules();
  return import("../src/statusBar");
}

function buildHost(text = "", enabled = true) {
  const barEl = document.createElement("div");
  const editorEl = document.createElement("textarea");
  editorEl.value = text;
  document.body.append(barEl, editorEl);
  const saved: boolean[] = [];
  return {
    barEl,
    editorEl,
    saved,
    loadEnabled: () => enabled,
    saveEnabled: (v: boolean) => saved.push(v),
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("statusBar", () => {
  it("문서 전체 통계를 보여준다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("한글 문서 입니다");
    initStatusBar(host);

    expect(host.barEl.textContent).toContain("3어절");
  });

  it("선택 영역이 있으면 그 범위를 센다", async () => {
    // 문서 전체는 늘 볼 수 있지만 "이 문단이 몇 자인가" 는 선택했을 때만 안다.
    const { initStatusBar } = await load();
    const host = buildHost("한글 문서 입니다");
    const controller = initStatusBar(host);

    host.editorEl.setSelectionRange(0, 5);
    controller.refresh();

    expect(host.barEl.textContent).toContain("선택");
    expect(host.barEl.textContent).toContain("2어절");
  });

  it("선택이 풀리면 전체로 돌아온다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("한글 문서 입니다");
    const controller = initStatusBar(host);

    host.editorEl.setSelectionRange(0, 5);
    controller.refresh();
    host.editorEl.setSelectionRange(3, 3);
    controller.refresh();

    expect(host.barEl.textContent).not.toContain("선택");
  });

  it("본문이 바뀌면 refresh 로 갱신된다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("가");
    const controller = initStatusBar(host);

    host.editorEl.value = "가 나 다";
    controller.refresh();
    expect(host.barEl.textContent).toContain("3어절");
  });

  it("꺼져 있으면 숨기고 갱신하지 않는다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("한글 문서", false);
    const controller = initStatusBar(host);

    expect(controller.isEnabled()).toBe(false);
    expect(host.barEl.hidden).toBe(true);
    expect(host.barEl.textContent).toBe("");
  });

  it("켜고 끄기가 저장된다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("가", false);
    const controller = initStatusBar(host);

    controller.setEnabled(true);
    expect(host.barEl.hidden).toBe(false);
    expect(host.saved).toEqual([true]);
  });

  it("초기 반영은 저장하지 않는다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("가", true);
    initStatusBar(host);
    expect(host.saved).toEqual([]);
  });

  it("저장이 던져도 표시 전환은 계속된다", async () => {
    const { initStatusBar } = await load();
    const host = buildHost("가", false);
    const controller = initStatusBar({
      ...host,
      saveEnabled: () => {
        throw new Error("quota");
      },
    });

    expect(() => controller.setEnabled(true)).not.toThrow();
    expect(controller.isEnabled()).toBe(true);
  });

  it("aria-live 를 붙이지 않는다", async () => {
    // 글자를 칠 때마다 스크린리더가 숫자를 읽으면 편집이 불가능해진다.
    const { initStatusBar } = await load();
    const host = buildHost("가");
    initStatusBar(host);
    expect(host.barEl.getAttribute("aria-live")).toBeNull();
  });

  it("재호출은 무시되고 잘못된 host 로도 던지지 않는다", async () => {
    const { initStatusBar } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initStatusBar(buildHost());
    initStatusBar(buildHost());
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[statusBar] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });
});
