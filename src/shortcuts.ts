import { openFile, saveFile } from "./fileOps";
import { getActiveTab, closeTab } from "./tabs";

export function initShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    if (!e.metaKey) return;

    switch (e.key) {
      case "o":
        e.preventDefault();
        openFile();
        break;
      case "s":
        e.preventDefault();
        saveFile();
        break;
      case "w":
        e.preventDefault();
        const tab = getActiveTab();
        if (tab) closeTab(tab.id);
        break;
    }
  });
}
