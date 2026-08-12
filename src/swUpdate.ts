/**
 * F-69 서비스 워커 업데이트 알림.
 *
 * 기술 스펙(§4.2) 결정: 이 모듈은 앱 내부 모듈을 **하나도 import 하지 않는다.**
 * `notice.ts` 를 확장하면 `tabs.ts → notice.ts → tabs.ts` 순환이 생기므로(§4.1),
 * 필요한 능력(세션 저장·미저장 탭 조회·확인 대화상자 등)은 전부 `main.ts` 가
 * `SwUpdateHost` 로 주입한다. 그 결과 `notice.ts`·`storage.ts`·`parser.ts` 와
 * 동급의 리프 모듈이 되어, vitest(jsdom)에서 실제 `navigator.serviceWorker` 없이
 * 가짜 registration 만으로 전량 검증 가능하다(U9).
 */

export interface SwUpdateHost {
  /** 알림 요소 (index.html 에 정적으로 존재하는 #sw-update) */
  panelEl: HTMLElement;
  /** 등록. 기본 구현은 navigator.serviceWorker.register("/sw.js") */
  register(): Promise<ServiceWorkerRegistration | null>;
  /** controllerchange 구독. 해제 함수를 반환 */
  onControllerChange(fn: () => void): () => void;
  /** 세션 확정 저장. 성공 여부를 반환 (= tabs.persistNow) */
  persist(): boolean;
  /** 미저장 탭 존재 여부 (= tabs.hasDirtyTabs) */
  hasDirty(): boolean;
  /** 저장 불가 상황의 사용자 확인. 기본 window.confirm */
  confirmUnsafeReload(message: string): boolean;
  /** 리로드. 기본 location.reload() */
  reload(): void;
  /** "나중에" 실행 후 포커스를 되돌릴 요소 */
  returnFocusTo: HTMLElement | null;
  /** FR-S5 타임아웃(ms). 기본 3000 */
  activationTimeoutMs?: number;
  /** FR-S2 주기 확인 간격(ms). 기본 3_600_000(60분) */
  checkIntervalMs?: number;
}

const DEFAULT_ACTIVATION_TIMEOUT_MS = 3000;
const DEFAULT_CHECK_INTERVAL_MS = 3_600_000;
/** FR-S1 가시성 복귀 확인의 중복 억제 기준(U6). */
const VISIBILITY_CHECK_THROTTLE_MS = 10 * 60 * 1000;
/** D1 — 로드 시점에 이미 대기 중인 경우, 첫 페인트를 가리지 않도록 두는 지연(NFR-1). */
const INITIAL_SHOW_DELAY_MS = 1000;

const CONFIRM_UNSAFE_RELOAD_MESSAGE =
  "자동 저장을 할 수 없습니다. 저장하지 않은 문서가 있습니다. 지금 새로고침하면 내용이 사라질 수 있습니다. 계속하시겠습니까?";

type PanelState = "idle" | "updating";

/** main.ts 의 beforeunload 가 이탈 경고 억제 여부를 판단할 때 읽는다 (U5). */
let reloadPending = false;

export function isUpdateReloadPending(): boolean {
  return reloadPending;
}

function resolveHost(
  partial: Partial<SwUpdateHost> & Pick<SwUpdateHost, "panelEl">,
): SwUpdateHost {
  return {
    register: async () => {
      if (!("serviceWorker" in navigator)) return null;
      return navigator.serviceWorker.register("/sw.js");
    },
    onControllerChange: (fn) => {
      navigator.serviceWorker.addEventListener("controllerchange", fn);
      return () => navigator.serviceWorker.removeEventListener("controllerchange", fn);
    },
    persist: () => false,
    hasDirty: () => false,
    confirmUnsafeReload: (message) => window.confirm(message),
    reload: () => location.reload(),
    returnFocusTo: null,
    ...partial,
  };
}

/**
 * F-69 감지·표시·dismiss·갱신 결정 로직을 초기화한다.
 *
 * 예외가 에디터 기능을 중단시키지 않도록(NFR-2) 호출자(main.ts)는 이 함수 전체를
 * 이미 PROD 가드 안쪽에서 부르고, 내부에서도 각 비동기 경계를 개별 보호한다.
 */
