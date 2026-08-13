import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "../src/imageUpload";

/** F-28 드롭·붙여넣기 배선 (이슈 #80). */

async function load(): Promise<typeof import("../src/editorDrop")> {
  vi.resetModules();
  return import("../src/editorDrop");
}

function fakeFile(name: string, type: string, size = 100): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function buildHost() {
  const editorEl = document.createElement("textarea");
  document.body.append(editorEl);

  const uploaded: string[] = [];
  const inserted: string[] = [];
  const notices: Array<{ message: string; kind?: string }> = [];
  const others: File[][] = [];

  return {
    editorEl,
    uploaded,
    inserted,
    notices,
    others,
    uploadImage: async (file: File) => {
      uploaded.push(file.name);
      return { url: `/i/abc.${file.type.split("/")[1]}` };
    },
    insertText: (_ta: HTMLTextAreaElement, text: string) => inserted.push(text),
    notify: (message: string, kind?: "info" | "error") => notices.push({ message, kind }),
    handleOtherFiles: (files: File[]) => {
      others.push(files);
      return true;
    },
  };
}

function dropFiles(el: HTMLElement, files: File[]): DragEvent {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"] },
  });
  el.dispatchEvent(event);
  return event;
}

function pasteFiles(el: HTMLElement, files: File[]): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  el.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("editorDrop — 이미지", () => {
  it("떨어뜨린 이미지를 올리고 마크다운을 넣는다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    dropFiles(host.editorEl, [fakeFile("사진.png", "image/png")]);
    await vi.waitFor(() => expect(host.inserted).toHaveLength(1));

    expect(host.uploaded).toEqual(["사진.png"]);
    expect(host.inserted[0]).toBe("![사진](/i/abc.png)");
  });

  it("붙여넣기도 같은 경로를 쓴다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    pasteFiles(host.editorEl, [fakeFile("clip.png", "image/png")]);
    await vi.waitFor(() => expect(host.inserted).toHaveLength(1));
  });

  it("업로드가 발생한다는 사실을 처음 한 번 알린다", async () => {
    // 이 앱은 공유를 빼면 네트워크를 타지 않는다. 사용자가 모르면 곤란하다.
    const { initEditorDrop } = await load();
    const host = buildHost();
    const controller = initEditorDrop(host);

    dropFiles(host.editorEl, [fakeFile("a.png", "image/png")]);
    await vi.waitFor(() => expect(host.inserted).toHaveLength(1));
    expect(controller.hasWarned()).toBe(true);
    expect(host.notices[0].message).toContain("업로드");

    const before = host.notices.length;
    dropFiles(host.editorEl, [fakeFile("b.png", "image/png")]);
    await vi.waitFor(() => expect(host.inserted).toHaveLength(2));
    expect(host.notices).toHaveLength(before);
  });

  it("SVG 는 거절하고 올리지 않는다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    dropFiles(host.editorEl, [fakeFile("도형.svg", "image/svg+xml")]);
    await vi.waitFor(() => expect(host.notices.length).toBeGreaterThan(0));

    expect(host.uploaded).toEqual([]);
    expect(host.inserted).toEqual([]);
    expect(host.notices[0].kind).toBe("error");
  });

  it("너무 큰 이미지는 올리지 않는다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    dropFiles(host.editorEl, [fakeFile("big.png", "image/png", MAX_IMAGE_BYTES + 1)]);
    await vi.waitFor(() => expect(host.notices.length).toBeGreaterThan(0));
    expect(host.uploaded).toEqual([]);
  });

  it("업로드 실패를 알리고 자리표시를 남기지 않는다", async () => {
    // 미리 넣어 두면 실패 시 지워야 하는데, 그 사이 사용자가 편집하면
    // 지울 자리를 잃는다.
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop({
      ...host,
      uploadImage: async () => {
        throw new Error("too-large");
      },
    });

    dropFiles(host.editorEl, [fakeFile("a.png", "image/png")]);
    await vi.waitFor(() => expect(host.notices.some((n) => n.kind === "error")).toBe(true));
    expect(host.inserted).toEqual([]);
  });

  it("여러 이미지를 순서대로 넣는다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    dropFiles(host.editorEl, [
      fakeFile("일.png", "image/png"),
      fakeFile("이.png", "image/png"),
    ]);
    await vi.waitFor(() => expect(host.inserted).toHaveLength(2));
    expect(host.uploaded).toEqual(["일.png", "이.png"]);
  });
});

describe("editorDrop — 분기", () => {
  it("이미지가 아닌 파일은 다른 처리기로 넘긴다 (F-56 연결점)", async () => {
    // 두 곳에서 drop 을 들으면 서로를 가린다 — 분기는 한 곳에서 한다.
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    const md = fakeFile("문서.md", "text/markdown");
    dropFiles(host.editorEl, [md]);

    expect(host.others).toEqual([[md]]);
    expect(host.uploaded).toEqual([]);
  });

  it("처리기가 없으면 알린다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop({ ...host, handleOtherFiles: undefined });

    dropFiles(host.editorEl, [fakeFile("문서.md", "text/markdown")]);
    expect(host.notices[0].kind).toBe("error");
  });

  it("이미지와 다른 파일이 섞이면 둘 다 처리한다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    dropFiles(host.editorEl, [
      fakeFile("사진.png", "image/png"),
      fakeFile("문서.md", "text/markdown"),
    ]);
    await vi.waitFor(() => expect(host.inserted).toHaveLength(1));
    expect(host.others).toHaveLength(1);
  });

  it("파일이 없는 드롭은 기본 동작에 맡긴다", async () => {
    // 텍스트 드래그는 브라우저가 알아서 넣는다.
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    const event = dropFiles(host.editorEl, []);
    expect(event.defaultPrevented).toBe(false);
  });

  it("이미지 없는 붙여넣기는 기본 동작에 맡긴다", async () => {
    const { initEditorDrop } = await load();
    const host = buildHost();
    initEditorDrop(host);

    const event = pasteFiles(host.editorEl, [fakeFile("a.txt", "text/plain")]);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("editorDrop — 초기화", () => {
  it("재호출은 무시되고 잘못된 host 로도 던지지 않는다", async () => {
    const { initEditorDrop } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    initEditorDrop(buildHost());
    initEditorDrop(buildHost());
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[editorDrop] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });
});
