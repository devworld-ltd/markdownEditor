/**
 * F-29 문서 통계 표시 (이슈 #81).
 *
 * 설계 판단:
 *
 * 1) **선택 영역이 있으면 그 범위의 통계를 보여준다.** 문서 전체 수치는 늘 볼 수
 *    있지만, "이 문단이 몇 자인가" 는 선택했을 때만 알 수 있다.
 * 2) **입력마다 전체를 다시 세지 않는다.** 큰 문서에서 매 글자마다 전체를 훑으면
 *    타이핑이 눈에 띄게 느려진다. 렌더 디바운스(150ms)에 얹는다.
 * 3) **`aria-live` 를 쓰지 않는다.** 글자를 칠 때마다 스크린리더가 숫자를 읽으면
 *    편집이 불가능해진다. 필요할 때 직접 읽도록 `role="status"` 없이 둔다.
 *
 * 주입형 리프다.
 */

import { computeStats, formatStats } from "./docStats";

export interface StatusBarHost {
  barEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
  loadEnabled?: () => boolean;
  saveEnabled?: (enabled: boolean) => void;
}

export interface StatusBarController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  refresh(): void;
}

const noopController: StatusBarController = {
  isEnabled: () => false,
  setEnabled() {},
  refresh() {},
};

let initialized = false;

export function initStatusBar(host: StatusBarHost): StatusBarController {
  if (initialized) {
    console.warn("[statusBar] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { barEl, editorEl } = host;
    let enabled = host.loadEnabled?.() ?? true;

    function render(): void {
      if (!enabled) return;

      const { value, selectionStart, selectionEnd } = editorEl;
      const hasSelection = selectionStart !== selectionEnd;
      const target = hasSelection ? value.slice(selectionStart, selectionEnd) : value;
      barEl.textContent = formatStats(computeStats(target), hasSelection);
    }

    function apply(next: boolean, persist: boolean): void {
      enabled = next;
      barEl.hidden = !enabled;
      render();
      if (persist) {
        try {
          host.saveEnabled?.(enabled);
        } catch {
          // 저장 실패가 표시 전환을 막으면 안 된다.
        }
      }
    }

    // 선택이 바뀌면 곧바로 갱신한다 — 선택 통계는 즉시성이 값어치다.
    // `selectionchange` 는 document 에만 오므로 대상 확인이 필요하다.
    editorEl.ownerDocument.addEventListener("selectionchange", () => {
      if (editorEl.ownerDocument.activeElement === editorEl) render();
    });

    apply(enabled, false);
    initialized = true;
    return {
      isEnabled: () => enabled,
      setEnabled: (next) => apply(Boolean(next), true),
      refresh: render,
    };
  } catch (error) {
    console.warn("[statusBar] 초기화 실패:", error);
    return noopController;
  }
}
