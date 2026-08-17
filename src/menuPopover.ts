/**
 * 더보기 팝오버 (이슈 #149).
 *
 * ## `<dialog>` 가 아니다 — 접근성을 직접 만들어야 한다
 *
 * 이 앱의 대화상자 6종은 네이티브 `<dialog>` + `showModal()` 이라 **포커스 트랩·
 * Esc 닫기·백드롭을 공짜로** 받는다. 팝오버는 모달이 아니므로 그 셋이 전부 없다.
 * 여기서 직접 만드는 것:
 *
 * - Esc 로 닫고 **포커스를 연 버튼으로 되돌린다** (안 돌려주면 키보드 사용자는
 *   문서 맨 앞으로 튕긴다)
 * - 바깥 클릭으로 닫되 **`pointerdown` 으로 듣는다** — 대화상자들과 같은 규약이고
 *   (트랩 #25), 누른 채 끌기 시작하는 동작에서도 곧바로 닫힌다. 여기서는 트리거를
 *   따로 걸러내므로 `click` 으로 들어도 여는 클릭이 자기를 닫지는 않는다 —
 *   **테스트로 두 방식을 구별할 수 없다는 뜻이므로, 이 선택은 규약 통일이다.**
 * - ↑↓ 이동, Home/End, Enter/Space 실행
 * - 열 때 첫 항목에 포커스
 *
 * ## 왜 모달이 아닌가
 *
 * 툴바 메뉴는 **문서를 가리면 안 된다.** 모달로 만들면 뒤가 어두워지고 스크롤이
 * 막혀, "인쇄 전에 문서를 한 번 더 보고 싶다" 같은 흐름이 끊긴다.
 *
 * `shortcutHelp.ts` 와 같은 주입형 리프다.
 */

export interface MenuItem {
  /** 표시 이름. 구분선은 `null` 로 넣는다. */
  label: string;
  /** lucide 아이콘 이름. */
  icon?: string;
  /** 오른쪽에 흐리게 보일 단축키 표시. */
  hint?: string;
  /**
   * 이 항목이 대신 실행하는 툴바 액션의 식별자(`data-action`).
   *
   * 툴바에 있던 버튼이 여기로 옮겨 왔을 뿐이므로, **부르는 이름은 그대로 남아야
   * 한다** — 그래야 기존 테스트와 진단이 "그 기능이 어디에 있든" 을 한 셀렉터로
   * 짚는다. 이름을 갈아 끼우면 옮긴 것과 없앤 것이 구별되지 않는다.
   */
  id?: string;
  action: () => void;
}

export type MenuEntry = MenuItem | null;

export interface MenuPopoverHost {
  /** 팝오버를 여는 버튼. `aria-expanded` 가 여기 붙는다. */
  triggerEl: HTMLElement;
  /** 팝오버 컨테이너. 비어 있어야 하며 이 모듈이 채운다. */
  panelEl: HTMLElement;
  entries: readonly MenuEntry[];
  /** 아이콘 SVG 를 만든다. 앱이 툴바와 같은 함수를 넘긴다. */
  renderIcon?: (name: string) => string;
}

export interface MenuPopoverController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** 그려진 항목 수(구분선 제외). 테스트·진단용. */
  count(): number;
}

const noopController: MenuPopoverController = {
  open() {},
  close() {},
  isOpen: () => false,
  count: () => 0,
};

let initialized = false;

