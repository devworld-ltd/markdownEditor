import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  findShortcut,
  groupShortcuts,
  type KeyEventLike,
  type ShortcutId,
} from "../src/shortcutDefs";

/**
 * F-58 단축키 정의 (이슈 #40).
 *
 * 이 모듈이 존재하는 이유는 **안내 목록과 실제 동작이 어긋나지 않게** 하기
 * 위해서다. 그래서 여기서 검증할 것은 "키가 눌리면 뭔가 일어난다" 가 아니라
 * **정의가 실제 키 이벤트와 정확히 대응하는가** 다.
 */

function key(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("shortcutDefs — 조합 판별", () => {
  const CASES: Array<{ id: ShortcutId; events: KeyEventLike[] }> = [
    {
      id: "open",
      events: [key({ key: "o", metaKey: true }), key({ key: "O", ctrlKey: true })],
    },
    {
      id: "save",
      events: [key({ key: "s", metaKey: true }), key({ key: "s", ctrlKey: true })],
    },
    {
      id: "saveAs",
      events: [
        key({ key: "s", metaKey: true, shiftKey: true }),
        key({ key: "S", ctrlKey: true, shiftKey: true }),
      ],
    },
    { id: "newTab", events: [key({ code: "KeyN", altKey: true })] },
    { id: "closeTab", events: [key({ code: "KeyW", altKey: true })] },
    { id: "help", events: [key({ code: "Slash", altKey: true })] },
  ];

  for (const { id, events } of CASES) {
    it(`${id} 를 올바른 조합에서 찾는다`, () => {
      for (const event of events) {
        expect(findShortcut(event)?.id).toBe(id);
      }
    });
  }

  it("Alt 조합은 e.key 가 아니라 e.code 로 판별한다", () => {
    // macOS 에서 ⌥N 은 e.key 가 "˜" 로, ⌥/ 는 "÷" 로 바뀐다. key 를 보면 빗나간다.
    expect(findShortcut(key({ key: "˜", code: "KeyN", altKey: true }))?.id).toBe("newTab");
    expect(findShortcut(key({ key: "÷", code: "Slash", altKey: true }))?.id).toBe("help");
    expect(findShortcut(key({ key: "∑", code: "KeyW", altKey: true }))?.id).toBe("closeTab");
  });

  it("Shift 유무가 save 와 saveAs 를 가른다", () => {
    expect(findShortcut(key({ key: "s", metaKey: true }))?.id).toBe("save");
    expect(findShortcut(key({ key: "s", metaKey: true, shiftKey: true }))?.id).toBe("saveAs");
  });

  it("Mod 와 Alt 를 함께 누르면 어느 쪽도 잡지 않는다", () => {
    // ⌘⌥N 같은 조합이 새 문서를 열면 사용자가 의도하지 않은 동작이 된다.
    expect(findShortcut(key({ code: "KeyN", altKey: true, metaKey: true }))).toBeNull();
    expect(findShortcut(key({ key: "s", metaKey: true, altKey: true }))).toBeNull();
  });

  it("수식 키 없는 평범한 타이핑은 아무것도 잡지 않는다", () => {
    // 본문에 글자를 치는 동안 단축키가 발화하면 편집이 불가능해진다.
    for (const code of ["KeyN", "KeyW", "KeyS", "KeyO", "Slash"]) {
      expect(findShortcut(key({ key: code.slice(-1).toLowerCase(), code }))).toBeNull();
    }
    expect(findShortcut(key({ key: "?", code: "Slash", shiftKey: true }))).toBeNull();
  });
});

describe("shortcutDefs — 안내 목록의 정합성", () => {
  it("모든 정의가 두 플랫폼의 키 캡을 갖는다", () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.apple.length, shortcut.id).toBeGreaterThan(0);
      expect(shortcut.keys.other.length, shortcut.id).toBeGreaterThan(0);
      expect(shortcut.keys.apple.length, shortcut.id).toBe(shortcut.keys.other.length);
    }
  });

  it("id 가 중복되지 않는다", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("표시용 키 캡이 실제 판별 조합과 일치한다", () => {
    // 캡에 ⌘/Ctrl 이 있으면 mod 조합이어야 하고, ⌥/Alt 가 있으면 alt 조합이어야
    // 한다. 여기가 어긋나면 안내가 거짓말을 시작한다 — 이 기능의 존재 이유다.
    for (const shortcut of SHORTCUTS) {
      const caps = shortcut.keys.other;
      const usesMod = caps.includes("Ctrl");
      const usesAlt = caps.includes("Alt");
      const usesShift = caps.includes("Shift");
      expect(usesMod || usesAlt, `${shortcut.id} 는 수식 키 캡이 없다`).toBe(true);

      const last = caps[caps.length - 1];
      const probe = key({
        key: last.toLowerCase(),
        code: last === "/" ? "Slash" : `Key${last.toUpperCase()}`,
        ctrlKey: usesMod,
        altKey: usesAlt,
        shiftKey: usesShift,
      });
      expect(findShortcut(probe)?.id, `${shortcut.id} 의 캡 표기와 판별이 어긋난다`).toBe(
        shortcut.id,
      );
    }
  });

  it("비표준 조합(Alt)에는 왜 그런지 설명이 붙어 있다", () => {
    // ⌥N/⌥W 는 브라우저가 ⌘N/⌘W 를 선점해서 어쩔 수 없이 고른 조합이다.
    // 이유 없이 특이한 조합을 보여주면 사용자는 앱이 이상하다고 판단한다.
    for (const shortcut of SHORTCUTS) {
      if (shortcut.keys.other.includes("Alt")) {
        expect(shortcut.note, `${shortcut.id} 에 설명이 없다`).toBeTruthy();
      }
    }
  });

  it("groupShortcuts() 가 모든 정의를 빠짐없이 담는다", () => {
    const grouped = groupShortcuts().flatMap((g) => g.items);
    expect(grouped.map((s) => s.id)).toEqual(SHORTCUTS.map((s) => s.id));
  });

  it("groupShortcuts() 가 같은 그룹을 하나로 묶는다", () => {
    const groups = groupShortcuts().map((g) => g.group);
    expect(new Set(groups).size).toBe(groups.length);
  });
});
