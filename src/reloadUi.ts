/**
 * F-88 파일 변경 감지 새로고침 — 배너 + 대화상자 (이슈 #187, D-2).
 *
 * 세 갈래 UI 를 역할대로 나눈다(기술 스펙 §4.4):
 *
 * | 상황 | UI |
 * |------|-----|
 * | 깨끗한 탭 자동 반영 | 기존 `#notice`(이 모듈이 아니라 `notice.ts`, host 로 주입) |
 * | 더티 탭 변경 감지 | 이 모듈의 정적 배너(`#reload-banner`) — 타이핑을 막지 않는다(A-1) |
 * | 파괴적 확정(재읽기·저장 충돌) | 이 모듈의 두 `<dialog>` |
 *
 * `swUpdate.ts`·`shortcutHelp.ts` 와 같은 **주입형 리프**다 — 앱 모듈을 하나도
 * import 하지 않는다.
 *
 * `<dialog>` 필수 사항(트랩 #25·#84):
 * - `.shortcut-help` 클래스를 그대로 재사용한다 — `margin: auto` 복원이 이미
 *   거기 있고, `display` 를 무조건 주지 않으므로 트랩 #84 에 해당하지 않는다.
 * - 백드롭 닫기는 `pointerdown` + 좌표 판정(트랩 #25) — `click` 은 여는 클릭이
 *   즉시 닫는 경합을 만든다.
 * - 기본 포커스는 **취소**(D-6) — 파괴적 동작이 Enter 한 번에 일어나면 안 된다.
 */

export interface ReloadUiHost {
  bannerEl: HTMLElement;
  bannerTextEl: HTMLElement;
  bannerReloadEl: HTMLElement;
  bannerKeepEl: HTMLElement;
  bannerCloseEl: HTMLElement;

  confirmDialogEl: HTMLDialogElement;
  confirmTextEl: HTMLElement;
  confirmMetaEl: HTMLElement;
  confirmCancelEl: HTMLElement;
  confirmOkEl: HTMLElement;

  conflictDialogEl: HTMLDialogElement;
  conflictTextEl: HTMLElement;
  conflictCancelEl: HTMLElement;
  conflictReloadEl: HTMLElement;
  conflictOverwriteEl: HTMLElement;

  /** 배너 "다시 읽기" 클릭 — 호출부(main.ts)가 `controller.reloadActive()` 를 넘긴다. */
  onReloadClick: () => void;
  /** 배너 "내 내용 유지"/"×" 클릭 — 호출부가 `controller.keepMine()` 을 넘긴다. */
  onKeepMineClick: () => void;
}

export interface ReloadConfirmInfo {
  fileName: string;
  diskModifiedAt: number | null;
}

export type SaveConflictChoice = "cancel" | "reload" | "overwrite";

export interface ReloadUiController {
  showBanner(fileName: string): void;
  hideBanner(): void;
  confirmReload(info: ReloadConfirmInfo): Promise<boolean>;
  confirmSaveConflict(info: ReloadConfirmInfo): Promise<SaveConflictChoice>;
}

const noopController: ReloadUiController = {
  showBanner() {},
  hideBanner() {},
  confirmReload: async () => false,
  confirmSaveConflict: async () => "cancel",
};

let initialized = false;

function formatMeta(diskModifiedAt: number | null): string {
  if (diskModifiedAt === null) return "";
  try {
    return `디스크 최종 수정: ${new Date(diskModifiedAt).toLocaleString()}`;
  } catch {
    return "";
  }
}

/** 백드롭 바깥 클릭 판정 + 닫기. 트랩 #25 — pointerdown + 좌표. */
function wireBackdropClose(dialogEl: HTMLDialogElement, onOutside: () => void): void {
  dialogEl.ownerDocument.addEventListener("pointerdown", (event) => {
    if (!dialogEl.open) return;
    const rect = dialogEl.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) onOutside();
  });
}

