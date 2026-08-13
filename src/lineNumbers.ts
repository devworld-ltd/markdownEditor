/**
 * F-24 줄 번호 (이슈 #77).
 *
 * ## 어려운 부분은 줄바꿈이다
 *
 * `1, 2, 3…` 을 같은 간격으로 찍으면 **줄바꿈(wrap)된 긴 줄에서 곧바로 어긋난다.**
 * 한 논리 줄이 화면에서 세 줄을 차지하면 그 뒤 번호가 전부 밀린다. 줄 번호는
 * 어긋나는 순간 쓸모가 아니라 방해가 된다.
 *
 * 그래서 **각 논리 줄이 실제로 몇 픽셀을 차지하는지 재서** 그 높이만큼 번호 칸을
 * 잡는다. 재는 방법은 host 로 주입받는다 — jsdom 에는 레이아웃이 없어, 이 경계가
 * 없으면 계산에 단위 테스트가 도달조차 못 한다(`search.ts` 와 같은 이유).
 *
 * ## 선택·복사에 번호가 섞이면 안 된다
 *
 * 번호는 `<textarea>` 바깥의 별도 요소이므로 텍스트 선택에 포함되지 않는다.
 * `user-select: none` 으로 한 번 더 막고, 스크린리더에는 `aria-hidden` 으로
 * 숨긴다 — 줄 번호를 한 줄씩 읽어 주는 것은 도움이 아니라 소음이다.
 */

export interface LineNumbersHost {
  /** 번호가 그려질 요소 */
  gutterEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
  /**
   * 각 논리 줄의 **표시 높이(px)** 를 잰다. 기본 구현은 미러 요소를 쓴다.
   * 테스트는 결정적인 가짜 측정기를 주입한다.
   */
  measureLineHeights?: (textarea: HTMLTextAreaElement) => number[];
  loadEnabled?: () => boolean;
  saveEnabled?: (enabled: boolean) => void;
}

export interface LineNumbersController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  toggle(): void;
  /** 본문·글꼴·크기가 바뀐 뒤 다시 그린다. */
  refresh(): void;
}

const noopController: LineNumbersController = {
  isEnabled: () => false,
  setEnabled() {},
  toggle() {},
  refresh() {},
};

let initialized = false;

/**
 * 미러 요소로 각 논리 줄의 표시 높이를 잰다.
 *
 * 줄마다 따로 재지 않고 **한 번의 레이아웃**으로 끝낸다 — 줄 수만큼 강제 리플로를
 * 일으키면 큰 문서에서 입력이 눈에 띄게 느려진다.
 */
function measureWithMirror(textarea: HTMLTextAreaElement): number[] {
  const doc = textarea.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];

  const style = view.getComputedStyle(textarea);
  const mirror = doc.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "absolute";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = style.width;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.font = style.font;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;

  const lines = textarea.value.split("\n");
  for (const line of lines) {
    const row = doc.createElement("div");
    // 빈 줄도 한 줄 높이를 차지해야 한다. 폭 없는 문자를 넣어 그 줄을 실재하게 한다.
    row.textContent = line === "" ? "​" : line;
    mirror.appendChild(row);
  }

  doc.body.appendChild(mirror);
  const heights = [...mirror.children].map((el) => (el as HTMLElement).offsetHeight);
  mirror.remove();
  return heights;
}

export function initLineNumbers(host: LineNumbersHost): LineNumbersController {
  if (initialized) {
    console.warn("[lineNumbers] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { gutterEl, editorEl } = host;
    const measure = host.measureLineHeights ?? measureWithMirror;
    let enabled = host.loadEnabled?.() ?? false;

    function render(): void {
      if (!enabled) {
        gutterEl.textContent = "";
        return;
      }

      const heights = measure(editorEl);
      const lineCount = editorEl.value.split("\n").length;

      gutterEl.textContent = "";
      for (let i = 0; i < lineCount; i++) {
        const row = document.createElement("div");
        row.className = "line-number";
        row.textContent = String(i + 1);
        // 잰 높이가 있으면 그대로 쓴다. 없으면(레이아웃 전) 자연 높이에 맡긴다 —
        // 0 을 넣으면 번호가 전부 겹쳐 버린다.
        const height = heights[i];
        if (typeof height === "number" && height > 0) row.style.height = `${height}px`;
        gutterEl.appendChild(row);
      }
    }

    function apply(next: boolean, persist: boolean): void {
      enabled = next;
      gutterEl.hidden = !enabled;
      editorEl.ownerDocument.documentElement.dataset.lineNumbers = String(enabled);
      render();
      if (persist) {
        try {
          host.saveEnabled?.(enabled);
        } catch {
          // 저장 실패가 표시 전환을 막으면 안 된다.
        }
      }
    }

    const controller: LineNumbersController = {
      isEnabled: () => enabled,
      setEnabled: (next) => apply(Boolean(next), true),
      toggle: () => apply(!enabled, true),
      refresh: () => {
        if (enabled) render();
      },
    };

    // 편집 영역이 스크롤하면 번호도 같은 만큼 움직여야 한다. 별도 스크롤바를
    // 두지 않고 transform 으로 밀면 스크롤 동기화 문제가 생기지 않는다.
    editorEl.addEventListener(
      "scroll",
      () => {
        gutterEl.style.transform = `translateY(${-editorEl.scrollTop}px)`;
      },
      { passive: true },
    );

    apply(enabled, false); // 저장된 값을 반영하되 다시 저장하지는 않는다
    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[lineNumbers] 초기화 실패:", error);
    return noopController;
  }
}
