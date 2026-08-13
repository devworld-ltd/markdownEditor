/**
 * F-28 이미지 드롭·붙여넣기 (이슈 #80).
 *
 * **드롭 처리는 이 한 곳에서만 한다.** 두 곳에서 `drop` 을 들으면 서로를 가려
 * 어느 쪽이 이길지 예측할 수 없다. F-56(마크다운 파일 열기)도 여기서 분기한다.
 *
 * ## 업로드가 발생한다는 사실을 숨기지 않는다
 *
 * 이 앱은 공유(F-60)를 빼면 네트워크를 타지 않는다. 이미지를 넣는 순간 **로컬
 * 편집에도 업로드가 생긴다** — 사용자가 모르면 곤란한 종류의 변화라, 처음 한 번은
 * 그 사실을 알린다.
 */

import { classifyDropped, rejectionMessage } from "./dropFiles";
import { altFromFileName, imageErrorMessage, imageMarkdown, validateImage } from "./imageUpload";

/**
 * 떨어진 문서 하나. **핸들이 붙어 있으면 그 파일에 바로 저장할 수 있다** —
 * 드롭으로 연 문서가 "다른 이름으로 저장" 만 되면, 파일을 끌어다 놓고 고친 뒤
 * 저장하는 가장 자연스러운 흐름이 끊긴다 (F-56).
 */
export interface DroppedDocument {
  file: File;
  /** FS Access API 가 있을 때만. 없으면 null. */
  handle: FileSystemFileHandle | null;
}

export interface EditorDropHost {
  editorEl: HTMLTextAreaElement;
  /** 이미지를 업로드하고 URL 을 돌려준다. */
  uploadImage: (file: File) => Promise<{ url: string }>;
  /** 커서 자리에 텍스트를 넣는다 (undo 보존). */
  insertText: (textarea: HTMLTextAreaElement, text: string) => void;
  notify?: (message: string, kind?: "info" | "error") => void;
  /**
   * 이미지가 아닌 문서가 떨어졌을 때 (F-56). 처리했으면 true.
   * 핸들은 드롭 이벤트가 살아 있는 동안에만 얻을 수 있어 여기서 같이 넘긴다.
   */
  handleOtherFiles?: (documents: DroppedDocument[]) => boolean;
}

export interface EditorDropController {
  /** 업로드 안내를 이미 보여줬는가 (세션당 1회). */
  hasWarned(): boolean;
}

const noopController: EditorDropController = { hasWarned: () => false };

let initialized = false;

export function initEditorDrop(host: EditorDropHost): EditorDropController {
  if (initialized) {
    console.warn("[editorDrop] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { editorEl } = host;
    let warned = false;

    function warnOnce(): void {
      if (warned) return;
      warned = true;
      host.notify?.(
        "이미지는 서버에 업로드되어 링크로 삽입됩니다. 링크를 아는 사람은 누구나 볼 수 있습니다.",
      );
    }

    async function insertImages(files: File[]): Promise<void> {
      for (const file of files) {
        const check = validateImage(file.type, file.size);
        if (!check.ok) {
          host.notify?.(imageErrorMessage(check.reason), "error");
          continue;
        }

        warnOnce();
        // 업로드가 끝나기 전에 자리표시를 넣지 않는다 — 실패하면 지워야 하는데,
        // 그 사이 사용자가 편집하면 지울 자리를 잃는다.
        try {
          const { url } = await host.uploadImage(file);
          host.insertText(editorEl, imageMarkdown(url, altFromFileName(file.name)));
        } catch (error) {
          host.notify?.(
            `이미지를 올리지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      }
    }

    /** 떨어진 파일을 이미지·문서·나머지로 가른다 (분류 규칙은 `dropFiles.ts`). */
    function routeFiles(documents: DroppedDocument[]): void {
      const { images, documents: docs, rejected } = classifyDropped(
        documents.map((d) => ({ ...d, name: d.file.name, type: d.file.type })),
      );

      if (docs.length > 0 && !host.handleOtherFiles?.(docs)) {
        host.notify?.("파일을 열지 못했습니다.", "error");
      }
      if (rejected.length > 0) {
        host.notify?.(rejectionMessage(rejected.map((d) => d.file)), "error");
      }
      if (images.length > 0) void insertImages(images.map((d) => d.file));
    }

    /**
     * 드롭 이벤트에서 파일과 (가능하면) 핸들을 꺼낸다.
     *
     * `getAsFileSystemHandle()` 은 **이벤트 처리 중에 호출해야 한다.**
     * `DataTransferItem` 은 핸들러가 끝나면 비워지므로, 나중에 부르면 빈손이
     * 된다. 반환값은 Promise 라 await 는 뒤에서 해도 된다.
     */
    async function collectDocuments(event: DragEvent): Promise<DroppedDocument[]> {
      const files = [...(event.dataTransfer?.files ?? [])];
      const items = [...(event.dataTransfer?.items ?? [])];

      const handlePromises = items.map((item) => {
        const get = (
          item as DataTransferItem & {
            getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
          }
        ).getAsFileSystemHandle;
        if (item.kind !== "file" || typeof get !== "function") return null;
        // 폴백 브라우저(Safari·Firefox)에는 이 메서드가 없다 — 핸들 없이 연다.
        return get.call(item).catch(() => null);
      });

      const handles = await Promise.all(
        handlePromises.map((p) => p ?? Promise.resolve(null)),
      );

      return files.map((file, index) => {
        const handle = handles[index];
        return {
          file,
          handle:
            handle && handle.kind === "file" ? (handle as FileSystemFileHandle) : null,
        };
      });
    }

    editorEl.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      // preventDefault 가 없으면 브라우저가 파일을 그냥 열어 버려
      // **편집 중인 문서가 통째로 사라진다.**
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      editorEl.dataset.dropping = "true";
    });

    editorEl.addEventListener("dragleave", () => {
      delete editorEl.dataset.dropping;
    });

    editorEl.addEventListener("drop", (event) => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return; // 텍스트 드롭은 기본 동작에 맡긴다

      event.preventDefault();
      delete editorEl.dataset.dropping;
      // 핸들 수집만 비동기다. `collectDocuments` 안에서 동기적으로 요청한다.
      void collectDocuments(event).then(routeFiles);
    });

    editorEl.addEventListener("paste", (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return; // 텍스트 붙여넣기는 그대로

      event.preventDefault();
      void insertImages(images);
    });

    initialized = true;
    return { hasWarned: () => warned };
  } catch (error) {
    console.warn("[editorDrop] 초기화 실패:", error);
    return noopController;
  }
}
