import { computeBlockInsertion, computeLineStart, computeWrap } from "./textEdit";

interface ToolbarAction {
  label: string;
  icon: string;
  action: (textarea: HTMLTextAreaElement) => void;
  separator?: boolean;
  /**
   * 본문을 수정하는 액션인지. true 일 때만 클릭 후 input 이벤트를 재발행한다.
   * 파일 액션(New/Open/Save/Save As)까지 input 을 쏘면 방금 연 문서가 곧바로
   * 변경됨(dirty)으로 표시된다.
   */
  editsText?: boolean;
  /** 나중에 상태를 갱신해야 하는 버튼에 붙이는 DOM id (F-33 보기 모드). */
  id?: string;
}

// 계산(무엇을 삽입할지)은 순수 함수인 ./textEdit 에 있다. 아래 세 함수는 DOM 삽입
// (어떻게 삽입할지)만 담당하는 얇은 껍데기다 — execCommand("insertText") 를 유지해야
// Cmd+Z undo 스택이 보존된다 (docs/user-scenarios.md US-05).

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
) {
  const { selectionStart, selectionEnd, value } = textarea;
  const { replacement, placeholderSelection } = computeWrap(
    value,
    selectionStart,
    selectionEnd,
    before,
    after,
  );

  textarea.focus();
  textarea.setSelectionRange(selectionStart, selectionEnd);
  document.execCommand("insertText", false, replacement);

  // 선택 텍스트가 없었으면 placeholder를 선택 상태로
  if (placeholderSelection) {
    textarea.setSelectionRange(placeholderSelection.start, placeholderSelection.end);
  }
}

function insertAtLineStart(textarea: HTMLTextAreaElement, prefix: string) {
  const { selectionStart, value } = textarea;
  const lineStart = computeLineStart(value, selectionStart);

  textarea.focus();
  textarea.setSelectionRange(lineStart, lineStart);
  document.execCommand("insertText", false, prefix);
}

function insertBlock(textarea: HTMLTextAreaElement, text: string) {
  const { selectionStart, value } = textarea;
  const insertion = computeBlockInsertion(value, selectionStart, text);

  textarea.focus();
  textarea.setSelectionRange(selectionStart, selectionStart);
  document.execCommand("insertText", false, insertion);
}

const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export interface FileActions {
  newDoc: () => void;
  open: () => void;
  save: () => void;
  saveAs: () => void;
  /** F-58 단축키 안내 열기. 안내 UI 초기화 실패 시 넘어오지 않는다. */
  showShortcuts?: () => void;
  /** F-33 보기 모드 순환. */
  cycleView?: () => void;
  /** F-38 HTML 내보내기. */
  exportHtml?: () => void;
  /** F-39 인쇄 / PDF 저장. */
  print?: () => void;
  /** F-35 편집 설정 열기. */
  showSettings?: () => void;
  /** F-36 최근 파일 목록 열기. */
  showRecent?: () => void;
}

let fileActions: FileActions | null = null;

export function setFileActions(actions: FileActions): void {
  fileActions = actions;
}

