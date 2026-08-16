/**
 * 저장 상태 표시 (이슈 #148).
 *
 * ## 왜 필요한가
 *
 * 저장 여부를 알 수 있는 곳이 **탭의 작은 점 하나뿐**이었다. 문서를 오래 고치다
 * 보면 그 점을 보지 않게 되고, 브라우저를 닫을 때 확인 창이 뜨고서야 안 저장된
 * 것을 안다.
 *
 * ## 색만으로 알리지 않는다
 *
 * 점 색으로만 구분하면 색각 이상이 있는 사람에게는 아무 정보도 아니다. 아이콘과
 * **글자를 항상 함께** 둔다.
 *
 * ## `aria-live` 를 붙이지 않는다
 *
 * 상태 표시줄은 `<footer>` 안에 있고, 여기에 `aria-live` 를 붙이면 **글자를 칠
 * 때마다 스크린리더가 상태를 읽어 편집이 불가능해진다**(트랩 #56). `role="status"`
 * 도 암묵적으로 `aria-live="polite"` 라 같은 이유로 안 된다. 필요할 때 사용자가
 * 직접 찾아가 읽는다.
 *
 * ## 통계와 다른 경로로 갱신한다
 *
 * 문서 통계는 매 글자마다 전체를 훑어야 해서 150ms 렌더 디바운스에 얹혀 있다.
 * 저장 상태는 **dirty 가 바뀔 때만** 달라지므로 그 경로를 탈 이유가 없다 —
 * `tabs.ts` 의 탭 렌더 시점에 맞춰 갱신한다.
 *
 * 주입형 리프다.
 */

export type SaveStatus = "saved" | "dirty" | "unsaved";

export interface SaveStateView {
  /** 저장 상태. `unsaved` 는 "아직 파일로 저장한 적 없음"(새 문서)이다. */
  status: SaveStatus;
  /** 파일명. 파일이 없으면 `null`. */
  fileName: string | null;
}

export interface SaveStateHost {
  rootEl: HTMLElement;
  iconEl: HTMLElement;
  textEl: HTMLElement;
  nameEl: HTMLElement;
  /** 지금 상태를 읽는다. 앱은 활성 탭에서 만들어 넘긴다. */
  read: () => SaveStateView | null;
}

export interface SaveStateController {
  /** 상태를 다시 읽어 화면에 반영한다. */
  refresh(): void;
  /** 지금 화면에 표시된 상태. 테스트·진단용. */
  current(): SaveStatus | null;
}

const noopController: SaveStateController = { refresh() {}, current: () => null };

/**
 * 상태별 표시. **글자가 본체이고 아이콘은 거드는 것**이다 — 반대로 만들면
 * 색·모양만으로 구분해야 한다.
 */
const LABEL: Record<SaveStatus, { text: string; icon: string }> = {
  saved: { text: "저장됨", icon: "●" },
  dirty: { text: "저장하지 않은 변경", icon: "○" },
  unsaved: { text: "저장한 적 없음", icon: "○" },
};

let initialized = false;

export function initSaveState(host: SaveStateHost): SaveStateController {
  if (initialized) {
    console.warn("[saveState] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { rootEl, iconEl, textEl, nameEl } = host;
    let shown: SaveStatus | null = null;

    function refresh(): void {
      let view: SaveStateView | null = null;
      try {
        view = host.read();
      } catch {
        // 상태를 못 읽으면 아무것도 보여주지 않는다 — 틀린 상태를 보여주는 것보다 낫다.
        view = null;
      }

      if (!view) {
        rootEl.hidden = true;
        shown = null;
        return;
      }

      rootEl.hidden = false;
      // 상태를 CSS 가 아니라 데이터로 내보낸다 — 색은 CSS 가 정하고,
      // 테스트는 색이 아니라 이 값을 본다.
      rootEl.dataset.status = view.status;
      iconEl.textContent = LABEL[view.status].icon;
      textEl.textContent = LABEL[view.status].text;
      nameEl.textContent = view.fileName ?? "";
      nameEl.hidden = !view.fileName;
      shown = view.status;
    }

    refresh();
    initialized = true;
    return { refresh, current: () => shown };
  } catch (error) {
    console.warn("[saveState] 초기화 실패:", error);
    return noopController;
  }
}
