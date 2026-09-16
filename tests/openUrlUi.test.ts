import { beforeEach, describe, expect, it, vi } from "vitest";
import type { initOpenUrlUi as InitOpenUrlUi, OpenUrlUiHost } from "../src/openUrlUi";

/**
 * F-90/F-91 확인 대화상자 — 가짜 host 객체(이슈 #195).
 *
 * jsdom 한계(트랩 #57): `showModal()` 의 inert·포커스 트랩은 jsdom 이 구현하지
 * 않는다. **기본 포커스가 취소인지 · 바깥이 inert 인지 · Esc 가 실제로 닫는지는
 * E2E 가 맡는다.** 여기서는 `showModal`/`close` 최소 스텁을 얹어 열림/닫힘
 * **상태 전이**와 콜백 시점만 확인한다(`reloadUi.test.ts` 와 같은 패턴).
 */
async function loadOpenUrlUi(): Promise<{ initOpenUrlUi: typeof InitOpenUrlUi }> {
  vi.resetModules();
  return import("../src/openUrlUi");
}

function stubDialog(dialogEl: HTMLDialogElement): void {
  dialogEl.showModal = () => {
    dialogEl.open = true;
  };
  dialogEl.close = (returnValue?: string) => {
    dialogEl.open = false;
    if (returnValue !== undefined) dialogEl.returnValue = returnValue;
    dialogEl.dispatchEvent(new Event("close"));
  };
}

function buildHost(): OpenUrlUiHost {
  const dialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(dialogEl);
  const titleEl = document.createElement("h2");
  const bodyEl = document.createElement("p");
  const targetEl = document.createElement("p");
  const cancelEl = document.createElement("button");
  const confirmEl = document.createElement("button");
  const returnFocusTo = document.createElement("textarea");

  document.body.append(dialogEl, titleEl, bodyEl, targetEl, cancelEl, confirmEl, returnFocusTo);

  return { dialogEl, titleEl, bodyEl, targetEl, cancelEl, confirmEl, returnFocusTo };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("confirmRemote", () => {
  it("주소를 textContent 로만 넣는다 — 태그가 생기지 않는다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);

    ui.confirmRemote(
      { url: '<img src=x onerror="window.__x=1">', host: "raw.test" },
      () => {},
    );

    expect(host.targetEl.innerHTML).not.toContain("<img");
    expect(host.targetEl.textContent).toBe('<img src=x onerror="window.__x=1">');
  });

  it("본문에 호스트가 노출된다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, () => {});
    expect(host.bodyEl.textContent).toContain("raw.test");
    expect(host.dialogEl.open).toBe(true);
  });

  it("onConfirm 이 '열기' 클릭 핸들러의 동기 프레임에서 불린다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);
    let calledSynchronously = false;

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, () => {
      calledSynchronously = true;
    });

    host.confirmEl.click();
    // await 가 전혀 없다 — 클릭 직후 즉시 참이어야 한다.
    expect(calledSynchronously).toBe(true);
  });

  it("취소 클릭은 onConfirm 을 부르지 않고 onCancel 을 부른다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, onConfirm, onCancel);
    host.cancelEl.click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(host.dialogEl.open).toBe(false);
  });

  it("cancel 이벤트(Esc 를 흉내낸 close)도 onConfirm 을 부르지 않는다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, onConfirm, onCancel);
    // 브라우저는 Esc 를 누르면 close()를 호출한다 — 여기서는 그 결과만 흉내낸다.
    host.dialogEl.close();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("닫힌 뒤 returnFocusTo 로 포커스가 돌아간다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const focusSpy = vi.spyOn(host.returnFocusTo!, "focus");
    const ui = initOpenUrlUi(host);

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, () => {});
    host.cancelEl.click();

    expect(focusSpy).toHaveBeenCalled();
  });

  it("재진입 — 이미 열려 있으면 두 번째 confirmRemote 는 무시된다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);
    const firstConfirm = vi.fn();
    const secondConfirm = vi.fn();

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, firstConfirm);
    ui.confirmRemote({ url: "https://other.test/b.md", host: "other.test" }, secondConfirm);

    expect(host.bodyEl.textContent).toContain("raw.test");
    expect(host.bodyEl.textContent).not.toContain("other.test");

    host.confirmEl.click();
    expect(firstConfirm).toHaveBeenCalledTimes(1);
    expect(secondConfirm).not.toHaveBeenCalled();
  });
});

describe("confirmLocal", () => {
  it("로컬 모드는 주소 상자를 비우고 숨긴다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);

    ui.confirmLocal(() => {});
    expect(host.targetEl.textContent).toBe("");
    expect(host.targetEl.hidden).toBe(true);
    expect(host.confirmEl.textContent).toContain("파일 선택");
  });

  it("모드 전환 — confirmRemote 뒤 confirmLocal 을 열어도 이전 주소가 남지 않는다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);

    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, () => {});
    host.cancelEl.click(); // 닫아야 재진입 가드에 걸리지 않는다

    ui.confirmLocal(() => {});
    expect(host.targetEl.textContent).toBe("");
    expect(host.bodyEl.textContent).not.toContain("raw.test");
  });

  it("'파일 선택' 클릭이 onConfirm 을 동기적으로 부른다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);
    let called = false;

    ui.confirmLocal(() => {
      called = true;
    });
    host.confirmEl.click();

    expect(called).toBe(true);
  });

  it("취소는 onConfirm 을 부르지 않는다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);
    const onConfirm = vi.fn();

    ui.confirmLocal(onConfirm);
    host.cancelEl.click();

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("isOpen", () => {
  it("열림 상태를 그대로 보고한다", async () => {
    const { initOpenUrlUi } = await loadOpenUrlUi();
    const host = buildHost();
    const ui = initOpenUrlUi(host);

    expect(ui.isOpen()).toBe(false);
    ui.confirmRemote({ url: "https://raw.test/a.md", host: "raw.test" }, () => {});
    expect(ui.isOpen()).toBe(true);
    host.cancelEl.click();
    expect(ui.isOpen()).toBe(false);
  });
});
