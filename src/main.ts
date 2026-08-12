import { createEditor } from "./editor";
import { initToolbar, setFileActions } from "./toolbar";
import {
  initFileOps,
  isFileSystemAccessSupported,
  openFile,
  saveFile,
  saveFileAs,
} from "./fileOps";
import { initShortcuts } from "./shortcuts";
import {
  UNTITLED,
  createTab,
  hasDirtyTabs,
  initTabs,
  persistNow,
  setCloseConfirm,
} from "./tabs";
import { initNotice, showNotice } from "./notice";
import { isStorageAvailable } from "./storage";

const editorEl = document.querySelector<HTMLTextAreaElement>("#editor");
const previewEl = document.querySelector<HTMLElement>("#preview");
const toolbarEl = document.querySelector<HTMLElement>("#toolbar-actions");
const titleEl = document.querySelector<HTMLElement>(".toolbar h1");
const tabBarEl = document.querySelector<HTMLElement>("#tab-bar");
const noticeEl = document.querySelector<HTMLElement>("#notice");

if (editorEl && previewEl) {
  if (noticeEl) initNotice(noticeEl);

  createEditor({ editorEl, previewEl });

  // 파일 I/O 는 탭 상태를 건드리므로 탭 초기화(세션 복원 포함)보다 먼저 준비한다.
  initFileOps(editorEl);

  setCloseConfirm((tab) =>
    window.confirm(`"${tab.fileName}" 의 변경 사항이 저장되지 않았습니다. 닫을까요?`),
  );

  if (titleEl && tabBarEl) {
    initTabs(tabBarEl, editorEl, previewEl, titleEl);
  }

  setFileActions({
    newDoc: () => createTab("", null, UNTITLED),
    open: () => void openFile(),
    save: () => void saveFile(),
    saveAs: () => void saveFileAs(),
  });

  if (toolbarEl) {
    initToolbar(toolbarEl, editorEl);
  }

  initShortcuts();

  // 새로고침·탭 닫기로 인한 유실 방지. 브라우저는 문구를 무시하고 기본 경고를 띄운다.
  window.addEventListener("beforeunload", (e) => {
    persistNow();
    if (hasDirtyTabs()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // 모바일 사파리는 beforeunload 를 신뢰할 수 없어 백그라운드 전환 시에도 저장한다.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistNow();
  });

  document.body.dataset.fsAccess = String(isFileSystemAccessSupported());

  if (!isStorageAvailable()) {
    showNotice(
      "브라우저 저장소를 쓸 수 없어 자동 저장이 비활성화됩니다. 작업 내용을 파일로 저장하세요.",
      "error",
      8000,
    );
  }
}
