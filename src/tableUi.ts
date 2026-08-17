/**
 * F-30 표 편집 보조 — UI (이슈 #82).
 *
 * 한 버튼에 두 가지 일이 걸린다. **커서가 표 안이면 그 표를 고치고, 밖이면 새
 * 표를 만든다.** 버튼을 둘로 나누면 "지금 어느 쪽이 되는가" 를 사용자가 매번
 * 판단해야 하는데, 그 답은 커서 위치로 이미 정해져 있다 — 앱이 알고 있는 것을
 * 사람에게 묻지 않는다.
 *
 * | 커서 위치 | 대화상자 | 할 수 있는 일 |
 * |-----------|----------|----------------|
 * | 표 안 | 편집 | 열별 정렬 지정 · 파이프 정렬 맞추기 |
 * | 그 밖 | 삽입 | 행·열 수와 정렬을 정해 새 표 삽입 |
 *
 * 삽입·치환은 모두 `execCommand("insertText")` 다. 이것 말고는 Cmd+Z 스택이
 * 끊긴다 — 표 하나를 자동 정렬했다고 그 앞의 편집 이력이 사라지면 안 된다.
 *
 * `editorSettings.ts`·`recentFilesUi.ts` 와 같은 `<dialog>` 주입형 리프다.
 * 계산은 전부 `tableFormat.ts`(순수)에 있다.
 */

import {
  findTableAt,
  formatTable,
  lineRangeToOffsets,
  makeTableBlock,
  withAlignment,
  type ColumnAlign,
  type TableBlock,
} from "./tableFormat";
import { renderTablePreview } from "./tablePreview";

export interface TableUiHost {
  dialogEl: HTMLDialogElement;
  /** 삽입 모드 영역 */
  insertEl: HTMLElement;
  rowsEl: HTMLInputElement;
  columnsEl: HTMLInputElement;
  /** 편집 모드 영역 */
  editEl: HTMLElement;
  /** 열별 정렬 버튼이 들어갈 곳 (편집 모드) */
  alignEl: HTMLElement;
  /** 새 표의 정렬 세그먼트가 들어갈 곳 (삽입 모드, #150) */
  insertAlignEl?: HTMLElement | null;
  /** 미리보기가 들어갈 곳 (#150) */
  previewEl?: HTMLElement | null;
  /** 확인 버튼 (모드에 따라 이름이 바뀐다) */
  submitEl: HTMLButtonElement;
  closeEl: HTMLElement;
  editorEl: HTMLTextAreaElement;
  notify?: (message: string) => void;
  returnFocusTo?: HTMLElement | null;
}

export interface TableUiController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** 지금 어떤 모드로 열리는지. 테스트와 단축키 안내가 쓴다. */
  mode(): "insert" | "edit";
}

const noopController: TableUiController = {
  open() {},
  close() {},
  isOpen: () => false,
  mode: () => "insert",
};

const ALIGN_LABELS: Array<{ value: ColumnAlign; label: string; symbol: string }> = [
  { value: "left", label: "왼쪽 정렬", symbol: "⇤" },
  { value: "center", label: "가운데 정렬", symbol: "↔" },
  { value: "right", label: "오른쪽 정렬", symbol: "⇥" },
];

let initialized = false;

