export type NoticeKind = "info" | "error";

let containerEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function initNotice(container: HTMLElement): void {
  containerEl = container;
}

/**
 * 사용자에게 보이는 알림을 띄운다.
 *
 * 이전 네이티브 버전은 파일 오류를 console.error 로만 남겨 사용자가 저장 실패를
 * 인지할 수 없었다. 웹에서는 저장 실패가 곧 데이터 유실이므로 반드시 화면에 알린다.
 */
export function showNotice(
  message: string,
  kind: NoticeKind = "info",
  durationMs = 4000,
): void {
  if (!containerEl) return;

  if (hideTimer) clearTimeout(hideTimer);

  containerEl.textContent = message;
  containerEl.dataset.kind = kind;
  containerEl.hidden = false;

  hideTimer = setTimeout(() => {
    if (containerEl) containerEl.hidden = true;
  }, durationMs);
}

export function hideNotice(): void {
  if (hideTimer) clearTimeout(hideTimer);
  if (containerEl) containerEl.hidden = true;
}
