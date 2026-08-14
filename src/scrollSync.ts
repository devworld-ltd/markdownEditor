/**
 * F-25 스크롤 동기화.
 *
 * `textarea#editor` 와 `div#preview` 는 각각 독립 스크롤 컨테이너다. 이 모듈은
 * 둘을 "스크롤 가능 거리 기준 정규화 비율"로 양방향 연동한다(PRD §3(b)).
 *
 * `offline.ts`·`fsLimitNotice.ts`·`swUpdate.ts` 와 동일하게 앱 모듈을 하나도
 * import 하지 않는 주입형 리프 모듈이다. DOM 전역(`document`/`window`/
 * `requestAnimationFrame`)을 직접 읽지 않고 host 로 주입받는다. jsdom 은
 * `scrollHeight`/`clientHeight` 를 항상 0 으로 보고하므로, 이 host 주입이
 * 매핑 함수·소유권 전이·0 나눗셈 가드를 단위 테스트로 검증하는 유일한 수단이다
 * (기술 스펙 D-1).
 *
 * 소유권(ownership) 모델 — 무한 루프 방지의 핵심:
 *
 * - R1: 사용자 스크롤이 발생한 패널이 소스, 반대편이 종속이 된다.
 * - R2: 프로그램적으로 대입한 scrollTop 값을 `expectedTop` 에 기록해 두고,
 *   그 패널의 다음 scroll 이벤트가 그 값과 1px 이내로 같으면 "프로그램적
 *   메아리"로 판별해 폐기한다. **불리언 플래그를 쓰지 않는 이유**: 프로그램적
 *   `scrollTop` 대입은 scroll 이벤트를 동기적으로 발화하지 않는다(다음 렌더링
 *   기회 직전 큐에서 전달된다). 대입 직후 내리는 불리언 플래그는 이벤트 도착
 *   시점에 이미 false 라서, 그 이벤트가 사용자 스크롤로 오분류되어 루프가
 *   그대로 돈다. 값 비교는 이 문제를 근본적으로 피한다.
 * - R3: 소유권은 시간 만료로 해제되지 않는다. `setTimeout`/`setInterval` 은
 *   이 파일에 한 번도 등장하지 않는다 — 관성 스크롤 중 소유권이 뒤집혀
 *   진동하는 것을 막기 위한 설계다.
 */

import { mapWithAnchors, type ScrollAnchor } from "./scrollAnchors";

/** 스크롤 컨테이너의 최소 계약. 실제 DOM 요소와 가짜 host 객체 모두 만족한다. */
export interface ScrollPanel {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  addEventListener(
    type: "scroll",
    listener: () => void,
    options?: { passive?: boolean },
  ): void;
  /**
   * 초기화 롤백 전용(#33). 두 패널 중 한쪽만 리스너가 붙은 채 초기화가 실패하면,
   * 재시도 시 죽은 클로저의 리스너가 살아남아 두 개의 동기화 엔진이 서로 다른
   * 상태로 같은 `scrollTop` 을 다투게 된다. 실제 DOM 요소는 항상 갖고 있으며,
   * 없으면 롤백을 포기하고 초기화 잠금을 유지한다.
   */
  removeEventListener?(type: "scroll", listener: () => void): void;
}

export interface ScrollSyncHost {
  editor: ScrollPanel;
  preview: ScrollPanel;
  /** 기본 구현: requestAnimationFrame */
  requestFrame(cb: () => void): number;
  /** 기본 구현: cancelAnimationFrame */
  cancelFrame(id: number): void;
  /**
   * 블록 대응표 (이슈 #114). 있으면 비율 대신 이것으로 맞춘다.
   *
   * 비율 동기화는 문서 전체를 하나의 선형 대응으로 보기 때문에, 제목·코드블록처럼
   * 두 패널의 높이비가 국소적으로 다른 지점에서 **보이는 줄이 어긋난다.** 앵커가
   * 있으면 블록마다 대응을 다시 맞춰 오차를 블록 안에 가둔다.
   *
   * 없거나 2개 미만이면 기존 비율 동기화로 되돌아간다 — 틀린 대응표로 맞추는
   * 것은 안 맞추는 것보다 나쁘다.
   */
  getAnchors?: () => readonly ScrollAnchor[];
}

