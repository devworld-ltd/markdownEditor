/**
 * F-35 편집 설정 UI (이슈 #63).
 *
 * 설계 판단:
 *
 * 1) **`<dialog>` 를 쓴다.** F-58 단축키 안내와 같은 이유 — 포커스 트랩·Esc·
 *    백드롭을 브라우저가 정확히 해 준다. 같은 패턴을 두 번째로 쓰는 것이라
 *    사용자에게도 일관된다.
 * 2) **편집 영역에만 적용한다.** 프리뷰 글자 크기까지 바꾸면 내보내기(F-38)와
 *    인쇄(F-39) 결과가 사람마다 달라진다 — 그건 문서를 받는 쪽의 몫이다.
 * 3) **CSS 변수 두 개만 바꾼다.** 클래스 토글이나 인라인 스타일을 요소마다
 *    붙이면 나중에 규칙이 늘 때 적용 지점이 흩어진다.
 * 4) **웹폰트 없음.** 네트워크 요청이 없는 앱이고 CSP 도 `font-src 'self' data:`
 *    다. 선택지는 시스템 글꼴 폴백 사슬뿐이다.
 *
 * `splitter.ts`·`viewMode.ts` 와 같은 주입형 리프다.
 */

import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE,
  FONT_CHOICES,
  clampFontSize,
  fontStackOf,
  parseFontId,
  stepFontSize,
} from "./editorPrefs";

export interface EditorSettingsHost {
  /** CSS 변수를 심을 요소 (보통 `document.documentElement`) */
  rootEl: HTMLElement;
  dialogEl: HTMLDialogElement;
  /** 글꼴 선택 `<select>` */
  fontSelectEl: HTMLSelectElement;
  /** 크기 표시 */
  sizeValueEl: HTMLElement;
  decreaseEl: HTMLElement;
  increaseEl: HTMLElement;
  resetEl: HTMLElement;
  closeEl: HTMLElement;
  loadPrefs?: () => { fontId?: unknown; fontSize?: unknown };
  savePrefs?: (prefs: { fontId: string; fontSize: number }) => void;
  returnFocusTo?: HTMLElement | null;
}

export interface EditorSettingsController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  getPrefs(): { fontId: string; fontSize: number };
}

const noopController: EditorSettingsController = {
  open() {},
  close() {},
  isOpen: () => false,
  getPrefs: () => ({ fontId: DEFAULT_FONT_ID, fontSize: DEFAULT_FONT_SIZE }),
};

let initialized = false;

export function initEditorSettings(host: EditorSettingsHost): EditorSettingsController {
  if (initialized) {
    console.warn("[editorSettings] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { rootEl, dialogEl, fontSelectEl, sizeValueEl } = host;

    const stored = host.loadPrefs?.() ?? {};
    let fontId = parseFontId(stored.fontId);
    let fontSize = clampFontSize(stored.fontSize);

    // 글꼴 목록은 정의에서 만든다 — HTML 에 다시 적으면 둘이 어긋난다.
    fontSelectEl.textContent = "";
    for (const choice of FONT_CHOICES) {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = choice.label;
      fontSelectEl.appendChild(option);
    }

    function paint(): void {
      rootEl.style.setProperty("--editor-font-size", `${fontSize}px`);
      rootEl.style.setProperty("--editor-font-family", fontStackOf(fontId));
      fontSelectEl.value = fontId;
      sizeValueEl.textContent = `${fontSize}px`;
    }

    function persist(): void {
      try {
        host.savePrefs?.({ fontId, fontSize });
      } catch {
        // 저장 실패가 설정 변경을 막으면 안 된다.
      }
    }

    function apply(): void {
      paint();
      persist();
    }

    const controller: EditorSettingsController = {
      isOpen: () => dialogEl.open,
      getPrefs: () => ({ fontId, fontSize }),

      open() {
        if (dialogEl.open) return;
        dialogEl.showModal();
      },

      close() {
        if (!dialogEl.open) return;
        dialogEl.close();
      },
    };

    fontSelectEl.addEventListener("change", () => {
      fontId = parseFontId(fontSelectEl.value);
      apply();
    });

    host.decreaseEl.addEventListener("click", () => {
      fontSize = stepFontSize(fontSize, -1);
      apply();
    });

    host.increaseEl.addEventListener("click", () => {
      fontSize = stepFontSize(fontSize, 1);
      apply();
    });

    host.resetEl.addEventListener("click", () => {
      fontId = DEFAULT_FONT_ID;
      fontSize = DEFAULT_FONT_SIZE;
      apply();
    });

    host.closeEl.addEventListener("click", () => controller.close());

    dialogEl.addEventListener("close", () => {
      host.returnFocusTo?.focus({ preventScroll: true });
    });

    // 바깥 클릭으로 닫기 — shortcutHelp.ts 와 같은 이유로 좌표 기반 + pointerdown.
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

    paint(); // 저장된 값을 즉시 반영한다 (저장은 하지 않는다 — 바뀐 게 없다)
    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[editorSettings] 초기화 실패:", error);
    return noopController;
  }
}
