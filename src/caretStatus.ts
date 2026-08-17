/**
 * 커서 위치 표시 (이슈 #152).
 *
 * ## `aria-live` 를 붙이지 않는다
 *
 * 캐럿은 글자를 칠 때마다 움직인다. 여기에 `aria-live` 를 붙이면 스크린리더가 매
 * 글자마다 행·열을 읽어 **편집이 불가능해진다**(트랩 #56). `role="status"` 도
 * 암묵적으로 `aria-live="polite"` 라 같은 이유로 안 된다.
 *
 * ## 줄 시작 배열을 캐시한다
 *
 * 본문이 그대로면 다시 만들지 않는다 — 캐럿 이동은 초당 수십 번 일어나지만 그때
 * 하는 일은 이진 탐색뿐이다. 근거와 실측은 `caretPosition.ts` 머리에 있다.
 *
 * 주입형 리프다.
 */

import { caretPositionAt, formatCaret, selectionInfo } from "./caretPosition";
import { lineStartOffsets } from "./sourceLines";

export interface CaretStatusHost {
  barEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
}

export interface CaretStatusController {
  /** 지금 값을 다시 읽어 표시한다. */
  refresh(): void;
  /** 화면에 보이는 글. 테스트·진단용. */
  text(): string;
}

const noopController: CaretStatusController = { refresh() {}, text: () => "" };

let initialized = false;

export function initCaretStatus(host: CaretStatusHost): CaretStatusController {
  if (initialized) {
    console.warn("[caretStatus] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { barEl, editorEl } = host;

    /**
     * 마지막으로 배열을 만든 본문. 같으면 다시 만들지 않는다.
     *
     * **어떤 테스트도 이 캐시를 구별하지 못한다** — `selectionchange` 가 작업당
     * 한 번으로 합쳐져 갱신 빈도가 프레임 수준으로 묶이기 때문이다(지우고
     * 재실행해 확인했다). 그래도 두는 이유는 실측된 비용 때문이다: 약 95,000자에서
     * 배열 생성이 0.088ms 라, 아주 큰 문서에서는 프레임 예산을 갉는다.
     * **필요해서가 아니라 값이 싸서 두는 것**이라고 적어 둔다.
     */
    let cachedText: string | null = null;
    let cachedStarts: number[] = [0];

    function starts(value: string): number[] {
      if (cachedText === value) return cachedStarts;
      cachedText = value;
      cachedStarts = lineStartOffsets(value);
      return cachedStarts;
    }

    function refresh(): void {
      const { value, selectionStart, selectionEnd } = editorEl;
      const position = caretPositionAt(starts(value), selectionStart);
      barEl.textContent = formatCaret(
        position,
        selectionInfo(value, selectionStart, selectionEnd),
      );
    }

    /**
     * **`selectionchange` 하나로 충분하다.**
     *
     * 처음에는 `input`·`keyup`·`click` 도 함께 들었는데, 셋 다 지워도 **어떤
     * 테스트도 실패하지 않았다** — 글자를 치는 것도 캐럿을 옮기는 것이라 결국
     * 여기로 온다. 구별되지 않는 배선은 지운다(안 그러면 다음 사람이 넷 다
     * 필요하다고 믿는다).
     *
     * 그리고 **입력 디바운스에 얹지 않는다.** 커서 위치는 즉시성이 값어치라,
     * 150ms 뒤에 따라오면 고장 난 것처럼 보인다.
     *
     * 문서 단위 이벤트이므로 **편집기에 포커스가 있을 때만** 본다 — 검색창에서
     * 글자를 고를 때마다 커서 표시가 흔들리면 안 된다.
     */
    editorEl.ownerDocument.addEventListener("selectionchange", () => {
      if (editorEl.ownerDocument.activeElement === editorEl) refresh();
    });

    refresh();
    initialized = true;
    return { refresh, text: () => barEl.textContent ?? "" };
  } catch (error) {
    console.warn("[caretStatus] 초기화 실패:", error);
    return noopController;
  }
}
