import { beforeEach, describe, expect, it, vi } from "vitest";

import { initTableUi, type TableUiHost } from "../src/tableUi";

/**
 * `initTableUi` 는 모듈 단위 `initialized` 플래그로 재초기화를 막는다.
 * 테스트마다 새 모듈 인스턴스를 얻기 위해 동적 import + `resetModules` 를 쓴다.
 */
async function freshInit(host: TableUiHost) {
  vi.resetModules();
  const mod = await import("../src/tableUi");
  return mod.initTableUi(host);
}

function makeHost(value: string, cursor = 0): TableUiHost & {
  notify: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = `
    <dialog id="d">
      <div id="insert"></div>
      <input id="rows" type="number" value="2" />
      <input id="cols" type="number" value="2" />
      <div id="edit"></div>
      <div id="align"></div>
      <button id="submit"></button>
      <button id="close"></button>
    </dialog>
    <textarea id="editor"></textarea>
  `;

  const dialogEl = document.querySelector<HTMLDialogElement>("#d")!;
  // jsdom 은 <dialog> 를 구현하지 않는다 — 열림 여부만 흉내 낸다.
  dialogEl.showModal = function () {
    this.open = true;
  };
  dialogEl.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  dialogEl.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 100, bottom: 100 }) as DOMRect;

  const editorEl = document.querySelector<HTMLTextAreaElement>("#editor")!;
  editorEl.value = value;
  editorEl.setSelectionRange(cursor, cursor);

  // jsdom 에 execCommand 가 없다. 실제 브라우저 동작(선택 범위 치환)을 흉내 낸다.
  document.execCommand = ((_cmd: string, _ui: boolean, text: string) => {
    const { selectionStart, selectionEnd } = editorEl;
    editorEl.value =
      editorEl.value.slice(0, selectionStart) +
      text +
      editorEl.value.slice(selectionEnd);
    const caret = selectionStart + text.length;
    editorEl.setSelectionRange(caret, caret);
    return true;
  }) as typeof document.execCommand;

  return {
    dialogEl,
    insertEl: document.querySelector<HTMLElement>("#insert")!,
    rowsEl: document.querySelector<HTMLInputElement>("#rows")!,
    columnsEl: document.querySelector<HTMLInputElement>("#cols")!,
    editEl: document.querySelector<HTMLElement>("#edit")!,
    alignEl: document.querySelector<HTMLElement>("#align")!,
    submitEl: document.querySelector<HTMLButtonElement>("#submit")!,
    closeEl: document.querySelector<HTMLElement>("#close")!,
    editorEl,
    notify: vi.fn(),
  };
}

const TABLE = "| 이름 | 값 |\n| --- | --- |\n| 한글 | 1 |";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("모드 판정", () => {
  it("커서가 표 밖이면 삽입 모드다", async () => {
    const host = makeHost("문단");
    const c = await freshInit(host);
    c.open();
    expect(c.mode()).toBe("insert");
    expect(host.insertEl.hidden).toBe(false);
    expect(host.editEl.hidden).toBe(true);
    expect(host.submitEl.textContent).toBe("표 삽입");
  });

  it("커서가 표 안이면 편집 모드다", async () => {
    const host = makeHost(TABLE, 3);
    const c = await freshInit(host);
    c.open();
    expect(c.mode()).toBe("edit");
    expect(host.editEl.hidden).toBe(false);
    expect(host.insertEl.hidden).toBe(true);
    expect(host.submitEl.textContent).toBe("정렬 맞추기");
  });

  it("열 때마다 다시 판단한다 — 커서는 그새 움직인다", async () => {
    const host = makeHost(`${TABLE}\n\n문단`, 3);
    const c = await freshInit(host);
    c.open();
    expect(c.mode()).toBe("edit");
    c.close();

    host.editorEl.setSelectionRange(host.editorEl.value.length, host.editorEl.value.length);
    c.open();
    expect(c.mode()).toBe("insert");
  });
});

