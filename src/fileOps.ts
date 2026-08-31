import {
  UNTITLED,
  createTab,
  findTabByHandle,
  getActiveContent,
  getActiveTab,
  markActiveTabDirty,
  setTabDiskChanged,
  setTabDiskStamp,
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

/**
 * 플랫폼 경계 — picker/Blob/anchor 전역 API 를 이 인터페이스 뒤로 모은다.
 *
 * `fileOps.ts` 는 `tabs.ts`/`notice.ts` 를 import 하므로 offline.ts/swUpdate.ts/
 * fsLimitNotice.ts 처럼 완전한 리프 모듈로 만들 수는 없다(그럴 필요도 없다 —
 * 이 파일이 검증해야 하는 위험한 분기는 "핸들 유무·AbortError 판별·dirty 해제
 * 시점"이지 tabs/notice 자체의 동작이 아니다. tabs/notice 는 각각 자기 테스트를
 * 갖고 있으므로 그대로 두고 함께 호출해 통합 검증한다).
 *
 * 대신 실제로 "가짜로 대체하지 않으면 전 분기를 못 만드는" 것만 주입 경계로
 * 뺀다 — `window.showOpenFilePicker`/`showSaveFilePicker`(대화상자 결과·AbortError·
 * 그 외 오류를 자유롭게 흉내낼 수 있어야 함) 와 `Blob`/`URL.createObjectURL`/
 * `document.createElement("a")`(폴백 다운로드 경로). `isFileSystemAccessSupported()`
 * 도 같은 판정을 쓰므로 host 를 통해 지원/미지원을 강제로 뒤집을 수 있게 한다.
 */
export interface FileOpsHost {
  isSupported(): boolean;
  showOpenFilePicker(
    options: OpenFilePickerOptions,
  ): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(
    options: SaveFilePickerOptions,
  ): Promise<FileSystemFileHandle>;
  createBlob(content: string, type: string): Blob;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): HTMLAnchorElement;
  appendToBody(el: HTMLElement): void;
}

