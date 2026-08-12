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
import { initSwUpdate, isUpdateReloadPending } from "./swUpdate";

const editorEl = document.querySelector<HTMLTextAreaElement>("#editor");
const previewEl = document.querySelector<HTMLElement>("#preview");
const toolbarEl = document.querySelector<HTMLElement>("#toolbar-actions");
const titleEl = document.querySelector<HTMLElement>(".toolbar h1");
const tabBarEl = document.querySelector<HTMLElement>("#tab-bar");
const noticeEl = document.querySelector<HTMLElement>("#notice");
const swUpdateEl = document.querySelector<HTMLElement>("#sw-update");

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
  // F-69: 서비스 워커 갱신 리로드가 진행 중이면(세션이 이미 확정 저장됐으므로) 이
  // 리로드 한 번에 한해 경고를 억제한다(U5, AC-06/AC-08).
  window.addEventListener("beforeunload", (e) => {
    persistNow();
    if (hasDirtyTabs() && !isUpdateReloadPending()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // 모바일 사파리는 beforeunload 를 신뢰할 수 없어 백그라운드 전환 시에도 저장한다.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistNow();
  });

  document.body.dataset.fsAccess = String(isFileSystemAccessSupported());

  // 서비스 워커는 프로덕션 빌드에서만 등록한다. 개발 서버에서 등록하면 HMR 결과가
  // 캐시에 가려 "고쳤는데 안 바뀌는" 상황을 만든다.
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      // F-69: 등록·감지·표시·갱신 로직 전체는 swUpdate.ts 가 맡는다(등록 자체도
      // 이 모듈이 수행 — 기본 host.register() 가 navigator.serviceWorker.register 를 호출한다).
      if (swUpdateEl) {
        initSwUpdate({
          panelEl: swUpdateEl,
          persist: () => persistNow(),
          hasDirty: () => hasDirtyTabs(),
          returnFocusTo: editorEl,
        });
      }
    });
  }

  if (!isStorageAvailable()) {
    showNotice(
      "브라우저 저장소를 쓸 수 없어 자동 저장이 비활성화됩니다. 작업 내용을 파일로 저장하세요.",
      "error",
      8000,
    );
  }
}
