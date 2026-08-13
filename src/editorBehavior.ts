/**
 * F-26 리스트 이어쓰기 · F-27 Tab 들여쓰기 — 편집 영역 배선 (이슈 #78·#79).
 *
 * 계산은 `editorKeys.ts`(순수)가 하고, 여기서는 **키 이벤트를 계산에 연결**한다.
 *
 * ## 반드시 지켜야 할 두 가지
 *
 * 1. **`execCommand("insertText")` 로 넣는다.** `value` 대입은 Cmd+Z 실행 취소
 *    스택을 통째로 날린다. 목록 이어쓰기·들여쓰기는 되돌리고 싶은 일이 잦다.
 * 2. **Tab 으로 편집 영역을 빠져나갈 수 있어야 한다.** Tab 을 무조건 가로채면
 *    키보드 사용자가 편집 영역에 **갇힌다**. Esc 를 먼저 누르면 다음 Tab 은
 *    브라우저 기본 동작(포커스 이동)으로 돌려준다(F-59).
 *
 * ## 조합 입력(IME)
 *
 * 한글·일본어 조합 중의 Enter 는 **글자를 확정하는 키**다. 여기서 가로채면 조합이
 * 깨지거나 중복 입력된다. `isComposing` 이 true 면 아무것도 하지 않는다.
 */

import {
  computeIndent,
  computeListContinuation,
  computeOutdent,
  type IndentResult,
} from "./editorKeys";

export interface EditorBehaviorHost {
  editorEl: HTMLTextAreaElement;
  /**
   * 선택 영역을 대체한다. 기본 구현은 `execCommand("insertText")` —
   * **이것을 `value` 대입으로 바꾸면 실행 취소가 죽는다.**
   */
  insertText?: (textarea: HTMLTextAreaElement, text: string) => void;
  /** 사용자에게 보이는 안내 (Tab 탈출 힌트). */
  notify?: (message: string) => void;
}

export interface EditorBehaviorController {
  /** Tab 이 들여쓰기로 동작하는가 (Esc 를 누르면 한 번 풀린다). */
  isTabCapturing(): boolean;
}

const noopController: EditorBehaviorController = { isTabCapturing: () => false };

let initialized = false;

function defaultInsertText(textarea: HTMLTextAreaElement, text: string): void {
  textarea.ownerDocument.execCommand("insertText", false, text);
}

export function initEditorBehavior(host: EditorBehaviorHost): EditorBehaviorController {
  if (initialized) {
    console.warn("[editorBehavior] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { editorEl } = host;
    const insertText = host.insertText ?? defaultInsertText;

    /**
     * Esc 를 누르면 **다음 Tab 한 번**은 포커스 이동으로 돌려준다.
     * 영구히 끄지 않는 이유: 다시 켜는 방법을 사용자가 알 수 없다.
     */
    let tabEscapeArmed = false;

    function applyEdit(result: IndentResult): void {
      editorEl.setSelectionRange(result.start, result.end);
      insertText(editorEl, result.replacement);
      editorEl.setSelectionRange(result.selectionStart, result.selectionEnd);
    }

    editorEl.addEventListener("keydown", (event) => {
      // 조합 입력 중에는 관여하지 않는다 — Enter 가 글자를 확정하는 키다.
      if (event.isComposing || event.keyCode === 229) return;

      if (event.key === "Escape") {
        if (!tabEscapeArmed) {
          tabEscapeArmed = true;
          host.notify?.("다음 Tab 은 다음 요소로 이동합니다.");
        }
        return;
      }

      if (event.key === "Tab") {
        if (tabEscapeArmed) {
          // 갇히지 않게 한 번은 그냥 보내 준다.
          tabEscapeArmed = false;
          return;
        }
        event.preventDefault();
        const { value, selectionStart, selectionEnd } = editorEl;
        applyEdit(
          event.shiftKey
            ? computeOutdent(value, selectionStart, selectionEnd)
            : computeIndent(value, selectionStart, selectionEnd),
        );
        return;
      }

      // 다른 키를 누르면 탈출 예약은 사라진다 — Esc 직후의 Tab 에만 적용된다.
      tabEscapeArmed = false;

      if (event.key === "Enter" && !event.shiftKey) {
        const { value, selectionStart, selectionEnd } = editorEl;
        const result = computeListContinuation(value, selectionStart, selectionEnd);
        if (!result) return; // 목록이 아니면 기본 동작

        event.preventDefault();
        editorEl.setSelectionRange(result.start, result.end);
        insertText(editorEl, result.replacement);
      }
    });

    initialized = true;
    return { isTabCapturing: () => !tabEscapeArmed };
  } catch (error) {
    console.warn("[editorBehavior] 초기화 실패:", error);
    return noopController;
  }
}
