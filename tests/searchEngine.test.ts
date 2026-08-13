import { describe, expect, it } from "vitest";
import {
  findMatches,
  formatCount,
  indexAtOrAfter,
  indexBefore,
  remapIndex,
  stepIndex,
} from "../src/searchEngine";

/**
 * F-22 검색 계산부 (이슈 #41).
 *
 * 검색의 어려운 부분은 전부 문자열 계산이다 — 경계·겹침·순환·문서 변경 후 위치
 * 유지. DOM 과 섞지 않았으므로 브라우저 없이 전부 검증된다.
 */

describe("findMatches", () => {
  it("모든 일치 위치를 앞에서부터 찾는다", () => {
    expect(findMatches("abc abc abc", "abc")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("대소문자를 구분하지 않는다", () => {
    expect(findMatches("Hello HELLO hello", "hello")).toHaveLength(3);
    expect(findMatches("Hello", "HELLO")).toEqual([{ start: 0, end: 5 }]);
  });

  it("빈 질의는 '전부 일치' 가 아니라 '검색 안 함' 이다", () => {
    // 빈 문자열을 indexOf 하면 모든 위치에서 0 길이 일치가 나와 무한 루프가 된다.
    expect(findMatches("아무 텍스트", "")).toEqual([]);
  });

  it("겹치는 일치는 세지 않는다", () => {
    // "aaaa" 에서 "aa" 는 2개(0-2, 2-4)다. 겹침을 세면 "다음" 을 눌렀을 때
    // 커서가 한 글자씩 기어가 사용자가 진행을 인지하지 못한다.
    expect(findMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("정규식 메타문자를 리터럴로 찾는다", () => {
    // 마크다운 문서에서 특히 잦은 문자들이다. 정규식으로 다루면 아무것도 안
    // 찾아지거나 예외가 난다.
    expect(findMatches("**굵게** [링크](url) a.b (괄호)", "**")).toHaveLength(2);
    expect(findMatches("a.b axb", ".")).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches("[링크](url)", "[")).toHaveLength(1);
    expect(findMatches("a(b)c", "(")).toHaveLength(1);
    expect(findMatches("a+b", "+")).toHaveLength(1);
    expect(findMatches("a|b", "|")).toHaveLength(1);
  });

  it("일치가 없으면 빈 배열", () => {
    expect(findMatches("abc", "xyz")).toEqual([]);
  });

  it("개행을 포함한 질의도 찾는다", () => {
    expect(findMatches("첫\n둘\n셋", "첫\n둘")).toEqual([{ start: 0, end: 3 }]);
  });
});

describe("indexAtOrAfter / indexBefore — 커서 기준 선택", () => {
  const matches = [
    { start: 10, end: 13 },
    { start: 20, end: 23 },
    { start: 30, end: 33 },
  ];

  it("커서 이후의 첫 일치를 고른다", () => {
    expect(indexAtOrAfter(matches, 0)).toBe(0);
    expect(indexAtOrAfter(matches, 15)).toBe(1);
    expect(indexAtOrAfter(matches, 20)).toBe(1); // 경계 포함
  });

  it("문서 끝을 넘으면 처음으로 순환한다", () => {
    // "없습니다" 로 멈추면 사용자는 위쪽에 있는 일치를 놓친다.
    expect(indexAtOrAfter(matches, 999)).toBe(0);
  });

  it("커서 이전의 마지막 일치를 고른다", () => {
    expect(indexBefore(matches, 999)).toBe(2);
    expect(indexBefore(matches, 25)).toBe(1);
    expect(indexBefore(matches, 23)).toBe(1); // 끝 경계 포함
  });

  it("문서 앞을 넘으면 끝으로 순환한다", () => {
    expect(indexBefore(matches, 0)).toBe(2);
  });

  it("일치가 없으면 -1", () => {
    expect(indexAtOrAfter([], 0)).toBe(-1);
    expect(indexBefore([], 0)).toBe(-1);
  });
});

describe("stepIndex — 순환 이동", () => {
  it("끝에서 다음은 처음으로 돌아온다", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
  });

  it("처음에서 이전은 끝으로 간다", () => {
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it("위치가 정해지지 않았으면 방향에 따라 양 끝에서 시작한다", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it("일치가 없으면 -1", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("remapIndex — 문서가 바뀌어도 보던 자리를 유지한다", () => {
  const three = [
    { start: 5, end: 8 },
    { start: 50, end: 53 },
    { start: 100, end: 103 },
  ];

  it("서수를 보존한다 — 좌표가 밀려도 같은 번째 일치를 가리킨다", () => {
    // 앞에 글자를 끼워 넣으면 모든 일치가 함께 밀린다. "가장 가까운 위치" 로
    // 고르면 세 번째보다 두 번째가 예전 좌표에 가까워져 하이라이트가 뒤로 튄다.
    const shifted = [
      { start: 9, end: 12 },
      { start: 54, end: 57 },
      { start: 104, end: 107 },
    ];
    expect(remapIndex(shifted, 2)).toBe(2);
    expect(remapIndex(shifted, 0)).toBe(0);
  });

  it("일치가 줄면 마지막으로 자른다", () => {
    expect(remapIndex(three.slice(0, 2), 2)).toBe(1);
  });

  it("이전 위치가 없으면 첫 일치", () => {
    expect(remapIndex(three, null)).toBe(0);
    expect(remapIndex(three, -1)).toBe(0);
  });

  it("일치가 없으면 -1", () => {
    expect(remapIndex([], 1)).toBe(-1);
  });
});

describe("formatCount", () => {
  it("질의가 없으면 아무것도 표시하지 않는다", () => {
    expect(formatCount(0, -1, false)).toBe("");
  });

  it("결과가 없으면 그렇게 알린다", () => {
    expect(formatCount(0, -1, true)).toBe("결과 없음");
  });

  it("1부터 세는 위치/총계를 보여준다", () => {
    // 0-기반 인덱스를 그대로 보여주면 "0/12" 가 되어 사람이 읽기 어렵다.
    expect(formatCount(12, 0, true)).toBe("1/12");
    expect(formatCount(12, 11, true)).toBe("12/12");
  });
});