const actions: ToolbarAction[] = [
  {
    label: "New",
    icon: `<svg ${SVG_ATTRS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
    action: () => fileActions?.newDoc(),
  },
  {
    label: "Open",
    icon: `<svg ${SVG_ATTRS}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    action: () => fileActions?.open(),
  },
  {
    // F-36: 최근 파일은 "여는" 동작이므로 Open 바로 옆에 둔다.
    label: "Recent",
    icon: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`,
    action: () => fileActions?.showRecent?.(),
  },
  {
    label: "Save",
    icon: `<svg ${SVG_ATTRS}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    action: () => fileActions?.save(),
  },
  {
    label: "Save As",
    icon: `<svg ${SVG_ATTRS}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v6"/><polyline points="7 3 7 8 14 8"/><line x1="18" y1="16" x2="18" y2="22"/><line x1="15" y1="19" x2="21" y2="19"/></svg>`,
    action: () => fileActions?.saveAs(),
    separator: true,
  },
  {
    label: "Bold",
    icon: `<svg ${SVG_ATTRS}><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>`,
    action: (ta) => wrapSelection(ta, "**", "**"),
    editsText: true,
  },
  {
    label: "Italic",
    icon: `<svg ${SVG_ATTRS}><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`,
    action: (ta) => wrapSelection(ta, "*", "*"),
    editsText: true,
  },
  {
    label: "Strikethrough",
    icon: `<svg ${SVG_ATTRS}><path d="M16 4H9a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3H8"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`,
    action: (ta) => wrapSelection(ta, "~~", "~~"),
    editsText: true,
  },
  {
    label: "Heading",
    icon: `<svg ${SVG_ATTRS}><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "## "),
    editsText: true,
  },
  {
    label: "Link",
    icon: `<svg ${SVG_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    action: (ta) => {
      const { selectionStart, selectionEnd, value } = ta;
      const selected = value.slice(selectionStart, selectionEnd);
      const text = selected || "링크 텍스트";
      const replacement = `[${text}](url)`;
      ta.focus();
      ta.setSelectionRange(selectionStart, selectionEnd);
      document.execCommand("insertText", false, replacement);
      // url 부분 선택
      const urlStart = selectionStart + text.length + 3;
      ta.setSelectionRange(urlStart, urlStart + 3);
    },
    editsText: true,
  },
  {
    label: "Image",
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    action: (ta) => {
      const { selectionStart, selectionEnd, value } = ta;
      const selected = value.slice(selectionStart, selectionEnd);
      const alt = selected || "이미지 설명";
      const replacement = `![${alt}](url)`;
      ta.focus();
      ta.setSelectionRange(selectionStart, selectionEnd);
      document.execCommand("insertText", false, replacement);
      const urlStart = selectionStart + alt.length + 4;
      ta.setSelectionRange(urlStart, urlStart + 3);
    },
    editsText: true,
  },
  {
    label: "Code",
    icon: `<svg ${SVG_ATTRS}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    action: (ta) => wrapSelection(ta, "`", "`"),
    editsText: true,
  },
  {
    label: "Code Block",
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/></svg>`,
    action: (ta) => {
      const { selectionStart, selectionEnd, value } = ta;
      const selected = value.slice(selectionStart, selectionEnd);
      const code = selected || "코드";
      const replacement = `\`\`\`\n${code}\n\`\`\``;
      ta.focus();
      ta.setSelectionRange(selectionStart, selectionEnd);
      document.execCommand("insertText", false, replacement);
      if (!selected) {
        ta.setSelectionRange(selectionStart + 4, selectionStart + 4 + "코드".length);
      }
    },
    editsText: true,
  },
  {
    label: "Unordered List",
    icon: `<svg ${SVG_ATTRS}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "- "),
    editsText: true,
  },
  {
    label: "Ordered List",
    icon: `<svg ${SVG_ATTRS}><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "1. "),
    editsText: true,
  },
  {
    label: "Blockquote",
    icon: `<svg ${SVG_ATTRS}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "> "),
    editsText: true,
  },
  {
    label: "Horizontal Rule",
    icon: `<svg ${SVG_ATTRS}><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    action: (ta) => insertBlock(ta, "---"),
    editsText: true,
    separator: true,
  },
  {
    // F-38 HTML 내보내기. 파일 액션이지만 "저장" 과 성격이 달라(탭 상태를
    // 건드리지 않는다) 서식 뒤 도구 묶음에 둔다.
    label: "Export HTML",
    icon: `<svg ${SVG_ATTRS}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    action: () => fileActions?.exportHtml?.(),
  },
  {
    // F-39 인쇄/PDF. 브라우저 인쇄 대화상자를 그대로 연다 — "PDF 로 저장" 은
    // 그 대화상자 안에 이미 있다. 별도 PDF 라이브러리를 넣을 이유가 없다.
    label: "Print / PDF",
    icon: `<svg ${SVG_ATTRS}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
    action: () => fileActions?.print?.(),
    separator: true,
  },
  {
    // F-33 보기 모드 순환. 툴바 버튼이 있어야 단축키를 모르는 사용자도 쓴다.
    label: "View Mode",
    icon: `<svg ${SVG_ATTRS}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    action: () => fileActions?.cycleView?.(),
    id: "view-mode",
  },
  {
    // F-35 편집 설정.
    label: "Settings",
    icon: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    action: () => fileActions?.showSettings?.(),
  },
  {
    // F-58: 단축키를 알려주는 기능을 단축키로만 열 수 있으면 순환이다.
    // 웹에는 메뉴바가 없으므로 눈에 보이는 진입점이 반드시 하나 있어야 한다.
    label: "Shortcuts",
    icon: `<svg ${SVG_ATTRS}><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>`,
    action: () => fileActions?.showShortcuts?.(),
  },
];

export function initToolbar(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
): void {
  actions.forEach(({ label, icon, action, separator, editsText, id }) => {
    const btn = document.createElement("button");
    btn.className = "toolbar-btn";
    btn.title = label;
    if (id) btn.id = id;
    btn.innerHTML = icon;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      action(textarea);
      if (editsText) {
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    container.appendChild(btn);

    if (separator) {
      const sep = document.createElement("div");
      sep.className = "toolbar-separator";
      container.appendChild(sep);
    }
  });
}