export interface ScrollSyncController {
  /** 동기화를 억제한다. 이 구간의 scroll 이벤트는 전부 폐기된다 (M10). */
  suspend(): void;
  /** 다음 프레임에 억제를 해제한다. 즉시 해제가 아닌 이유는 아래 §resumeAfterFrame 참고. */
  resumeAfterFrame(): void;
  /** 에디터 현재 위치로 프리뷰를 1회 맞춘다 (M11). */
  syncFromEditorOnce(): void;
  /** 프리뷰 innerHTML 교체 직후 직전 비율을 1회 재적용한다 (M9). */
  reapplyAfterRender(): void;
}

type PanelKind = "editor" | "preview";

/** 프로그램적 대입 판별에 쓰는 오차 허용치. HiDPI 소수점 scrollTop 대응. */
const ECHO_EPSILON_PX = 1;

let initialized = false;

function defaultRequestFrame(cb: () => void): number {
  return requestAnimationFrame(cb);
}

function defaultCancelFrame(id: number): void {
  cancelAnimationFrame(id);
}

function resolveHost(
  partialHost: Partial<ScrollSyncHost> & Pick<ScrollSyncHost, "editor" | "preview">,
): ScrollSyncHost {
  return {
    requestFrame: defaultRequestFrame,
    cancelFrame: defaultCancelFrame,
    ...partialHost,
  };
}

/** 스크롤 가능 거리. 0 이하일 수 있다(짧은 문서·레이아웃 전이 중 음수, D-7). */
function scrollableDistance(panel: ScrollPanel): number {
  return panel.scrollHeight - panel.clientHeight;
}

const noopController: ScrollSyncController = {
  suspend() {},
  resumeAfterFrame() {},
  syncFromEditorOnce() {},
  reapplyAfterRender() {},
};

/**
 * F-25 스크롤 동기화 초기화. `offline.ts` 와 동일하게 재진입 가드와 전역
 * try/catch 를 갖는다. 초기화가 실패하면 경고만 남기고 모든 메서드가 no-op 인
 * 컨트롤러를 반환한다 — 동기화 실패가 에디터 기능을 중단시키면 안 된다.
 */
