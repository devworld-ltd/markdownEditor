import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestFileName } from "../src/fileOps";
import type { FileOpsHost } from "../src/fileOps";

describe("suggestFileName", () => {
  it("UNTITLED 이면 Untitled.md 를 제안한다", () => {
    expect(suggestFileName("Untitled")).toBe("Untitled.md");
  });

  it("공백 문자열이면 Untitled.md 를 제안한다", () => {
    expect(suggestFileName("   ")).toBe("Untitled.md");
  });

  it("빈 문자열이면 Untitled.md 를 제안한다", () => {
    expect(suggestFileName("")).toBe("Untitled.md");
  });

  it(".md 확장자는 그대로 유지한다", () => {
    expect(suggestFileName("notes.md")).toBe("notes.md");
  });

  it(".markdown 확장자는 그대로 유지한다", () => {
    expect(suggestFileName("notes.markdown")).toBe("notes.markdown");
  });

  it(".txt 확장자는 그대로 유지한다", () => {
    expect(suggestFileName("notes.txt")).toBe("notes.txt");
  });

  it("대소문자가 섞인 확장자(.MD)도 인식해 그대로 유지한다", () => {
    expect(suggestFileName("notes.MD")).toBe("notes.MD");
  });

  it("확장자가 없으면 .md 를 붙인다", () => {
    expect(suggestFileName("notes")).toBe("notes.md");
  });

  it("지원하지 않는 확장자면 .md 를 덧붙인다", () => {
    expect(suggestFileName("notes.doc")).toBe("notes.doc.md");
  });
});

/**
 * `fileOps.ts` 는 `tabs.ts`/`notice.ts` 를 import 하는 non-leaf 모듈이다(주입
 * 경계 설계 근거는 src/fileOps.ts 상단 FileOpsHost 주석 참고). tabs.ts 와 동일하게
 * 모듈 스코프 싱글턴(`host`, `editorEl`, `fileInputEl`)을 쓰므로 `tabs.test.ts` 의
 * `loadTabs()` 패턴을 따라 매 테스트마다 `vi.resetModules()` 로 새로 로드하고,
 * fileOps 가 내부적으로 쓰는 tabs/notice 인스턴스를 공유하려면 같은 모듈
 * 레지스트리에서 동적 import 해야 한다(정적 import 는 리셋 이전 인스턴스를 잡는다).
 */
async function loadFileOps(): Promise<{
  fileOps: typeof import("../src/fileOps");
  tabs: typeof import("../src/tabs");
  notice: typeof import("../src/notice");
}> {
  vi.resetModules();
  const fileOps = await import("../src/fileOps");
  const tabs = await import("../src/tabs");
  const notice = await import("../src/notice");
  return { fileOps, tabs, notice };
}

interface Dom {
  tabBar: HTMLElement;
  editor: HTMLTextAreaElement;
  preview: HTMLElement;
  title: HTMLElement;
  notice: HTMLElement;
}

function createDom(): Dom {
  document.body.innerHTML = `
    <div id="tab-bar"></div>
    <textarea id="editor"></textarea>
    <div id="preview"></div>
    <div id="title"></div>
    <div id="notice" hidden></div>
  `;
  return {
    tabBar: document.querySelector<HTMLElement>("#tab-bar")!,
    editor: document.querySelector<HTMLTextAreaElement>("#editor")!,
    preview: document.querySelector<HTMLElement>("#preview")!,
    title: document.querySelector<HTMLElement>("#title")!,
    notice: document.querySelector<HTMLElement>("#notice")!,
  };
}

/** 가짜 FileSystemFileHandle. write 성공/실패, isSameEntry 판정을 자유롭게 흉내낸다. */
function makeHandle(overrides: Record<string, unknown> = {}) {
  return {
    name: "handle.md",
    getFile: vi.fn(async () => new File(["원격 내용"], "handle.md")),
    isSameEntry: vi.fn(async () => false),
    createWritable: vi.fn(async () => ({
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    })),
    ...overrides,
  };
}

function abortError(): DOMException {
  return new DOMException("취소됨", "AbortError");
}

/** 개발 편의를 위한 부분 host — 명시하지 않은 필드는 setFileOpsHost() 기본값을 쓴다. */
function makeHost(overrides: Partial<FileOpsHost>): Partial<FileOpsHost> {
  return overrides;
}

