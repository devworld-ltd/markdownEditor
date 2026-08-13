import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-22 검색 UI 배선 (이슈 #41).
 *
 * 계산부는 `searchEngine.test.ts` 가, 실제 브라우저 동작(키 가로채기·스크롤·
 * 포커스)은 `search.spec.ts` 가 맡는다. 여기서는 **둘 사이의 배선**을 본다 —
 * 특히 "일치를 매번 다시 계산한다" 는 불변식은 E2E 로는 다른 경로
 * (`onAfterRender → refresh()`)에 가려 검증되지 않는다는 것을 확인했다.
 */

async function loadSearch(): Promise<typeof import("../src/search")> {
  vi.resetModules();
  return import("../src/search");
}

function buildHost(text = "") {
  const panelEl = document.createElement("div");
  panelEl.hidden = true;
  const inputEl = document.createElement("input");
  const countEl = document.createElement("span");
  const prevEl = document.createElement("button");
  const nextEl = document.createElement("button");
  const closeEl = document.createElement("button");
  const editorEl = document.createElement("textarea");
  editorEl.value = text;

  document.body.append(panelEl, inputEl, countEl, prevEl, nextEl, closeEl, editorEl);

  return {
    panelEl,
    inputEl,
    countEl,
    prevEl,
    nextEl,
    closeEl,
    editorEl,
    // jsdom 은 레이아웃이 없어 미러 측정이 항상 0 이다. 배선만 보면 되므로
    // 결정적인 가짜 측정기를 주입한다(주입 경계를 둔 이유, D-4).
    measureOffsetTop: (_ta: HTMLTextAreaElement, index: number) => index * 10,
  };
}

function type(inputEl: HTMLInputElement, value: string): void {
  inputEl.value = value;
  inputEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(inputEl: HTMLInputElement, shiftKey = false): void {
  inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true }));
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("search — 열기/닫기", () => {
  it("열면 검색창에 포커스가 가고 닫으면 에디터로 돌아온다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘");
    const controller = initSearch(host);

    controller.open();
    expect(controller.isOpen()).toBe(true);
    expect(document.activeElement).toBe(host.inputEl);

    controller.close();
    expect(controller.isOpen()).toBe(false);
    expect(document.activeElement).toBe(host.editorEl);
  });

  it("에디터에 선택 영역이 있으면 그것을 질의로 채운다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("건초 바늘 건초");
    const controller = initSearch(host);

    host.editorEl.setSelectionRange(3, 5);
    controller.open();

    expect(host.inputEl.value).toBe("바늘");
    expect(host.countEl.textContent).toBe("1/1");
  });

  it("여러 줄 선택은 질의로 쓰지 않는다", async () => {
    // 여러 줄 덩어리는 검색어로 부적절하고, 검색창을 알아볼 수 없게 만든다.
    const { initSearch } = await loadSearch();
    const host = buildHost("첫 줄\n둘째 줄");
    const controller = initSearch(host);

    host.editorEl.setSelectionRange(0, 8);
    controller.open();

    expect(host.inputEl.value).toBe("");
  });

  it("toggle() 이 상태를 뒤집는다", async () => {
    const { initSearch } = await loadSearch();
    const controller = initSearch(buildHost("x"));

    controller.toggle();
    expect(controller.isOpen()).toBe(true);
    controller.toggle();
    expect(controller.isOpen()).toBe(false);
  });
});

