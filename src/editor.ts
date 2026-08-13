import { renderPreview } from "./preview";

export interface EditorOptions {
  editorEl: HTMLTextAreaElement;
  previewEl: HTMLElement;
  debounceMs?: number;
  /**
   * F-25: 프리뷰 innerHTML 교체 직후 호출된다. 렌더 파이프라인 자체는
   * 건드리지 않는다 — preview.ts/parser.ts 는 이 옵션과 무관하게 0줄 변경이다.
   */
  onAfterRender?: () => void;
}

/**
 * 에디터를 초기화하고 입력 이벤트를 프리뷰에 연결한다.
 */
export function createEditor(options: EditorOptions): void {
  const { editorEl, previewEl, debounceMs = 150, onAfterRender } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function update() {
    renderPreview(previewEl, editorEl.value);
    onAfterRender?.();
  }

  editorEl.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, debounceMs);
  });

  // 초기 렌더링
  update();
}