async function setUp() {
  const { fileOps, tabs, notice } = await loadFileOps();
  const dom = createDom();
  notice.initNotice(dom.notice);
  tabs.initTabs(dom.tabBar, dom.editor, dom.preview, dom.title);
  fileOps.initFileOps(dom.editor);
  return { fileOps, tabs, notice, dom };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openFile", () => {
  it("FS Access 지원 시 picker 를 연다(업로드 input 은 클릭하지 않는다)", async () => {
    const { fileOps, dom } = await setUp();
    const showOpenFilePicker = vi.fn(async () => [makeHandle()]);
    fileOps.setFileOpsHost(
      makeHost({ isSupported: () => true, showOpenFilePicker }),
    );
    const clickSpy = vi.spyOn(
      document.querySelector<HTMLInputElement>("#file-input")!,
      "click",
    );

    await fileOps.openFile();

    expect(showOpenFilePicker).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(dom).toBeTruthy();
  });

  it("FS Access 미지원 시 숨김 file input 을 클릭한다(picker 는 호출 안 함)", async () => {
    const { fileOps } = await setUp();
    const showOpenFilePicker = vi.fn();
    fileOps.setFileOpsHost(
      makeHost({ isSupported: () => false, showOpenFilePicker }),
    );
    const input = document.querySelector<HTMLInputElement>("#file-input")!;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => undefined);

    await fileOps.openFile();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(showOpenFilePicker).not.toHaveBeenCalled();
  });
});

describe("openViaFileSystemAccess (openFile 경유)", () => {
  it("새 파일이면 새 탭으로 연다", async () => {
    const { fileOps, tabs } = await setUp();
    const handle = makeHandle({
      getFile: vi.fn(async () => new File(["# 본문"], "new.md")),
    });
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => true,
        showOpenFilePicker: vi.fn(async () => [handle]),
      }),
    );

    await fileOps.openFile();

    expect(tabs.getAllTabs()).toHaveLength(2);
    expect(tabs.getActiveTab()!.fileName).toBe("new.md");
    expect(tabs.getActiveTab()!.handle).toBe(handle);
  });

  it("이미 열려 있는 핸들이면 새 탭 대신 기존 탭으로 전환한다", async () => {
    const { fileOps, tabs } = await setUp();
    const handle = makeHandle();
    // 먼저 열어서 tab-2 를 handle 소유 탭으로 만든다.
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => true,
        showOpenFilePicker: vi.fn(async () => [handle]),
      }),
    );
    await fileOps.openFile();
    const openedId = tabs.getActiveTab()!.id;
    // 다른 탭으로 옮겨 둔다.
    tabs.createTab("세번째");
    expect(tabs.getActiveTab()!.id).not.toBe(openedId);

    // isSameEntry 가 이번엔 대상 핸들과 일치한다고 답하도록 재설정.
    handle.isSameEntry = vi.fn(async () => true);
    await fileOps.openFile();

    expect(tabs.getAllTabs()).toHaveLength(3); // 새 탭이 생기지 않았다.
    expect(tabs.getActiveTab()!.id).toBe(openedId);
  });

  it("AbortError 는 조용히 무시한다(알림 없음, 새 탭 없음)", async () => {
    const { fileOps, tabs, dom } = await setUp();
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => true,
        showOpenFilePicker: vi.fn(async () => {
          throw abortError();
        }),
      }),
    );

    await fileOps.openFile();

    expect(tabs.getAllTabs()).toHaveLength(1);
    expect(dom.notice.hidden).toBe(true);
  });

  it("그 외 오류는 오류 알림을 띄운다", async () => {
    const { fileOps, tabs, dom } = await setUp();
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => true,
        showOpenFilePicker: vi.fn(async () => {
          throw new Error("디스크 오류");
        }),
      }),
    );

    await fileOps.openFile();

    expect(tabs.getAllTabs()).toHaveLength(1);
    expect(dom.notice.hidden).toBe(false);
    expect(dom.notice.dataset.kind).toBe("error");
    expect(dom.notice.textContent).toContain("파일을 열지 못했습니다");
    expect(dom.notice.textContent).toContain("디스크 오류");
  });
});

