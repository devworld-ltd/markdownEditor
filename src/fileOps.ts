import {
  getActiveTab,
  markActiveTabDirty,
  findTabByPath,
  createTab,
  switchTab,
  updateActiveTab,
} from "./tabs";

declare global {
  interface Window {
    webkit?: {
      messageHandlers: {
        fileHandler: {
          postMessage(message: FileMessage): void;
        };
      };
    };
    _bridge?: FileBridge;
  }
}

interface FileMessage {
  action: "open" | "save" | "saveAs";
  content?: string;
  filePath?: string;
}

interface FileBridge {
  onFileOpened(content: string, filePath: string, fileName: string): void;
  onFileSaved(filePath: string, fileName: string): void;
  onFileCancelled(): void;
  onFileError(message: string): void;
}

let editorEl: HTMLTextAreaElement;

export function openFile(): void {
  window.webkit?.messageHandlers.fileHandler.postMessage({ action: "open" });
}

export function saveFile(): void {
  const tab = getActiveTab();
  if (!tab) return;

  if (tab.filePath) {
    window.webkit?.messageHandlers.fileHandler.postMessage({
      action: "save",
      content: editorEl.value,
      filePath: tab.filePath,
    });
  } else {
    saveFileAs();
  }
}

export function saveFileAs(): void {
  window.webkit?.messageHandlers.fileHandler.postMessage({
    action: "saveAs",
    content: editorEl.value,
  });
}

export function initFileOps(editor: HTMLTextAreaElement): void {
  editorEl = editor;

  editor.addEventListener("input", () => {
    markActiveTabDirty();
  });

  window._bridge = {
    onFileOpened(content: string, filePath: string, fileName: string) {
      const existing = findTabByPath(filePath);
      if (existing) {
        switchTab(existing.id);
        return;
      }
      createTab(content, filePath, fileName);
    },

    onFileSaved(filePath: string, fileName: string) {
      updateActiveTab({ filePath, fileName, isDirty: false });
    },

    onFileCancelled() {
      // 아무 동작 없음
    },

    onFileError(message: string) {
      console.error("[fileOps] Error:", message);
    },
  };
}
