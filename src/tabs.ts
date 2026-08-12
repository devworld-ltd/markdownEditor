import { renderPreview } from "./preview";
import {
  createSession,
  isStorageAvailable,
  loadSession,
  saveSession,
  type PersistedTab,
} from "./storage";
import { showNotice } from "./notice";

export const APP_NAME = "Markdown Editor";
export const UNTITLED = "Untitled";

export interface TabState {
  id: string;
  /**
   * File System Access API 핸들. 지원 브라우저에서 "열기"/"다른 이름으로 저장"에
   * 성공한 탭만 보유한다. 폴백(업로드/다운로드) 경로와 세션 복원 탭은 항상 null 이며,
   * 저장 시 매번 저장 위치를 다시 묻는다.
   */
  handle: FileSystemFileHandle | null;
  fileName: string;
  content: string;
  isDirty: boolean;
  scrollTop: number;
  selectionStart: number;
  selectionEnd: number;
}

const tabs = new Map<string, TabState>();
let activeTabId = "";
let nextId = 1;

let tabBarEl: HTMLElement;
let editorEl: HTMLTextAreaElement;
let previewEl: HTMLElement;
let titleEl: HTMLElement;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let onCloseDirty: ((tab: TabState) => boolean) | null = null;
/** 자동 저장 실패 알림을 500ms 마다 반복하지 않기 위한 플래그. */
let saveFailureNotified = false;

function generateId(): string {
  return `tab-${nextId++}`;
}

/**
 * dirty 탭을 닫으려 할 때 확인을 받는 콜백을 등록한다.
 * true 를 반환하면 닫기를 진행한다. 등록하지 않으면 확인 없이 닫힌다.
 */
export function setCloseConfirm(fn: (tab: TabState) => boolean): void {
  onCloseDirty = fn;
}

export function initTabs(
  tabBar: HTMLElement,
  editor: HTMLTextAreaElement,
  preview: HTMLElement,
  title: HTMLElement,
): void {
  tabBarEl = tabBar;
  editorEl = editor;
  previewEl = preview;
  titleEl = title;

  if (!restoreSession()) {
    createTab("", null, UNTITLED);
  }
}

/** 저장된 세션을 복원한다. 복원할 것이 없으면 false. */
function restoreSession(): boolean {
  const session = loadSession();
  if (!session) return false;

  let restoredActiveId = "";
  let maxSeq = 0;

  for (const persisted of session.tabs) {
    const tab: TabState = {
      id: persisted.id,
      handle: null,
      fileName: persisted.fileName,
      content: persisted.content,
      isDirty: persisted.isDirty,
      scrollTop: 0,
      selectionStart: 0,
      selectionEnd: 0,
    };
    tabs.set(tab.id, tab);
    if (tab.id === session.activeTabId) restoredActiveId = tab.id;

    const seq = Number(tab.id.replace("tab-", ""));
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }

  if (tabs.size === 0) return false;

  // ID 충돌을 피하려면 시퀀스를 복원된 최대값 뒤로 밀어야 한다.
  nextId = maxSeq + 1;
  switchTab(restoredActiveId || [...tabs.keys()][0]);
  return true;
}

export function createTab(
  content = "",
  handle: FileSystemFileHandle | null = null,
  fileName = UNTITLED,
): string {
  const id = generateId();
  const tab: TabState = {
    id,
    handle,
    fileName,
    content,
    isDirty: false,
    scrollTop: 0,
    selectionStart: 0,
    selectionEnd: 0,
  };
  tabs.set(id, tab);
  switchTab(id);
  return id;
}

export function closeTab(id: string): void {
  const tab = tabs.get(id);
  if (!tab) return;

  // 활성 탭의 content 는 stale 하므로 dirty 판정 전에 동기화한다.
  if (id === activeTabId) syncActiveTab();

  if (tab.isDirty && onCloseDirty && !onCloseDirty(tab)) return;

  tabs.delete(id);

  if (tabs.size === 0) {
    createTab("", null, UNTITLED);
    return;
  }

  if (activeTabId === id) {
    const keys = [...tabs.keys()];
    switchTab(keys[keys.length - 1]);
  } else {
    renderTabs();
    schedulePersist();
  }
}

export function switchTab(id: string): void {
  const target = tabs.get(id);
  if (!target) return;

  syncActiveTab();

  activeTabId = id;

  editorEl.value = target.content;
  editorEl.scrollTop = target.scrollTop;
  // 탭 바 클릭으로 전환할 때 textarea 는 포커스를 잃은 상태다. 포커스 없는 textarea 의
  // 선택 영역은 클릭 이벤트가 끝나면서 브라우저가 0,0 으로 되돌리므로, 먼저 포커스를
  // 되돌려 준 뒤 선택을 복원해야 커서 위치가 유지된다. (편집 계속하기에도 이쪽이 맞다.)
  editorEl.focus({ preventScroll: true });
  editorEl.setSelectionRange(target.selectionStart, target.selectionEnd);
  renderPreview(previewEl, target.content);

  renderTabs();
  updateTitle();
  schedulePersist();
}

