/**
 * F-36 최근 파일 목록 — UI (이슈 #64).
 *
 * 이 기능에서 **정직하게 다뤄야 할 것은 파일 핸들의 수명**이다(트랩 #6).
 *
 * | 상태 | 언제 | 목록을 누르면 |
 * |------|------|---------------|
 * | 살아 있음 | 이번 세션에서 연/저장한 파일 | **바로 열린다** |
 * | 끊김 | 새로고침 뒤, 또는 폴백 브라우저 | 파일 선택 창이 열린다 (안내와 함께) |
 *
 * 두 상태를 구분해 보여주지 않으면, 사용자는 목록을 눌렀는데 파일 선택 창이
 * 뜨는 것을 **버그로 받아들인다.** 그래서 항목마다 상태를 표시하고, 끊긴 항목을
 * 누를 때는 이유를 함께 알린다.
 *
 * `editorSettings.ts`·`shortcutHelp.ts` 와 같은 `<dialog>` 주입형 리프다.
 */

import { formatRelativeTime, type RecentEntry } from "./recentFiles";

export interface RecentFilesHost {
  dialogEl: HTMLDialogElement;
  listEl: HTMLElement;
  emptyEl: HTMLElement;
  closeEl: HTMLElement;
  /** 저장된 목록을 읽는다. */
  load: () => RecentEntry[];
  /** 목록을 저장한다. */
  save: (list: RecentEntry[]) => void;
  /** 이 이름의 핸들이 지금 세션에 살아 있는가. */
  isLive: (name: string) => boolean;
  /** 살아 있는 핸들로 연다. */
  openLive: (name: string) => void;
  /** 핸들이 없을 때 — 파일 선택 창을 연다. */
  openPicker: () => void;
  /** 사용자에게 보이는 안내. */
  notify?: (message: string) => void;
  /** 현재 시각. 테스트가 고정값을 주입한다 — `Date.now()` 를 직접 읽지 않는다. */
  now?: () => number;
  returnFocusTo?: HTMLElement | null;
}

export interface RecentFilesController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** 파일을 연/저장한 뒤 호출한다. */
  record(name: string): void;
  list(): RecentEntry[];
}

const noopController: RecentFilesController = {
  open() {},
  close() {},
  isOpen: () => false,
  record() {},
  list: () => [],
};

let initialized = false;

export function initRecentFiles(host: RecentFilesHost): RecentFilesController {
  if (initialized) {
    console.warn("[recentFiles] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { dialogEl, listEl, emptyEl } = host;
    const now = host.now ?? (() => Date.now());
    let entries = host.load();

    function render(): void {
      listEl.textContent = "";
      emptyEl.hidden = entries.length > 0;

      for (const entry of entries) {
        const live = host.isLive(entry.name);

        const row = document.createElement("li");
        row.className = "recent-row";
        row.dataset.live = String(live);

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "recent-open";
        // 상태를 이름에 담는다 — 색이나 아이콘만으로는 스크린리더에 전달되지 않는다.
        openBtn.setAttribute(
          "aria-label",
          live ? `${entry.name} 열기` : `${entry.name} — 파일을 다시 선택해서 열기`,
        );

        const nameEl = document.createElement("span");
        nameEl.className = "recent-name";
        nameEl.textContent = entry.name;
        openBtn.appendChild(nameEl);

        const metaEl = document.createElement("span");
        metaEl.className = "recent-meta";
        metaEl.textContent = live
          ? formatRelativeTime(entry.at, now())
          : "다시 선택 필요";
        openBtn.appendChild(metaEl);

        openBtn.addEventListener("click", () => {
          controller.close();
          if (live) {
            host.openLive(entry.name);
            return;
          }
          // 핸들은 직렬화되지 않는다(트랩 #6). 왜 선택 창이 뜨는지 알려 준다.
          host.notify?.(
            `브라우저 보안 때문에 새로고침 후에는 파일 권한이 유지되지 않습니다. "${entry.name}" 을(를) 다시 선택해주세요.`,
          );
          host.openPicker();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "recent-remove";
        removeBtn.textContent = "×";
        removeBtn.setAttribute("aria-label", `${entry.name} 을(를) 목록에서 지우기`);
        removeBtn.addEventListener("click", () => {
          entries = entries.filter((e) => e.name !== entry.name);
          persist();
          render();
        });

        row.append(openBtn, removeBtn);
        listEl.appendChild(row);
      }
    }

    function persist(): void {
      try {
        host.save(entries);
      } catch {
        // 저장 실패가 목록 사용을 막으면 안 된다.
      }
    }

    const controller: RecentFilesController = {
      isOpen: () => dialogEl.open,
      list: () => [...entries],

      open() {
        if (dialogEl.open) return;
        render(); // 열 때마다 다시 그린다 — 핸들 생존 여부가 그새 바뀔 수 있다
        dialogEl.showModal();
      },

      close() {
        if (!dialogEl.open) return;
        dialogEl.close();
      },

      record(name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        entries = [
          { name: trimmed, at: now() },
          ...entries.filter((e) => e.name !== trimmed),
        ].slice(0, 10);
        persist();
      },
    };

    host.closeEl.addEventListener("click", () => controller.close());

    dialogEl.addEventListener("close", () => {
      host.returnFocusTo?.focus({ preventScroll: true });
    });

    dialogEl.ownerDocument.addEventListener("pointerdown", (event) => {
      if (!dialogEl.open) return;
      const rect = dialogEl.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) controller.close();
    });

    render();
    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[recentFiles] 초기화 실패:", error);
    return noopController;
  }
}
