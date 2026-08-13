/**
 * F-22 문서 내 검색 — UI 배선 (이슈 #41).
 *
 * 브라우저 기본 `Cmd/Ctrl+F` 는 **textarea 안의 텍스트를 찾지 못한다.** 프리뷰만
 * 검색되므로 긴 문서를 편집하다 특정 대목을 찾을 방법이 사실상 없었다.
 *
 * 설계 판단:
 *
 * 1) **`Cmd/Ctrl+F` 를 그대로 뺏는다.** `⌘W`·`⌘N` 과 달리 이 조합은 페이지에
 *    도달하고 `preventDefault()` 가 먹는다(실측). 익숙한 키를 두고 새 조합을
 *    가르치는 건 발견성만 나빠진다. 대신 검색창이 닫혀 있을 때 다시 누르면
 *    열리므로, 브라우저 찾기가 필요하면 검색창을 닫고 한 번 더 누르면 된다.
 * 2) **모달이 아니라 상단 바다.** 찾은 위치를 **보면서** 이동해야 하므로
 *    `<dialog>`(F-58)와 달리 본문을 가리면 안 된다.
 * 3) **일치는 이동 직전에 항상 다시 계산한다.** 탭 전환은 `input` 이벤트 없이
 *    `editorEl.value` 를 바꾸므로(tabs.ts), 캐시해 두면 다른 문서의 좌표로
 *    이동하는 사고가 난다. 문서가 수백 줄 규모라 매번 계산해도 비용이 없다.
 * 4) **스크롤은 미러 요소로 측정한다.** `setSelectionRange()` 는 선택만 하고
 *    스크롤하지 않는다. 줄 높이 × 줄 번호로 어림하면 **줄바꿈(wrap)된 줄에서
 *    빗나간다.** 같은 폭·글꼴·`white-space` 를 가진 숨은 요소에 일치 지점까지의
 *    텍스트를 넣고 그 높이를 재면 wrap 을 포함해 정확하다.
 *
 * `offline.ts`·`fsLimitNotice.ts`·`shortcutHelp.ts` 와 같은 주입형 리프다 —
 * `searchEngine.ts`(순수 계산) 외에는 앱 모듈을 import 하지 않는다.
 */

import {
  caretAfterReplace,
  findMatches,
  formatCount,
  indexAtOrAfter,
  indexBefore,
  remapIndex,
  replaceAll,
  stepIndex,
  type MatchRange,
} from "./searchEngine";

export interface SearchHost {
  /** index.html 에 정적으로 존재하는 검색 바 */
  panelEl: HTMLElement;
  inputEl: HTMLInputElement;
  countEl: HTMLElement;
  prevEl: HTMLElement;
  nextEl: HTMLElement;
  closeEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
  /** 치환 UI (F-22 잔여). 없으면 찾기만 동작한다 — 기존 배선과의 역호환. */
  toggleReplaceEl?: HTMLElement;
  replaceRowEl?: HTMLElement;
  replaceInputEl?: HTMLInputElement;
  replaceOneEl?: HTMLElement;
  replaceAllEl?: HTMLElement;
  /**
   * 선택 영역을 치환한다. 기본 구현은 `execCommand("insertText")` — **이것을
   * `value` 대입으로 바꾸면 Cmd+Z 실행 취소 스택이 통째로 날아간다**
   * (`toolbar.ts` 와 같은 이유). jsdom 은 execCommand 를 구현하지 않으므로
   * 단위 테스트가 이 경계를 주입한다.
   */
  insertText?: (textarea: HTMLTextAreaElement, text: string) => void;
  /**
   * 일치 지점이 에디터 상단에서 몇 px 아래인지. 기본 구현은 미러 요소로 잰다.
   * 테스트는 레이아웃이 없는 jsdom 에서도 검증할 수 있도록 이걸 주입한다.
   */
  measureOffsetTop?: (textarea: HTMLTextAreaElement, index: number) => number;
}

export interface SearchController {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** 문서·질의 변화를 반영해 일치를 다시 계산한다(이동은 하지 않는다). */
  refresh(): void;
}

const noopController: SearchController = {
  open() {},
  close() {},
  toggle() {},
  isOpen: () => false,
  refresh() {},
};

let initialized = false;

/**
 * 미러 요소로 `index` 지점의 y 오프셋을 잰다.
 *
 * textarea 와 **같은 폭·글꼴·줄높이·패딩·`white-space`** 를 가진 숨은 요소에
 * 앞부분 텍스트만 넣고 높이를 재면, 줄바꿈까지 반영된 실제 y 를 얻는다.
 * 줄 번호 × 줄 높이로 어림하는 방식은 wrap 된 긴 줄에서 어긋난다.
 */
