import { createEditor } from "./editor";
import { initToolbar, setFileActions } from "./toolbar";
import { initFileOps, openFile, saveFile } from "./fileOps";
import { initShortcuts } from "./shortcuts";
import { initTabs } from "./tabs";

const editorEl = document.querySelector<HTMLTextAreaElement>("#editor");
const previewEl = document.querySelector<HTMLElement>("#preview");
const toolbarEl = document.querySelector<HTMLElement>("#toolbar-actions");
const titleEl = document.querySelector<HTMLElement>(".toolbar h1");
const tabBarEl = document.querySelector<HTMLElement>("#tab-bar");

if (editorEl && previewEl) {
  createEditor({ editorEl, previewEl });

  if (titleEl && tabBarEl) {
    initTabs(tabBarEl, editorEl, previewEl, titleEl);
  }

  initFileOps(editorEl);

  setFileActions(openFile, saveFile);

  if (toolbarEl) {
    initToolbar(toolbarEl, editorEl);
  }

  initShortcuts();
}
