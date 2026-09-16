/**
 * F-90/F-91 원격·로컬 열기 확인 대화상자 — 주입형 리프 (이슈 #195).
 *
 * `reloadUi.ts`·`swUpdate.ts` 와 같은 성격이다 — 앱 모듈을 하나도 import 하지
 * 않는다. `notice`·`tabs`·`fileOps`·`remoteDoc` 은 전부 `main.ts` 가 콜백으로
 * 주입한다.
 *
 * ## 콜백 형태인 이유 (반환 `Promise<boolean>` 이 아닌 이유)
 *
 * `reloadUi.ts` 는 `Promise<boolean>` 을 돌려주지만 여기서는 쓸 수 없다.
 * `await` 로 값을 받은 뒤에 `showOpenFilePicker()` 를 부르면 **사용자 제스처가
 * 이미 끝나 파일 선택창이 조용히 열리지 않는다**(`<input type=file>` 폴백은
 * 예외조차 없다 — PRD 결정 2 실측). 콜백은 "열기"/"파일 선택" 클릭 핸들러의
 * **동기 프레임 안에서** 불린다.
 *
 * `<dialog>` 필수 사항(트랩 #25·#84, `reloadUi.ts` 선례 그대로):
 * - `.shortcut-help` 클래스 재사용 — `margin: auto` 복원, `display` 는
 *   `dialog[open]` 로만 한정된다.
 * - 백드롭 닫기는 `pointerdown` + 좌표 판정 — `click` 은 여는 클릭이 즉시
 *   닫는 경합을 만든다.
 * - 기본 포커스는 **취소**(D-6) — 파괴적 확정이 Enter 한 번에 일어나면 안 된다.
 * - 주소는 **`textContent` 로만** 넣는다 — `<a href>` 로 만들지 않는다(확인창
 *   안에서 대상으로 이동할 수 있으면 확인의 의미가 없다).
 */

export interface OpenUrlUiHost {
  dialogEl: HTMLDialogElement;
  titleEl: HTMLElement;
  bodyEl: HTMLElement;
  /** 전체 주소 상자 — textContent 로만 넣는다. */
  targetEl: HTMLElement;
  cancelEl: HTMLElement;
  confirmEl: HTMLElement;
  /** 닫힌 뒤 포커스 복귀 지점. main.ts 가 editorEl 을 넘긴다. */
  returnFocusTo?: HTMLElement;
}

export interface OpenUrlUiController {
  /**
   * 원격 확인. 사용자가 "열기" 를 누르면 그 클릭 핸들러 안에서 onConfirm 이
   * 불린다. 취소(취소 버튼·Esc·백드롭)로 닫히면 `onConfirm` 대신 `onCancel`
   * 이 불린다(M-9 — 주소 정리는 열기/취소가 끝난 뒤에 한다).
   */
  confirmRemote(
    info: { url: string; host: string },
    onConfirm: () => void,
    onCancel?: () => void,
  ): void;
  /** 로컬 확인. "파일 선택" 클릭 핸들러 안에서 onConfirm 이 불린다. */
  confirmLocal(onConfirm: () => void, onCancel?: () => void): void;
  isOpen(): boolean;
}

const noopController: OpenUrlUiController = {
  confirmRemote: () => {},
  confirmLocal: () => {},
  isOpen: () => false,
};

let initialized = false;

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

