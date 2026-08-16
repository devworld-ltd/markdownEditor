/**
 * 릴리스 노트 — 화면 (이슈 #131).
 *
 * `CHANGELOG.md` 를 **빌드 시각에 번들에 넣어** 보여준다.
 *
 * ## 왜 받아오지 않고 번들에 넣는가
 *
 * 이 앱은 공유(F-60)를 쓰지 않는 한 **네트워크 요청이 한 건도 없고**, E2E `SH8` 이
 * 그것을 단언한다. `fetch("/releases.json")` 하나면 그 성질이 깨진다. 릴리스 노트는
 * 배포 시각에 이미 확정된 값이므로 받아올 이유도 없다.
 *
 * ## 정화 경로는 하나뿐이다
 *
 * 노트 본문은 마크다운이고 화면에는 HTML 로 들어간다. **반드시 `parseMarkdown()` 을
 * 거친다**(F-18) — 여기서 두 번째 렌더 경로를 만들면 정화 정책이 갈라진다.
 *
 * `recentFilesUi.ts`·`shortcutHelp.ts` 와 같은 `<dialog>` 주입형 리프다.
 */

import type { ReleaseEntry } from "./releaseNotes";
import { latestRelease, shouldAutoShow } from "./releaseNotes";

export interface ReleaseNotesHost {
  dialogEl: HTMLDialogElement;
  listEl: HTMLElement;
  emptyEl: HTMLElement;
  closeEl: HTMLElement;
  /** 현재 앱 버전 (`package.json` 에서 빌드 시각에 주입). */
  currentVersion: string;
  /** 릴리스 목록 — 최신이 맨 앞. */
  entries: readonly ReleaseEntry[];
  /** 마크다운 → **정화된** HTML. 앱은 `parseMarkdown` 을 그대로 넘긴다. */
  render: (markdown: string) => string;
  /** 마지막으로 본 버전을 읽는다. 처음이면 `null`. */
  loadSeen?: () => string | null;
  /** 마지막으로 본 버전을 적는다. */
  saveSeen?: (version: string) => void;
  returnFocusTo?: HTMLElement | null;
}

export interface ReleaseNotesController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** 갱신 뒤 처음이면 자동으로 연다. 열었으면 `true`. */
  maybeAutoShow(): boolean;
  /** 지금 화면에 그려진 버전 수. 테스트·진단용. */
  count(): number;
}

const noopController: ReleaseNotesController = {
  open() {},
  close() {},
  isOpen: () => false,
  maybeAutoShow: () => false,
  count: () => 0,
};

let initialized = false;

export function initReleaseNotes(host: ReleaseNotesHost): ReleaseNotesController {
  if (initialized) {
    console.warn("[releaseNotes] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { dialogEl, listEl, emptyEl } = host;
    const entries = [...(host.entries ?? [])];
    let rendered = false;

    /**
     * 목록을 그린다. **한 번만** 그린다 — 내용이 빌드 시각에 고정이라 다시 그릴
     * 이유가 없고, 매번 그리면 사용자가 펼쳐 둔 항목이 닫힌다.
     */
    function render(): void {
      if (rendered) return;
      rendered = true;

      listEl.textContent = "";
      emptyEl.hidden = entries.length > 0;

      entries.forEach((entry, index) => {
        const item = document.createElement("section");
        item.className = "release-item";
        item.dataset.version = entry.version;

        const heading = document.createElement("h3");
        heading.className = "release-version";
        heading.textContent = entry.date
          ? `${entry.version} · ${entry.date}`
          : entry.version;
        // 현재 쓰고 있는 버전을 짚어 준다 — 목록만 있으면 어디가 지금인지 모른다.
        if (entry.version === host.currentVersion) {
          const badge = document.createElement("span");
          badge.className = "release-current";
          badge.textContent = "지금 버전";
          heading.appendChild(badge);
        }
        item.appendChild(heading);

        const body = document.createElement("div");
        body.className = "release-body";
        // **정화 경로는 하나뿐이다** (F-18). 직접 innerHTML 을 조립하지 말 것.
        body.innerHTML = host.render(entry.body);
        item.appendChild(body);

        // 최신 하나만 펼치고 나머지는 접는다 — 이력이 길어지면 최신이 묻힌다.
        if (index > 0) item.dataset.collapsed = "true";
        listEl.appendChild(item);
      });
    }

    function markSeen(): void {
      try {
        host.saveSeen?.(host.currentVersion);
      } catch {
        // 기록 실패가 열람을 막으면 안 된다. 다음에 한 번 더 뜰 뿐이다.
      }
    }

    const controller: ReleaseNotesController = {
      isOpen: () => dialogEl.open,
      count: () => listEl.querySelectorAll(".release-item").length,

      open() {
        if (dialogEl.open) return;
        render();
        dialogEl.showModal();
        // **연 순간 기록한다.** 닫을 때 기록하면 새로고침으로 닫은 사용자에게
        // 영원히 다시 뜬다.
        markSeen();
      },

      close() {
        if (!dialogEl.open) return;
        dialogEl.close();
      },

      maybeAutoShow() {
        let seen: string | null = null;
        try {
          seen = host.loadSeen?.() ?? null;
        } catch {
          // 읽지 못하면 "처음" 으로 본다 — 모르는 채로 띄우지 않는다.
          return false;
        }
        if (!shouldAutoShow(host.currentVersion, seen)) {
          // 처음 온 사람도 지금 버전은 본 것으로 친다. 그러지 않으면 다음
          // 갱신 때가 아니라 **다음 방문 때** 새 소식이 뜬다.
          markSeen();
          return false;
        }
        if (!latestRelease(entries)) return false;
        controller.open();
        return true;
      },
    };

    host.closeEl.addEventListener("click", () => controller.close());

    dialogEl.addEventListener("close", () => {
      host.returnFocusTo?.focus({ preventScroll: true });
    });

    // 접힌 항목을 눌러 펼친다. 헤딩이 곧 버튼이다.
    listEl.addEventListener("click", (event) => {
      const heading = (event.target as HTMLElement | null)?.closest(".release-version");
      const item = heading?.closest<HTMLElement>(".release-item");
      if (!item) return;
      if (item.dataset.collapsed) delete item.dataset.collapsed;
      else item.dataset.collapsed = "true";
    });

    // 백드롭 클릭으로 닫기. 히트 타깃이 `dialog` 가 아니므로 좌표로 판단하고,
    // `click` 이 아니라 `pointerdown` 으로 듣는다 (트랩 #25).
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

    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[releaseNotes] 초기화 실패:", error);
    return noopController;
  }
}