export function initTableUi(host: TableUiHost): TableUiController {
  if (initialized) {
    console.warn("[tableUi] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { dialogEl, editorEl } = host;

    /** 편집 모드일 때 다루는 표. 열 때 한 번 정해진다. */
    let block: TableBlock | null = null;
    /** 삽입 모드의 정렬. 대화상자를 닫아도 남는다 — 같은 선택을 반복하지 않게. */
    let insertAlign: ColumnAlign = "left";

    /**
     * 텍스트를 바꾼다. `execCommand` 로만 — 되돌리기를 지키기 위해서다.
     * `value` 에 직접 대입하면 그 순간 이전 이력이 전부 날아간다.
     */
    function replaceRange(start: number, end: number, text: string): void {
      editorEl.focus();
      editorEl.setSelectionRange(start, end);
      document.execCommand("insertText", false, text);
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function renderAlignButtons(): void {
      host.alignEl.textContent = "";
      if (!block) return;

      block.header.forEach((title, column) => {
        const row = document.createElement("div");
        row.className = "setting-row table-align-row";

        const name = document.createElement("span");
        name.className = "table-align-name";
        // 제목이 비어 있으면 위치라도 알려 준다 — "" 만 셋 나열되면 어느 열인지 모른다.
        name.textContent = title.trim() || `${column + 1}번째 열`;
        row.appendChild(name);

        const group = document.createElement("div");
        group.className = "setting-stepper";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", `${name.textContent} 정렬`);

        for (const choice of ALIGN_LABELS) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "search-text-btn table-align-btn";
          btn.textContent = choice.symbol;
          btn.dataset.align = choice.value;
          btn.dataset.column = String(column);
          btn.setAttribute("aria-label", `${name.textContent} ${choice.label}`);
          // 색만으로 현재 값을 알리면 스크린리더에 전달되지 않는다.
          btn.setAttribute(
            "aria-pressed",
            String(block!.align[column] === choice.value),
          );
          btn.addEventListener("click", () => {
            block = withAlignment(block!, column, choice.value);
            renderAlignButtons();
            renderPreview();
          });
          group.appendChild(btn);
        }

        row.appendChild(group);
        host.alignEl.appendChild(row);
      });
    }

    /**
     * 지금 화면이 뜻하는 표.
     *
     * **삽입 결과와 미리보기가 같은 곳에서 나온다** — 편집 모드면 다루고 있는
     * 표 그대로, 삽입 모드면 `makeTableBlock()` 이 만든 것 그대로다. 미리보기가
     * 자기만의 계산을 하면 "보이는 것과 넣은 것이 같다" 가 우연이 된다.
     */
    function currentBlock(): TableBlock {
      if (block) return block;
      return makeTableBlock(
        Number(host.rowsEl.value),
        Number(host.columnsEl.value),
        insertAlign,
      );
    }

    function renderPreview(): void {
      if (!host.previewEl) return;
      renderTablePreview(host.previewEl, currentBlock());
    }

    function renderInsertAlign(): void {
      const container = host.insertAlignEl;
      if (!container) return;
      container.textContent = "";

      for (const choice of ALIGN_LABELS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "search-text-btn segmented-btn";
        btn.textContent = choice.symbol;
        btn.dataset.align = choice.value;
        btn.setAttribute("aria-label", choice.label);
        // 색만으로 알리면 스크린리더에는 아무 정보도 아니다.
        btn.setAttribute("aria-pressed", String(insertAlign === choice.value));
        btn.addEventListener("click", () => {
          insertAlign = choice.value;
          renderInsertAlign();
          renderPreview();
        });
        container.appendChild(btn);
      }
    }

    function currentMode(): "insert" | "edit" {
      return block ? "edit" : "insert";
    }

    function paint(): void {
      const edit = currentMode() === "edit";
      host.editEl.hidden = !edit;
      host.insertEl.hidden = edit;
      host.submitEl.textContent = edit ? "정렬 맞추기" : "표 삽입";
      if (edit) renderAlignButtons();
      else renderInsertAlign();
      renderPreview();
    }

    /**
     * 확인 버튼.
     *
     * **대화상자를 먼저 닫아야 한다.** `showModal()` 로 열린 동안 바깥 요소는
     * inert 라서 `editorEl.focus()` 가 먹지 않고, 포커스 없는 textarea 에
     * `execCommand` 를 쏘면 **조용히 아무 일도 일어나지 않는다** — 예외도 없다.
     * jsdom 은 inert 를 구현하지 않아 단위 테스트로는 잡히지 않는다(E2E TB2).
     */
    function submit(): void {
      controller.close();

      if (block) {
        // 편집: 표가 있던 자리만 정확히 갈아 끼운다.
        const { start, end } = lineRangeToOffsets(
          editorEl.value,
          block.startLine,
          block.endLine,
        );
        replaceRange(start, end, formatTable(block));
        host.notify?.("표 정렬을 맞췄습니다.");
      } else {
        // 미리보기가 보여 준 바로 그 표를 넣는다.
        const table = formatTable(currentBlock());
        const { selectionStart, selectionEnd, value } = editorEl;
        // 표는 블록 요소다 — 앞줄이 비어 있지 않으면 빈 줄을 넣어야 마크다운이
        // 표로 읽는다.
        const before = value.slice(0, selectionStart);
        const prefix = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
        replaceRange(selectionStart, selectionEnd, `${prefix}${table}\n`);
      }
    }

    const controller: TableUiController = {
      isOpen: () => dialogEl.open,
      mode: currentMode,

      open() {
        if (dialogEl.open) return;
        // 열 때마다 다시 판단한다 — 커서는 그새 움직였을 수 있다.
        block = findTableAt(editorEl.value, editorEl.selectionStart);
        paint();
        dialogEl.showModal();
      },

      close() {
        if (!dialogEl.open) return;
        dialogEl.close();
      },
    };

    // 행·열을 바꾸면 미리보기가 곧바로 따라온다. `input` 이라 숫자를 치는 중에도
    // 반영된다 — `change` 는 포커스를 잃어야 오므로 "즉시" 가 아니다.
    host.rowsEl.addEventListener("input", renderPreview);
    host.columnsEl.addEventListener("input", renderPreview);

    host.submitEl.addEventListener("click", submit);
    host.closeEl.addEventListener("click", () => controller.close());

    dialogEl.addEventListener("close", () => {
      host.returnFocusTo?.focus({ preventScroll: true });
    });

    dialogEl.ownerDocument.addEventListener("pointerdown", (event) => {
      if (!dialogEl.open) return;
      const rect = dialogEl.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) controller.close();
    });

    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[tableUi] 초기화 실패:", error);
    return noopController;
  }
}