/**
 * textarea 의 현재 값을 활성 TabState 로 밀어 넣는다.
 *
 * 활성 탭의 content/scrollTop/selection 은 실시간 갱신되지 않으므로, 저장·영속화·
 * dirty 판정처럼 "탭의 진짜 내용"이 필요한 시점에는 먼저 이 함수를 호출해야 한다.
 */
export function syncActiveTab(): void {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const current = tabs.get(activeTabId)!;
  current.content = editorEl.value;
  current.scrollTop = editorEl.scrollTop;
  current.selectionStart = editorEl.selectionStart;
  current.selectionEnd = editorEl.selectionEnd;
}

export function getActiveTab(): TabState | undefined {
  return tabs.get(activeTabId);
}

export function getAllTabs(): TabState[] {
  return [...tabs.values()];
}

export function hasDirtyTabs(): boolean {
  syncActiveTab();
  return [...tabs.values()].some((tab) => tab.isDirty);
}

/** 활성 탭의 실제 본문. TabState.content 가 아니라 항상 이 값을 저장한다. */
export function getActiveContent(): string {
  return editorEl.value;
}

export function markActiveTabDirty(): void {
  const tab = tabs.get(activeTabId);
  if (!tab) return;

  if (!tab.isDirty) {
    tab.isDirty = true;
    renderTabs();
    updateTitle();
  }
  schedulePersist();
}

/**
 * 이미 같은 파일을 연 탭을 찾는다.
 * FileSystemFileHandle 은 경로를 노출하지 않으므로 isSameEntry() 로 비교한다.
 */
export async function findTabByHandle(
  handle: FileSystemFileHandle,
): Promise<TabState | undefined> {
  for (const tab of tabs.values()) {
    if (tab.handle && (await tab.handle.isSameEntry(handle))) return tab;
  }
  return undefined;
}

export function updateActiveTab(
  updates: Partial<Pick<TabState, "handle" | "fileName" | "isDirty" | "content">>,
): void {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  Object.assign(tab, updates);
  renderTabs();
  updateTitle();
  schedulePersist();
}

function renderTabs(): void {
  tabBarEl.innerHTML = "";

  for (const tab of tabs.values()) {
    const el = document.createElement("div");
    el.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    el.dataset.tabId = tab.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-name";
    nameSpan.textContent = tab.isDirty ? `${tab.fileName} *` : tab.fileName;
    el.appendChild(nameSpan);

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.title = "탭 닫기";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener("click", () => {
      if (tab.id !== activeTabId) switchTab(tab.id);
    });

    tabBarEl.appendChild(el);
  }
}

function updateTitle(): void {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const name = tab.fileName === UNTITLED ? APP_NAME : tab.fileName;
  const display = tab.isDirty ? `${name} *` : name;
  titleEl.textContent = display;
  document.title = display;
}

// --- 세션 영속화 -------------------------------------------------------------

const PERSIST_DEBOUNCE_MS = 500;

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
}

/**
 * 디바운스를 건너뛰고 즉시 저장한다 (beforeunload 등).
 *
 * F-69: 반환값이 `saveSession()` 의 성공 여부를 그대로 알린다. 서비스 워커 갱신
 * 흐름(`swUpdate.ts`)이 "세션이 정말 저장됐는지"를 알아야 이탈 경고 억제 여부를
 * 안전하게 판단할 수 있기 때문이다. 기존 호출부(schedulePersist 의 setTimeout,
 * beforeunload, visibilitychange)는 반환값을 쓰지 않으므로 무영향이다.
 */
export function persistNow(): boolean {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  syncActiveTab();

  const persisted: PersistedTab[] = [...tabs.values()].map((tab) => ({
    id: tab.id,
    fileName: tab.fileName,
    content: tab.content,
    isDirty: tab.isDirty,
  }));

  const saved = saveSession(createSession(persisted, activeTabId));

  // 자동 저장이 조용히 실패하면 사용자는 보호받고 있다고 잘못 믿게 된다.
  // 저장소 자체를 못 쓰는 경우는 기동 시 main.ts 가 이미 안내하므로,
  // 여기서는 용량 초과처럼 "쓸 수 있는데 실패한" 경우만 알린다.
  if (!saved && isStorageAvailable()) {
    if (!saveFailureNotified) {
      saveFailureNotified = true;
      showNotice(
        "브라우저 저장 공간이 부족해 자동 저장이 중단됐습니다. 문서를 파일로 저장하세요.",
        "error",
        10000,
      );
    }
  } else if (saved) {
    // 다시 성공하면 다음 실패 때 또 알릴 수 있도록 되돌린다.
    saveFailureNotified = false;
  }

  return saved;
}
