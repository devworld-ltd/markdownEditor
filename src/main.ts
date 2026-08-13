import { createEditor } from "./editor";
import { initToolbar, setFileActions } from "./toolbar";
import {
  exportFile,
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
  getActiveTab,
  hasDirtyTabs,
  initTabs,
  persistNow,
  setCloseConfirm,
  setScrollSyncHooks,
} from "./tabs";
import { initNotice, showNotice } from "./notice";
import {
  isStorageAvailable,
  loadEditorPrefs,
  saveEditorPrefs,
  loadSplitRatio,
  loadViewMode,
  saveSplitRatio,
  saveViewMode,
} from "./storage";
import { initSwUpdate, isUpdateReloadPending } from "./swUpdate";
import { initOfflineIndicator } from "./offline";
import { initFsLimitNotice } from "./fsLimitNotice";
import { initScrollSync } from "./scrollSync";
import { detectApplePlatform, initShortcutHelp } from "./shortcutHelp";
import { initSearch } from "./search";
import { initSplitter } from "./splitter";
import { initViewMode, parseViewMode } from "./viewMode";
import { initEditorSettings } from "./editorSettings";
import { buildHtmlDocument, suggestHtmlFileName, titleFromFileName } from "./htmlExport";

const editorEl = document.querySelector<HTMLTextAreaElement>("#editor");
const previewEl = document.querySelector<HTMLElement>("#preview");
const toolbarEl = document.querySelector<HTMLElement>("#toolbar-actions");
const titleEl = document.querySelector<HTMLElement>(".toolbar h1");
const tabBarEl = document.querySelector<HTMLElement>("#tab-bar");
const noticeEl = document.querySelector<HTMLElement>("#notice");
const swUpdateEl = document.querySelector<HTMLElement>("#sw-update");
const offlineEl = document.querySelector<HTMLElement>("#offline-indicator");
const fsLimitNoticeEl = document.querySelector<HTMLElement>("#fs-limit-notice");
const shortcutHelpEl = document.querySelector<HTMLDialogElement>("#shortcut-help");
const shortcutHelpListEl = document.querySelector<HTMLElement>("#shortcut-help-list");
const shortcutHelpCloseEl = document.querySelector<HTMLElement>("#shortcut-help-close");
const searchBarEl = document.querySelector<HTMLElement>("#search-bar");
const searchInputEl = document.querySelector<HTMLInputElement>("#search-input");
const searchCountEl = document.querySelector<HTMLElement>("#search-count");
const searchPrevEl = document.querySelector<HTMLElement>("#search-prev");
const searchNextEl = document.querySelector<HTMLElement>("#search-next");
const searchCloseEl = document.querySelector<HTMLElement>("#search-close");
const searchToggleReplaceEl = document.querySelector<HTMLElement>("#search-toggle-replace");
const searchReplaceRowEl = document.querySelector<HTMLElement>("#search-replace-row");
const searchReplaceInputEl = document.querySelector<HTMLInputElement>("#search-replace-input");
const searchReplaceOneEl = document.querySelector<HTMLElement>("#search-replace-one");
const searchReplaceAllEl = document.querySelector<HTMLElement>("#search-replace-all");
const editorContainerEl = document.querySelector<HTMLElement>(".editor-container");
const splitResizerEl = document.querySelector<HTMLElement>("#split-resizer");

