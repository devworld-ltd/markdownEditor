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

import { altFromFileName, imageErrorMessage, imageMarkdown, validateImage } from "./imageUpload";

export interface EditorDropHost {
  editorEl: HTMLTextAreaElement;
  /** 이미지를 업로드하고 URL 을 돌려준다. */
  uploadImage: (file: File) => Promise<{ url: string }>;
  /** 커서 자리에 텍스트를 넣는다 (undo 보존). */
  insertText: (textarea: HTMLTextAreaElement, text: string) => void;
  notify?: (message: string, kind?: "info" | "error") => void;
  /**
   * 이미지가 아닌 파일이 떨어졌을 때. F-56 이 여기에 연결된다.
   * 처리했으면 true 를 돌려준다.
   */
  handleOtherFiles?: (files: File[]) => boolean;
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

    /** 떨어진 파일을 이미지와 나머지로 가른다. */
    function routeFiles(files: File[]): void {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const others = files.filter((f) => !f.type.startsWith("image/"));

      if (others.length > 0 && host.handleOtherFiles?.(others)) {
        // F-56 이 가져갔다.
      } else if (others.length > 0) {
        host.notify?.("이미지 파일만 넣을 수 있습니다.", "error");
      }

      if (images.length > 0) void insertImages(images);
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
      routeFiles(files);
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
