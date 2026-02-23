interface ToolbarAction {
  label: string;
  icon: string;
  action: (textarea: HTMLTextAreaElement) => void;
  separator?: boolean;
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const replacement = `${before}${selected || "텍스트"}${after}`;

  textarea.focus();
  textarea.setSelectionRange(selectionStart, selectionEnd);
  document.execCommand("insertText", false, replacement);

  // 선택 텍스트가 없었으면 placeholder를 선택 상태로
  if (!selected) {
    textarea.setSelectionRange(
      selectionStart + before.length,
      selectionStart + before.length + "텍스트".length,
    );
  }
}

function insertAtLineStart(textarea: HTMLTextAreaElement, prefix: string) {
  const { selectionStart, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;

  textarea.focus();
  textarea.setSelectionRange(lineStart, lineStart);
  document.execCommand("insertText", false, prefix);
}

function insertBlock(textarea: HTMLTextAreaElement, text: string) {
  const { selectionStart, value } = textarea;
  const needsNewline = selectionStart > 0 && value[selectionStart - 1] !== "\n";
  const insertion = needsNewline ? `\n${text}\n` : `${text}\n`;

  textarea.focus();
  textarea.setSelectionRange(selectionStart, selectionStart);
  document.execCommand("insertText", false, insertion);
}

const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

let fileOpenAction: (() => void) | null = null;
let fileSaveAction: (() => void) | null = null;

export function setFileActions(open: () => void, save: () => void): void {
  fileOpenAction = open;
  fileSaveAction = save;
}

const actions: ToolbarAction[] = [
  {
    label: "Open",
    icon: `<svg ${SVG_ATTRS}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    action: () => fileOpenAction?.(),
  },
  {
    label: "Save",
    icon: `<svg ${SVG_ATTRS}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    action: () => fileSaveAction?.(),
    separator: true,
  },
  {
    label: "Bold",
    icon: `<svg ${SVG_ATTRS}><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>`,
    action: (ta) => wrapSelection(ta, "**", "**"),
  },
  {
    label: "Italic",
    icon: `<svg ${SVG_ATTRS}><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`,
    action: (ta) => wrapSelection(ta, "*", "*"),
  },
  {
    label: "Strikethrough",
    icon: `<svg ${SVG_ATTRS}><path d="M16 4H9a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3H8"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`,
    action: (ta) => wrapSelection(ta, "~~", "~~"),
  },
  {
    label: "Heading",
    icon: `<svg ${SVG_ATTRS}><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "## "),
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
  },
  {
    label: "Code",
    icon: `<svg ${SVG_ATTRS}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    action: (ta) => wrapSelection(ta, "`", "`"),
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
  },
  {
    label: "Unordered List",
    icon: `<svg ${SVG_ATTRS}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "- "),
  },
  {
    label: "Ordered List",
    icon: `<svg ${SVG_ATTRS}><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "1. "),
  },
  {
    label: "Blockquote",
    icon: `<svg ${SVG_ATTRS}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>`,
    action: (ta) => insertAtLineStart(ta, "> "),
  },
  {
    label: "Horizontal Rule",
    icon: `<svg ${SVG_ATTRS}><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    action: (ta) => insertBlock(ta, "---"),
  },
];

export function initToolbar(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
): void {
  actions.forEach(({ label, icon, action, separator }) => {
    const btn = document.createElement("button");
    btn.className = "toolbar-btn";
    btn.title = label;
    btn.innerHTML = icon;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      action(textarea);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    container.appendChild(btn);

    if (separator) {
      const sep = document.createElement("div");
      sep.className = "toolbar-separator";
      container.appendChild(sep);
    }
  });
}