export function initOpenUrlUi(host: OpenUrlUiHost): OpenUrlUiController {
  if (initialized) {
    console.warn("[openUrlUi] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { dialogEl, titleEl, bodyEl, targetEl, cancelEl, confirmEl, returnFocusTo } = host;

    let pendingConfirm: (() => void) | null = null;
    let pendingCancel: (() => void) | null = null;
    let confirmHandler: (() => void) | null = null;
    let cancelHandler: (() => void) | null = null;
    let closeHandler: (() => void) | null = null;

    function cleanupListeners(): void {
      if (confirmHandler) confirmEl.removeEventListener("click", confirmHandler);
      if (cancelHandler) cancelEl.removeEventListener("click", cancelHandler);
      if (closeHandler) dialogEl.removeEventListener("close", closeHandler);
      confirmHandler = null;
      cancelHandler = null;
      closeHandler = null;
    }

    function closeDialog(): void {
      if (dialogEl.open) dialogEl.close();
    }

    function open(
      mode: "remote" | "local",
      info: { url?: string; host?: string },
      onConfirm: () => void,
      onCancel?: () => void,
    ): void {
      // 재진입(#199): 이미 열려 있으면 **새 요청을 버리되 그 onCancel 은 부른다.**
      // 그래야 main.ts 의 cleanupAddress() 가 돌아 주소에 파라미터가 남지 않는다 —
      // 예전에는 그냥 return 해서 "오류도 없이 조용히 무동작" 이었다.
      //
      // 열려 있던 것을 새 요청으로 **교체하지 않는** 이유가 둘이다.
      //
      // 1. 이 대화상자의 존재 이유가 "링크를 준 사람을 믿을 수 있을 때만 여세요"
      //    다. 사용자가 A 를 읽고 "열기" 로 손을 옮기는 사이 내용이 B 로 바뀌면
      //    읽지 않은 것을 확인하게 된다 — 확인창이 오히려 위험해진다.
      // 2. `dialogEl.close()` 의 close 이벤트는 **동기가 아니라 큐에 들어간다.**
      //    교체하려면 닫기 전에 옛 핸들러를 떼야 하고, 안 그러면 뒤늦게 도착한
      //    close 가 방금 세운 새 요청을 취소로 처리한다.
      //
      // 닿는 경로는 PWA focus-existing(F-89/#187) 이다 — 확인창이 떠 있는 창에
      // OS 가 새 targetURL 을 전달할 때.
      if (dialogEl.open) {
        onCancel?.();
        return;
      }

      pendingConfirm = onConfirm;
      pendingCancel = onCancel ?? null;

      if (mode === "remote") {
        titleEl.textContent = "이 주소의 문서를 열까요?";
        bodyEl.textContent =
          `${info.host} 에서 마크다운 문서를 내려받습니다. ` +
          "링크를 준 사람을 믿을 수 있을 때만 여세요. 현재 문서는 그대로 두고 새 탭에서 엽니다.";
        targetEl.textContent = info.url ?? "";
        targetEl.hidden = false;
        confirmEl.textContent = "열기";
      } else {
        titleEl.textContent = "파일을 열까요?";
        bodyEl.textContent =
          "브라우저는 주소만으로 파일 창을 열 수 없습니다. 아래 버튼을 누르면 파일 선택 창이 열립니다.";
        targetEl.textContent = "";
        targetEl.hidden = true;
        confirmEl.textContent = "파일 선택";
      }

      cleanupListeners();

      confirmHandler = () => {
        const cb = pendingConfirm;
        pendingConfirm = null;
        pendingCancel = null;
        closeDialog();
        // **동기 프레임 안에서** 부른다 — await 뒤로 미루면 제스처가 만료된다.
        cb?.();
      };
      // 취소 버튼은 닫기만 한다 — 취소로 인식하는 것은 close 이벤트(아래)다.
      // Esc·백드롭도 같은 경로를 타야 셋이 동일하게 취급된다.
      cancelHandler = () => {
        closeDialog();
      };
      closeHandler = () => {
        // pendingConfirm 이 아직 남아 있다면 confirmHandler 를 거치지 않고
        // 닫힌 것이다 — 취소 버튼·Esc·백드롭이 전부 여기로 모인다(M-9).
        const cancelled = pendingConfirm !== null;
        const cancel = pendingCancel;
        pendingConfirm = null;
        pendingCancel = null;
        cleanupListeners();
        returnFocusTo?.focus();
        if (cancelled) cancel?.();
      };

      confirmEl.addEventListener("click", confirmHandler);
      cancelEl.addEventListener("click", cancelHandler);
      dialogEl.addEventListener("close", closeHandler);

      dialogEl.showModal();
      cancelEl.focus(); // D-6: 기본 포커스 = 취소
    }

    wireBackdropClose(dialogEl, () => {
      closeDialog();
    });

    initialized = true;
    return {
      confirmRemote: (info, onConfirm, onCancel) => open("remote", info, onConfirm, onCancel),
      confirmLocal: (onConfirm, onCancel) => open("local", {}, onConfirm, onCancel),
      isOpen: () => dialogEl.open,
    };
  } catch (error) {
    console.warn("[openUrlUi] 초기화 실패:", error);
    return noopController;
  }
}
