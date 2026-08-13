/**
 * F-58 잔여 — 단축키 안내 UI (이슈 #40).
 *
 * 웹에는 메뉴바가 없다. 네이티브 앱이라면 메뉴를 열어 단축키를 발견하지만, 이
 * 에디터에서는 `⌥N`·`⌥W` 같은 **비표준 조합**을 알아낼 통로가 아예 없었다.
 * 그 조합들이 비표준인 것도 자의가 아니라 브라우저가 `⌘N`/`⌘W` 를 선점해
 * `preventDefault()` 로도 막을 수 없기 때문이라(CLAUDE.md 트랩 #4), 안내의
 * 필요성은 오히려 더 크다.
 *
 * 설계 판단:
 *
 * 1) **네이티브 `<dialog>` 를 쓴다.** 포커스 트랩·Esc 닫기·백드롭·`inert` 처리를
 *    브라우저가 이미 정확히 해 준다. 직접 구현하면 그 전부를 다시 만들어야 하고,
 *    이 저장소에서 포커스 관련 버그가 이미 두 번 났다(탭 전환 커서 리셋,
 *    F-69 알림 포커스 순서). 접근성은 손으로 만들 때 가장 조용히 틀리는 영역이다.
 * 2) **목록은 `shortcutDefs.ts` 에서 파생한다.** 여기에 목록을 다시 쓰면 단축키를
 *    추가할 때 안내가 조용히 낡는다 — 안내가 거짓말하는 것은 안내가 없는 것보다
 *    나쁘다.
 * 3) **플랫폼 판정은 주입받는다.** `navigator` 를 직접 읽으면 테스트가 전역 패치에
 *    의존하게 된다(이 저장소에서 여섯 번 확인된 교훈, CLAUDE.md 트랩 #15).
 * 4) **여는 경로가 둘이다.** 툴바 버튼과 `⌥/`. 단축키만 두면 "단축키를 알려주는
 *    기능을 단축키로만 열 수 있는" 순환이 된다.
 *
 * `offline.ts`·`fsLimitNotice.ts`·`scrollSync.ts` 와 동일한 주입형 리프 모듈이다 —
 * `shortcutDefs.ts`(순수 데이터) 외에는 앱 모듈을 import 하지 않는다.
 */

import { groupShortcuts } from "./shortcutDefs";

export interface ShortcutHelpHost {
  /** index.html 에 정적으로 존재하는 <dialog id="shortcut-help"> */
  dialogEl: HTMLDialogElement;
  /** 목록이 그려질 컨테이너 */
  listEl: HTMLElement;
  /** 닫기 버튼 */
  closeEl: HTMLElement;
  /** Apple 계열이면 ⌘/⌥ 로 표기한다. 호출자가 판단해 넘긴다(D-3). */
  isApplePlatform: boolean;
  /** 닫은 뒤 포커스를 되돌릴 요소 */
  returnFocusTo?: HTMLElement | null;
}

export interface ShortcutHelpController {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

const noopController: ShortcutHelpController = {
  open() {},
  close() {},
  toggle() {},
  isOpen: () => false,
};

let initialized = false;

/** 호출자가 넘길 값. `navigator` 를 이 모듈이 직접 읽지 않기 위한 헬퍼다. */
export function detectApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}

function renderList(listEl: HTMLElement, isApplePlatform: boolean): void {
  listEl.textContent = ""; // innerHTML 을 쓰지 않는다 — 이 목록에 사용자 입력은 없지만
  // 정화 파이프라인을 우회하는 DOM 주입 경로를 새로 만들지 않는다(F-18).

  for (const { group, items } of groupShortcuts()) {
    const section = document.createElement("section");
    section.className = "shortcut-group";

    const heading = document.createElement("h3");
    heading.className = "shortcut-group-title";
    heading.textContent = group;
    section.appendChild(heading);

    const list = document.createElement("dl");
    list.className = "shortcut-list";

    for (const shortcut of items) {
      const term = document.createElement("dt");
      term.className = "shortcut-keys";
      for (const cap of isApplePlatform ? shortcut.keys.apple : shortcut.keys.other) {
        const kbd = document.createElement("kbd");
        kbd.textContent = cap;
        term.appendChild(kbd);
      }

      const description = document.createElement("dd");
      description.className = "shortcut-label";
      description.textContent = shortcut.label;
      if (shortcut.note) {
        const note = document.createElement("small");
        note.className = "shortcut-note";
        note.textContent = shortcut.note;
        description.appendChild(note);
      }

      list.append(term, description);
    }

    section.appendChild(list);
    listEl.appendChild(section);
  }
}

export function initShortcutHelp(host: ShortcutHelpHost): ShortcutHelpController {
  if (initialized) {
    console.warn("[shortcutHelp] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { dialogEl, listEl, closeEl, isApplePlatform, returnFocusTo } = host;

    renderList(listEl, isApplePlatform);

    const controller: ShortcutHelpController = {
      isOpen: () => dialogEl.open,

      open() {
        if (dialogEl.open) return;
        // showModal() 이라야 포커스 트랩·백드롭·Esc 가 붙는다. show() 는 아니다.
        dialogEl.showModal();
      },

      close() {
        if (!dialogEl.open) return;
        dialogEl.close();
      },

      toggle() {
        if (dialogEl.open) controller.close();
        else controller.open();
      },
    };

    closeEl.addEventListener("click", () => controller.close());

    // Esc 로 닫히는 경로까지 포함해 포커스를 되돌린다. dialog 의 close 이벤트는
    // 닫힌 이유(버튼·Esc·close())와 무관하게 한 번 발생한다.
    dialogEl.addEventListener("close", () => {
      returnFocusTo?.focus({ preventScroll: true });
    });

    // 바깥 클릭으로 닫기 — 두 가지를 피해야 한다.
    //
    // (a) **`event.target === dialogEl` 로 판별하지 않는다.** "백드롭 클릭은
    //     dialog 자신을 타깃으로 준다" 는 통설과 달리, Chromium 은 백드롭 아래에
    //     깔린 실제 요소를 타깃으로 준다(실측: `DIV`). 그래서 좌표가 다이얼로그
    //     사각형 밖인지로 판단한다.
    // (b) **`click` 이 아니라 `pointerdown` 을 쓴다.** 여는 클릭은 `click` 단계에서
    //     처리되므로, 같은 클릭이 계속 버블링해 방금 연 다이얼로그를 즉시 닫는다.
    //     `pointerdown` 은 다이얼로그가 열리기 **전에** 이미 지나갔으므로 이
    //     경합이 구조적으로 생기지 않는다 — 타이머로 무시 구간을 두는 방식과 달리
    //     순서 가정에 기대지 않는다.
    host.dialogEl.ownerDocument.addEventListener("pointerdown", (event) => {
      if (!dialogEl.open) return;
      const rect = dialogEl.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) controller.close();
    });

    initialized = true; // 성공 경로에서만 잠근다
    return controller;
  } catch (error) {
    console.warn("[shortcutHelp] 초기화 실패:", error);
    return noopController;
  }
}
