/**
 * F-29 문서 통계 (이슈 #81).
 *
 * ## 한국어에서 "단어 수" 는 무엇인가
 *
 * 공백으로 자르면 한국어에서는 **단어가 아니라 어절**이 세어진다. "먹었습니다"
 * 는 한 어절이지만 형태소로는 여럿이고, 영어 기준의 word count 와 직접 비교할
 * 수 없다. 형태소 분석기를 들이면 정확해지지만 **런타임 의존성이 늘고 번들이
 * 수 MB 커진다** — 이 저장소가 기능 20개를 더하는 동안 지켜 온 성질을 통계
 * 표시로 포기할 수는 없다.
 *
 * 그래서 **세는 방식을 정확히 이름 붙여서** 보여준다. "단어" 라고 쓰고 어절을
 * 세면 조용히 틀린 숫자가 되지만, "어절" 이라고 쓰면 그건 맞는 숫자다.
 *
 * ## 읽기 시간
 *
 * 한글은 영어보다 글자당 정보량이 많아 **분당 단어 수로 재면 크게 빗나간다.**
 * 한글이 섞인 문서는 글자 수 기준(분당 500자), 그렇지 않으면 어절 기준(분당
 * 200어절)으로 잡는다. 어느 쪽이든 어림이므로 **분 단위로만** 보여준다.
 *
 * DOM 을 만지지 않는 순수 모듈이다.
 */

export interface DocStats {
  /** 공백으로 나눈 조각 수 (한국어에서는 어절) */
  words: number;
  /** 공백 포함 글자 수 */
  characters: number;
  /** 공백 제외 글자 수 */
  charactersNoSpaces: number;
  /** 줄 수 */
  lines: number;
  /** 예상 읽기 시간(분). 1 미만은 1 로 올린다 */
  readingMinutes: number;
  /** 한글이 섞인 문서인가 (읽기 시간 기준을 가른다) */
  koreanHeavy: boolean;
}

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const HANGUL_GLOBAL = /[ㄱ-ㆎ가-힣]/g;

/** 분당 읽는 양. 어림값이며 분 단위 표시에만 쓴다. */
const CHARS_PER_MINUTE = 500;
const WORDS_PER_MINUTE = 200;

/** 한글 글자가 전체의 이 비율을 넘으면 글자 기준으로 읽기 시간을 잡는다. */
const KOREAN_THRESHOLD = 0.1;

export function computeStats(text: string): DocStats {
  const characters = [...text].length;
  const charactersNoSpaces = [...text.replace(/\s/g, "")].length;
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  const lines = text === "" ? 0 : text.split("\n").length;

  const hangulCount = (text.match(HANGUL_GLOBAL) ?? []).length;
  const koreanHeavy =
    HANGUL.test(text) && charactersNoSpaces > 0 && hangulCount / charactersNoSpaces >= KOREAN_THRESHOLD;

  const rawMinutes = koreanHeavy
    ? charactersNoSpaces / CHARS_PER_MINUTE
    : words / WORDS_PER_MINUTE;
  // 내용이 있으면 최소 1분 — "0분" 은 정보가 아니다.
  const readingMinutes = characters === 0 ? 0 : Math.max(1, Math.round(rawMinutes));

  return { words, characters, charactersNoSpaces, lines, readingMinutes, koreanHeavy };
}

/**
 * 표시 문자열.
 *
 * **"단어" 가 아니라 "어절" 이라고 쓴다** — 공백으로 자른 결과에 정확히 맞는
 * 이름이다. 한글이 없는 문서에서는 어절이 곧 단어이므로 "단어" 로 바꾼다.
 */
export function formatStats(stats: DocStats, selection = false): string {
  if (stats.characters === 0) return selection ? "" : "빈 문서";
  const unit = stats.koreanHeavy ? "어절" : "단어";
  const prefix = selection ? "선택 " : "";
  return `${prefix}${stats.words.toLocaleString()}${unit} · ${stats.characters.toLocaleString()}자 · 약 ${stats.readingMinutes}분`;
}
