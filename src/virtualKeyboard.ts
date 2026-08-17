/**
 * 가상 키보드가 가린 높이 계산 (이슈 #155).
 *
 * ## 왜 `100vh` 로는 안 되나
 *
 * iOS Safari 의 `100vh` 는 **키보드를 고려하지 않는다** — 키보드가 올라와도 값이
 * 그대로라, 화면 아래에 붙인 바가 키보드 뒤로 숨는다. `VirtualKeyboard API` 는
 * Chromium 전용이다. 가장 넓게 통하는 것은 `visualViewport` 로 **실제로 보이는
 * 높이**를 재는 것이다.
 *
 * ## 자동 테스트로 끝까지 확인할 수 없다
 *
 * 헤드리스 브라우저에는 가상 키보드가 없다. 여기서 검증할 수 있는 것은 **계산
 * 규칙**까지이고, 실제로 키보드 위에 붙는지는 실기기에서 확인한다 (#135 의 Finder
 * 등록과 같은 성격). 그래서 계산을 이렇게 순수 함수로 떼어 둔다.
 *
 * 순수 모듈이다.
 */

export interface ViewportMetrics {
  /** `visualViewport.height` — 키보드를 뺀, 실제로 보이는 높이. */
  height: number;
  /** `visualViewport.offsetTop` — 확대·스크롤로 밀린 양. */
  offsetTop?: number;
}

/**
 * 화면 아래에서 **몇 px 띄워야** 가려지지 않는가.
 *
 * 키보드가 없으면 0 이다. 음수는 만들지 않는다 — 확대(pinch zoom)로 보이는 높이가
 * 창보다 커지는 순간이 있는데, 그때 음수를 그대로 쓰면 바가 화면 밖으로 나간다.
 */
export function keyboardInset(
  viewport: ViewportMetrics | null | undefined,
  windowHeight: number,
): number {
  if (!viewport || !Number.isFinite(viewport.height)) return 0;
  const covered = windowHeight - viewport.height - (viewport.offsetTop ?? 0);
  if (!Number.isFinite(covered)) return 0;
  // 1px 안팎의 차이는 반올림 오차다 — 그것 때문에 바가 떨리면 안 된다.
  return covered > 1 ? covered : 0;
}
