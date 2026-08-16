/**
 * 사용 설명서 화면 (이슈 #141).
 *
 * ## 왜 대화상자인가
 *
 * 새 탭으로 여는 쪽이 더 자연스러워 보인다 — 마크다운 편집기가 자기 문서를 자기
 * 프리뷰로 보여주는 셈이니까. 그런데 그러면 **사용자가 그 탭을 고치고 저장하려 든다.**
 * 실제 파일이 아니라 저장할 곳이 없고, 세션에도 남아 다음에 열 때 "안 지운 문서" 처럼
 * 보인다. 안내는 안내로 두는 편이 낫다 — `shortcutHelp.ts`·`releaseNotesUi.ts` 와 같은 자리다.
 *
 * ## 본문은 반드시 `parseMarkdown()` 을 거친다
 *
 * 정화 경로는 하나뿐이다(F-18). 여기서 직접 HTML 을 조립하면 두 번째 경로가 생기고,
 * 한쪽만 갱신되는 순간 뚫린다.
 *
 * ## 받아오지 않는다
 *
 * `docs/manual.md` 는 **빌드 시각에 번들로** 들어온다. `fetch("/manual.md")` 하나면
 * 이 앱의 "공유 외 네트워크 요청 0건" 이 깨지고 E2E `SH8` 이 죽는다 (트랩 #75).
 *
 * 주입형 리프다.
 */

export interface ManualHost {
  dialogEl: HTMLDialogElement;
  bodyEl: HTMLElement;
  closeEl: HTMLElement;
  /** `docs/manual.md` 원문 (빌드 시각 주입). */
  markdown: string;
  /** 마크다운 → **정화된** HTML. 앱은 `parseMarkdown` 을 그대로 넘긴다. */
  render: (markdown: string) => string;
  returnFocusTo?: HTMLElement | null;
}

export interface ManualController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** 본문을 그렸는가. 테스트와 진단용. */
  isRendered(): boolean;
}

const noopController: ManualController = {
  open() {},
  close() {},
  isOpen: () => false,
  isRendered: () => false,
};

let initialized = false;

export function initManual(host: ManualHost): ManualController {
  if (initialized) {
    console.warn("[manual] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { dialogEl, bodyEl } = host;
    let rendered = false;

    /**
     * **처음 열 때 한 번만 그린다.**
     *
     * 내용이 빌드 시각에 고정이라 다시 그릴 이유가 없고, 앱 기동 때 미리 그리면
     * 열어 보지도 않을 문서를 파싱하느라 첫 화면이 느려진다.
     */
    function render(): void {
      if (rendered) return;
      const markdown = host.markdown ?? "";
      if (!markdown.trim()) {
        // 번들에 문서가 안 들어온 경우. 빈 화면보다 이유를 보여준다.
        bodyEl.textContent = "설명서를 불러오지 못했습니다.";
        rendered = true;
        return;
      }
      // 정화 경로는 하나뿐이다 (F-18). 직접 조립하지 말 것.
      bodyEl.innerHTML = host.render(markdown);
      rendered = true;
    }

    const controller: ManualController = {
      isOpen: () => dialogEl.open,
      isRendered: () => rendered,

      open() {
        if (dialogEl.open) return;
        render();
        dialogEl.showModal();
        // 매번 처음부터 읽도록 되돌린다 — 지난번에 보던 자리에서 시작하면
        // "설명서를 다시 열었다" 는 기대와 어긋난다.
        bodyEl.scrollTop = 0;
      },

      close() {
        if (!dialogEl.open) return;
        dialogEl.close();
      },
    };

    host.closeEl.addEventListener("click", () => controller.close());

    dialogEl.addEventListener("close", () => {
      host.returnFocusTo?.focus({ preventScroll: true });
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
    console.warn("[manual] 초기화 실패:", error);
    return noopController;
  }
}
