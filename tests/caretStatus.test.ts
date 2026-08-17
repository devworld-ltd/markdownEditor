import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaretStatusHost } from "../src/caretStatus";
import { lineStartOffsets } from "../src/sourceLines";

/**
 * #152 커서 위치 표시 — 주입형 리프 (#177 에서 보강).
 *
 * 계산 자체는 `caretPosition.test.ts` 가 맡는다. 여기서 고정하는 것은 **E2E 가
 * 원리상 볼 수 없는 것들**이다: 배열 캐시가 실제로 아끼는가, 포커스 밖에서
 * 갱신을 건너뛰는가, 초기화가 실패해도 앱이 사는가.
 */

/** 1회 초기화 가드 때문에 테스트마다 새로 불러온다. */
async function load(): Promise<typeof import("../src/caretStatus")> {
  vi.resetModules();
  return import("../src/caretStatus");
}

interface Rig {
  host: CaretStatusHost;
  barEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
  /** `lineStarts` 가 몇 번 불렸는가. 캐시 검증의 전부다. */
  calls: () => number;
  /** 편집기에 포커스가 있는 것처럼 만든다. */
  focusEditor: () => void;
  fireSelectionChange: () => void;
}

function rig(value = "첫 줄\n둘째 줄"): Rig {
  document.body.innerHTML = `
    <span id="bar"></span>
    <textarea id="editor"></textarea>
  `;
  const barEl = document.getElementById("bar") as HTMLElement;
  const editorEl = document.getElementById("editor") as HTMLTextAreaElement;
  editorEl.value = value;
  editorEl.setSelectionRange(0, 0);

  let calls = 0;
  const host: CaretStatusHost = {
    barEl,
    editorEl,
    lineStarts: (text) => {
      calls += 1;
      return lineStartOffsets(text);
    },
  };

  return {
    host,
    barEl,
    editorEl,
    calls: () => calls,
    focusEditor: () => editorEl.focus(),
    fireSelectionChange: () =>
      document.dispatchEvent(new Event("selectionchange")),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("표시", () => {
  it("CS1: 초기화하는 즉시 현재 위치를 그린다", async () => {
    const { initCaretStatus } = await load();
    const r = rig();
    initCaretStatus(r.host);
    expect(r.barEl.textContent).toBe("1행 1열");
  });

  it("CS2: refresh() 가 값을 다시 읽고 text() 가 화면 글을 준다", async () => {
    const { initCaretStatus } = await load();
    const r = rig();
    const c = initCaretStatus(r.host);

    r.editorEl.setSelectionRange(2, 2);
    c.refresh();

    expect(r.barEl.textContent).toBe("1행 3열");
    expect(c.text()).toBe("1행 3열");
  });

  it("CS7: 선택이 있으면 선택 정보가 함께 붙는다", async () => {
    const { initCaretStatus } = await load();
    const r = rig("가나다\n라마바");
    const c = initCaretStatus(r.host);

    r.editorEl.setSelectionRange(0, 5);
    c.refresh();

    expect(r.barEl.textContent).toContain("선택");
    expect(r.barEl.textContent).toContain("줄");
  });
});

describe("줄 시작 배열 캐시", () => {
  it("CS3: 본문이 그대로면 다시 만들지 않는다", async () => {
    /**
     * **E2E 로는 이것을 볼 수 없다** — `selectionchange` 가 작업당 한 번으로
     * 합쳐져 캐럿을 2000번 옮겨도 갱신이 한 번뿐이다(트랩 #94). 여기서만
     * 캐시가 실제로 일을 하는지 확인된다.
     */
    const { initCaretStatus } = await load();
    const r = rig();
    const c = initCaretStatus(r.host);
    const afterInit = r.calls();

    for (let i = 0; i < 20; i += 1) {
      r.editorEl.setSelectionRange(i % 5, i % 5);
      c.refresh();
    }

    expect(r.calls()).toBe(afterInit);
  });

  it("CS4: 본문이 바뀌면 다시 만든다", async () => {
    const { initCaretStatus } = await load();
    const r = rig();
    const c = initCaretStatus(r.host);
    const before = r.calls();

    r.editorEl.value = "완전히\n다른\n글";
    c.refresh();

    expect(r.calls()).toBe(before + 1);
  });

  it("CS4-b: 바뀐 본문의 행·열이 맞는다 — 옛 배열을 그대로 쓰지 않는다", async () => {
    const { initCaretStatus } = await load();
    const r = rig("짧다");
    const c = initCaretStatus(r.host);

    r.editorEl.value = "가\n나\n다";
    r.editorEl.setSelectionRange(4, 4);
    c.refresh();

    expect(r.barEl.textContent).toBe("3행 1열");
  });
});

describe("갱신 시점", () => {
  it("CS5: 편집기에 포커스가 있으면 selectionchange 에 반응한다", async () => {
    const { initCaretStatus } = await load();
    const r = rig();
    initCaretStatus(r.host);

    r.focusEditor();
    r.editorEl.setSelectionRange(3, 3);
    r.fireSelectionChange();

    expect(r.barEl.textContent).toBe("1행 4열");
  });

  it("CS6: 편집기 밖에 포커스가 있으면 갱신하지 않는다", async () => {
    // 검색창에서 글자를 고를 때마다 커서 표시가 흔들리면 안 된다.
    const { initCaretStatus } = await load();
    const r = rig();
    initCaretStatus(r.host);

    const other = document.createElement("input");
    document.body.append(other);
    other.focus();

    r.editorEl.setSelectionRange(3, 3);
    r.fireSelectionChange();

    expect(r.barEl.textContent).toBe("1행 1열");
  });
});

describe("가드", () => {
  it("CS8: 두 번 부르면 두 번째는 무동작 컨트롤러다", async () => {
    const { initCaretStatus } = await load();
    const r = rig();
    initCaretStatus(r.host);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = initCaretStatus(rig().host);
    expect(again.text()).toBe("");
    again.refresh();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("CS9: host 가 망가져도 앱을 죽이지 않는다", async () => {
    const { initCaretStatus } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const broken = initCaretStatus({
      barEl: null as unknown as HTMLElement,
      editorEl: null as unknown as HTMLTextAreaElement,
    });

    expect(broken.text()).toBe("");
    expect(() => broken.refresh()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("CS10: lineStarts 를 안 넘기면 기본 계산을 쓴다", async () => {
    const { initCaretStatus } = await load();
    document.body.innerHTML = `<span id="bar"></span><textarea id="editor"></textarea>`;
    const barEl = document.getElementById("bar") as HTMLElement;
    const editorEl = document.getElementById("editor") as HTMLTextAreaElement;
    editorEl.value = "가\n나";
    editorEl.setSelectionRange(2, 2);

    initCaretStatus({ barEl, editorEl });

    expect(barEl.textContent).toBe("2행 1열");
  });
});
