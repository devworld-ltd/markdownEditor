import { openFile, saveFile, saveFileAs } from "./fileOps";
import { UNTITLED, closeTab, createTab, getActiveTab } from "./tabs";
import { findShortcut, type ShortcutId } from "./shortcutDefs";

/**
 * 웹 환경 단축키 디스패치.
 *
 * 조합 판별은 이 파일에 없다 — `shortcutDefs.ts` 가 유일한 정의이고, 안내
 * UI(`shortcutHelp.ts`)도 같은 정의를 읽는다. 그래서 단축키를 추가하면 안내
 * 목록에 **자동으로** 나타난다. 예전처럼 여기서 직접 `e.key` 를 비교하면
 * 안내가 조용히 낡는다(F-58, 이슈 #40).
 *
 * 네이티브 버전의 Cmd+W(탭 닫기)는 브라우저가 선점해 preventDefault 로도 막을 수
 * 없다. 그래서 문서 탭 닫기/새 문서는 Alt 조합으로 옮겼고, Alt 조합은 macOS 에서
 * `e.key` 가 특수문자로 바뀌므로 `e.code` 로 판별한다 — 그 판별도 정의 쪽에 있다.
 */

export interface ShortcutHandlers {
  /** 단축키 목록 열기/닫기. 안내 UI 초기화에 실패하면 넘어오지 않는다. */
  toggleHelp?: () => void;
}

export function initShortcuts(handlers: ShortcutHandlers = {}): void {
  // Record<ShortcutId, …> 라서 새 단축키를 정의에 추가하면 여기가 **타입 오류로**
  // 막힌다. 정의만 늘리고 동작을 빠뜨리는 사고가 컴파일 단계에서 걸린다.
  const dispatch: Record<ShortcutId, () => void> = {
    open: () => void openFile(),
    save: () => void saveFile(),
    saveAs: () => void saveFileAs(),
    newTab: () => createTab("", null, UNTITLED),
    closeTab: () => {
      const tab = getActiveTab();
      if (tab) closeTab(tab.id);
    },
    help: () => handlers.toggleHelp?.(),
  };

  document.addEventListener("keydown", (e) => {
    const shortcut = findShortcut(e);
    if (!shortcut) return;

    e.preventDefault();
    dispatch[shortcut.id]();
  });
}
