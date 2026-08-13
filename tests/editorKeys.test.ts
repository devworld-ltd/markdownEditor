import { describe, expect, it } from "vitest";
import {
  INDENT,
  computeIndent,
  computeListContinuation,
  computeOutdent,
  parseListMarker,
} from "../src/editorKeys";

/** F-26 리스트 이어쓰기 · F-27 들여쓰기 계산 (이슈 #78·#79). */

describe("parseListMarker", () => {
  it("불릿·번호·체크박스를 알아본다", () => {
    expect(parseListMarker("- 항목")).toMatchObject({ bullet: "-", content: "항목" });
    expect(parseListMarker("* 항목")).toMatchObject({ bullet: "*" });
    expect(parseListMarker("+ 항목")).toMatchObject({ bullet: "+" });
    expect(parseListMarker("3. 항목")).toMatchObject({ bullet: "3.", content: "항목" });
    expect(parseListMarker("3) 항목")).toMatchObject({ bullet: "3)" });
    expect(parseListMarker("- [ ] 할 일")).toMatchObject({
      bullet: "-",
      checkbox: "[ ]",
      content: "할 일",
    });
    expect(parseListMarker("- [x] 완료")).toMatchObject({ checkbox: "[x]" });
  });

  it("들여쓰기를 보존한다", () => {
    expect(parseListMarker("    - 깊은 항목")).toMatchObject({ indent: "    " });
  });

  it("목록이 아니면 null", () => {
    for (const line of ["평범한 줄", "-없는공백", "", "   ", "#제목", "1.붙음"]) {
      expect(parseListMarker(line), line).toBeNull();
    }
  });
});

describe("computeListContinuation", () => {
  const at = (text: string) => text.indexOf("|");
  const strip = (text: string) => text.replace("|", "");

  function run(withCursor: string) {
    const value = strip(withCursor);
    const pos = at(withCursor);
    return computeListContinuation(value, pos, pos);
  }

  it("불릿을 이어 쓴다", () => {
    expect(run("- 항목|")).toMatchObject({ replacement: "\n- " });
  });

  it("번호를 올린다", () => {
    expect(run("3. 항목|")).toMatchObject({ replacement: "\n4. " });
    expect(run("9) 항목|")).toMatchObject({ replacement: "\n10) " });
  });

  it("들여쓰기를 유지한다", () => {
    expect(run("    - 항목|")).toMatchObject({ replacement: "\n    - " });
  });

  it("체크박스는 빈 상태로 이어 쓴다", () => {
    // 완료 표시까지 물려받으면 새 항목이 이미 완료된 것으로 보인다.
    expect(run("- [x] 완료|")).toMatchObject({ replacement: "\n- [ ] " });
  });

  it("빈 항목에서는 표식을 지운다 — 목록을 끝낼 수 있어야 한다", () => {
    // 이어쓰기만 하면 사용자가 목록을 빠져나갈 방법이 없다.
    const value = "- 첫째\n- ";
    const result = computeListContinuation(value, value.length, value.length);
    // 표식("- ")이 시작되는 자리부터 지운다.
    expect(result).toEqual({ replacement: "\n", start: 5, end: value.length });
  });

  it("빈 체크박스 항목에서도 종료된다", () => {
    const value = "- [ ] ";
    const result = computeListContinuation(value, value.length, value.length);
    expect(result?.replacement).toBe("\n");
  });

  it("목록이 아니면 null — 기본 동작에 맡긴다", () => {
    expect(run("그냥 글|")).toBeNull();
  });

  it("선택 영역이 있으면 관여하지 않는다", () => {
    // 지우고 줄바꿈하는 기본 동작이 옳다.
    expect(computeListContinuation("- 항목", 2, 4)).toBeNull();
  });

  it("줄 중간에서 Enter 를 쳐도 앞부분만 본다", () => {
    const value = "- 항목입니다";
    expect(computeListContinuation(value, 4, 4)?.replacement).toBe("\n- ");
  });
});

describe("computeIndent", () => {
  it("커서 자리에 한 단계 넣는다", () => {
    expect(computeIndent("abc", 1, 1)).toMatchObject({
      replacement: INDENT,
      start: 1,
      end: 1,
      selectionStart: 1 + INDENT.length,
    });
  });

  it("한 줄 안의 선택은 그대로 대체한다", () => {
    expect(computeIndent("abcdef", 1, 3)).toMatchObject({ replacement: INDENT, start: 1, end: 3 });
  });

  it("여러 줄이 걸치면 줄 전체를 들여쓴다", () => {
    // 선택을 통째로 공백으로 바꾸면 내용이 사라진다.
    const value = "첫째\n둘째\n셋째";
    const result = computeIndent(value, 1, 4);
    expect(result.replacement).toBe("  첫째\n  둘째");
    expect(result.start).toBe(0);
  });

  it("선택이 줄 맨 앞에서 끝나면 그 줄은 들여쓰지 않는다", () => {
    // 위 줄 끝까지 드래그하면 커서가 다음 줄 0열에 놓인다. 그때 다음 줄까지
    // 움직이면 사용자가 고르지 않은 줄이 바뀐다.
    const value = "첫째\n둘째\n셋째";
    const result = computeIndent(value, 0, 6); // "첫째\n둘째\n" 까지
    expect(result.replacement).toBe("  첫째\n  둘째");
  });

  it("들여쓴 뒤 선택이 그 범위를 덮는다", () => {
    const value = "a\nb";
    const result = computeIndent(value, 0, 3);
    expect(value.slice(0, result.start) + result.replacement).toBe("  a\n  b");
    expect(result.selectionEnd - result.selectionStart).toBe(result.replacement.length);
  });
});

describe("computeOutdent", () => {
  it("한 단계 뺀다", () => {
    const value = "  abc";
    const result = computeOutdent(value, 5, 5);
    expect(result.replacement).toBe("abc");
  });

  it("들여쓰기가 없으면 그대로 둔다", () => {
    const value = "abc";
    expect(computeOutdent(value, 3, 3).replacement).toBe("abc");
  });

  it("탭 문자도 뺀다", () => {
    expect(computeOutdent("\tabc", 4, 4).replacement).toBe("abc");
  });

  it("여러 줄에서 각 줄을 뺀다", () => {
    const value = "  a\n  b\n  c";
    expect(computeOutdent(value, 0, value.length).replacement).toBe("a\nb\nc");
  });

  it("일부 줄만 들여쓰여 있어도 안전하다", () => {
    const value = "  a\nb\n    c";
    expect(computeOutdent(value, 0, value.length).replacement).toBe("a\nb\n  c");
  });

  it("커서가 줄 시작보다 앞으로 가지 않는다", () => {
    const value = "  abc";
    const result = computeOutdent(value, 1, 1);
    expect(result.selectionStart).toBeGreaterThanOrEqual(0);
  });
});
