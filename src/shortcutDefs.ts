/**
 * F-58 단축키 단일 출처 (이슈 #40).
 *
 * 안내 UI 를 만들 때 가장 흔한 실패는 **목록이 실제 동작과 어긋나는 것**이다.
 * 단축키를 추가하고 안내를 고치지 않으면 안내가 조용히 거짓말을 시작하고,
 * 그건 안내가 아예 없는 것보다 나쁘다. 테스트로 잡는 것보다 **구조적으로
 * 불가능하게** 만드는 편이 낫다.
 *
 * 그래서 이 모듈이 유일한 정의이고, `shortcuts.ts`(디스패치)와
 * `shortcutHelp.ts`(안내 표시)가 **둘 다 여기서 읽는다.** 어긋날 여지가 없다.
 *
 * DOM 을 import 하지 않는 순수 모듈이다 — `match()` 는 `KeyEventLike` 만 받는다.
 */

/** `KeyboardEvent` 중 판별에 필요한 부분만. 단위 테스트가 평범한 객체로 만든다. */
export interface KeyEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type ShortcutId =
  | "open"
  | "save"
  | "saveAs"
  | "newTab"
  | "closeTab"
  | "find"
  | "cycleView"
  | "help";

export interface ShortcutDef {
  id: ShortcutId;
  /** 안내 UI 의 묶음 제목 */
  group: "파일" | "편집" | "보기" | "탭" | "도움말";
  /** 무엇을 하는지 (안내 UI 에 그대로 노출된다) */
  label: string;
  /** 표시용 키 캡. Apple 은 ⌘/⌥, 그 외는 Ctrl/Alt 로 읽힌다. */
  keys: { apple: string[]; other: string[] };
  /** 이 조합이 왜 이런지 — 비표준 조합만 채운다. */
  note?: string;
  match(event: KeyEventLike): boolean;
}

/** Cmd(맥) 또는 Ctrl(그 외). Alt 가 함께 눌린 조합과 섞이지 않게 alt 를 배제한다. */
function isModOnly(e: KeyEventLike): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey;
}

/**
 * Alt 조합은 **반드시 `e.code` 로 판별한다.** macOS 에서 Alt 를 누르면 `e.key` 가
 * 특수문자로 바뀌어(예: Alt+N → "˜", Alt+/ → "÷") `e.key` 비교가 통째로 빗나간다.
 */
function isAltOnly(e: KeyEventLike): boolean {
  return e.altKey && !e.metaKey && !e.ctrlKey;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: "open",
    group: "파일",
    label: "파일 열기",
    keys: { apple: ["⌘", "O"], other: ["Ctrl", "O"] },
    match: (e) => isModOnly(e) && e.key.toLowerCase() === "o",
  },
  {
    id: "save",
    group: "파일",
    label: "저장",
    keys: { apple: ["⌘", "S"], other: ["Ctrl", "S"] },
    match: (e) => isModOnly(e) && !e.shiftKey && e.key.toLowerCase() === "s",
  },
  {
    id: "saveAs",
    group: "파일",
    label: "다른 이름으로 저장",
    keys: { apple: ["⌘", "⇧", "S"], other: ["Ctrl", "Shift", "S"] },
    match: (e) => isModOnly(e) && e.shiftKey && e.key.toLowerCase() === "s",
  },
  {
    id: "cycleView",
    group: "보기",
    label: "분할 / 편집 전용 / 미리보기 전용 전환",
    keys: { apple: ["⌥", "M"], other: ["Alt", "M"] },
    note: "브라우저가 ⌘/Ctrl 조합 대부분을 선점해 Alt 조합을 씁니다.",
    match: (e) => isAltOnly(e) && e.code === "KeyM",
  },
  {
    id: "newTab",
    group: "탭",
    label: "새 문서",
    keys: { apple: ["⌥", "N"], other: ["Alt", "N"] },
    note: "브라우저가 ⌘N/Ctrl+N 을 선점해 막을 수 없어 Alt 조합을 씁니다.",
    match: (e) => isAltOnly(e) && e.code === "KeyN",
  },
  {
    id: "closeTab",
    group: "탭",
    label: "탭 닫기",
    keys: { apple: ["⌥", "W"], other: ["Alt", "W"] },
    note: "브라우저가 ⌘W/Ctrl+W 를 선점해 막을 수 없어 Alt 조합을 씁니다.",
    match: (e) => isAltOnly(e) && e.code === "KeyW",
  },
  {
    id: "find",
    group: "편집",
    label: "문서 내 검색",
    keys: { apple: ["⌘", "F"], other: ["Ctrl", "F"] },
    note: "브라우저 찾기는 편집 영역 안을 찾지 못해 이 조합을 가져옵니다. 검색창을 닫고 다시 누르면 브라우저 찾기가 열립니다.",
    match: (e) => isModOnly(e) && e.key.toLowerCase() === "f",
  },
  {
    id: "help",
    group: "도움말",
    label: "단축키 목록 열기 / 닫기",
    keys: { apple: ["⌥", "/"], other: ["Alt", "/"] },
    note: "본문에 '?' 를 입력해야 하므로 물음표 단독은 쓸 수 없습니다.",
    match: (e) => isAltOnly(e) && e.code === "Slash",
  },
];

/** 이 이벤트에 해당하는 단축키. 없으면 null. */
export function findShortcut(event: KeyEventLike): ShortcutDef | null {
  return SHORTCUTS.find((shortcut) => shortcut.match(event)) ?? null;
}

/** 안내 UI 용 — 정의 순서를 유지한 채 그룹으로 묶는다. */
export function groupShortcuts(): Array<{ group: string; items: ShortcutDef[] }> {
  const groups: Array<{ group: string; items: ShortcutDef[] }> = [];
  for (const shortcut of SHORTCUTS) {
    const last = groups[groups.length - 1];
    if (last && last.group === shortcut.group) last.items.push(shortcut);
    else groups.push({ group: shortcut.group, items: [shortcut] });
  }
  return groups;
}
