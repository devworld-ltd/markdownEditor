/**
 * F-22 문서 내 검색 — 계산부 (이슈 #41).
 *
 * DOM 을 하나도 만지지 않는 순수 모듈이다. `parser.ts`·`textEdit.ts`·
 * `shortcutDefs.ts` 와 같은 자리에 있다 — 검색의 어려운 부분(경계·겹침·순환)은
 * 전부 문자열 계산이고, 그걸 DOM 과 섞으면 브라우저 없이는 검증할 수 없게 된다.
 */

export interface MatchRange {
  start: number;
  end: number;
}

/**
 * `text` 안의 `query` 위치를 앞에서부터 찾는다. 대소문자를 구분하지 않는다.
 *
 * **정규식이 아니라 리터럴로 찾는다.** 사용자가 마크다운 문서에서 `*`·`[`·`(`
 * 같은 문자를 찾는 일이 잦은데, 정규식으로 다루면 그것들이 메타문자가 되어
 * "아무것도 안 찾아지거나" 예외가 난다.
 *
 * **겹치는 일치는 세지 않는다.** "aaaa" 에서 "aa" 는 2개다(0-2, 2-4). 편집기의
 * 찾기는 다음 탐색을 일치 **끝**에서 이어가는 것이 관례이고, 겹침을 세면
 * "다음" 을 눌렀을 때 커서가 한 글자씩 기어가 사용자가 진행을 인지하지 못한다.
 */
export function findMatches(text: string, query: string): MatchRange[] {
  if (!query) return []; // 빈 질의는 "전부 일치" 가 아니라 "검색 안 함" 이다.

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: MatchRange[] = [];

  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    matches.push({ start: index, end: index + query.length });
    from = index + query.length; // 끝에서 이어간다 — 겹침 배제
  }

  return matches;
}

/**
 * 커서 위치 기준으로 "다음" 일치의 인덱스.
 *
 * 검색을 시작한 지점부터 **앞으로** 찾다가 끝에 닿으면 처음으로 순환한다.
 * 문서 끝에서 "없습니다" 로 멈추면 사용자는 위쪽에 있는 일치를 놓친다.
 */
export function indexAtOrAfter(matches: MatchRange[], caret: number): number {
  if (matches.length === 0) return -1;
  const found = matches.findIndex((match) => match.start >= caret);
  return found === -1 ? 0 : found;
}

/** 커서 위치 기준으로 "이전" 일치의 인덱스. 처음에서 뒤로 가면 끝으로 순환한다. */
export function indexBefore(matches: MatchRange[], caret: number): number {
  if (matches.length === 0) return -1;
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].end <= caret) return i;
  }
  return matches.length - 1;
}

/** 순환하는 다음 인덱스. 일치가 없으면 -1. */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : total - 1;
  return (current + delta + total) % total;
}

/**
 * 문서가 바뀐 뒤에도 **보고 있던 자리를 유지하도록** 인덱스를 옮긴다.
 *
 * **서수(몇 번째 일치인가)를 보존한다.** "위치가 가장 가까운 일치" 를 고르는
 * 방식도 시도했으나 흔한 경우에 어긋난다 — 문서 앞에 네 글자를 끼워 넣으면 모든
 * 일치가 4씩 밀리고, 그러면 세 번째 일치보다 두 번째 일치가 예전 좌표에 더
 * 가까워져 하이라이트가 뒤로 튄다.
 *
 * 타이핑은 대개 **일치 개수를 바꾸지 않고 좌표만 민다.** 그 지배적인 경우에
 * 서수 보존은 항상 옳다.
 *
 * 한계: 앞쪽 일치를 통째로 지우면 서수가 하나 밀린다(3번째를 보다가 1번째를
 * 지우면 예전 4번째로 간다). 이건 받아들인다 — 위치 기반이 흔한 경우를 틀리는
 * 것보다, 드문 경우에 한 칸 밀리는 편이 낫다.
 */
export function remapIndex(matches: MatchRange[], previousIndex: number | null): number {
  if (matches.length === 0) return -1;
  if (previousIndex === null || previousIndex < 0) return 0;
  return Math.min(previousIndex, matches.length - 1);
}

/** "3/12" 형태의 표시 문자열. 일치가 없으면 질의 유무에 따라 다르다. */
export function formatCount(matchCount: number, currentIndex: number, hasQuery: boolean): string {
  if (!hasQuery) return "";
  if (matchCount === 0) return "결과 없음";
  return `${currentIndex + 1}/${matchCount}`;
}
