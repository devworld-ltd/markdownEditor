/**
 * 좁은 화면 서식 바 (이슈 #155).
 *
 * ## 왜 필요한가
 *
 * 휴대폰 폭에서는 툴바의 서식 묶음이 접힌다(#154). 서식을 넣으려면 화면 위쪽으로
 * 손을 옮겨야 하는데, 편집 중 엄지가 닿는 곳은 아래다. 그래서 편집 중일 때만
 * 화면 아래에 서식 바를 둔다.
 *
 * ## 툴바 액션을 그대로 실행한다
 *
 * 버튼은 `toolbarActionByLabel()` 로 찾은 **툴바와 같은 액션**을 `runToolbarAction()`
 * 으로 돌린다. 서식 계산을 다시 구현하면 두 경로가 갈라지고, 한쪽만 고치는 순간
 * 좁은 화면에서만 다른 결과가 나온다. 삽입은 그대로 `execCommand("insertText")`
 * 라 `⌘Z` 가 살아 있다 (트랩 #27).
 *
 * ## 가상 키보드
 *
 * `visualViewport` 로 가려진 높이를 재어 그만큼 띄운다. 계산은
 * `virtualKeyboard.ts`(순수)에 있고, **실제로 키보드 위에 붙는지는 실기기에서만
 * 확인된다** — 헤드리스 브라우저에는 가상 키보드가 없다.
 *
 * 주입형 리프다.
 */

import { runToolbarAction, toolbarActionByLabel } from "./toolbar";
import { keyboardInset, type ViewportMetrics } from "./virtualKeyboard";

/**
 * 서식 바에 놓을 것들.
 *
 * **툴바 이름을 그대로 쓴다** — 이름이 곧 같은 액션을 가리키는 손잡이다(#149 의
 * `data-action` 과 같은 규약). 없는 이름을 적으면 그 버튼만 조용히 빠지므로
 * 초기화에서 개수를 확인할 수 있다.
 */
const ITEMS: ReadonlyArray<{ label: string; text: string }> = [
  { label: "Bold", text: "굵게" },
  { label: "Italic", text: "기울임" },
  { label: "Heading", text: "제목" },
  { label: "Unordered List", text: "목록" },
  { label: "Link", text: "링크" },
  { label: "Code", text: "코드" },
  { label: "Table", text: "표" },
  { label: "Image", text: "이미지" },
];

export interface FormatBarHost {
  barEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
  /** `window.visualViewport`. 없는 브라우저면 키보드 보정을 하지 않는다. */
  viewport?: (VisualViewport & ViewportMetrics) | null;
  /** `window.innerHeight` 를 읽는다. 테스트가 갈아끼운다. */
  windowHeight?: () => number;
}

export interface FormatBarController {
  /** 그려진 버튼 수. 테스트·진단용. */
  count(): number;
  /** 지금 띄운 높이(px). */
  inset(): number;
}

const noopController: FormatBarController = { count: () => 0, inset: () => 0 };

let initialized = false;

export function initFormatBar(host: FormatBarHost): FormatBarController {
  if (initialized) {
    console.warn("[formatBar] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { barEl, editorEl } = host;
    let shown = 0;
    let currentInset = 0;

    for (const item of ITEMS) {
      const action = toolbarActionByLabel(item.label);
      // 이름이 바뀌면 그 버튼만 빠진다 — 앱 전체가 죽는 것보다 낫고, `count()`
      // 로 드러난다.
      if (!action) continue;

      const btn = barEl.ownerDocument.createElement("button");
      btn.type = "button";
      btn.className = "format-btn";
      btn.dataset.action = item.label;
      btn.textContent = item.text;
      btn.setAttribute("aria-label", item.text);
      // **누르는 순간 편집기가 포커스를 잃으면 안 된다.** 잃으면 선택이 사라져
      // 서식이 엉뚱한 곳에 들어가고, 모바일에서는 키보드까지 내려간다.
      btn.addEventListener("pointerdown", (event) => event.preventDefault());
      btn.addEventListener("click", () => {
        editorEl.focus();
        runToolbarAction(action, editorEl);
      });
      barEl.appendChild(btn);
      shown += 1;
    }

    function applyInset(): void {
      currentInset = keyboardInset(
        host.viewport ?? null,
        host.windowHeight?.() ?? 0,
      );
      barEl.style.bottom = `${currentInset}px`;
    }

    const viewport = host.viewport;
    if (viewport) {
      viewport.addEventListener("resize", applyInset);
      // 키보드가 올라온 뒤 페이지가 밀리는 브라우저가 있다 — 그때는 scroll 로 온다.
      viewport.addEventListener("scroll", applyInset);
    }
    applyInset();

    initialized = true;
    return { count: () => shown, inset: () => currentInset };
  } catch (error) {
    console.warn("[formatBar] 초기화 실패:", error);
    return noopController;
  }
}
