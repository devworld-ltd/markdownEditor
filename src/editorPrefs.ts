/**
 * F-35 편집 글꼴·글자 크기 (이슈 #63).
 *
 * DOM 을 만지지 않는 순수 모듈이다. 자르기·검증·저장값 해석이 전부 계산이고,
 * 그걸 DOM 과 섞으면 브라우저 없이는 확인할 수 없다.
 *
 * **웹폰트를 쓰지 않는다.** 이 앱은 네트워크 요청이 없고 CSP 도
 * `font-src 'self' data:` 다. 그래서 선택지는 **시스템에 이미 있는 글꼴 묶음**뿐이고,
 * 각 항목은 여러 OS 를 커버하는 폴백 사슬이다.
 */

export const MIN_FONT_SIZE = 11;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_FONT_SIZE = 14;
/** 한 번에 움직이는 폭. 1px 이면 체감 변화가 없고 2px 이면 건너뛴다. */
export const FONT_SIZE_STEP = 1;

export interface FontChoice {
  id: string;
  label: string;
  /** CSS `font-family` 값. 시스템 글꼴 폴백 사슬이다. */
  stack: string;
}

export const FONT_CHOICES: readonly FontChoice[] = [
  {
    id: "mono",
    label: "고정폭",
    stack: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  },
  {
    id: "sans",
    label: "산세리프",
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: "serif",
    label: "세리프",
    stack: '"Apple SD Gothic Neo", "Noto Serif KR", Georgia, "Times New Roman", serif',
  },
];

export const DEFAULT_FONT_ID = "mono";

export function clampFontSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

/** 한 단계 조절. 끝에서는 더 가지 않는다 — 순환하면 갑자기 반대 끝으로 튄다. */
export function stepFontSize(size: number, direction: number): number {
  return clampFontSize(clampFontSize(size) + direction * FONT_SIZE_STEP);
}

/** 모르는 id 는 기본값 — 설정 하나 때문에 편집기가 안 뜨면 안 된다. */
export function parseFontId(id: unknown): string {
  return FONT_CHOICES.some((f) => f.id === id) ? (id as string) : DEFAULT_FONT_ID;
}

export function fontStackOf(id: string): string {
  return (FONT_CHOICES.find((f) => f.id === parseFontId(id)) ?? FONT_CHOICES[0]).stack;
}

export function fontLabelOf(id: string): string {
  return (FONT_CHOICES.find((f) => f.id === parseFontId(id)) ?? FONT_CHOICES[0]).label;
}
