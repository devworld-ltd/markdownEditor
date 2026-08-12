import { openFile, saveFile, saveFileAs } from "./fileOps";
import { UNTITLED, closeTab, createTab, getActiveTab } from "./tabs";

/**
 * 웹 환경 단축키.
 *
 * 네이티브 버전의 Cmd+W(탭 닫기)는 브라우저가 선점해 preventDefault 로도 막을 수
 * 없다. 그래서 문서 탭 닫기/새 문서는 브라우저가 가로채지 않는 Alt 조합으로 옮겼다.
 * Alt 조합은 macOS 에서 e.key 가 특수문자로 바뀌므로 e.code 로 판별한다.
 */
export function initShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case "o":
          e.preventDefault();
          void openFile();
          return;
        case "s":
          e.preventDefault();
          void (e.shiftKey ? saveFileAs() : saveFile());
          return;
      }
      return;
    }

    if (e.altKey && !mod) {
      switch (e.code) {
        case "KeyN":
          e.preventDefault();
          createTab("", null, UNTITLED);
          return;
        case "KeyW": {
          e.preventDefault();
          const tab = getActiveTab();
          if (tab) closeTab(tab.id);
          return;
        }
      }
    }
  });
}