function defaultHost(): FileOpsHost {
  return {
    isSupported: () =>
      typeof window.showOpenFilePicker === "function" &&
      typeof window.showSaveFilePicker === "function",
    showOpenFilePicker: (options) => window.showOpenFilePicker!(options),
    showSaveFilePicker: (options) => window.showSaveFilePicker!(options),
    createBlob: (content, type) => new Blob([content], { type }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    appendToBody: (el) => document.body.appendChild(el),
  };
}

let host: FileOpsHost = defaultHost();

/**
 * 테스트 전용 주입 지점. 프로덕션(`main.ts`)은 절대 호출하지 않으므로 기본
 * `host` 는 항상 실제 전역 API 를 그대로 쓴다. 인자를 생략하면 기본값으로
 * 되돌린다(테스트 간 누수 방지 — `afterEach` 에서 호출).
 */
export function setFileOpsHost(partial?: Partial<FileOpsHost>): void {
  host = { ...defaultHost(), ...partial };
}

/**
 * F-36: 파일을 연/저장한 뒤 알린다. `fileOps` 가 최근 목록 모듈을 import 하지
 * 않도록 콜백으로 뒤집는다 — `toolbar.ts` 의 `setFileActions` 와 같은 패턴이다.
 */
type FileTouchListener = (name: string, handle: FileSystemFileHandle | null) => void;
let fileTouchListener: FileTouchListener | null = null;

export function setFileTouchListener(listener: FileTouchListener | null): void {
  fileTouchListener = listener;
}

function notifyFileTouched(name: string, handle: FileSystemFileHandle | null): void {
  try {
    fileTouchListener?.(name, handle);
  } catch {
    // 기록 실패가 파일 열기·저장을 망치면 안 된다.
  }
}

/**
 * F-88 S-1: 저장 직전 디스크 충돌을 확인하는 훅. `main.ts` 가
 * `fileReload.confirmBeforeSave` 를 주입한다 — `fileOps.ts` 는 `fileReload.ts` 를
 * import 하지 않는다(`setFileActions` 와 같은 콜백 역전 패턴).
 *
 * 주입하지 않으면(테스트 등) 항상 저장을 허용해 기존 동작 그대로다.
 */
type SaveConflictGuard = (tabId: string) => Promise<boolean>;
let saveConflictGuard: SaveConflictGuard | null = null;

export function setSaveConflictGuard(guard: SaveConflictGuard | null): void {
  saveConflictGuard = guard;
}

/** F-88 M-1: 핸들에서 현재 디스크 기준값을 읽는다. 실패하면 null. */
async function currentStamp(
  handle: FileSystemFileHandle,
): Promise<{ lastModified: number; size: number } | null> {
  try {
    const file = await handle.getFile();
    return { lastModified: file.lastModified, size: file.size };
  } catch {
    return null;
  }
}

export function isFileSystemAccessSupported(): boolean {
  return host.isSupported();
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
    const [handle] = await host.showOpenFilePicker({
      types: MARKDOWN_TYPES,
      multiple: false,
    });
    if (!handle) return;
    await openHandle(handle);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`파일을 열지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

/**
 * 이미 가진 핸들로 연다 (F-36 최근 파일).
 *
 * 대화상자를 거치지 않는 것 말고는 일반 열기와 같다 — **중복 탭 방지와 최근
 * 목록 기록을 같은 경로에서** 처리해야 두 진입점의 동작이 갈라지지 않는다.
 * 권한이 만료됐거나 파일이 사라졌으면 예외가 나므로 호출부가 알 수 있다.
 */
export async function openFileFromHandle(handle: FileSystemFileHandle): Promise<void> {
  try {
    await openHandle(handle);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`파일을 열지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

async function openHandle(handle: FileSystemFileHandle): Promise<void> {
  const existing = await findTabByHandle(handle);
  if (existing) {
    switchTab(existing.id);
    // 이미 열려 있어도 "방금 쓴 파일" 이다 — 최근 목록에서 뒤로 밀리면
    // 자주 쓰는 문서일수록 목록에서 사라지는 이상한 동작이 된다 (F-36).
    notifyFileTouched(existing.fileName, handle);
    // F-88 M-1: 다시 연 시점의 디스크 기준값으로 갱신한다.
    setTabDiskStamp(existing.id, await currentStamp(handle));
    setTabDiskChanged(existing.id, false);
    return;
  }

  const file = await handle.getFile();
  const id = createTab(await file.text(), handle, file.name);
  notifyFileTouched(file.name, handle); // F-36
  // F-88 M-1: 열기 직후 디스크 기준값을 기록한다.
  setTabDiskStamp(id, { lastModified: file.lastModified, size: file.size });
}

/**
 * F-56 드롭으로 연다.
 *
 * 핸들이 있으면 **파일 선택 창으로 연 것과 완전히 같게** 다룬다 — 중복 탭 방지도,
 * 그 파일에 바로 저장하는 것도 된다. 핸들이 없는 브라우저에서는 업로드 경로와
 * 같아져 저장할 때 위치를 다시 묻는다(트랩 #6).
 */
export async function openDroppedFile(
  file: File,
  handle: FileSystemFileHandle | null,
): Promise<void> {
  if (handle) {
    await openFileFromHandle(handle);
    return;
  }
  await openViaUpload(file);
}

async function openViaUpload(file: File): Promise<void> {
  try {
    // 업로드 경로에는 핸들이 없어 중복 열기를 판별할 수 없다. 항상 새 탭이 열린다.
    createTab(await file.text(), null, file.name);
    notifyFileTouched(file.name, null); // F-36 — 폴백 경로엔 핸들이 없다
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
    // F-88 S-1: 저장 직전 디스크 충돌을 확인한다. 가드가 없으면(테스트 등)
    // 항상 통과해 기존 동작 그대로다.
    if (saveConflictGuard) {
      const proceed = await saveConflictGuard(tab.id);
      if (!proceed) return;
    }
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
    notifyFileTouched(suggestedName, null); // F-36 — 폴백 저장도 "최근" 이다
    showNotice(`${suggestedName} 을(를) 내려받았습니다.`);
    return;
  }

  try {
    const handle = await host.showSaveFilePicker({
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
    notifyFileTouched(fileName, handle); // F-36
    // F-88 M-1/E-6: 쓴 직후의 디스크 기준값을 기록하고, 저장으로 충돌을
    // 해소했으니 배지·배너를 지운다.
    const tab = getActiveTab();
    if (tab) {
      setTabDiskStamp(tab.id, await currentStamp(handle));
      setTabDiskChanged(tab.id, false);
    }
    showNotice(`${fileName} 에 저장했습니다.`);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`저장하지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

/**
 * F-38: 파일을 **탭 상태와 무관하게** 내보낸다.
 *
 * `saveFile()`/`saveFileAs()` 와 달리 탭의 핸들·파일명·dirty 를 건드리지 않는다.
 * HTML 내보내기는 "이 문서를 다른 형식으로 한 부 뽑는" 것이지 저장이 아니다 —
 * 탭이 `note.html` 을 가리키게 되면 다음 Cmd+S 가 마크다운 원문을 .html 파일에
 * 덮어쓴다.
 */
export async function exportFile(
  content: string,
  fileName: string,
  mimeType: string,
  accept: Record<string, string[]>,
): Promise<void> {
  if (!isFileSystemAccessSupported()) {
    downloadBlob(content, fileName, mimeType);
    showNotice(`${fileName} 을(를) 내려받았습니다.`);
    return;
  }

  try {
    const handle = await host.showSaveFilePicker({
      types: [{ description: mimeType, accept }],
      suggestedName: fileName,
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    showNotice(`${handle.name} 으로 내보냈습니다.`);
  } catch (error) {
    if (isAbort(error)) return;
    showNotice(`내보내지 못했습니다: ${errorMessage(error)}`, "error");
  }
}

function downloadBlob(content: string, fileName: string, mimeType: string): void {
  const blob = host.createBlob(content, mimeType);
  const url = host.createObjectURL(blob);
  const anchor = host.createAnchor();
  anchor.href = url;
  anchor.download = fileName;
  host.appendToBody(anchor);
  anchor.click();
  anchor.remove();
  host.revokeObjectURL(url);
}

function downloadFile(content: string, fileName: string): void {
  downloadBlob(content, fileName, "text/markdown;charset=utf-8");
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