export function initReloadUi(host: ReloadUiHost): ReloadUiController {
  if (initialized) {
    console.warn("[reloadUi] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const {
      bannerEl,
      bannerTextEl,
      bannerReloadEl,
      bannerKeepEl,
      bannerCloseEl,
      confirmDialogEl,
      confirmTextEl,
      confirmMetaEl,
      confirmCancelEl,
      confirmOkEl,
      conflictDialogEl,
      conflictTextEl,
      conflictCancelEl,
      conflictReloadEl,
      conflictOverwriteEl,
    } = host;

    // --- 배너 --------------------------------------------------------------

    function showBanner(fileName: string): void {
      bannerTextEl.textContent = `"${fileName}" 가 디스크에서 변경되었습니다. 편집 중인 내용이 있어 자동으로 반영하지 않았습니다.`;
      bannerEl.hidden = false;
      // A-1: 포커스를 빼앗지 않는다 — 타이핑 중이면 글자가 엉뚱한 곳에 들어간다.
    }

    function hideBanner(): void {
      bannerEl.hidden = true;
    }

    bannerReloadEl.addEventListener("click", () => host.onReloadClick());
    bannerKeepEl.addEventListener("click", () => host.onKeepMineClick());
    bannerCloseEl.addEventListener("click", () => host.onKeepMineClick()); // I-10: × 는 "내 내용 유지"와 동일

    // --- 재읽기 확인 대화상자 (더티 탭, 파괴적) ------------------------------

    function confirmReload(info: ReloadConfirmInfo): Promise<boolean> {
      return new Promise((resolve) => {
        confirmTextEl.textContent = `"${info.fileName}"`;
        confirmMetaEl.textContent = formatMeta(info.diskModifiedAt);
        confirmDialogEl.returnValue = "";

        function onCancel() {
          confirmDialogEl.close("cancel");
        }
        function onOk() {
          confirmDialogEl.close("ok");
        }
        function onClose() {
          confirmCancelEl.removeEventListener("click", onCancel);
          confirmOkEl.removeEventListener("click", onOk);
          confirmDialogEl.removeEventListener("close", onClose);
          resolve(confirmDialogEl.returnValue === "ok");
        }

        confirmCancelEl.addEventListener("click", onCancel);
        confirmOkEl.addEventListener("click", onOk);
        confirmDialogEl.addEventListener("close", onClose);

        confirmDialogEl.showModal();
        confirmCancelEl.focus(); // D-6: 기본 포커스 = 취소
      });
    }

    wireBackdropClose(confirmDialogEl, () => {
      if (confirmDialogEl.open) confirmDialogEl.close("cancel");
    });

    // --- 저장 충돌 대화상자 (S-1) --------------------------------------------

    function confirmSaveConflict(info: ReloadConfirmInfo): Promise<SaveConflictChoice> {
      return new Promise((resolve) => {
        conflictTextEl.textContent = `"${info.fileName}" 는 이 앱에서 연 뒤 디스크에서 변경되었습니다. 지금 저장하면 그 변경이 덮어써집니다.`;
        conflictDialogEl.returnValue = "";

        function onCancel() {
          conflictDialogEl.close("cancel");
        }
        function onReload() {
          conflictDialogEl.close("reload");
        }
        function onOverwrite() {
          conflictDialogEl.close("overwrite");
        }
        function onClose() {
          conflictCancelEl.removeEventListener("click", onCancel);
          conflictReloadEl.removeEventListener("click", onReload);
          conflictOverwriteEl.removeEventListener("click", onOverwrite);
          conflictDialogEl.removeEventListener("close", onClose);
          const value = conflictDialogEl.returnValue;
          resolve(value === "reload" || value === "overwrite" ? value : "cancel");
        }

        conflictCancelEl.addEventListener("click", onCancel);
        conflictReloadEl.addEventListener("click", onReload);
        conflictOverwriteEl.addEventListener("click", onOverwrite);
        conflictDialogEl.addEventListener("close", onClose);

        conflictDialogEl.showModal();
        conflictCancelEl.focus(); // D-6: 기본 포커스 = 취소
      });
    }

    wireBackdropClose(conflictDialogEl, () => {
      if (conflictDialogEl.open) conflictDialogEl.close("cancel");
    });

    initialized = true;
    return { showBanner, hideBanner, confirmReload, confirmSaveConflict };
  } catch (error) {
    console.warn("[reloadUi] 초기화 실패:", error);
    return noopController;
  }
}