function measureWithMirror(textarea: HTMLTextAreaElement, index: number): number {
  const doc = textarea.ownerDocument;
  const style = doc.defaultView?.getComputedStyle(textarea);
  if (!style) return 0;

  const mirror = doc.createElement("div");
  const { position, left, top, visibility, whiteSpace, overflowWrap, wordBreak } = mirror.style;
  void position, left, top, visibility, whiteSpace, overflowWrap, wordBreak;

  mirror.style.position = "absolute";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = style.width;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.font = style.font;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.boxSizing = style.boxSizing;

  // 마지막 글자가 개행이면 브라우저가 마지막 빈 줄의 높이를 세지 않는다.
  // 폭 없는 문자를 덧붙여 그 줄이 실재하게 만든다.
  mirror.textContent = `${textarea.value.slice(0, index)}​`;
  doc.body.appendChild(mirror);
  const height = mirror.scrollHeight;
  mirror.remove();

  return height;
}

/**
 * 기본 치환 구현. **`execCommand("insertText")` 를 유지해야 한다** — 이것이
 * `textarea.value = …` 로 바뀌는 순간 Cmd+Z 실행 취소 스택이 통째로 날아간다.
 * 폐기 예정 API 이지만 undo 스택을 보존하는 유일한 표준 경로다(`toolbar.ts` 동일).
 */
function defaultInsertText(textarea: HTMLTextAreaElement, text: string): void {
  textarea.ownerDocument.execCommand("insertText", false, text);
}

