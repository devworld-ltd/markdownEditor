/**
 * F-32 분할 비율 계산 (이슈 #49).
 *
 * DOM 을 만지지 않는 순수 모듈이다. 드래그·키보드·복원의 어려운 부분은 전부
 * "비율을 어떻게 자를 것인가" 이고, 그건 계산이다.
 */

/**
 * 한쪽이 사라지지 않게 하는 하한/상한.
 *
 * 0 을 허용하면 사용자가 실수로 한쪽을 완전히 접은 뒤 **되돌릴 손잡이도 함께
 * 사라진다.** 15% 는 좁은 화면(720px)에서도 100px 남짓을 남겨 리사이저를 다시
 * 잡을 수 있는 값이다. 한쪽만 보고 싶은 요구는 F-33 모드 토글이 담당한다.
 */
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

/** 기본값 — 반반. 더블클릭으로 여기로 되돌아온다. */
export const DEFAULT_RATIO = 0.5;

/** 키보드 한 번에 움직이는 폭. 화살표로 끝에서 끝까지 35번이면 충분히 빠르다. */
export const KEYBOARD_STEP = 0.02;

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * 포인터 좌표를 비율로 바꾼다.
 *
 * `size` 가 0 이하면 계산이 정의되지 않는다(레이아웃 전이 중). `0/0 = NaN` 을
 * 그대로 흘려보내면 `clampRatio` 가 기본값으로 돌려놓지만, 여기서 명시적으로
 * 막는 편이 의도가 드러난다 — F-25 에서 같은 함정을 밟은 적이 있다(트랩 #18).
 */
export function ratioFromPointer(pointer: number, start: number, size: number): number {
  if (!(size > 0)) return DEFAULT_RATIO;
  return clampRatio((pointer - start) / size);
}

/** 화살표 키 이동. 끝에 닿으면 더 가지 않는다(순환하지 않는다). */
export function stepRatio(ratio: number, direction: number): number {
  return clampRatio(ratio + direction * KEYBOARD_STEP);
}

/** CSS `flex-basis` 에 넣을 문자열. 소수점은 서브픽셀 흔들림만 만든다. */
export function toPercent(ratio: number): string {
  return `${(clampRatio(ratio) * 100).toFixed(2)}%`;
}

/** 스크린리더가 읽을 정수 퍼센트. */
export function toAriaValue(ratio: number): number {
  return Math.round(clampRatio(ratio) * 100);
}

/**
 * 저장된 값을 읽는다. 손상·범위 밖 값은 **조용히 기본값으로** 되돌린다 —
 * 레이아웃 설정 때문에 앱이 뜨지 않는 것이 훨씬 나쁘다(`storage.ts` 와 같은 태도).
 */
export function parseStoredRatio(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_RATIO;
  return clampRatio(raw);
}
