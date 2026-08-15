/**
 * F-36 최근 파일 목록 — UI (이슈 #64, #125).
 *
 * 이 기능에서 **정직하게 다뤄야 할 것은 파일 핸들의 수명**이다(트랩 #6).
 *
 * | 상태 | 언제 | 목록을 누르면 |
 * |------|------|---------------|
 * | 살아 있음 | 이번 세션에서 연/저장한 파일 | **바로 열린다** |
 * | 되살릴 수 있음 | 새로고침 뒤 — 핸들이 보관돼 있다(#125) | **권한을 한 번 확인하고 바로 열린다** |
 * | 끊김 | 보관된 핸들이 없거나 폴백 브라우저 | 파일 선택 창이 열린다 (안내와 함께) |
 *
 * 세 상태를 구분해 보여주지 않으면, 사용자는 목록을 눌렀는데 파일 선택 창이
 * 뜨는 것을 **버그로 받아들인다.** 그래서 항목마다 상태를 표시하고, 끊긴 항목을
 * 누를 때는 이유를 함께 알린다.
 *
 * **"되살릴 수 있음" 을 낙관해서 표시하지 말 것.** 보관된 핸들이 있어도 사용자가
 * 권한을 거부하면 못 연다. 그래서 라벨은 "바로 열림" 이 아니라 권한 확인이
 * 있을 수 있음을 담는다 — 기대와 다른 창이 뜨는 것이 이 기능의 유일한 실패 모드다.
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
  /**
   * 보관된 핸들로 연다 (#125). 권한 확인까지 포함한다.
   *
   * `true` 면 열었다는 뜻이고, `false` 면 호출부가 파일 선택 창으로 되돌린다.
   * 주입하지 않으면(구형 브라우저·보관 불가) 예전 동작 그대로다.
   */
  openStored?: (name: string) => Promise<boolean>;
  /** 보관 중인 이름 전부 (#125). 목록의 상태 표시에 쓴다. */
  listStored?: () => Promise<string[]>;
  /** 목록에서 지운 항목의 보관 핸들도 버린다 (#125). */
  forgetStored?: (name: string) => void;
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
    /** 보관된 핸들이 있는 이름들 (#125). 대화상자를 열 때마다 다시 읽는다. */
    let stored = new Set<string>();

    /**
     * 이 항목을 지금 어떻게 열 수 있는가.
     *
     * `live` 는 동기로 알 수 있지만 `stored` 는 IndexedDB 라 비동기다 — 그래서
     * 열 때 한 번 읽어 두고, 도착하면 다시 그린다. 목록이 비어 보이는 순간을
     * 만들지 않으려고 **먼저 그리고 나중에 갱신**한다.
     */
    function stateOf(name: string): "live" | "stored" | "stale" {
      if (host.isLive(name)) return "live";
      return stored.has(name) ? "stored" : "stale";
    }

    function render(): void {
      listEl.textContent = "";
      emptyEl.hidden = entries.length > 0;

      for (const entry of entries) {
        const state = stateOf(entry.name);
        const live = state !== "stale";

        const row = document.createElement("li");
        row.className = "recent-row";
        row.dataset.live = String(live);
        row.dataset.state = state;

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "recent-open";
        // 상태를 이름에 담는다 — 색이나 아이콘만으로는 스크린리더에 전달되지 않는다.
        openBtn.setAttribute(
          "aria-label",
          state === "live"
            ? `${entry.name} 열기`
            : state === "stored"
              ? `${entry.name} — 파일 접근을 허용하고 열기`
              : `${entry.name} — 파일을 다시 선택해서 열기`,
        );

        const nameEl = document.createElement("span");
        nameEl.className = "recent-name";
        nameEl.textContent = entry.name;
        openBtn.appendChild(nameEl);

        const metaEl = document.createElement("span");
        metaEl.className = "recent-meta";
        metaEl.textContent =
          state === "live"
            ? formatRelativeTime(entry.at, now())
            : state === "stored"
              ? `${formatRelativeTime(entry.at, now())} · 접근 허용 필요`
              : "다시 선택 필요";
        openBtn.appendChild(metaEl);

        openBtn.addEventListener("click", () => {
          controller.close();
          if (state === "live") {
            host.openLive(entry.name);
            return;
          }

          if (state === "stored" && host.openStored) {
            // **이 호출은 클릭 핸들러 안에 있어야 한다** — 권한 요청은 사용자
            // 제스처 밖에서 조용히 거부된다. `await` 로 감싸 뒤로 미루지 말 것.
            void host.openStored(entry.name).then((opened) => {
              if (opened) return;
              host.notify?.(
                `"${entry.name}" 에 접근할 수 없어 파일을 다시 선택합니다.`,
              );
              host.openPicker();
            });
            return;
          }

          // 보관된 핸들이 없다 — 이 브라우저에서 연 적이 없거나 정리됐다.
          host.notify?.(
            `"${entry.name}" 의 파일 위치를 알 수 없습니다. 파일을 다시 선택해주세요.`,
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
          // 목록에 없는 핸들은 쓸 데가 없다 — 함께 버린다 (#125).
          stored.delete(entry.name);
          host.forgetStored?.(entry.name);
          persist();
          render();
        });

        row.append(openBtn, removeBtn);
        listEl.appendChild(row);
      }
    }

    /**
     * 보관 목록을 다시 읽고, 달라졌으면 다시 그린다 (#125).
     *
     * **달라졌을 때만** 그린다 — 열 때마다 무조건 다시 그리면 사용자가 막
     * 옮긴 포커스가 날아간다.
     */
    async function refreshStored(): Promise<void> {
      if (!host.listStored) return;
      try {
        const names = new Set(await host.listStored());
        const changed =
          names.size !== stored.size || [...names].some((n) => !stored.has(n));
        stored = names;
        if (changed && dialogEl.open) render();
      } catch {
        // 보관 목록을 못 읽어도 목록 자체는 쓸 수 있어야 한다.
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
        void refreshStored();
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
