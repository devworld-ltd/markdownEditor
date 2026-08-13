import { renderPreview } from "./preview";
import { dropIndex, moveItem, stepItem } from "./tabOrder";
import {
  createSession,
  isStorageAvailable,
  loadSession,
  saveSession,
  type PersistedTab,
} from "./storage";
import { showNotice } from "./notice";
import {
  reclaimMessage,
  restoredEmptyMessage,
  saveWithReclaim,
} from "./sessionReclaim";

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

/**
 * F-25: switchTab() 의 동기화 억제·재동기화 훅. `setCloseConfirm()` 과 동일한
 * 주입 패턴이다 — tabs.ts 는 scrollSync.ts 를 import 하지 않는다(D-2).
 */
export interface TabScrollSyncHooks {
  suspend(): void;
  /** 억제 해제 + 에디터 복원 위치 기준 1회 동기화. 순서는 구현이 보장한다. */
  resumeAndSync(): void;
}

let scrollSyncHooks: TabScrollSyncHooks | null = null;

/** main.ts 가 주입한다. 주입하지 않으면 전 경로가 무동작이다(기존 동작 그대로). */
export function setScrollSyncHooks(hooks: TabScrollSyncHooks): void {
  scrollSyncHooks = hooks;
}

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

  // F-54 잔여: 용량 때문에 사본을 비운 탭은 빈 채로 돌아온다. 말하지 않으면
  // 사용자는 문서가 사라진 줄 안다.
  const emptied = session.tabs.filter((t) => t.reclaimed).map((t) => t.fileName);
  if (emptied.length > 0) {
    showNotice(restoredEmptyMessage(emptied), "info", 10000);
  }

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
  if (!target) return; // 가드가 먼저 — 존재하지 않는 ID 는 억제조차 하지 않는다

  scrollSyncHooks?.suspend(); // M10 — 억제가 항상 먼저
  try {
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
  } finally {
    scrollSyncHooks?.resumeAndSync(); // M11 — 억제 해제는 항상 나중. 예외가 나도 억제가 영구히 남지 않게 한다
  }
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

/**
 * 탭 순서를 새 배열대로 다시 세운다 (F-34).
 *
 * `Map` 은 삽입 순서를 보존하므로 **비우고 새 순서로 다시 넣는 것**이 곧
 * 재정렬이다. 세션 영속화도 이 순서를 그대로 쓰므로 새로고침 후에도 유지된다.
 */
function applyOrder(orderedIds: string[]): void {
  if (orderedIds.length !== tabs.size) return; // 계산이 어긋났으면 건드리지 않는다

  const snapshot = new Map(tabs);
  tabs.clear();
  for (const id of orderedIds) {
    const tab = snapshot.get(id);
    if (tab) tabs.set(id, tab);
  }

  // 하나라도 빠졌으면 되돌린다 — 탭이 사라지는 것보다 순서가 그대로인 편이 낫다.
  if (tabs.size !== snapshot.size) {
    tabs.clear();
    for (const [id, tab] of snapshot) tabs.set(id, tab);
    return;
  }

  renderTabs();
  schedulePersist();
}

/** 현재 탭 순서 (F-34 계산부에 넘길 값). */
export function getTabOrder(): string[] {
  return [...tabs.keys()];
}

/** 드래그 결과를 반영한다. */
export function reorderTabByDrop(draggedId: string, targetId: string, insertAfter: boolean): void {
  const order = getTabOrder();
  const from = order.indexOf(draggedId);
  const to = dropIndex(order, draggedId, targetId, insertAfter);
  applyOrder(moveItem(order, from, to));
}

/** 활성 탭을 한 칸 옮긴다 (키보드 경로). 끝에서는 움직이지 않는다. */
export function moveActiveTab(direction: number): void {
  applyOrder(stepItem(getTabOrder(), activeTabId, direction));
}

/** 드래그 중인 탭 id. 드롭 대상 계산에만 쓰인다. */
let draggingTabId: string | null = null;

function clearDropMarkers(): void {
  for (const el of tabBarEl.querySelectorAll(".drop-before, .drop-after")) {
    el.classList.remove("drop-before", "drop-after");
  }
}

function renderTabs(): void {
  tabBarEl.innerHTML = "";

  for (const tab of tabs.values()) {
    const el = document.createElement("div");
    el.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    el.dataset.tabId = tab.id;

    // F-59: 예전에는 <span> 이라 클릭으로만 전환할 수 있었다 — 키보드 사용자는
    // 탭을 아예 바꿀 수 없었다. 실제 <button> 으로 만들면 포커스·Enter·Space 가
    // 브라우저에서 그냥 따라온다(ARIA 로 흉내내지 않는다).
    const nameSpan = document.createElement("button");
    nameSpan.type = "button";
    nameSpan.className = "tab-name";
    nameSpan.textContent = tab.isDirty ? `${tab.fileName} *` : tab.fileName;
    if (tab.id === activeTabId) nameSpan.setAttribute("aria-current", "true");
    el.appendChild(nameSpan);

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.type = "button";
    closeBtn.title = "탭 닫기";
    // 아이콘(×)만으로는 스크린리더가 어느 탭을 닫는지 알 수 없다.
    closeBtn.setAttribute("aria-label", `${tab.fileName} 탭 닫기`);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener("click", () => {
      if (tab.id !== activeTabId) switchTab(tab.id);
    });

    // F-34 드래그 재정렬. 컨테이너를 draggable 로 두면 안쪽 <button> 에서
    // 끌기 시작해도 이 요소가 드래그 소스가 된다.
    el.draggable = true;

    el.addEventListener("dragstart", (e) => {
      draggingTabId = tab.id;
      el.classList.add("dragging");
      // setData 를 호출해야 Firefox 에서 드래그가 시작된다.
      e.dataTransfer?.setData("text/plain", tab.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    el.addEventListener("dragend", () => {
      draggingTabId = null;
      clearDropMarkers();
      el.classList.remove("dragging");
    });

    el.addEventListener("dragover", (e) => {
      if (!draggingTabId || draggingTabId === tab.id) return;
      // preventDefault 를 하지 않으면 브라우저가 "놓을 수 없음" 으로 판정해
      // drop 이 아예 발생하지 않는다.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      // 놓은 탭의 어느 절반인지로 앞/뒤를 가른다 — 항상 앞에 넣으면 마지막
      // 자리로 옮길 방법이 없다.
      const rect = el.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      clearDropMarkers();
      el.classList.add(after ? "drop-after" : "drop-before");
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drop-before", "drop-after");
    });

    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = draggingTabId ?? e.dataTransfer?.getData("text/plain") ?? "";
      const after = el.classList.contains("drop-after");
      clearDropMarkers();
      draggingTabId = null;
      if (draggedId && draggedId !== tab.id) reorderTabByDrop(draggedId, tab.id, after);
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

  // F-54 잔여: 그냥 실패로 두면 자동 저장이 멈춘 채 유지된다. 다시 열 수 있는
  // 탭(깨끗하고·활성 아니고·파일 이름이 있는)의 **저장된 사본만** 비우고
  // 재시도한다. 규칙과 근거는 `sessionReclaim.ts` 에 있다.
  const { saved, reclaimed } = saveWithReclaim(
    createSession(persisted, activeTabId),
    saveSession,
  );

  if (reclaimed.length > 0) {
    showNotice(reclaimMessage(reclaimed), "info", 10000);
  }

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
