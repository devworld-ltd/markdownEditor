import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/editor";

function createDom(): { editorEl: HTMLTextAreaElement; previewEl: HTMLElement } {
  document.body.innerHTML = `<textarea id="editor"></textarea><div id="preview"></div>`;
  return {
    editorEl: document.querySelector<HTMLTextAreaElement>("#editor")!,
    previewEl: document.querySelector<HTMLElement>("#preview")!,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createEditor", () => {
  it("초기화 시 현재 textarea 값을 즉시 프리뷰에 렌더링한다", () => {
    const { editorEl, previewEl } = createDom();
    editorEl.value = "# 초기 제목";

    createEditor({ editorEl, previewEl });

    expect(previewEl.innerHTML).toContain("<h1");
  });

  it("input 이벤트는 디바운스 후에만 프리뷰를 갱신한다", () => {
    const { editorEl, previewEl } = createDom();
    createEditor({ editorEl, previewEl, debounceMs: 150 });

    editorEl.value = "본문 입력";
    editorEl.dispatchEvent(new Event("input"));

    // 디바운스 시간이 지나기 전에는 아직 갱신되지 않는다.
    expect(previewEl.innerHTML).not.toContain("본문 입력");

    vi.advanceTimersByTime(150);
    expect(previewEl.innerHTML).toContain("본문 입력");
  });

  it("디바운스 시간 내 연속 입력은 마지막 값 한 번만 렌더링한다", () => {
    const { editorEl, previewEl } = createDom();
    createEditor({ editorEl, previewEl, debounceMs: 150 });

    editorEl.value = "첫";
    editorEl.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(100);

    editorEl.value = "두번째";
    editorEl.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(100);
    // 첫 타이머(150ms) 시점이 지났어도 재설정됐으므로 아직 갱신되지 않는다.
    expect(previewEl.innerHTML).not.toContain("두번째");

    vi.advanceTimersByTime(50);
    expect(previewEl.innerHTML).toContain("두번째");
    expect(previewEl.innerHTML).not.toContain("첫");
  });

  it("debounceMs 기본값은 150ms 다", () => {
    const { editorEl, previewEl } = createDom();
    createEditor({ editorEl, previewEl });

    editorEl.value = "기본 디바운스";
    editorEl.dispatchEvent(new Event("input"));

    vi.advanceTimersByTime(149);
    expect(previewEl.innerHTML).not.toContain("기본 디바운스");

    vi.advanceTimersByTime(1);
    expect(previewEl.innerHTML).toContain("기본 디바운스");
  });
});
