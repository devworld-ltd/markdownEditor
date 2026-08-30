import { beforeEach, describe, expect, it, vi } from "vitest";
import type { initReloadUi as InitReloadUi, ReloadUiHost } from "../src/reloadUi";

/**
 * F-88 배너 + 대화상자. `<dialog>` 의 모달 동작은 jsdom 이 구현하지 않으므로
 * (`shortcutHelp.test.ts` 와 같은 이유) `showModal()`/`close()` 최소 스텁을
 * 얹어 열림/닫힘 **상태 전이**만 확인한다. 시각적 백드롭·포커스 이동은 E2E 가 본다.
 *
 * `reloadUi.ts` 는 `swUpdate.ts`/`shortcutHelp.ts` 와 같은 재진입 가드
 * (`initialized` 모듈 스코프 플래그)를 쓴다 — 그래서 테스트마다 모듈을
 * 새로 불러와야 두 번째 `initReloadUi()` 호출이 noop 이 되지 않는다.
 */
async function loadReloadUi(): Promise<{ initReloadUi: typeof InitReloadUi }> {
  vi.resetModules();
  return import("../src/reloadUi");
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

function buildHost(): ReloadUiHost & { onReloadClick: () => void; onKeepMineClick: () => void } {
  const bannerEl = document.createElement("div");
  const bannerTextEl = document.createElement("span");
  const bannerReloadEl = document.createElement("button");
  const bannerKeepEl = document.createElement("button");
  const bannerCloseEl = document.createElement("button");

  const confirmDialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(confirmDialogEl);
  const confirmTextEl = document.createElement("p");
  const confirmMetaEl = document.createElement("p");
  const confirmCancelEl = document.createElement("button");
  const confirmOkEl = document.createElement("button");

  const conflictDialogEl = document.createElement("dialog") as HTMLDialogElement;
  stubDialog(conflictDialogEl);
  const conflictTextEl = document.createElement("p");
  const conflictCancelEl = document.createElement("button");
  const conflictReloadEl = document.createElement("button");
  const conflictOverwriteEl = document.createElement("button");

  document.body.append(
    bannerEl,
    bannerTextEl,
    bannerReloadEl,
    bannerKeepEl,
    bannerCloseEl,
    confirmDialogEl,
    confirmTextEl,
    confirmMetaEl,
    confirmCancelEl,
    confirmOkEl,
    conflictDialogEl,
    conflictTextEl,
    conflictCancelEl,
    conflictReloadEl,
    conflictOverwriteEl,
  );

  return {
    bannerEl,
    bannerTextEl,
    bannerReloadEl,
    bannerKeepEl,
    bannerCloseEl,
    confirmDialogEl,
    confirmTextEl,
    confirmMetaEl,
    confirmCancelEl,
    confirmOkEl,
    conflictDialogEl,
    conflictTextEl,
    conflictCancelEl,
    conflictReloadEl,
    conflictOverwriteEl,
    onReloadClick: () => {},
    onKeepMineClick: () => {},
  };
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("reloadUi — 배너", () => {
  it("showBanner 는 파일명을 포함한 문구를 보이고, hideBanner 는 숨긴다", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    ui.showBanner("note.md");
    expect(host.bannerEl.hidden).toBe(false);
    expect(host.bannerTextEl.textContent).toContain("note.md");
    expect(host.bannerTextEl.textContent).toContain("디스크에서 변경되었습니다");

    ui.hideBanner();
    expect(host.bannerEl.hidden).toBe(true);
  });

  it("배너의 다시 읽기/내 내용 유지/× 클릭이 각각의 콜백을 부른다", async () => {
    const { initReloadUi } = await loadReloadUi();
    let reloadClicked = 0;
    let keepClicked = 0;
    const host = buildHost();
    host.onReloadClick = () => reloadClicked++;
    host.onKeepMineClick = () => keepClicked++;
    initReloadUi(host);

    host.bannerReloadEl.click();
    expect(reloadClicked).toBe(1);

    host.bannerKeepEl.click();
    expect(keepClicked).toBe(1);

    host.bannerCloseEl.click(); // I-10: × 는 "내 내용 유지"와 동일
    expect(keepClicked).toBe(2);
  });
});

describe("reloadUi — 재읽기 확인 대화상자 (파괴적, D-6)", () => {
  it("확인을 누르면 true 로 resolve 한다", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    const promise = ui.confirmReload({ fileName: "note.md", diskModifiedAt: 1700000000000 });
    expect(host.confirmDialogEl.open).toBe(true);
    expect(host.confirmTextEl.textContent).toContain("note.md");
    expect(host.confirmMetaEl.textContent).toContain("디스크 최종 수정");

    host.confirmOkEl.click();
    expect(await promise).toBe(true);
    expect(host.confirmDialogEl.open).toBe(false);
  });

  it("취소를 누르면 false 로 resolve 한다", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    const promise = ui.confirmReload({ fileName: "note.md", diskModifiedAt: null });
    host.confirmCancelEl.click();

    expect(await promise).toBe(false);
  });

  it("Esc(반환값 없이 닫힘)도 취소와 같이 false 로 resolve 한다", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    const promise = ui.confirmReload({ fileName: "note.md", diskModifiedAt: null });
    // Esc 는 returnValue 를 "ok" 로 설정하지 않고 그냥 close() 한다.
    host.confirmDialogEl.close();

    expect(await promise).toBe(false);
  });

  it("기본 포커스는 취소 버튼이다 (D-6: 파괴적 동작이 Enter 한 번에 일어나면 안 된다)", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    void ui.confirmReload({ fileName: "note.md", diskModifiedAt: null });
    expect(document.activeElement).toBe(host.confirmCancelEl);
  });
});

describe("reloadUi — 저장 충돌 대화상자 (S-1)", () => {
  it("취소/다시 읽기/덮어쓰기 세 갈래를 그대로 돌려준다", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    const p1 = ui.confirmSaveConflict({ fileName: "a.md", diskModifiedAt: null });
    host.conflictCancelEl.click();
    expect(await p1).toBe("cancel");

    const p2 = ui.confirmSaveConflict({ fileName: "a.md", diskModifiedAt: null });
    host.conflictReloadEl.click();
    expect(await p2).toBe("reload");

    const p3 = ui.confirmSaveConflict({ fileName: "a.md", diskModifiedAt: null });
    host.conflictOverwriteEl.click();
    expect(await p3).toBe("overwrite");
  });

  it("기본 포커스는 취소 버튼이다", async () => {
    const { initReloadUi } = await loadReloadUi();
    const host = buildHost();
    const ui = initReloadUi(host);

    void ui.confirmSaveConflict({ fileName: "a.md", diskModifiedAt: null });
    expect(document.activeElement).toBe(host.conflictCancelEl);
  });
});
