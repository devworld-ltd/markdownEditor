/**
 * F-70 오프라인 상태 표시.
 *
 * 이슈 #17 의 판단 사항에 대한 결정과 근거:
 *
 * 1) 감지 신호 — `online`/`offline` 이벤트 + `navigator.onLine` 만 쓴다. 실제 요청
 *    실패를 보강 신호로 쓰지 않는다. 이 앱은 최초 로드 이후 서비스 워커 업데이트
 *    확인(§7.2, 60분 주기 + 가시성 복귀 시)을 빼면 네트워크를 전혀 쓰지 않으므로
 *    "요청 실패 = 오프라인" 신호 자체가 거의 발생하지 않고, 발생해도 그 순간에만
 *    반짝 오탐(온라인인데 offline 로 오판)할 위험이 실익보다 크다. 단순하고 예측
 *    가능한 신호가 낫다.
 * 2) 표시 형태 — 지속형 배지. 오프라인은 사라지지 않는 상태이므로 `notice.ts` 의
 *    4초 자동 숨김 토스트는 쓰지 않는다. online 복귀 이벤트에서만 숨긴다.
 * 3) `#notice-stack` 세 번째 항목 — `#sw-update` 뒤(스택 맨 아래)에 둔다. 토스트인
 *    `#notice` 가 사라져도 레이아웃이 튀지 않도록 지속형 항목을 아래에 두는 기존
 *    원칙(§notice-stack)을 그대로 따른다. `#sw-update` 는 사용자 액션(버튼)이 필요한
 *    지속형 항목이라 정보 전달만 하는 이 배지보다 위에 둔다.
 * 4) 오해 방지 — 문구에 "저장 안 됨" 을 암시하는 표현을 넣지 않는다. 편집·자동
 *    저장·파일 저장은 오프라인에서도 전부 로컬로 동작하므로 경고가 아니라 정보
 *    전달로 문구를 고정한다(index.html 정적 텍스트).
 *
 * `swUpdate.ts` 와 동일하게 앱 모듈을 하나도 import 하지 않는 주입형 리프 모듈이다.
 * 전역 `navigator.onLine`/`window` 이벤트를 직접 읽지 않고 host 로 주입받아, 단위
 * 테스트에서 실제 브라우저 온오프라인 전환 없이 가짜 host 만으로 전량 검증한다.
 */

export interface OfflineHost {
  /** 알림 요소 (index.html 에 정적으로 존재하는 #offline-indicator) */
  badgeEl: HTMLElement;
  /** 초기 상태 판정. 기본 구현은 navigator.onLine */
  isOnline(): boolean;
  /** online 이벤트 구독. 해제 함수를 반환 */
  onOnline(fn: () => void): () => void;
  /** offline 이벤트 구독. 해제 함수를 반환 */
  onOffline(fn: () => void): () => void;
}

/**
 * 재진입 가드(swUpdate.ts 의 `initialized` 와 동일한 원칙). main.ts 는 앱 생애주기당
 * 정확히 한 번만 호출한다.
 */
let initialized = false;

function resolveHost(
  partial: Partial<OfflineHost> & Pick<OfflineHost, "badgeEl">,
): OfflineHost {
  return {
    isOnline: () => navigator.onLine,
    onOnline: (fn) => {
      window.addEventListener("online", fn);
      return () => window.removeEventListener("online", fn);
    },
    onOffline: (fn) => {
      window.addEventListener("offline", fn);
      return () => window.removeEventListener("offline", fn);
    },
    ...partial,
  };
}

/**
 * F-70 오프라인 배지 초기화. 예외가 에디터 기능을 중단시키지 않도록(swUpdate.ts 의
 * NFR-2 와 동일 원칙) 내부 전체를 보호한다.
 */
export function initOfflineIndicator(
  partialHost: Partial<OfflineHost> & Pick<OfflineHost, "badgeEl">,
): void {
  if (initialized) {
    console.warn("[offline] 이미 초기화되어 재호출을 무시합니다.");
    return;
  }
  initialized = true;
  try {
    const host = resolveHost(partialHost);
    const badgeEl = host.badgeEl;

    function show(): void {
      badgeEl.hidden = false;
    }
    function hide(): void {
      badgeEl.hidden = true;
    }

    // 로드 시점 초기 상태 반영.
    if (host.isOnline()) {
      hide();
    } else {
      show();
    }

    host.onOffline(show);
    host.onOnline(hide);
  } catch (error) {
    console.warn("[offline] 초기화 실패:", error);
  }
}
