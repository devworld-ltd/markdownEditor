import { renderPreview } from "./preview";

export interface EditorOptions {
  editorEl: HTMLTextAreaElement;
  previewEl: HTMLElement;
  debounceMs?: number;
}

/**
 * 에디터를 초기화하고 입력 이벤트를 프리뷰에 연결한다.
 */
export function createEditor(options: EditorOptions): void {
  const { editorEl, previewEl, debounceMs = 150 } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function update() {
    renderPreview(previewEl, editorEl.value);
  }

  editorEl.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, debounceMs);
  });

  // 초기 렌더링
  update();
}