export function initScrollSync(
  partialHost: Partial<ScrollSyncHost> & Pick<ScrollSyncHost, "editor" | "preview">,
): ScrollSyncController {
  if (initialized) {
    console.warn("[scrollSync] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const host = resolveHost(partialHost);
    const panels: Record<PanelKind, ScrollPanel> = {
      editor: host.editor,
      preview: host.preview,
    };

    // --- 상태(D-5) — 다른 어떤 모듈도 이 상태를 읽거나 쓰지 않는다 ---------
    let source: PanelKind | null = null;
    let suspended = false;
    let frameId: number | null = null;
    let pendingResumeId: number | null = null;
    let lastRatio: number | null = null;
    const expectedTop: Record<PanelKind, number | null> = {
      editor: null,
      preview: null,
    };

    function otherOf(panel: PanelKind): PanelKind {
      return panel === "editor" ? "preview" : "editor";
    }

    /** ratio(p) = clamp(p.scrollTop / d(p), 0, 1). d(p) <= 0 이면 계산하지 않는다. */
    function computeRatio(panel: ScrollPanel): number | null {
      const distance = scrollableDistance(panel);
      if (!(distance > 0)) return null; // `!== 0` 이 아니라 `> 0` — 레이아웃 전이 중 음수 대비 (D-7)

      const top = panel.scrollTop;
      // 4.3 양 끝 정확 일치 — 1px 스냅
      if (top <= ECHO_EPSILON_PX) return 0;
      if (distance - top <= ECHO_EPSILON_PX) return 1;
      return top / distance;
    }

    /** 목표 좌표를 그대로 적용한다. 메아리 판별(R2)은 여기 한 곳에서만 걸린다. */
    function applyTopToPanel(kind: PanelKind, rawTarget: number): void {
      const panel = panels[kind];
      const distance = scrollableDistance(panel);
      if (!(distance > 0)) return; // 종속이 갈 곳이 없다 (E2/E3)

      const target = Math.round(Math.max(0, Math.min(distance, rawTarget)));
      if (Math.abs(target - panel.scrollTop) < ECHO_EPSILON_PX) return; // 불필요한 쓰기·고아 expectedTop 방지

      expectedTop[kind] = target; // R2 — 대입 직전에 기록
      panel.scrollTop = target;
    }

    function applyToPanel(kind: PanelKind, ratio: number): void {
      const distance = scrollableDistance(panels[kind]);
      if (!(distance > 0)) return;
      applyTopToPanel(kind, ratio * distance);
    }

    /**
     * 앵커로 계산한 반대편 목표. 앵커가 없으면 null 이고, 호출부는 비율로 간다.
     *
     * 이 함수는 **읽기만 한다** — 소유권·메아리 상태를 건드리지 않으므로 F-25 의
     * 루프 방지 모델(R1~R3)에 손대지 않는다.
     */
    function anchoredTarget(from: PanelKind, top: number): number | null {
      const anchors = host.getAnchors?.();
      if (!anchors || anchors.length < 2) return null;
      return mapWithAnchors(
        anchors,
        from,
        top,
        scrollableDistance(panels[otherOf(from)]),
        scrollableDistance(panels[from]),
      );
    }

    function cancelPendingFrame(): void {
      if (frameId !== null) {
        host.cancelFrame(frameId);
        frameId = null;
      }
    }

    function scheduleFrame(): void {
      if (frameId !== null) return; // 같은 프레임의 추가 이벤트 흡수 (M8)
      frameId = host.requestFrame(applyFrame);
    }

    function applyFrame(): void {
      frameId = null;
      if (suspended || source === null) return;

      const srcPanel = panels[source];
      const ratio = computeRatio(srcPanel);
      if (ratio === null) return; // 소스가 못 움직이면 비율이 정의되지 않는다. lastRatio 갱신 안 함

      const anchored = anchoredTarget(source, srcPanel.scrollTop);
      if (anchored !== null) applyTopToPanel(otherOf(source), anchored);
      else applyToPanel(otherOf(source), ratio);

      // 앵커로 맞췄더라도 비율은 계속 기록한다 — 렌더 직후 재적용(M9)에서
      // 앵커가 아직 없을 수 있고, 그때 되돌아갈 자리가 필요하다.
      lastRatio = ratio;
    }

    function onScroll(panel: PanelKind): void {
      if (suspended) {
        expectedTop[panel] = null;
        return; // M10
      }

      const expected = expectedTop[panel];
      if (
        expected !== null &&
        Math.abs(panels[panel].scrollTop - expected) <= ECHO_EPSILON_PX
      ) {
        expectedTop[panel] = null;
        return; // R2 — 프로그램적 메아리. 여기서 루프가 끊긴다
      }

      expectedTop[panel] = null;
      source = panel; // R1/R3 — 시간 만료 없이 즉시 전환
      scheduleFrame();
    }

    // 리스너 부착은 이 초기화에서 **유일하게 되돌릴 수 없는 부작용**이다. 한쪽만
    // 붙은 채 실패하면 재시도가 두 번째 엔진을 만들어 두 클로저가 같은 scrollTop 을
    // 다툰다. 그래서 부착 실패 시 붙은 것을 떼어내고, 뗄 수단이 없으면 재시도를
    // 막는다(#33).
    const onEditorScroll = () => onScroll("editor");
    const onPreviewScroll = () => onScroll("preview");
    const attached: Array<[ScrollPanel, () => void]> = [];
    try {
      panels.editor.addEventListener("scroll", onEditorScroll, { passive: true });
      attached.push([panels.editor, onEditorScroll]);
      panels.preview.addEventListener("scroll", onPreviewScroll, { passive: true });
      attached.push([panels.preview, onPreviewScroll]);
    } catch (error) {
      for (const [panel, listener] of attached) {
        if (typeof panel.removeEventListener !== "function") {
          // 뗄 수 없다 — 재시도가 더 나쁜 상태를 만든다. 잠근 채로 실패한다.
          initialized = true;
          throw error;
        }
        panel.removeEventListener("scroll", listener);
      }
      throw error;
    }

    function doSuspend(): void {
      suspended = true;
      cancelPendingFrame();
      if (pendingResumeId !== null) {
        host.cancelFrame(pendingResumeId);
        pendingResumeId = null;
      }
      expectedTop.editor = null;
      expectedTop.preview = null;
    }

    function doResumeAfterFrame(): void {
      // 즉시 해제가 아니라 다음 프레임에 해제하는 이유: renderPreview() 의
      // innerHTML 교체가 프리뷰 scrollTop 을 리셋하며 scroll 이벤트를 큐에
      // 넣는데, 이 이벤트는 동기 실행이 끝난 뒤 rAF 콜백보다 먼저 도착한다.
      // 즉시 해제하면 그 이벤트가 사용자 스크롤로 분류되어 에디터 복원값을
      // 덮어쓴다(F-06/F-51 회귀). setTimeout(…, 0) 은 이 순서를 보장하지
      // 않으므로 쓰지 않는다.
      pendingResumeId = host.requestFrame(() => {
        pendingResumeId = null;
        suspended = false;
      });
    }

    const controller: ScrollSyncController = {
      suspend: doSuspend,
      resumeAfterFrame: doResumeAfterFrame,

      syncFromEditorOnce() {
        // 에디터 → 프리뷰 단방향. 프리뷰가 소스가 되는 경로는 없다.
        const ratio = computeRatio(panels.editor);
        if (ratio === null) return;

        const anchored = anchoredTarget("editor", panels.editor.scrollTop);
        if (anchored !== null) applyTopToPanel("preview", anchored);
        else applyToPanel("preview", ratio);

        source = "editor";
        lastRatio = ratio;
      },

      reapplyAfterRender() {
        // syncFromEditorOnce() 가 아니라 lastRatio(직전 동기화 비율)를 재적용한다.
        // 소스가 프리뷰였고 에디터가 스크롤 불가인 경우, 에디터에서 비율을 다시
        // 유도하면 0 이 나와 프리뷰가 맨 위로 튄다. 저장된 비율을 쓰면 두 경우
        // 모두 옳다. lastRatio 가 null(아직 한 번도 스크롤하지 않음)이면
        // 아무것도 하지 않는다 — 프리뷰는 정상적으로 맨 위에 머문다.
        // 내부적으로 suspend() → 적용 → resumeAfterFrame() 3단계를 그대로 쓴다.
        //
        // 단, doSuspend() 는 대기 중이던 applyFrame 을 취소한다(#34). 사용자가
        // 스크롤과 타이핑을 동시에 하면 방금 만든 스크롤 한 프레임이 조용히
        // 사라지고, 여기서 낡은 lastRatio 를 덮어써서 다음 스크롤까지 어긋난
        // 채로 남는다. 그래서 취소 **전에** 최신 비율을 확정한다.
        //
        // 소스가 에디터일 때만 되살릴 수 있다. 소스가 프리뷰였다면 그 비율의
        // 근거인 preview.scrollTop 을 이미 innerHTML 교체가 0 으로 지운 뒤라
        // 이 시점에 복원할 정보가 남아 있지 않다 — 에디터에 타이핑하면서 동시에
        // 프리뷰를 스크롤해야 닿는 경로다.
        const pendingRatio =
          frameId !== null && source === "editor" ? computeRatio(panels.editor) : null;
        const ratio = pendingRatio ?? lastRatio;
        if (ratio === null) return;

        doSuspend();
        // 이슈 #114: 렌더 직후에도 앵커가 있으면 그것으로 맞춘다. 렌더로 프리뷰
        // 높이가 달라졌을 수 있는데, 그때 비율을 그대로 쓰면 방금 보던 줄에서
        // 벗어난다 — 타이핑 중에 프리뷰가 슬금슬금 밀리는 증상이 이것이다.
        const anchored =
          source === "editor" ? anchoredTarget("editor", panels.editor.scrollTop) : null;
        if (anchored !== null) applyTopToPanel("preview", anchored);
        else applyToPanel("preview", ratio);
        doResumeAfterFrame();
        lastRatio = ratio;
      },
    };

    initialized = true; // 성공 경로에서만 잠근다 — 실패는 재시도 가능해야 한다 (#33)
    return controller;
  } catch (error) {
    console.warn("[scrollSync] 초기화 실패:", error);
    return noopController;
  }
}