describe("openViaUpload (file input 경유, 폴백 모드)", () => {
  function selectFile(input: HTMLInputElement, file: File): void {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new Event("change"));
  }

  it("정상 업로드는 새 탭으로 연다", async () => {
    const { fileOps, tabs } = await setUp();
    fileOps.setFileOpsHost(makeHost({ isSupported: () => false }));
    const input = document.querySelector<HTMLInputElement>("#file-input")!;
    const file = new File(["업로드 본문"], "uploaded.md");

    selectFile(input, file);
    await vi.waitFor(() => expect(tabs.getAllTabs()).toHaveLength(2));

    expect(tabs.getActiveTab()!.fileName).toBe("uploaded.md");
    expect(tabs.getActiveTab()!.handle).toBeNull();
  });

  it("file.text() 실패는 오류 알림을 띄운다(새 탭 없음)", async () => {
    const { fileOps, tabs, dom } = await setUp();
    fileOps.setFileOpsHost(makeHost({ isSupported: () => false }));
    const input = document.querySelector<HTMLInputElement>("#file-input")!;
    const file = new File(["무시됨"], "broken.md");
    file.text = vi.fn(async () => {
      throw new Error("읽기 실패");
    });

    selectFile(input, file);
    await vi.waitFor(() => expect(dom.notice.hidden).toBe(false));

    expect(tabs.getAllTabs()).toHaveLength(1);
    expect(dom.notice.dataset.kind).toBe("error");
    expect(dom.notice.textContent).toContain("파일을 읽지 못했습니다");
  });
});

describe("saveFile", () => {
  it("활성 탭이 없으면 아무 일도 하지 않는다", async () => {
    // tabs.initTabs() 를 호출하지 않아 활성 탭이 없는 상태를 그대로 재현한다.
    const { fileOps, notice } = await loadFileOps();
    const dom = createDom();
    notice.initNotice(dom.notice);
    fileOps.initFileOps(dom.editor);
    const showSaveFilePicker = vi.fn();
    fileOps.setFileOpsHost(makeHost({ showSaveFilePicker }));

    await expect(fileOps.saveFile()).resolves.toBeUndefined();

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(dom.notice.hidden).toBe(true);
  });

  it("핸들이 있으면 대화상자 없이 writeToHandle 로 덮어쓴다", async () => {
    const { fileOps, tabs, dom } = await setUp();
    const handle = makeHandle();
    tabs.updateActiveTab({ handle, fileName: "doc.md" });
    dom.editor.value = "수정된 본문";
    const showSaveFilePicker = vi.fn();
    fileOps.setFileOpsHost(makeHost({ showSaveFilePicker }));

    await fileOps.saveFile();

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(handle.createWritable).toHaveBeenCalledTimes(1);
    expect(tabs.getActiveTab()!.isDirty).toBe(false);
    expect(dom.notice.textContent).toContain("doc.md 에 저장했습니다");
  });

  it("핸들이 없으면 saveFileAs 로 넘어가 저장 위치를 묻는다", async () => {
    const { fileOps, tabs, dom } = await setUp();
    dom.editor.value = "새 문서 본문";
    const handle = makeHandle({ name: "새문서.md" });
    const showSaveFilePicker = vi.fn(async () => handle);
    fileOps.setFileOpsHost(
      makeHost({ isSupported: () => true, showSaveFilePicker }),
    );

    await fileOps.saveFile();

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(tabs.getActiveTab()!.handle).toBe(handle);
    expect(dom.notice.textContent).toContain("새문서.md 에 저장했습니다");
  });
});

