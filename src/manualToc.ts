/**
 * 사용 설명서 차례 (이슈 #151).
 *
 * ## 손으로 적지 않는다
 *
 * 차례 목록을 따로 적으면 `docs/manual.md` 에 절을 더할 때마다 두 곳을 고쳐야
 * 하고, 잊으면 **빌드도 테스트도 통과하면서 차례만 낡는다**(트랩 #22·#75 와 같은
 * 구조). 그래서 차례는 **그려진 본문의 `h2` 에서** 만든다 — 두 번째 파싱 경로를
 * 만들지 않는다는 뜻이기도 하다(F-18).
 *
 * 순수 모듈이다. DOM 을 만지지 않고 제목 글자와 좌표만 받는다.
 */

export interface TocEntry {
  /** 본문 제목에 붙일 id. 차례 링크가 이것으로 찾아간다. */
  id: string;
  title: string;
}

/**
 * 제목을 id 로 만든다.
 *
 * 한국어 제목이 대부분이라 **글자를 버리지 않는다** — 영문자만 남기면
 * `"5. 파일 다루기"` 가 통째로 빈 문자열이 되어 모든 절이 같은 id 를 갖는다.
 */
export function slugify(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "절";

  let id = `manual-${base}`;
  let n = 2;
  // 같은 제목이 두 번 나와도 **다른 곳으로 가야 한다.**
  while (taken.has(id)) {
    id = `manual-${base}-${n}`;
    n += 1;
  }
  return id;
}

/** 제목 목록을 차례로. id 는 서로 겹치지 않는다. */
export function buildToc(titles: readonly string[]): TocEntry[] {
  const taken = new Set<string>();
  return titles.map((title) => {
    const id = slugify(title, taken);
    taken.add(id);
    return { id, title: title.trim() };
  });
}

/**
 * 지금 보고 있는 절.
 *
 * `tops` 는 각 제목의 **스크롤 컨테이너 기준** y 좌표다. 스크롤 위치보다 위에
 * 있는 것 중 마지막을 고른다.
 *
 * `slack` 만큼 여유를 둔다 — 제목이 화면 맨 위에 딱 붙기 **직전**에 이미 그 절을
 * 읽고 있기 때문이다. 0 으로 두면 링크를 눌러 이동한 직후에도 이전 절이 강조된
 * 채로 남는다.
 */
export function activeIndex(
  tops: readonly number[],
  scrollTop: number,
  slack = 8,
): number {
  if (tops.length === 0) return -1;
  let index = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] <= scrollTop + slack) index = i;
    else break;
  }
  return index;
}

/**
 * 끝까지 내렸으면 **마지막 절**로 친다.
 *
 * 마지막 절이 짧으면 아무리 내려도 그 제목이 기준선을 넘지 못해, 차례의 강조가
 * 끝 절에 영영 닿지 않는다 — 사용자는 강조가 고장 났다고 읽는다.
 */
export function activeIndexAtScroll(
  tops: readonly number[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  slack = 8,
): number {
  if (tops.length === 0) return -1;
  if (scrollHeight - (scrollTop + clientHeight) <= 2) return tops.length - 1;
  return activeIndex(tops, scrollTop, slack);
}
