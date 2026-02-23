import { createEditor } from "./editor";
import { initToolbar } from "./toolbar";

const editorEl = document.querySelector<HTMLTextAreaElement>("#editor");
const previewEl = document.querySelector<HTMLElement>("#preview");
const toolbarEl = document.querySelector<HTMLElement>("#toolbar-actions");

if (editorEl && previewEl) {
  createEditor({ editorEl, previewEl });

  if (toolbarEl) {
    initToolbar(toolbarEl, editorEl);
  }
}
