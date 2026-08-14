/**
 * F-23 잔여 — 편집 영역 하이라이팅 오버레이 (이슈 #95).
 *
 * ## 왜 오버레이인가
 *
 * textarea 는 서식을 그릴 수 없고, `contenteditable` 로 바꾸면 **IME 조합·실행
 * 취소·선택 복원이 전부 다시 짜야 하는 문제**가 된다(F-26·F-27·F-51·F-53 이
 * 전부 textarea 의 동작에 기대고 있다). 그래서 textarea 는 그대로 두고, **같은
 * 글자를 같은 자리에 그린 레이어를 뒤에 깔고** 앞의 글자만 투명하게 만든다.
 *
 * 커서·선택·IME 는 여전히 진짜 textarea 의 것이다. 우리가 하는 일은 색을 칠한
 * 종이를 뒤에 받치는 것뿐이다.
 *
 * ## 어긋나면 못 쓴다
 *
 * 두 레이어의 글자 위치가 1px만 달라도 눈에 띈다. 그래서
 *
 * - 글꼴·크기·줄 높이·패딩·줄바꿈 규칙을 **CSS 에서 같은 변수로** 준다(F-35 가
 *   바꾸는 값이 자동으로 양쪽에 걸린다).
 * - 스크롤은 매 프레임이 아니라 **editor 의 scroll 이벤트에서** 그대로 옮긴다.
 * - 마지막 줄이 비어 있으면 textarea 는 한 줄을 더 보여주지만 `pre-wrap` 은
 *   끝의 개행을 접는다 — 그래서 **개행 하나를 덧붙인다.**
 *
 * ## 기본은 꺼짐
 *
 * 글꼴 폴백·확대·모바일처럼 정렬이 어긋날 수 있는 환경이 있다. 사용자가 즉시
 * 되돌릴 수 있어야 하므로 설정으로 끄고 켜며 **기본값은 꺼짐**이다(사용자 결정).
 *
 * `lineNumbers.ts`·`statusBar.ts` 와 같은 주입형 리프다. 계산은 전부
 * `markdownHighlight.ts`(순수)에 있다.
 */

import { highlightMarkdown } from "./markdownHighlight";

export interface EditorOverlayHost {
  editorEl: HTMLTextAreaElement;
  /** 하이라이트를 그릴 요소. textarea 뒤에 겹쳐 놓는다. */
  overlayEl: HTMLElement;
  /** 두 레이어를 함께 감싼 상자. 켜짐 상태를 여기에 표시한다. */
  paneEl: HTMLElement;
  loadEnabled?: () => boolean;
  saveEnabled?: (enabled: boolean) => void;
}

export interface EditorOverlayController {
  /** 본문이 바뀐 뒤 다시 그린다. 꺼져 있으면 아무 일도 하지 않는다. */
  refresh(): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

const noopController: EditorOverlayController = {
  refresh() {},
  setEnabled() {},
  isEnabled: () => false,
};

let initialized = false;

export function initEditorOverlay(host: EditorOverlayHost): EditorOverlayController {
  if (initialized) {
    console.warn("[editorOverlay] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { editorEl, overlayEl, paneEl } = host;
    let enabled = host.loadEnabled?.() ?? false;

    /**
     * 왼쪽 시작점을 textarea 의 **실제 위치**에서 잰다.
     *
     * 줄 번호 칸(F-24)이 켜지고 꺼지면 textarea 가 옆으로 밀린다. 그 폭을 CSS 에
     * 다시 적으면 두 곳이 어긋나므로, 있는 값을 읽는다.
     */
    function syncGeometry(): void {
      overlayEl.style.left = `${editorEl.offsetLeft}px`;
    }

    function render(): void {
      if (!enabled) return;
      syncGeometry();
      // 끝의 개행 하나를 덧붙인다. `pre-wrap` 은 마지막 개행을 접지만 textarea 는
      // 빈 줄을 보여줘, 이게 없으면 문서 끝에서 두 레이어의 높이가 달라진다.
      overlayEl.innerHTML = `${highlightMarkdown(editorEl.value)}\n`;
      syncScroll();
    }

    function syncScroll(): void {
      if (!enabled) return;
      overlayEl.scrollTop = editorEl.scrollTop;
      overlayEl.scrollLeft = editorEl.scrollLeft;
    }

    function paint(): void {
      paneEl.dataset.overlay = String(enabled);
      if (enabled) {
        render();
      } else {
        // 꺼져 있는 동안 큰 문서의 DOM 을 들고 있을 이유가 없다.
        overlayEl.textContent = "";
      }
    }

    const controller: EditorOverlayController = {
      refresh: render,
      isEnabled: () => enabled,

      setEnabled(next) {
        if (enabled === next) return;
        enabled = next;
        paint();
        try {
          host.saveEnabled?.(next);
        } catch {
          // 저장 실패가 표시 전환을 막으면 안 된다.
        }
      },
    };

    // scroll 은 버블링하지 않는다 — 반드시 대상 요소에 직접 붙인다(F-25 와 같은
    // 이유). 그리기와 달리 스크롤은 디바운스하지 않는다: 한 프레임만 늦어도
    // 글자가 따로 노는 게 보인다.
    editorEl.addEventListener("scroll", syncScroll, { passive: true });

    paint();
    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[editorOverlay] 초기화 실패:", error);
    return noopController;
  }
}