describe("saveFileAs", () => {
  it("FS Access 미지원이면 다운로드로 대체하고 dirty 를 해제한다", async () => {
    const { fileOps, tabs, dom } = await setUp();
    dom.editor.value = "다운로드될 본문";
    const anchor = document.createElement("a");
    const clickSpy = vi.spyOn(anchor, "click").mockImplementation(() => undefined);
    const createBlob = vi.fn((content: string, type: string) => new Blob([content], { type }));
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => false,
        createBlob,
        createObjectURL,
        revokeObjectURL,
        createAnchor: () => anchor,
        appendToBody: vi.fn(),
      }),
    );

    await fileOps.saveFileAs();

    expect(createBlob).toHaveBeenCalledWith("다운로드될 본문", "text/markdown;charset=utf-8");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    expect(anchor.download).toBe("Untitled.md");
    expect(tabs.getActiveTab()!.isDirty).toBe(false);
    expect(tabs.getActiveTab()!.fileName).toBe("Untitled.md");
    expect(dom.notice.textContent).toContain("내려받았습니다");
  });

  it("FS Access 지원이면 picker 로 저장 위치를 물은 뒤 기록한다(핸들이 있어도 다시 묻는다)", async () => {
    const { fileOps, tabs, dom } = await setUp();
    const oldHandle = makeHandle({ name: "old.md" });
    tabs.updateActiveTab({ handle: oldHandle, fileName: "old.md" });
    dom.editor.value = "본문";
    const newHandle = makeHandle({ name: "사본.md" });
    const showSaveFilePicker = vi.fn(async () => newHandle);
    fileOps.setFileOpsHost(
      makeHost({ isSupported: () => true, showSaveFilePicker }),
    );

    await fileOps.saveFileAs();

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(tabs.getActiveTab()!.handle).toBe(newHandle);
    expect(tabs.getActiveTab()!.fileName).toBe("사본.md");
    expect(dom.notice.textContent).toContain("사본.md 에 저장했습니다");
  });

  it("AbortError 는 조용히 무시한다", async () => {
    const { fileOps, dom } = await setUp();
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => true,
        showSaveFilePicker: vi.fn(async () => {
          throw abortError();
        }),
      }),
    );

    await fileOps.saveFileAs();

    expect(dom.notice.hidden).toBe(true);
  });

  it("그 외 오류는 오류 알림을 띄운다", async () => {
    const { fileOps, dom } = await setUp();
    fileOps.setFileOpsHost(
      makeHost({
        isSupported: () => true,
        showSaveFilePicker: vi.fn(async () => {
          throw new Error("권한 없음");
        }),
      }),
    );

    await fileOps.saveFileAs();

    expect(dom.notice.hidden).toBe(false);
    expect(dom.notice.dataset.kind).toBe("error");
    expect(dom.notice.textContent).toContain("저장하지 못했습니다");
    expect(dom.notice.textContent).toContain("권한 없음");
  });
});

describe("writeToHandle (saveFile/saveFileAs 경유)", () => {
  it("성공 시 dirty 를 해제하고 성공 알림을 띄운다", async () => {
    const { fileOps, tabs, dom } = await setUp();
    const handle = makeHandle();
    tabs.updateActiveTab({ handle, fileName: "ok.md" });
    tabs.markActiveTabDirty();
    dom.editor.value = "저장될 내용";

    await fileOps.saveFile();

    expect(tabs.getActiveTab()!.isDirty).toBe(false);
    expect(dom.notice.hidden).toBe(false);
    expect(dom.notice.dataset.kind).not.toBe("error");
    expect(dom.notice.textContent).toContain("ok.md 에 저장했습니다");
  });

  it("AbortError 는 조용히 무시하고 dirty 를 건드리지 않는다", async () => {
    const { fileOps, tabs, dom } = await setUp();
    const handle = makeHandle({
      createWritable: vi.fn(async () => {
        throw abortError();
      }),
    });
    tabs.updateActiveTab({ handle, fileName: "cancel.md" });
    tabs.markActiveTabDirty();

    await fileOps.saveFile();

    expect(tabs.getActiveTab()!.isDirty).toBe(true);
    expect(dom.notice.hidden).toBe(true);
  });

  it("쓰기 실패 시 dirty 를 유지하고 오류 알림을 띄운다(저장 안 된 문서를 저장된 것으로 표시하지 않는다)", async () => {
    const { fileOps, tabs, dom } = await setUp();
    const handle = makeHandle({
      createWritable: vi.fn(async () => {
        throw new Error("디스크 가득 참");
      }),
    });
    tabs.updateActiveTab({ handle, fileName: "fail.md" });
    tabs.markActiveTabDirty();

    await fileOps.saveFile();

    expect(tabs.getActiveTab()!.isDirty).toBe(true);
    expect(dom.notice.hidden).toBe(false);
    expect(dom.notice.dataset.kind).toBe("error");
    expect(dom.notice.textContent).toContain("저장하지 못했습니다");
    expect(dom.notice.textContent).toContain("디스크 가득 참");
  });
});
