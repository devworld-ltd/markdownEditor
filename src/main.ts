import { createEditor } from "./editor";
import { initToolbar, setFileActions } from "./toolbar";
import {
  exportFile,
  initFileOps,
  openDroppedFile,
  openFileFromHandle,
  setFileTouchListener,
  isFileSystemAccessSupported,
  openFile,
  saveFile,
  saveFileAs,
} from "./fileOps";
import { initShortcuts } from "./shortcuts";
import {
  UNTITLED,
  createTab,
  getActiveContent,
  getActiveTab,
  syncActiveTab,
  hasDirtyTabs,
  initTabs,
  persistNow,
  setCloseConfirm,
  setScrollSyncHooks,
} from "./tabs";
import { initNotice, showNotice } from "./notice";
import {
  isStorageAvailable,
  loadDocStats,
  saveDocStats,
  loadLineNumbers,
  saveLineNumbers,
  loadRecentFilesRaw,
  saveRecentFiles,
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
import { initTableUi } from "./tableUi";
import { initLineNumbers } from "./lineNumbers";
import { initStatusBar } from "./statusBar";
import { initEditorBehavior } from "./editorBehavior";
import { initEditorDrop } from "./editorDrop";
import { initRecentFiles } from "./recentFilesUi";
import { parseRecent } from "./recentFiles";
import { buildHtmlDocument, suggestHtmlFileName, titleFromFileName } from "./htmlExport";
import { copyRenderedHtml } from "./clipboardExport";
import { createShareLink, loadSharedDocument, type ShareHost } from "./share";
import { shareIdFromPath } from "./shareId";

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
const editorPaneEl = document.querySelector<HTMLElement>("#editor-pane");

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

  // F-24: **createEditor() 보다 먼저** 초기화해야 한다. onAfterRender 콜백이
  // lineNumbers 를 참조하는데, createEditor 가 최초 렌더를 동기적으로 수행하므로
  // 뒤에 두면 "Cannot access 'lineNumbers' before initialization" 이 난다
  // (실제로 그랬다 — 화면은 뜨지만 콘솔에 오류가 남는다).
  // F-24 줄 번호. 설정 다이얼로그(F-35) 안에 함께 둔다 — 편집 화면에 관한
  // 설정이 두 곳으로 흩어지면 사용자가 어디를 봐야 할지 모른다.
  const lineGutterEl = document.querySelector<HTMLElement>("#line-gutter");
  const lineNumbers = lineGutterEl
    ? initLineNumbers({
        gutterEl: lineGutterEl,
        editorEl,
        loadEnabled: loadLineNumbers,
        saveEnabled: saveLineNumbers,
      })
    : null;

  // F-29 문서 통계. 렌더 디바운스에 얹어 매 글자마다 전체를 훑지 않는다.
  const statusBarEl = document.querySelector<HTMLElement>("#status-bar");
  const statusBar = statusBarEl
    ? initStatusBar({
        barEl: statusBarEl,
        editorEl,
        loadEnabled: loadDocStats,
        saveEnabled: saveDocStats,
      })
    : null;

  const statsCheckEl = document.querySelector<HTMLInputElement>("#setting-doc-stats");
  if (statsCheckEl && statusBar) {
    statsCheckEl.checked = statusBar.isEnabled();
    statsCheckEl.addEventListener("change", () => statusBar.setEnabled(statsCheckEl.checked));
  }

  const lineNumbersCheckEl = document.querySelector<HTMLInputElement>("#setting-line-numbers");
  if (lineNumbersCheckEl && lineNumbers) {
    lineNumbersCheckEl.checked = lineNumbers.isEnabled();
    lineNumbersCheckEl.addEventListener("change", () => {
      lineNumbers.setEnabled(lineNumbersCheckEl.checked);
    });
  }

  // F-26·F-27: 목록 이어쓰기와 Tab 들여쓰기. execCommand 로 넣으므로 실행
  // 취소가 보존되고, Esc 를 먼저 누르면 다음 Tab 은 포커스 이동으로 돌아간다.
  initEditorBehavior({
    editorEl,
    notify: (message) => showNotice(message, "info", 3000),
  });

  // F-28: 드롭 처리는 여기 한 곳뿐이다 — 두 곳에서 들으면 서로를 가린다.
  initEditorDrop({
    editorEl,
    uploadImage: async (file) => {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      return (await response.json()) as { url: string };
    },
    insertText: (textarea, text) => {
      textarea.focus({ preventScroll: true });
      document.execCommand("insertText", false, text);
    },
    notify: (message, kind) => showNotice(message, kind ?? "info", 7000),
    // F-56: 마크다운·텍스트는 새 탭으로 연다. 같은 drop 핸들러에서 갈린다.
    handleOtherFiles: (documents) => {
      void (async () => {
        for (const { file, handle } of documents) {
          await openDroppedFile(file, handle);
        }
      })();
      return true;
    },
  });

  createEditor({
    editorEl,
    previewEl,
    onAfterRender: () => {
      scrollSync.reapplyAfterRender();
      // 본문이 바뀌면 일치 위치도 바뀐다. 열려 있을 때만 다시 계산한다.
      search?.refresh();
      // F-24: 줄 수·줄바꿈이 바뀌면 번호 칸 높이를 다시 잰다.
      lineNumbers?.refresh();
      // F-29: 같은 디바운스에 얹는다 — 매 글자마다 전체를 세면 느려진다.
      statusBar?.refresh();
    },
  });

  // 파일 I/O 는 탭 상태를 건드리므로 탭 초기화(세션 복원 포함)보다 먼저 준비한다.
  initFileOps(editorEl);

  setCloseConfirm((tab) =>
    window.confirm(`"${tab.fileName}" 의 변경 사항이 저장되지 않았습니다. 닫을까요?`),
  );

  // F-32: F-25 억제 훅을 붙이지 않는다 — 실측 결과 있으나 없으나 드래그 후
  // 두 패널의 비율 차이가 0 이었다(splitter.ts §2 참고).
  if (editorContainerEl && splitResizerEl && editorPaneEl) {
    initSplitter({
      containerEl: editorContainerEl,
      resizerEl: splitResizerEl,
      // F-24 이후 비율은 줄 번호를 포함한 .editor-pane 이 받는다 — #editor 를
      // 직접 조절하면 번호 칸 폭만큼 비율이 어긋난다.
      firstPaneEl: editorPaneEl,
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
          savePrefs: (prefs) => {
            saveEditorPrefs(prefs);
            // F-24: 글자 크기·글꼴이 바뀌면 줄 높이가 달라진다 — 번호를 다시 잰다.
            lineNumbers?.refresh();
          },
          returnFocusTo: editorEl,
        })
      : null;

  // F-36 최근 파일. 핸들은 직렬화되지 않으므로(트랩 #6) **이번 세션 동안만**
  // 메모리에 들고 있다가, 살아 있으면 바로 열고 아니면 파일 선택 창을 연다.
  const liveHandles = new Map<string, FileSystemFileHandle>();
  const recentDialogEl = document.querySelector<HTMLDialogElement>("#recent-files");
  const recentListEl = document.querySelector<HTMLElement>("#recent-files-list");
  const recentEmptyEl = document.querySelector<HTMLElement>("#recent-files-empty");
  const recentCloseEl = document.querySelector<HTMLElement>("#recent-files-close");

  const recentFiles =
    recentDialogEl && recentListEl && recentEmptyEl && recentCloseEl
      ? initRecentFiles({
          dialogEl: recentDialogEl,
          listEl: recentListEl,
          emptyEl: recentEmptyEl,
          closeEl: recentCloseEl,
          load: () => parseRecent(loadRecentFilesRaw()),
          save: saveRecentFiles,
          isLive: (name) => liveHandles.has(name),
          openLive: (name) => {
            const handle = liveHandles.get(name);
            if (handle) void openFileFromHandle(handle);
          },
          openPicker: () => void openFile(),
          notify: (message) => showNotice(message, "info", 6000),
          returnFocusTo: editorEl,
        })
      : null;

  // F-30 표. 대화상자 하나가 커서 위치에 따라 삽입/편집으로 갈린다.
  const tableDialogEl = document.querySelector<HTMLDialogElement>("#table-dialog");
  const tableInsertEl = document.querySelector<HTMLElement>("#table-insert");
  const tableRowsEl = document.querySelector<HTMLInputElement>("#table-rows");
  const tableColumnsEl = document.querySelector<HTMLInputElement>("#table-columns");
  const tableEditEl = document.querySelector<HTMLElement>("#table-edit");
  const tableAlignEl = document.querySelector<HTMLElement>("#table-align");
  const tableSubmitEl = document.querySelector<HTMLButtonElement>("#table-submit");
  const tableCloseEl = document.querySelector<HTMLElement>("#table-close");

  const tableUi =
    tableDialogEl &&
    tableInsertEl &&
    tableRowsEl &&
    tableColumnsEl &&
    tableEditEl &&
    tableAlignEl &&
    tableSubmitEl &&
    tableCloseEl
      ? initTableUi({
          dialogEl: tableDialogEl,
          insertEl: tableInsertEl,
          rowsEl: tableRowsEl,
          columnsEl: tableColumnsEl,
          editEl: tableEditEl,
          alignEl: tableAlignEl,
          submitEl: tableSubmitEl,
          closeEl: tableCloseEl,
          editorEl,
          notify: (message) => showNotice(message, "info", 3000),
          returnFocusTo: editorEl,
        })
      : null;

  setFileTouchListener((name, handle) => {
    if (handle) liveHandles.set(name, handle);
    recentFiles?.record(name);
  });

  // F-60 공유. 서버는 마크다운 원문만 주고받는다 — 렌더를 서버에서 하면
  // 정화 정책이 두 곳으로 갈라진다(F-38·F-40 과 같은 이유).
  const shareHost: ShareHost = {
    origin: window.location.origin,
    upload: async (content) => {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      return (await response.json()) as { id: string };
    },
    download: async (id) => {
      const response = await fetch(`/api/share/${id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
    notify: (message, kind) => showNotice(message, kind ?? "info", 8000),
    copyLink: (url) => navigator.clipboard.writeText(url),
  };

  setFileActions({
    newDoc: () => createTab("", null, UNTITLED),
    open: () => void openFile(),
    save: () => void saveFile(),
    saveAs: () => void saveFileAs(),
    showShortcuts: shortcutHelp ? () => shortcutHelp.open() : undefined,
    cycleView: viewMode ? () => viewMode.cycle() : undefined,
    showSettings: editorSettings ? () => editorSettings.open() : undefined,
    showTable: tableUi ? () => tableUi.open() : undefined,
    showRecent: recentFiles ? () => recentFiles.open() : undefined,

    // F-60: 이 앱에서 유일하게 네트워크를 타는 동작이다. 버튼을 눌러야만 fetch 한다.
    share: () => {
      syncActiveTab();
      void createShareLink(shareHost, getActiveContent());
    },

    // F-40: F-38 과 같은 원칙 — 프리뷰의 정화된 HTML 만 쓴다. 붙여넣는 곳이
    // 우리 앱이 아니므로 위험도는 오히려 높다.
    copyHtml: () => {
      void copyRenderedHtml(
        {
          supportsRichCopy: () =>
            typeof ClipboardItem === "function" &&
            typeof navigator.clipboard?.write === "function",
          writeRich: async (html, text) => {
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([text], { type: "text/plain" }),
              }),
            ]);
          },
          writeText: (text) => navigator.clipboard.writeText(text),
          notify: (message, kind) => showNotice(message, kind ?? "info", 5000),
        },
        previewEl.innerHTML,
        getActiveContent(),
      );
    },

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

  // F-60: /s/<id> 로 들어왔으면 문서를 가져와 새 탭으로 연다.
  // 실패해도 앱은 정상적으로 떠야 한다 — 흰 화면이 되면 안 된다.
  const sharedId = shareIdFromPath(window.location.pathname);
  if (sharedId) {
    void loadSharedDocument(shareHost, sharedId).then((content) => {
      if (content === null) return;
      createTab(content, null, `공유-${sharedId}.md`);
      // 주소를 정리한다 — 새로고침 때마다 다시 받아 탭이 쌓이는 것을 막는다.
      window.history.replaceState(null, "", "/");
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
