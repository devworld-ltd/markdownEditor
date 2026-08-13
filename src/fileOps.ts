import {
  UNTITLED,
  createTab,
  findTabByHandle,
  getActiveContent,
  getActiveTab,
  markActiveTabDirty,
  switchTab,
  syncActiveTab,
  updateActiveTab,
} from "./tabs";
import { showNotice } from "./notice";
import { notifyFallbackSave } from "./fsLimitNotice";

/**
 * 브라우저 파일 I/O.
 *
 * 1순위: File System Access API (Chrome·Edge) — 실제 파일 핸들을 잡아 "덮어쓰기"가 된다.
 * 2순위: <input type="file"> 업로드 + Blob 다운로드 (Safari·Firefox) — 덮어쓰기가
 *        불가능하므로 저장할 때마다 새 파일이 내려받아진다.
 */

declare global {
  interface Window {
    showOpenFilePicker?: (
      options?: OpenFilePickerOptions,
    ) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (
      options?: SaveFilePickerOptions,
    ) => Promise<FileSystemFileHandle>;
  }
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[];
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
}

const MARKDOWN_TYPES: FilePickerAcceptType[] = [
  {
    description: "Markdown",
    accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
  },
];

const ACCEPT_ATTR = ".md,.markdown,.txt,text/markdown,text/plain";

let editorEl: HTMLTextAreaElement;
let fileInputEl: HTMLInputElement;

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window.showOpenFilePicker === "function" &&
    typeof window.showSaveFilePicker === "function"
  );
}

/** 사용자가 대화상자를 취소한 경우. 오류로 취급하지 않는다. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- 열기 --------------------------------------------------------------------

export async function openFile(): Promise<void> {
  if (isFileSystemAccessSupported()) {
    await openViaFileSystemAccess();
  } else {
    fileInputEl.click();
  }
}

async function openViaFileSystemAccess(): Promise<void> {
  try {
    const [handle] = await window.showOpenFilePicker!({
      types: MARKDOWN_TYPES,
      multiple: false,
    });
    if (!handle) return;

    const existing = await findTabByHandle(handle);
    if (existing) {
      switchTab(existing.id);
      return;
    }

    const file = await handle.getFile();
    createTab(await file.text(), handle, file.name);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`파일을 열지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

async function openViaUpload(file: File): Promise<void> {
  try {
    // 업로드 경로에는 핸들이 없어 중복 열기를 판별할 수 없다. 항상 새 탭이 열린다.
    createTab(await file.text(), null, file.name);
  } catch (error) {
    showNotice(`파일을 읽지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

// --- 저장 --------------------------------------------------------------------

export async function saveFile(): Promise<void> {
  const tab = getActiveTab();
  if (!tab) return;

  syncActiveTab();

  if (tab.handle) {
    await writeToHandle(tab.handle, getActiveContent(), tab.fileName);
    return;
  }
  await saveFileAs();
}

export async function saveFileAs(): Promise<void> {
  const tab = getActiveTab();
  if (!tab) return;

  syncActiveTab();
  const content = getActiveContent();
  const suggestedName = suggestFileName(tab.fileName);

  if (!isFileSystemAccessSupported()) {
    // F-58: 저장을 실제로 실행하는 이 시점에 브라우저 한계를 안내한다(세션당 1회).
    // 저장 동작 자체(다운로드 방식·파일명·성공 알림)는 그대로 두고 부가 안내만 더한다.
    notifyFallbackSave();
    downloadFile(content, suggestedName);
    updateActiveTab({ fileName: suggestedName, isDirty: false });
    showNotice(`${suggestedName} 을(를) 내려받았습니다.`);
    return;
  }

  try {
    const handle = await window.showSaveFilePicker!({
      types: MARKDOWN_TYPES,
      suggestedName,
    });
    await writeToHandle(handle, content, handle.name);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`저장하지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

async function writeToHandle(
  handle: FileSystemFileHandle,
  content: string,
  fileName: string,
): Promise<void> {
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    updateActiveTab({ handle, fileName, isDirty: false });
    showNotice(`${fileName} 에 저장했습니다.`);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`저장하지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

function downloadFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 순수 함수 — 저장 대화상자에 제안할 파일명 계산. UNTITLED/공백은 "Untitled.md",
 * 이미 마크다운류 확장자면 그대로, 아니면 ".md" 를 붙인다. */
export function suggestFileName(fileName: string): string {
  if (fileName === UNTITLED || fileName.trim() === "") return "Untitled.md";
  return /\.(md|markdown|txt)$/i.test(fileName) ? fileName : `${fileName}.md`;
}

// --- 초기화 ------------------------------------------------------------------

export function initFileOps(editor: HTMLTextAreaElement): void {
  editorEl = editor;

  editorEl.addEventListener("input", () => {
    markActiveTabDirty();
  });

  // 폴백 경로용 숨김 file input. 지원 브라우저에서도 만들어 두지만 사용하지 않는다.
  fileInputEl = document.createElement("input");
  fileInputEl.type = "file";
  fileInputEl.accept = ACCEPT_ATTR;
  fileInputEl.hidden = true;
  fileInputEl.id = "file-input";
  fileInputEl.addEventListener("change", () => {
    const file = fileInputEl.files?.[0];
    // 같은 파일을 연속으로 선택해도 change 가 발생하도록 값을 비운다.
    fileInputEl.value = "";
    if (file) void openViaUpload(file);
  });
  document.body.appendChild(fileInputEl);
}