if (editorEl && previewEl) {
  if (noticeEl) initNotice(noticeEl);

  // F-70: 서비스 워커 등록 여부와 무관하게(개발 서버 포함) 항상 초기화한다 —
  // online/offline 이벤트는 PROD 가드가 필요한 SW 등록과 달리 모든 환경에서
  // 동일하게 동작하고, HMR 등 dev 서버 동작을 방해하지 않는다.
  if (offlineEl) initOfflineIndicator({ badgeEl: offlineEl });

  // F-25: initTabs() 가 내부에서 restoreSession()/createTab() → switchTab() 을
  // 동기적으로 호출하므로, setScrollSyncHooks() 는 initTabs() 보다 먼저 주입되어
  // 있어야 최초 복원 시점부터 M10/M11 이 성립한다.
  const scrollSync = initScrollSync({ editor: editorEl, preview: previewEl });

  // F-22: 검색은 에디터 본문을 대상으로 하므로 editorEl 만 있으면 된다.
  // 실패하면 단축키·툴바 진입점이 조용히 없는 것처럼 동작한다.
  const search =
    searchBarEl && searchInputEl && searchCountEl && searchPrevEl && searchNextEl && searchCloseEl
      ? initSearch({
          panelEl: searchBarEl,
          inputEl: searchInputEl,
          countEl: searchCountEl,
          prevEl: searchPrevEl,
          nextEl: searchNextEl,
          closeEl: searchCloseEl,
          editorEl,
          // 치환 UI 는 선택 사항 — 없으면 찾기만 동작한다(F-22 잔여).
          toggleReplaceEl: searchToggleReplaceEl ?? undefined,
          replaceRowEl: searchReplaceRowEl ?? undefined,
          replaceInputEl: searchReplaceInputEl ?? undefined,
          replaceOneEl: searchReplaceOneEl ?? undefined,
          replaceAllEl: searchReplaceAllEl ?? undefined,
        })
      : null;

  createEditor({
    editorEl,
    previewEl,
    onAfterRender: () => {
      scrollSync.reapplyAfterRender();
      // 본문이 바뀌면 일치 위치도 바뀐다. 열려 있을 때만 다시 계산한다.
      search?.refresh();
    },
  });

  // 파일 I/O 는 탭 상태를 건드리므로 탭 초기화(세션 복원 포함)보다 먼저 준비한다.
  initFileOps(editorEl);

  setCloseConfirm((tab) =>
    window.confirm(`"${tab.fileName}" 의 변경 사항이 저장되지 않았습니다. 닫을까요?`),
  );

  // F-32: F-25 억제 훅을 붙이지 않는다 — 실측 결과 있으나 없으나 드래그 후
  // 두 패널의 비율 차이가 0 이었다(splitter.ts §2 참고).
  if (editorContainerEl && splitResizerEl) {
    initSplitter({
      containerEl: editorContainerEl,
      resizerEl: splitResizerEl,
      firstPaneEl: editorEl,
      loadRatio: () => loadSplitRatio() ?? 0.5,
      saveRatio: saveSplitRatio,
    });
  }

  setScrollSyncHooks({
    suspend: () => scrollSync.suspend(),
    resumeAndSync: () => {
      scrollSync.syncFromEditorOnce(); // M11 — 억제 상태에서 프로그램적으로 1회
      scrollSync.resumeAfterFrame(); // 해제는 그 다음 프레임
    },
  });

  if (titleEl && tabBarEl) {
    initTabs(tabBarEl, editorEl, previewEl, titleEl);
  }

  // F-58: 안내 UI 는 툴바 버튼과 단축키 양쪽에서 열린다. 초기화에 실패하면
  // 두 진입점 모두 조용히 없는 것처럼 동작한다(에디터 기능은 그대로).
  const shortcutHelp =
    shortcutHelpEl && shortcutHelpListEl && shortcutHelpCloseEl
      ? initShortcutHelp({
          dialogEl: shortcutHelpEl,
          listEl: shortcutHelpListEl,
          closeEl: shortcutHelpCloseEl,
          isApplePlatform: detectApplePlatform(navigator.userAgent),
          returnFocusTo: editorEl,
        })
      : null;

  // F-33: 툴바가 버튼을 만든 **뒤에** 초기화해야 #view-mode 를 찾을 수 있다.
  // 순서가 뒤집히면 클릭은 동작하지만 aria-pressed/aria-label 이 비어 있어
  // 스크린리더에게는 상태 없는 버튼이 된다 — 눈으로는 드러나지 않는다.
  if (toolbarEl) {
    initToolbar(toolbarEl, editorEl);
  }

  // 모드는 분할 비율과 독립이다 — 모드를 되돌리면 맞춰 둔 비율이 그대로 돌아온다.
  const viewMode = editorContainerEl
    ? initViewMode({
        containerEl: editorContainerEl,
        buttonEl: document.querySelector<HTMLElement>("#view-mode") ?? undefined,
        loadMode: () => parseViewMode(loadViewMode()),
        saveMode: saveViewMode,
      })
    : null;

  // F-35: 툴바가 버튼을 만든 뒤라야 #settings 관련 요소를 찾을 수 있다(F-33 과 같은 이유).
  const settingsDialogEl = document.querySelector<HTMLDialogElement>("#editor-settings");
  const settingsFontEl = document.querySelector<HTMLSelectElement>("#setting-font");
  const settingsSizeEl = document.querySelector<HTMLElement>("#setting-size-value");
  const settingsDownEl = document.querySelector<HTMLElement>("#setting-size-down");
  const settingsUpEl = document.querySelector<HTMLElement>("#setting-size-up");
  const settingsResetEl = document.querySelector<HTMLElement>("#setting-reset");
  const settingsCloseEl = document.querySelector<HTMLElement>("#editor-settings-close");

  const editorSettings =
    settingsDialogEl &&
    settingsFontEl &&
    settingsSizeEl &&
    settingsDownEl &&
    settingsUpEl &&
    settingsResetEl &&
    settingsCloseEl
      ? initEditorSettings({
          rootEl: document.documentElement,
          dialogEl: settingsDialogEl,
          fontSelectEl: settingsFontEl,
          sizeValueEl: settingsSizeEl,
          decreaseEl: settingsDownEl,
          increaseEl: settingsUpEl,
          resetEl: settingsResetEl,
          closeEl: settingsCloseEl,
          loadPrefs: loadEditorPrefs,
          savePrefs: saveEditorPrefs,
          returnFocusTo: editorEl,
        })
      : null;

  setFileActions({
    newDoc: () => createTab("", null, UNTITLED),
    open: () => void openFile(),
    save: () => void saveFile(),
    saveAs: () => void saveFileAs(),
    showShortcuts: shortcutHelp ? () => shortcutHelp.open() : undefined,
    cycleView: viewMode ? () => viewMode.cycle() : undefined,
    showSettings: editorSettings ? () => editorSettings.open() : undefined,

    // F-38: 프리뷰에 이미 들어가 있는 **정화된** HTML 을 그대로 쓴다.
    // 원문을 다시 파싱하는 두 번째 경로를 만들면 정화 정책이 갈라진다(F-18).
    // F-39: 브라우저 인쇄 대화상자를 연다. "PDF 로 저장" 은 그 안에 이미 있으므로
    // PDF 라이브러리를 들일 이유가 없다. 출력 모양은 @media print 가 만든다.
    print: () => window.print(),

    exportHtml: () => {
      const tab = getActiveTab();
      const fileName = tab?.fileName ?? UNTITLED;
      void exportFile(
        buildHtmlDocument(titleFromFileName(fileName), previewEl.innerHTML),
        suggestHtmlFileName(fileName),
        "text/html;charset=utf-8",
        { "text/html": [".html"] },
      );
    },
  });

  initShortcuts({
    toggleHelp: shortcutHelp ? () => shortcutHelp.toggle() : undefined,
    toggleFind: search ? () => search.toggle() : undefined,
    cycleView: viewMode ? () => viewMode.cycle() : undefined,
  });

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

  const fsAccessSupported = isFileSystemAccessSupported();
  document.body.dataset.fsAccess = String(fsAccessSupported);

  // F-58: Chrome·Edge 에는 아무것도 보이면 안 되므로, 폴백 모드일 때만 초기화한다.
  // 호출 자체를 생략하는 편이 리스너 유무까지 포함해 "아무것도 안 뜬다"를 가장
  // 확실하게 보장한다(§fsLimitNotice.ts 판단 근거).
  if (fsLimitNoticeEl && !fsAccessSupported) {
    initFsLimitNotice({ panelEl: fsLimitNoticeEl, returnFocusTo: editorEl });
  }

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
