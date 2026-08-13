/**
 * F-33 프리뷰 전용 / 에디터 전용 모드 (이슈 #50).
 *
 * 좁은 화면이나 집중 편집·검토 상황에서 한쪽만 보고 싶은 요구를 담당한다.
 * F-32(분할 비율)가 **양쪽을 보되 크기를 조절**하는 것이라면, 이쪽은 **한쪽만
 * 본다.** 그래서 F-32 의 하한/상한이 0 을 허용하지 않아도 된다.
 *
 * 설계 판단:
 *
 * 1) **DOM 조작이 아니라 데이터 속성 하나로 바꾼다.** `containerEl.dataset.mode`
 *    를 바꾸면 CSS 가 나머지를 한다. 요소를 지우거나 다시 만들면 에디터의
 *    스크롤 위치·선택·포커스가 날아가고, 탭 상태와도 어긋난다.
 * 2) **분할 비율은 건드리지 않는다.** 모드를 되돌리면 사용자가 맞춰 둔 비율이
 *    그대로 돌아와야 한다. 두 설정은 독립이다.
 * 3) **모드는 순환한다.** 버튼 하나로 분할 → 에디터 → 프리뷰 → 분할. 버튼 3개를
 *    두면 툴바가 붐비고, 어차피 대부분 "지금 말고 다른 것" 을 원한다.
 * 4) **한쪽이 숨겨져도 F-25 는 안전하다.** 숨은 패널은 `clientHeight` 가 0 이라
 *    `computeRatio()` 의 `> 0` 가드에 걸려 동기화가 무동작이 된다 — 예외도
 *    잘못된 스크롤도 없다. 이 성질에 기대므로 E2E 로 못을 박아 둔다.
 *
 * `splitter.ts`·`search.ts` 와 같은 주입형 리프다.
 */

export const VIEW_MODES = ["split", "editor", "preview"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const DEFAULT_MODE: ViewMode = "split";

/** 저장된 값을 읽는다. 모르는 값은 기본값으로 — 설정 때문에 앱이 깨지면 안 된다. */
export function parseViewMode(raw: unknown): ViewMode {
  return VIEW_MODES.includes(raw as ViewMode) ? (raw as ViewMode) : DEFAULT_MODE;
}

/** 다음 모드. 분할 → 에디터 → 프리뷰 → 분할. */
export function nextViewMode(mode: ViewMode): ViewMode {
  const index = VIEW_MODES.indexOf(mode);
  return VIEW_MODES[(index + 1) % VIEW_MODES.length];
}

const MODE_LABEL: Record<ViewMode, string> = {
  split: "분할 보기",
  editor: "편집 전용 보기",
  preview: "미리보기 전용",
};

/** 버튼의 접근 가능한 이름 — 지금 상태와 다음 동작을 함께 알린다. */
export function modeButtonLabel(mode: ViewMode): string {
  return `보기 모드: ${MODE_LABEL[mode]} (누르면 ${MODE_LABEL[nextViewMode(mode)]})`;
}

export interface ViewModeHost {
  /** `.editor-container` — `data-mode` 가 여기 붙는다. */
  containerEl: HTMLElement;
  /**
   * 상태를 표시할 툴바 버튼. **클릭 처리는 하지 않는다** — 툴바가 이미 모든
   * 버튼의 클릭을 다루므로 여기서도 듣게 하면 한 번 눌러 두 단계 넘어간다
   * (실제로 그렇게 동작했다). 이 모듈은 `aria-*` 갱신만 맡는다.
   */
  buttonEl?: HTMLElement;
  loadMode?: () => ViewMode;
  saveMode?: (mode: ViewMode) => void;
}

export interface ViewModeController {
  get(): ViewMode;
  set(mode: ViewMode): void;
  cycle(): void;
}

const noopController: ViewModeController = {
  get: () => DEFAULT_MODE,
  set() {},
  cycle() {},
};

let initialized = false;

export function initViewMode(host: ViewModeHost): ViewModeController {
  if (initialized) {
    console.warn("[viewMode] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { containerEl } = host;
    let mode: ViewMode = parseViewMode(host.loadMode?.() ?? DEFAULT_MODE);

    function paint(): void {
      containerEl.dataset.mode = mode;
      if (host.buttonEl) {
        host.buttonEl.setAttribute("aria-label", modeButtonLabel(mode));
        host.buttonEl.setAttribute("title", MODE_LABEL[mode]);
        // 분할이 아닐 때만 "켜짐" 이다 — 기본 상태를 눌린 것으로 표시하면
        // 스크린리더 사용자가 늘 뭔가 켜져 있다고 오해한다.
        host.buttonEl.setAttribute("aria-pressed", String(mode !== "split"));
      }
    }

    const controller: ViewModeController = {
      get: () => mode,
      set(next) {
        mode = parseViewMode(next);
        paint();
        try {
          host.saveMode?.(mode);
        } catch {
          // 저장 실패가 화면 전환을 막으면 안 된다.
        }
      },
      cycle() {
        controller.set(nextViewMode(mode));
      },
    };

    paint();
    initialized = true; // 성공 경로에서만 잠근다
    return controller;
  } catch (error) {
    console.warn("[viewMode] 초기화 실패:", error);
    return noopController;
  }
}