export function initSearch(host: SearchHost): SearchController {
  if (initialized) {
    console.warn("[search] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { panelEl, inputEl, countEl, prevEl, nextEl, closeEl, editorEl } = host;
    const measureOffsetTop = host.measureOffsetTop ?? measureWithMirror;
    const insertText = host.insertText ?? defaultInsertText;

    let matches: MatchRange[] = [];
    let current = -1;

    function updateCount(): void {
      countEl.textContent = formatCount(matches.length, current, inputEl.value.length > 0);
      // 결과가 없을 때만 시각 신호를 준다 — 입력 중 매 글자마다 색이 바뀌면 소음이다.
      panelEl.dataset.state = inputEl.value && matches.length === 0 ? "empty" : "ok";
    }

    /** 항상 현재 editorEl.value 로 다시 계산한다 — 탭 전환은 input 을 쏘지 않는다(D-3). */
    function recompute(): void {
      const previousIndex = current >= 0 ? current : null;
      matches = findMatches(editorEl.value, inputEl.value);
      current = remapIndex(matches, previousIndex);
      updateCount();
    }

    /**
     * 선택 + 스크롤. 선택만 하면 화면 밖의 일치는 찾아도 보이지 않는다.
     *
     * **에디터로 포커스를 옮기지 않는다.** 사용자는 검색창에 타이핑 중이고,
     * 여기서 포커스를 뺏으면 Enter 가 본문에 개행을 넣어 방금 찾은 일치를
     * 지워 버린다(실제로 그렇게 동작했다). 브라우저 찾기 막대와 같은 방식으로,
     * 선택만 걸어 두고 포커스는 검색창에 남긴다 — Esc 로 닫으면 그 선택이 곧바로
     * 활성 선택이 되어 찾은 자리에서 편집을 이어갈 수 있다.
     */
    function reveal(): void {
      const match = matches[current];
      if (!match) return;

      editorEl.setSelectionRange(match.start, match.end);

      const offset = measureOffsetTop(editorEl, match.start);
      const viewport = editorEl.clientHeight;
      // 일치를 화면 위쪽 1/3 지점에 둔다 — 정중앙에 두면 뒤따르는 문맥이 좁고,
      // 맨 위에 두면 앞 문맥이 사라진다.
      const target = Math.max(0, Math.round(offset - viewport / 3));
      editorEl.scrollTop = target;
    }

    function go(delta: number): void {
      recompute();
      if (matches.length === 0) return;

      // 사용자가 검색창 밖에서 커서를 옮겼을 수 있으므로, 첫 이동은 커서 기준으로
      // 고른다. 그러지 않으면 "다음" 이 문서 맨 앞으로 되돌아간다.
      if (current < 0) {
        const caret = editorEl.selectionStart;
        current = delta > 0 ? indexAtOrAfter(matches, caret) : indexBefore(matches, caret);
      } else {
        current = stepIndex(current, matches.length, delta);
      }

      updateCount();
      reveal();
    }

    const controller: SearchController = {
      isOpen: () => !panelEl.hidden,

      open() {
        const wasOpen = !panelEl.hidden;
        panelEl.hidden = false;

        // 이미 열려 있는데 다시 열면 질의를 지우지 않는다 — 방금 찾던 것을
        // 다시 치게 만들 이유가 없다. 대신 전체 선택해 바로 덮어쓸 수 있게 한다.
        if (!wasOpen) {
          const selected = editorEl.value.slice(
            editorEl.selectionStart,
            editorEl.selectionEnd,
          );
          // 선택 영역이 있으면 그것을 질의로 채운다(편집기 관례).
          // 여러 줄 선택은 검색어로 부적절하므로 한 줄일 때만.
          if (selected && !selected.includes("\n")) inputEl.value = selected;
        }

        inputEl.focus();
        inputEl.select();
        recompute();
      },

      close() {
        if (panelEl.hidden) return;
        panelEl.hidden = true;
        if (host.replaceRowEl) host.replaceRowEl.hidden = true;
        host.toggleReplaceEl?.setAttribute("aria-expanded", "false");
        host.toggleReplaceEl?.setAttribute("aria-label", "치환 열기");
        matches = [];
        current = -1;
        editorEl.focus({ preventScroll: true });
      },

      toggle() {
        if (panelEl.hidden) controller.open();
        else controller.close();
      },

      refresh() {
        if (panelEl.hidden) return;
        recompute();
      },
    };

    /**
     * 선택 영역을 새 텍스트로 바꾼다.
     *
     * `execCommand("insertText")` 를 쓰려면 textarea 가 **포커스를 가져야 한다.**
     * 그래서 찾기와 달리 치환에서는 잠깐 포커스를 옮겼다가 되돌린다 — 되돌리지
     * 않으면 다음 Enter 가 본문에 개행을 넣는다(찾기에서 이미 겪은 함정).
     */
    function applyEdit(start: number, end: number, text: string, caret: number): void {
      const activeBefore = editorEl.ownerDocument.activeElement as HTMLElement | null;
      editorEl.focus({ preventScroll: true });
      editorEl.setSelectionRange(start, end);
      insertText(editorEl, text);
      editorEl.setSelectionRange(caret, caret);
      if (activeBefore && activeBefore !== editorEl) activeBefore.focus();
    }

    function replaceCurrent(): void {
      const replaceInputEl = host.replaceInputEl;
      if (!replaceInputEl) return;

      recompute();
      const match = matches[current];
      if (!match) return;

      const replacement = replaceInputEl.value;
      applyEdit(match.start, match.end, replacement, caretAfterReplace(match, replacement));

      // 치환 결과가 질의를 포함하면(예: "a" → "aa") 같은 자리에 새 일치가 생긴다.
      // 커서 이후로 넘겨 다음 일치를 가리켜야 같은 자리를 무한히 맴돌지 않는다.
      matches = findMatches(editorEl.value, inputEl.value);
      current = matches.length === 0 ? -1 : indexAtOrAfter(matches, editorEl.selectionStart);
      updateCount();
      if (current >= 0) reveal();
    }

    function replaceEvery(): void {
      const replaceInputEl = host.replaceInputEl;
      if (!replaceInputEl) return;

      recompute();
      if (matches.length === 0) return;

      // 문서 전체를 한 번에 넣는다 — Cmd+Z 한 번으로 되돌아가야 한다.
      const next = replaceAll(editorEl.value, inputEl.value, replaceInputEl.value);
      applyEdit(0, editorEl.value.length, next, next.length);

      current = -1;
      recompute();
    }

    if (host.toggleReplaceEl && host.replaceRowEl) {
      const toggleReplaceEl = host.toggleReplaceEl;
      const replaceRowEl = host.replaceRowEl;
      toggleReplaceEl.addEventListener("click", () => {
        const opening = replaceRowEl.hidden;
        replaceRowEl.hidden = !opening;
        toggleReplaceEl.setAttribute("aria-expanded", String(opening));
        toggleReplaceEl.setAttribute("aria-label", opening ? "치환 닫기" : "치환 열기");
        if (opening) host.replaceInputEl?.focus();
      });
    }

    host.replaceOneEl?.addEventListener("click", () => replaceCurrent());
    host.replaceAllEl?.addEventListener("click", () => replaceEvery());
    host.replaceInputEl?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        // Shift+Enter = 모두 바꾸기. 되돌리기 쉬운 쪽(1건)을 기본으로 둔다.
        if (event.shiftKey) replaceEvery();
        else replaceCurrent();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        controller.close();
      }
    });

    inputEl.addEventListener("input", () => {
      current = -1; // 질의가 바뀌면 위치를 처음부터 다시 고른다
      recompute();
      if (matches.length > 0) {
        current = indexAtOrAfter(matches, editorEl.selectionStart);
        updateCount();
        reveal();
      }
    });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        go(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        controller.close();
      }
    });

    // 버튼 클릭 뒤에도 포커스는 검색창에 남는다. (트랩 #2 의 "클릭이 끝나며
    // 선택이 0,0 으로 되돌아간다" 는 탭바 클릭 경로의 이야기이고, 여기서는
    // 일어나지 않는다 — rAF 재적용 코드를 넣어 봤지만 그것을 제거해도 F5b 가
    // 통과해, 방어할 대상이 없음을 확인하고 지웠다.)
    prevEl.addEventListener("click", () => {
      go(-1);
      inputEl.focus();
    });
    nextEl.addEventListener("click", () => {
      go(1);
      inputEl.focus();
    });
    closeEl.addEventListener("click", () => controller.close());

    initialized = true; // 성공 경로에서만 잠근다
    return controller;
  } catch (error) {
    console.warn("[search] 초기화 실패:", error);
    return noopController;
  }
}
