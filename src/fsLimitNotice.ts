/**
 * F-58 브라우저별 기능 한계 안내.
 *
 * 이슈 #25 의 판단 사항에 대한 결정과 근거:
 *
 * 1) 표시 시점 — 폴백(Safari·Firefox) 모드에서 사용자가 **처음 저장을 시도하는
 *    순간** 1회만 보여준다(세션당 1회, 모듈 스코프 `shown` 플래그로 이후 호출을
 *    무시한다). 앱 진입 시 띄우면 아직 문제와 무관한 시점이라 무시되기 쉽고 다음
 *    실제 저장 때는 기억나지 않는다. 상시 배지는 편집 내내 화면을 차지해 "반복
 *    소음"이 된다(이슈가 명시한 우려). 저장을 실행하는 시점에 맞춰 보여주면
 *    "note (1).md 가 왜 생겼지?" 하고 당황하기 전에 원인을 먼저 알 수 있다.
 * 2) 중복 열기 제약 — 별도로 알리지 않는다. 저장(데이터가 예상과 다른 곳에
 *    쌓임)보다 체감 손실이 작고(탭이 하나 더 생길 뿐 데이터 유실은 없다), 별도
 *    알림을 추가하면 세션당 알림이 2개로 늘어 소음만 커진다. 저장 안내 문구가
 *    이미 "이 브라우저는 파일 핸들을 다룰 수 없다"는 같은 근본 원인을 설명하므로
 *    충분하다고 판단했다.
 * 3) 알림 스택 — 기존 `showNotice()`(`#notice`)를 재사용하지 않고 새 스택 항목을
 *    추가했다. `saveFileAs()` 는 같은 타이밍에 "OO 을(를) 내려받았습니다" 토스트를
 *    이미 `#notice` 에 띄우므로, 같은 요소에 다시 쓰면 먼저 뜬 메시지를 지우거나
 *    (showNotice 는 내용과 타이머를 덮어쓴다) 두 메시지의 순서가 꼬인다. `.notice-stack`
 *    은 이미 `max-width: min(420px, calc(100% - 32px))` 로 좁은 화면(720px 이하
 *    포함)에 대응하므로 네 번째 항목을 더해도 폭 문제는 없다. 세션당 1회만 뜨고
 *    자동 숨김 타이머 없이 수동으로만 닫힌다 — offline.ts 의 "토스트는 자리를 비운
 *    사이 사라져 무의미해진다" 원칙과 같은 이유로, 안내를 읽기 전에 사라지면 목적을
 *    잃는다. DOM 순서는 `#notice`(가장 빈번한 일시 토스트) 바로 다음, `#sw-update`
 *    /`#offline-indicator`(지속형) 이전에 둔다 — "지속형 아래, 일시 위" 원칙
 *    (style.css `.notice-stack` 주석)을 그대로 따른다.
 * 4) 문구 — 비난조("당신 브라우저는 못 합니다")를 피하고 "이 브라우저에서는 이렇게
 *    동작한다"는 사실과 사용자가 할 일("다운로드 폴더에서 최신 내용 확인")을 함께
 *    전달한다. Chrome·Edge 로 전환하면 해결된다는 대안도 담아 행동 지침을 준다.
 *
 * `offline.ts`/`swUpdate.ts` 와 동일한 주입형 리프 모듈이다 — 앱 모듈을 하나도
 * import 하지 않는다. 표시 여부를 가르는 폴백 판정(`isFileSystemAccessSupported()`)도
 * 이 모듈이 직접 읽지 않고 호출자가 판단해 `initFsLimitNotice()` 호출 여부로 넘긴다.
 * Chrome·Edge 에서는 아예 초기화되지 않으므로 리스너조차 붙지 않아 "아무것도 보이지
 * 않아야 한다"는 요구를 가장 확실하게 만족한다.
 */

export interface FsLimitNoticeHost {
  /** 알림 요소 (index.html 에 정적으로 존재하는 #fs-limit-notice) */
  panelEl: HTMLElement;
  /** "확인" 클릭 후 포커스를 되돌릴 요소 */
  returnFocusTo?: HTMLElement | null;
}

/** 재진입 가드 — swUpdate.ts/offline.ts 와 동일 원칙. */
let initialized = false;
/** 세션당 1회 표시 가드(판단 1). dismiss 여부와 무관하게 "이미 보여준 적 있음"을 기록한다. */
let shown = false;

let panelEl: HTMLElement | null = null;
let returnFocusTo: HTMLElement | null = null;

function resolveHost(
  partial: Partial<FsLimitNoticeHost> & Pick<FsLimitNoticeHost, "panelEl">,
): FsLimitNoticeHost {
  return { returnFocusTo: null, ...partial };
}

/**
 * 닫기 버튼·Esc 배선을 준비한다. 호출자(main.ts)는 폴백 모드일 때만 이 함수를
 * 부른다 — 지원 브라우저에서는 호출 자체를 생략해 리스너가 하나도 붙지 않는다.
 *
 * 예외가 에디터 기능을 중단시키지 않도록(swUpdate.ts 의 NFR-2 와 동일 원칙) 내부
 * 전체를 보호한다.
 */
export function initFsLimitNotice(
  partialHost: Partial<FsLimitNoticeHost> & Pick<FsLimitNoticeHost, "panelEl">,
): void {
  if (initialized) {
    console.warn("[fs-limit-notice] 이미 초기화되어 재호출을 무시합니다.");
    return;
  }
  initialized = true;
  try {
    const host = resolveHost(partialHost);
    panelEl = host.panelEl;
    returnFocusTo = host.returnFocusTo ?? null;

    const dismissBtn = panelEl.querySelector<HTMLButtonElement>(
      "#fs-limit-notice-dismiss",
    );

    function hide(): void {
      if (panelEl) panelEl.hidden = true;
    }

    function handleDismiss(): void {
      returnFocusTo?.focus();
      hide();
    }

    dismissBtn?.addEventListener("click", handleDismiss);

    // Esc 는 알림 내부에 포커스가 있을 때만 닫기로 동작한다(swUpdate.ts 와 동일).
    // document 전역 리스너를 쓰면 shortcuts.ts 와 충돌한다.
    panelEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleDismiss();
      }
    });
  } catch (error) {
    console.warn("[fs-limit-notice] 초기화 실패:", error);
  }
}

/**
 * 폴백 모드에서 사용자가 저장을 시도한 시점에 호출한다(fileOps.ts `saveFileAs()`
 * 의 폴백 분기). 세션당 1회만 실제로 표시하고, 이후 호출은 조용히 무시한다
 * (판단 1 — 반복 소음 방지). `initFsLimitNotice()` 가 호출되지 않았다면(예: 아직
 * 배선 전이거나 지원 브라우저) 아무 일도 하지 않는다.
 */
export function notifyFallbackSave(): void {
  if (shown) return;
  if (!panelEl) return;
  shown = true;
  try {
    panelEl.hidden = false;
  } catch (error) {
    console.warn("[fs-limit-notice] 표시 실패:", error);
  }
}