describe("삽입", () => {
  it("행·열 수대로 표를 넣는다", async () => {
    const host = makeHost("");
    const c = await freshInit(host);
    c.open();
    host.submitEl.click();

    const lines = host.editorEl.value.trim().split("\n");
    expect(lines).toHaveLength(4); // 헤더 + 구분선 + 본문 2
    expect(host.editorEl.value).toContain("| 제목 1 | 제목 2 |");
  });

  it("본문 바로 뒤라면 빈 줄을 넣는다 — 없으면 표로 읽히지 않는다", async () => {
    const host = makeHost("문단", 2);
    const c = await freshInit(host);
    c.open();
    host.submitEl.click();
    expect(host.editorEl.value).toMatch(/^문단\n\n\|/);
  });

  it("이미 빈 줄이면 더 넣지 않는다", async () => {
    const host = makeHost("문단\n\n", 6);
    const c = await freshInit(host);
    c.open();
    host.submitEl.click();
    expect(host.editorEl.value).toMatch(/^문단\n\n\|/);
  });

  it("입력 이벤트를 쏴서 프리뷰가 갱신되게 한다", async () => {
    const host = makeHost("");
    const c = await freshInit(host);
    const onInput = vi.fn();
    host.editorEl.addEventListener("input", onInput);
    c.open();
    host.submitEl.click();
    expect(onInput).toHaveBeenCalled();
  });

  it("삽입 후 대화상자를 닫는다", async () => {
    const host = makeHost("");
    const c = await freshInit(host);
    c.open();
    host.submitEl.click();
    expect(c.isOpen()).toBe(false);
  });
});

describe("편집", () => {
  it("열마다 정렬 버튼 세 개를 만든다", async () => {
    const host = makeHost(TABLE, 3);
    const c = await freshInit(host);
    c.open();
    expect(host.alignEl.querySelectorAll(".table-align-btn")).toHaveLength(6);
  });

  it("현재 정렬을 aria-pressed 로 알린다 — 색만으로는 전달되지 않는다", async () => {
    const host = makeHost("| a | b |\n| --- | ---: |\n| 1 | 2 |", 3);
    const c = await freshInit(host);
    c.open();
    const pressed = [...host.alignEl.querySelectorAll<HTMLElement>('[aria-pressed="true"]')];
    expect(pressed.map((el) => el.dataset.align)).toEqual(["left", "right"]);
  });

  it("정렬을 바꾸면 구분선에 반영된다", async () => {
    const host = makeHost(TABLE, 3);
    const c = await freshInit(host);
    c.open();
    host.alignEl
      .querySelector<HTMLElement>('[data-column="0"][data-align="center"]')!
      .click();
    host.submitEl.click();
    expect(host.editorEl.value.split("\n")[1]).toMatch(/^\| :-+: \|/);
  });

  it("제목이 없는 열은 위치로 부른다", async () => {
    const host = makeHost("|  | b |\n| --- | --- |\n| 1 | 2 |", 2);
    const c = await freshInit(host);
    c.open();
    expect(host.alignEl.textContent).toContain("1번째 열");
  });

  it("표만 갈아 끼우고 앞뒤 본문은 건드리지 않는다", async () => {
    const host = makeHost(`앞 문단\n\n${TABLE}\n\n뒤 문단`);
    host.editorEl.setSelectionRange(12, 12);
    const c = await freshInit(host);
    c.open();
    expect(c.mode()).toBe("edit");
    host.submitEl.click();

    expect(host.editorEl.value).toMatch(/^앞 문단\n\n/);
    expect(host.editorEl.value).toMatch(/\n\n뒤 문단$/);
    // 구분선이 최소 세 칸이라 "값"(두 칸) 뒤에 공백이 하나 붙는다.
    expect(host.editorEl.value).toContain("| 이름 | 값  |");
  });

  it("정렬 후 알림을 남긴다", async () => {
    const host = makeHost(TABLE, 3);
    const c = await freshInit(host);
    c.open();
    host.submitEl.click();
    expect(host.notify).toHaveBeenCalled();
  });
});

describe("견고함", () => {
  it("초기화 실패해도 앱을 멈추지 않는다", async () => {
    vi.resetModules();
    const mod = await import("../src/tableUi");
    const c = mod.initTableUi(null as unknown as TableUiHost);
    expect(() => c.open()).not.toThrow();
    expect(c.isOpen()).toBe(false);
  });

  it("두 번 초기화하면 두 번째는 무시한다", async () => {
    const host = makeHost("");
    vi.resetModules();
    const mod = await import("../src/tableUi");
    mod.initTableUi(host);
    const second = mod.initTableUi(host);
    second.open();
    expect(second.isOpen()).toBe(false);
  });
});
