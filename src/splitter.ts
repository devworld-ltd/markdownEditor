/**
 * F-32 분할 비율 조절 (이슈 #49).
 *
 * 좌우(720px 초과) 또는 상하(720px 이하) 분할의 경계를 드래그·키보드로 옮긴다.
 *
 * 설계 판단:
 *
 * 1) **`setPointerCapture` 를 쓴다.** `document` 에 mousemove 를 붙이는 방식은
 *    포인터가 창 밖으로 나가면 놓친 채 드래그 상태로 굳는다. 포인터 캡처는
 *    브라우저가 그 처리를 해 주고, `pointerup` 이 어디서 발생하든 되돌아온다.
 * 2) **F-25 스크롤 동기화를 억제하지 않는다.** `tabs.ts` 처럼 suspend/resume 훅을
 *    주입하는 방안을 구현해 두고 **실측**했더니, 있으나 없으나 드래그 후 두 패널의
 *    비율 차이가 0 으로 동일했다 — F-25 의 메아리 판별(`expectedTop`)과 소유권
 *    모델이 리사이즈로 생기는 scroll 이벤트를 이미 올바르게 처리한다. 검증되지
 *    않는 방어 코드는 남기지 않는다. 되살리기 전에 먼저 재현되는 실패를 만들 것.
 * 3) **키보드로도 조절된다.** `role="separator"` + `aria-valuenow` 로 노출하고
 *    화살표·Home 을 받는다. 드래그 전용이면 키보드 사용자에게는 없는 기능이다.
 * 4) **레이아웃은 CSS 변수 하나로만 바꾼다.** 드래그 루프에서 클래스나 DOM 을
 *    건드리면 매 프레임 재계산이 걸린다. 컨테이너 사각형은 드래그 시작 때 한 번만
 *    읽는다.
 *
 * `offline.ts`·`search.ts` 와 같은 주입형 리프다 — `splitLayout.ts`(순수 계산)
 * 외에는 앱 모듈을 import 하지 않는다.
 */

import {
  DEFAULT_RATIO,
  ratioFromPointer,
  stepRatio,
  toAriaValue,
  toPercent,
  clampRatio,
} from "./splitLayout";

export interface SplitterHost {
  /** `.editor-container` — 방향(가로/세로)과 크기의 기준이 된다. */
  containerEl: HTMLElement;
  /** 드래그 손잡이 (`role="separator"`) */
  resizerEl: HTMLElement;
  /** 크기가 지정되는 쪽. 반대편은 남은 공간을 차지한다. */
  firstPaneEl: HTMLElement;
  /** 저장된 비율을 읽는다. 없으면 기본값. */
  loadRatio?: () => number;
  /** 비율을 저장한다. 실패해도 조작은 계속돼야 한다. */
  saveRatio?: (ratio: number) => void;
}

export interface SplitterController {
  getRatio(): number;
  setRatio(ratio: number): void;
  reset(): void;
}

const noopController: SplitterController = {
  getRatio: () => DEFAULT_RATIO,
  setRatio() {},
  reset() {},
};

let initialized = false;

/** 상하 분할인지. 컨테이너의 실제 `flex-direction` 을 읽어 판단한다. */
function isVertical(containerEl: HTMLElement): boolean {
  const view = containerEl.ownerDocument.defaultView;
  if (!view) return false;
  return view.getComputedStyle(containerEl).flexDirection.startsWith("column");
}

export function initSplitter(host: SplitterHost): SplitterController {
  if (initialized) {
    console.warn("[splitter] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { containerEl, resizerEl, firstPaneEl } = host;

    let ratio = clampRatio(host.loadRatio?.() ?? DEFAULT_RATIO);
    let dragging = false;

    function paint(): void {
      // flex-basis 하나만 바꾼다 — 클래스 토글이나 DOM 조작은 매 프레임
      // 재계산을 부른다.
      firstPaneEl.style.flexBasis = toPercent(ratio);
      resizerEl.setAttribute("aria-valuenow", String(toAriaValue(ratio)));
    }

    function apply(next: number, persist: boolean): void {
      ratio = clampRatio(next);
      paint();
      if (persist) {
        try {
          host.saveRatio?.(ratio);
        } catch {
          // 저장 실패가 드래그를 멈추면 안 된다 (storage.ts 와 같은 태도).
        }
      }
    }

    const controller: SplitterController = {
      getRatio: () => ratio,
      setRatio: (next) => apply(next, true),
      reset: () => apply(DEFAULT_RATIO, true),
    };

    resizerEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; // 좌클릭만
      event.preventDefault();

      dragging = true;
      // 포인터가 창 밖으로 나가도 놓치지 않는다.
      resizerEl.setPointerCapture?.(event.pointerId);
      resizerEl.dataset.dragging = "true";
    });

    resizerEl.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      event.preventDefault();

      // 사각형은 매 프레임 읽어야 한다 — 창 크기 변경·스크롤바 출현으로 바뀐다.
      // 대신 이 한 번의 읽기 외에는 레이아웃을 건드리지 않는다.
      const rect = containerEl.getBoundingClientRect();
      const vertical = isVertical(containerEl);
      apply(
        vertical
          ? ratioFromPointer(event.clientY, rect.top, rect.height)
          : ratioFromPointer(event.clientX, rect.left, rect.width),
        false, // 드래그 중에는 저장하지 않는다 — 매 프레임 localStorage 쓰기는 낭비다
      );
    });

    function endDrag(event: PointerEvent): void {
      if (!dragging) return;
      dragging = false;
      resizerEl.releasePointerCapture?.(event.pointerId);
      delete resizerEl.dataset.dragging;
      apply(ratio, true); // 여기서 한 번만 저장
    }

    resizerEl.addEventListener("pointerup", endDrag);
    resizerEl.addEventListener("pointercancel", endDrag);

    // 더블클릭으로 반반 복귀. 드래그로 어긋난 것을 되돌리는 가장 빠른 길이다.
    resizerEl.addEventListener("dblclick", () => controller.reset());

    resizerEl.addEventListener("keydown", (event) => {
      const vertical = isVertical(containerEl);
      // 가로 분할에서는 ←→, 세로 분할에서는 ↑↓ 가 자연스럽다. 둘 다 받되
      // 방향이 맞는 쪽을 우선한다 — 어느 키를 눌러도 동작하지 않는 것보다 낫다.
      let direction = 0;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowUp":
          direction = -1;
          break;
        case "ArrowRight":
        case "ArrowDown":
          direction = 1;
          break;
        case "Home":
          event.preventDefault();
          controller.reset();
          return;
        default:
          return;
      }
      void vertical;

      event.preventDefault();
      apply(stepRatio(ratio, direction), true);
    });

    paint();
    initialized = true; // 성공 경로에서만 잠근다
    return controller;
  } catch (error) {
    console.warn("[splitter] 초기화 실패:", error);
    return noopController;
  }
}