export function initMenuPopover(host: MenuPopoverHost): MenuPopoverController {
  if (initialized) {
    console.warn("[menuPopover] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { triggerEl, panelEl } = host;
    const entries = [...(host.entries ?? [])];
    let open = false;

    panelEl.setAttribute("role", "menu");
    triggerEl.setAttribute("aria-haspopup", "true");
    triggerEl.setAttribute("aria-expanded", "false");

    const items: HTMLButtonElement[] = [];

    for (const entry of entries) {
      if (!entry) {
        const sep = panelEl.ownerDocument.createElement("div");
        sep.className = "menu-separator";
        // 구분선은 장식이다 — 메뉴 항목으로 세어지면 화살표 이동이 빈 칸에 멈춘다.
        sep.setAttribute("aria-hidden", "true");
        panelEl.appendChild(sep);
        continue;
      }

      const item = panelEl.ownerDocument.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      item.setAttribute("role", "menuitem");
      if (entry.id) item.dataset.action = entry.id;
      // 화살표로만 이동하므로 Tab 순서에서는 뺀다 — 메뉴 안에서 Tab 을 누르면
      // 팝오버를 벗어나야 하지, 항목 사이를 오가서는 안 된다.
      item.tabIndex = -1;

      if (entry.icon && host.renderIcon) {
        const iconWrap = panelEl.ownerDocument.createElement("span");
        iconWrap.className = "menu-icon";
        iconWrap.setAttribute("aria-hidden", "true");
        iconWrap.innerHTML = host.renderIcon(entry.icon);
        item.appendChild(iconWrap);
      }

      const label = panelEl.ownerDocument.createElement("span");
      label.className = "menu-label";
      label.textContent = entry.label;
      item.appendChild(label);

      if (entry.hint) {
        const hint = panelEl.ownerDocument.createElement("span");
        hint.className = "menu-hint";
        hint.textContent = entry.hint;
        item.appendChild(hint);
      }

      item.addEventListener("click", () => {
        // **먼저 닫는다.** 열린 채로 동작하면 그 동작이 대화상자를 여는 경우
        // 팝오버가 그 위에 남는다.
        controller.close();
        try {
          entry.action();
        } catch (error) {
          console.warn("[menuPopover] 항목 실행 실패:", error);
        }
      });

      panelEl.appendChild(item);
      items.push(item);
    }

    function focusAt(index: number): void {
      if (items.length === 0) return;
      const i = ((index % items.length) + items.length) % items.length;
      items[i].focus();
    }

    function currentIndex(): number {
      return items.indexOf(panelEl.ownerDocument.activeElement as HTMLButtonElement);
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!open) return;
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          controller.close();
          break;
        case "ArrowDown":
          event.preventDefault();
          focusAt(currentIndex() + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusAt(currentIndex() - 1);
          break;
        case "Home":
          event.preventDefault();
          focusAt(0);
          break;
        case "End":
          event.preventDefault();
          focusAt(items.length - 1);
          break;
        case "Tab":
          // 메뉴 안에 가두지 않는다 — Tab 은 팝오버를 닫고 밖으로 나간다.
          controller.close();
          break;
        default:
          break;
      }
    };

    /** 바깥 클릭. 트리거와 패널 안쪽은 제외한다. */
    const onPointerDown = (event: PointerEvent): void => {
      if (!open) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (panelEl.contains(target) || triggerEl.contains(target)) return;
      controller.close();
    };

    const controller: MenuPopoverController = {
      isOpen: () => open,
      count: () => items.length,

      open() {
        if (open || items.length === 0) return;
        open = true;
        panelEl.hidden = false;
        triggerEl.setAttribute("aria-expanded", "true");
        panelEl.ownerDocument.addEventListener("keydown", onKeyDown, true);
        panelEl.ownerDocument.addEventListener("pointerdown", onPointerDown, true);
        focusAt(0);
      },

      close() {
        if (!open) return;
        open = false;
        panelEl.hidden = true;
        triggerEl.setAttribute("aria-expanded", "false");
        panelEl.ownerDocument.removeEventListener("keydown", onKeyDown, true);
        panelEl.ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
        // **포커스를 연 버튼으로 되돌린다.** 안 돌려주면 키보드 사용자는 문서
        // 맨 앞으로 튕겨 방금 있던 자리를 잃는다.
        triggerEl.focus({ preventScroll: true });
      },
    };

    triggerEl.addEventListener("click", (event) => {
      event.preventDefault();
      if (open) controller.close();
      else controller.open();
    });

    panelEl.hidden = true;
    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[menuPopover] 초기화 실패:", error);
    return noopController;
  }
}
