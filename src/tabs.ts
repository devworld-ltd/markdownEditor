import { renderPreview } from "./preview";

export interface TabState {
  id: string;
  filePath: string | null;
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

function generateId(): string {
  return `tab-${nextId++}`;
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

  createTab("", null, "Untitled");
}

export function createTab(
  content = "",
  filePath: string | null = null,
  fileName = "Untitled",
): string {
  const id = generateId();
  const tab: TabState = {
    id,
    filePath,
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
  if (!tabs.has(id)) return;

  tabs.delete(id);

  if (tabs.size === 0) {
    createTab("", null, "Untitled");
    return;
  }

  if (activeTabId === id) {
    // Activate the last remaining tab (by insertion order)
    const keys = [...tabs.keys()];
    switchTab(keys[keys.length - 1]);
  } else {
    renderTabs();
  }
}

export function switchTab(id: string): void {
  const target = tabs.get(id);
  if (!target) return;

  // Save current tab state
  if (activeTabId && tabs.has(activeTabId)) {
    const current = tabs.get(activeTabId)!;
    current.content = editorEl.value;
    current.scrollTop = editorEl.scrollTop;
    current.selectionStart = editorEl.selectionStart;
    current.selectionEnd = editorEl.selectionEnd;
  }

  activeTabId = id;

  // Restore target tab state
  editorEl.value = target.content;
  editorEl.scrollTop = target.scrollTop;
  editorEl.setSelectionRange(target.selectionStart, target.selectionEnd);
  renderPreview(previewEl, target.content);

  renderTabs();
  updateTitle();
}

export function getActiveTab(): TabState | undefined {
  return tabs.get(activeTabId);
}

export function markActiveTabDirty(): void {
  const tab = tabs.get(activeTabId);
  if (tab && !tab.isDirty) {
    tab.isDirty = true;
    renderTabs();
    updateTitle();
  }
}

export function findTabByPath(filePath: string): TabState | undefined {
  for (const tab of tabs.values()) {
    if (tab.filePath === filePath) return tab;
  }
  return undefined;
}

export function updateActiveTab(updates: Partial<Pick<TabState, "filePath" | "fileName" | "isDirty" | "content">>): void {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  Object.assign(tab, updates);
  renderTabs();
  updateTitle();
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
    closeBtn.textContent = "\u00d7";
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
  const name = tab.filePath ? tab.fileName : "Markup Editor";
  const display = tab.isDirty ? `${name} *` : name;
  titleEl.textContent = display;
  document.title = display;
}
