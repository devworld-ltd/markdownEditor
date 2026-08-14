/**
 * 앵커 기반 스크롤 대응 (이슈 #114).
 *
 * 앵커 하나는 "이 블록이 편집기에서는 y=A, 프리뷰에서는 y=B 에 있다" 는 사실
 * 하나다. 앵커 사이는 **선형 보간**한다 — 블록 안에서는 두 패널의 높이가 비례해
 * 흐른다고 보는 것이고, 실제로 문단 하나 안에서는 그 가정이 잘 맞는다.
 *
 * ## 왜 비율이 아니라 앵커인가
 *
 * 비율 동기화는 문서 **전체**를 하나의 선형 대응으로 본다. 제목·코드블록처럼 두
 * 패널의 높이비가 국소적으로 다른 지점이 있으면 그 오차가 문서 중간에서 최대가
 * 된다. 앵커는 그 대응을 **블록마다 다시 맞추므로** 오차가 블록 안으로 갇힌다.
 *
 * ## 양 끝은 특별 취급한다
 *
 * 맨 위·맨 아래는 "정확히 같아야 한다" 는 기대가 특히 강하다(F-25 의 기존 계약).
 * 그래서 첫 앵커 위·마지막 앵커 아래 구간은 보간하지 않고 **끝점에 맞춘다.**
 *
 * DOM 을 만지지 않는 순수 모듈이다.
 */

/** 한 블록의 두 패널 y 좌표. `editor`·`preview` 는 각 패널의 스크롤 좌표계다. */
export interface ScrollAnchor {
  editor: number;
  preview: number;
}

export type AnchorSide = "editor" | "preview";

/**
 * 두 목록을 앵커로 짝짓는다.
 *
 * **개수가 다르면 포기한다.** 원문 블록과 프리뷰 요소가 1:1 이 아니면 대응표가
 * 통째로 틀어지고, 틀린 표로 맞추는 것은 안 맞추는 것보다 나쁘다 — 사용자는
 * 스크롤이 제멋대로 튄다고 느낀다.
 */
export function buildAnchors(
  editorTops: readonly number[],
  previewTops: readonly number[],
): ScrollAnchor[] {
  if (editorTops.length !== previewTops.length) return [];
  if (editorTops.length < 2) return [];

  const anchors: ScrollAnchor[] = [];
  for (let i = 0; i < editorTops.length; i += 1) {
    const editor = editorTops[i];
    const preview = previewTops[i];
    if (!Number.isFinite(editor) || !Number.isFinite(preview)) continue;
    // 두 좌표 모두 **단조 증가**여야 보간이 성립한다. 측정 잡음으로 뒤집힌
    // 앵커가 하나만 있어도 그 구간에서 스크롤이 역주행한다.
    const last = anchors[anchors.length - 1];
    if (last && (editor <= last.editor || preview <= last.preview)) continue;
    anchors.push({ editor, preview });
  }

  return anchors.length >= 2 ? anchors : [];
}

/**
 * `from` 패널의 위치 `top` 에 대응하는 반대편 위치.
 *
 * 앵커가 부족하면 `null` — 호출부는 기존 비율 동기화로 되돌아간다.
 */
export function mapWithAnchors(
  anchors: readonly ScrollAnchor[],
  from: AnchorSide,
  top: number,
  /** 반대편에서 갈 수 있는 최대 거리. 끝 구간을 맞추는 데 쓴다. */
  toDistance: number,
  fromDistance: number,
): number | null {
  if (anchors.length < 2) return null;
  if (!(toDistance > 0) || !(fromDistance > 0)) return null;

  const to: AnchorSide = from === "editor" ? "preview" : "editor";

  // 맨 위·맨 아래는 보간하지 않고 끝에 붙인다 (F-25 의 기존 계약).
  if (top <= 0) return 0;
  if (top >= fromDistance) return toDistance;

  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  // 첫 앵커 위: 0 ↔ 첫 앵커 사이를 잇는다.
  if (top <= first[from]) {
    return interpolate(top, 0, first[from], 0, first[to]);
  }

  // 마지막 앵커 아래: 마지막 앵커 ↔ 끝 사이를 잇는다.
  if (top >= last[from]) {
    return interpolate(top, last[from], fromDistance, last[to], toDistance);
  }

  // 사이: 이분 탐색으로 감싸는 두 앵커를 찾는다. 앵커가 수백 개여도 한 자릿수
  // 비교로 끝난다 — 스크롤은 프레임마다 도는 경로다.
  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][from] <= top) lo = mid;
    else hi = mid;
  }

  return interpolate(
    top,
    anchors[lo][from],
    anchors[hi][from],
    anchors[lo][to],
    anchors[hi][to],
  );
}

/** 구간 선형 보간. 구간 길이가 0 이면 시작점을 그대로 준다(0 나눗셈 방지). */
function interpolate(
  value: number,
  fromStart: number,
  fromEnd: number,
  toStart: number,
  toEnd: number,
): number {
  const span = fromEnd - fromStart;
  if (!(span > 0)) return toStart;
  const t = (value - fromStart) / span;
  return toStart + t * (toEnd - toStart);
}