describe("search — 이동과 개수 표시", () => {
  it("질의를 치면 첫 일치를 선택하고 개수를 표시한다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘 A 바늘 B 바늘");
    const controller = initSearch(host);
    controller.open();

    type(host.inputEl, "바늘");

    expect(host.countEl.textContent).toBe("1/3");
    expect([host.editorEl.selectionStart, host.editorEl.selectionEnd]).toEqual([0, 2]);
  });

  it("Enter 로 다음, Shift+Enter 로 이전, 끝에서 순환한다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘 A 바늘 B 바늘");
    const controller = initSearch(host);
    controller.open();
    type(host.inputEl, "바늘");

    pressEnter(host.inputEl);
    expect(host.countEl.textContent).toBe("2/3");
    pressEnter(host.inputEl);
    expect(host.countEl.textContent).toBe("3/3");
    pressEnter(host.inputEl);
    expect(host.countEl.textContent).toBe("1/3");

    pressEnter(host.inputEl, true);
    expect(host.countEl.textContent).toBe("3/3");
  });

  it("결과가 없으면 상태를 표시하고 선택을 건드리지 않는다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("건초 더미");
    const controller = initSearch(host);
    controller.open();
    host.editorEl.setSelectionRange(2, 2);

    type(host.inputEl, "바늘");

    expect(host.countEl.textContent).toBe("결과 없음");
    expect(host.panelEl.dataset.state).toBe("empty");
    expect([host.editorEl.selectionStart, host.editorEl.selectionEnd]).toEqual([2, 2]);
  });

  it("일치 지점으로 스크롤한다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("건초 바늘");
    const controller = initSearch(host);
    controller.open();

    type(host.inputEl, "바늘");

    // 주입한 측정기: index * 10 → start=3 이므로 30. clientHeight 는 jsdom 에서 0.
    expect(host.editorEl.scrollTop).toBe(30);
  });

  it("Escape 는 검색창을 닫는다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘");
    const controller = initSearch(host);
    controller.open();

    host.inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(controller.isOpen()).toBe(false);
  });

  it("버튼 클릭으로도 이동하고 포커스는 검색창에 남는다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘 A 바늘");
    const controller = initSearch(host);
    controller.open();
    type(host.inputEl, "바늘");

    host.nextEl.click();
    expect(host.countEl.textContent).toBe("2/2");
    expect(document.activeElement).toBe(host.inputEl);

    host.prevEl.click();
    expect(host.countEl.textContent).toBe("1/2");
  });

  it("닫기 버튼이 닫는다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘");
    const controller = initSearch(host);
    controller.open();

    host.closeEl.click();
    expect(controller.isOpen()).toBe(false);
  });
});

describe("search — 본문이 바뀌어도 어긋나지 않는다", () => {
  it("이동 직전에 항상 다시 계산한다 — 렌더 알림 없이 본문이 바뀌어도", async () => {
    // 탭 전환은 input 이벤트 없이 editorEl.value 를 바꾼다(tabs.ts). E2E 에서는
    // onAfterRender → refresh() 경로가 이 상황을 가려 버려서, 이 불변식은
    // 여기서만 검증된다 — 실제로 go() 의 recompute() 를 지워도 E2E 는 전부
    // 통과했다.
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘 바늘 바늘");
    const controller = initSearch(host);
    controller.open();
    type(host.inputEl, "바늘");
    expect(host.countEl.textContent).toBe("1/3");

    // 렌더도 input 이벤트도 없이 본문만 교체된다.
    host.editorEl.value = "다른 문서";

    pressEnter(host.inputEl);
    expect(host.countEl.textContent).toBe("결과 없음");
  });

  it("refresh() 는 열려 있을 때만 다시 계산한다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘");
    const controller = initSearch(host);

    // 닫혀 있으면 아무것도 쓰지 않는다 — 닫힌 UI 를 갱신하는 건 낭비이자
    // 사용자에게 보이지 않는 상태 변화다.
    controller.refresh();
    expect(host.countEl.textContent).toBe("");

    controller.open();
    type(host.inputEl, "바늘");
    host.editorEl.value = "바늘 바늘";
    controller.refresh();
    expect(host.countEl.textContent).toBe("1/2");
  });

  it("본문이 바뀌어도 보고 있던 일치를 계속 가리킨다", async () => {
    const { initSearch } = await loadSearch();
    const host = buildHost("바늘 A 바늘 B 바늘");
    const controller = initSearch(host);
    controller.open();
    type(host.inputEl, "바늘");
    pressEnter(host.inputEl);
    pressEnter(host.inputEl);
    expect(host.countEl.textContent).toBe("3/3");

    // 앞쪽에 글자가 끼어들어 좌표가 밀린다.
    host.editorEl.value = `앞머리 ${host.editorEl.value}`;
    controller.refresh();

    // 인덱스를 그대로 두면 엉뚱한 일치로 튄다.
    expect(host.countEl.textContent).toBe("3/3");
  });
});

describe("search — 초기화", () => {
  it("재호출은 무시된다", async () => {
    const { initSearch } = await loadSearch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initSearch(buildHost());
    initSearch(buildHost());

    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[search] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });

  it("초기화가 실패해도 던지지 않고 no-op 컨트롤러를 돌려준다", async () => {
    const { initSearch } = await loadSearch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    const controller = initSearch({
      panelEl: null as unknown as HTMLElement,
      inputEl: null as unknown as HTMLInputElement,
      countEl: null as unknown as HTMLElement,
      prevEl: null as unknown as HTMLElement,
      nextEl: null as unknown as HTMLElement,
      closeEl: null as unknown as HTMLElement,
      editorEl: null as unknown as HTMLTextAreaElement,
    });

    expect(() => controller.open()).not.toThrow();
    expect(controller.isOpen()).toBe(false);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(["[search] 초기화 실패:"]);
    warn.mockRestore();
  });
});