export function initSwUpdate(
  partialHost: Partial<SwUpdateHost> & Pick<SwUpdateHost, "panelEl">,
): void {
  try {
    const host = resolveHost(partialHost);
    const panelEl = host.panelEl;

    const textEl = panelEl.querySelector<HTMLElement>("#sw-update-text");
    const laterBtn = panelEl.querySelector<HTMLButtonElement>("#sw-update-later");
    const reloadBtn = panelEl.querySelector<HTMLButtonElement>("#sw-update-reload");

    const activationTimeoutMs = host.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
    const checkIntervalMs = host.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

    let registration: ServiceWorkerRegistration | null = null;
    /** 버전 단위 dismiss 추적 — ServiceWorker 객체 동일성으로 비교한다(§5.2). */
    let dismissedWorker: ServiceWorker | null = null;
    let panelState: PanelState = "idle";
    let lastCheckAt = 0;

    function setPanelState(state: PanelState): void {
      panelState = state;
      panelEl.dataset.state = state;
      const updating = state === "updating";
      if (laterBtn) laterBtn.disabled = updating;
      if (reloadBtn) reloadBtn.disabled = updating;
      if (textEl) {
        textEl.innerHTML = updating
          ? "새 버전으로 전환하는 중입니다..."
          : "새 버전이 준비됐습니다.<br />새로고침하면 최신 버전으로 전환됩니다.";
      }
    }

    function show(): void {
      // 최초 설치(제어 워커 없음)에는 절대 표시하지 않는다(FR-M2) — 호출부에서
      // 이미 판정하지만, 여기서도 방어적으로 다시 확인한다.
      if (navigator.serviceWorker.controller === null) return;
      panelEl.hidden = false;
    }

    function hide(): void {
      panelEl.hidden = true;
    }

    function handleWaiting(): void {
      const waiting = registration?.waiting ?? null;
      if (!waiting) return;
      // 최초 설치에서는 controller 가 없으므로 절대 표시하지 않는다(D1-C, FR-M2).
      if (navigator.serviceWorker.controller === null) return;
      if (dismissedWorker === waiting) return;
      show();
    }

    function handleLater(): void {
      dismissedWorker = registration?.waiting ?? null;
      // 순서 중요(§10.3): 포커스를 먼저 되돌린 뒤 숨긴다. 반대로 하면 포커스를 가진
      // 버튼이 먼저 사라져 포커스가 <body> 로 떨어진다. returnFocusTo 가 주입되지
      // 않았을 때(기본값 null) 복구가 아예 불가능해지므로 순서가 실제로 문제가 된다.
      host.returnFocusTo?.focus();
      hide();
      setPanelState("idle");
    }

    async function handleReload(): Promise<void> {
      // FR-S4: 연타 시 첫 클릭만 처리한다.
      if (panelState === "updating") return;
      const waiting = registration?.waiting ?? null;
      if (!waiting) return;

      setPanelState("updating");

      const saved = host.persist();

      if (!saved && host.hasDirty()) {
        const proceed = host.confirmUnsafeReload(CONFIRM_UNSAFE_RELOAD_MESSAGE);
        if (!proceed) {
          // I-12: 취소 시 알림은 기본 상태로 복귀하고 리로드는 일어나지 않는다.
          // 이탈 경고 억제도 켜진 적이 없으므로 별도 해제가 필요 없다(AC-08).
          setPanelState("idle");
          return;
        }
      }

      reloadPending = true;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        unsubscribe();
        host.reload();
      };

      const unsubscribe = host.onControllerChange(finish);
      const timeoutId = setTimeout(finish, activationTimeoutMs);

      try {
        waiting.postMessage({ type: "SKIP_WAITING" });
      } catch (error) {
        // SKIP_WAITING 전송 자체가 실패하면 리로드가 일어나지 않으므로 억제를 되돌린다.
        console.warn("[sw-update] SKIP_WAITING 전송 실패:", error);
        reloadPending = false;
        settled = true;
        clearTimeout(timeoutId);
        unsubscribe();
        setPanelState("idle");
      }
    }

    reloadBtn?.addEventListener("click", () => void handleReload());
    laterBtn?.addEventListener("click", handleLater);

    // Esc 는 알림 내부에 포커스가 있을 때만 닫기로 동작한다(§10.3). document 전역
    // 리스너를 쓰면 shortcuts.ts 와 충돌하므로 반드시 panelEl 에 부착한다.
    panelEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleLater();
      }
    });

    function maybeCheckForUpdate(): void {
      if (!registration) return;
      const now = Date.now();
      if (now - lastCheckAt < VISIBILITY_CHECK_THROTTLE_MS) return;
      lastCheckAt = now;
      registration.update().catch((error) => {
        console.warn("[sw-update] 업데이트 확인 실패:", error);
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") maybeCheckForUpdate();
    });

    setInterval(() => {
      lastCheckAt = 0; // 주기 확인은 가시성 스로틀과 별개로 항상 수행한다.
      maybeCheckForUpdate();
    }, checkIntervalMs);

    void host
      .register()
      .then((reg) => {
        if (!reg) return;
        registration = reg;

        // 경로 A: 로드 시점에 이미 대기 중.
        if (reg.waiting) {
          setTimeout(handleWaiting, INITIAL_SHOW_DELAY_MS);
        }

        // 경로 B: 세션 중 새 워커가 설치된다.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") handleWaiting();
          });
        });
      })
      .catch((error) => {
        console.warn("[sw-update] 등록 실패:", error);
      });
  } catch (error) {
    // NFR-2: 이 모듈의 어떤 예외도 에디터 기능으로 전파되지 않는다.
    console.warn("[sw-update] 초기화 실패:", error);
  }
}
