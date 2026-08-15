/**
 * 앵커 좌표 측정 (이슈 #114).
 *
 * `scrollAnchors.ts`(순수)가 쓰는 **두 목록의 y 좌표**를 실제 DOM 에서 잰다.
 * 계산은 전부 순수 모듈에 있고, 여기에는 "어떻게 재는가" 만 있다.
 *
 * ## 편집기 쪽 — 미러 한 장으로 한 번에
 *
 * textarea 안의 특정 줄이 화면에서 어디인지 물어볼 방법이 없어, 같은 폭·글꼴·
 * 줄높이를 가진 숨은 요소에 같은 글자를 넣고 잰다(`search.ts` 와 같은 기법).
 *
 * 다만 검색은 지점 하나만 재면 되지만 앵커는 수십~수백 개다. 그래서 **미러를
 * 하나만 만들고 표식 `<span>` 을 심어 한 번의 레이아웃으로 전부 읽는다.**
 * 지점마다 미러를 새로 만들면 문서가 길수록 O(n²) 이 되어 타이핑이 멈춘다.
 *
 * 표식은 **빈 인라인 요소**라 줄바꿈 위치를 바꾸지 않는다 — 바꾸면 잰 값이
 * 실제와 달라져 앵커가 통째로 어긋난다.
 *
 * ## 프리뷰 쪽 — 자식 요소의 위치
 *
 * `offsetTop` 은 `offsetParent` 기준이라 프리뷰가 positioned 인지에 따라 값이
 * 달라진다. 그래서 **경계 상자 차이 + scrollTop** 으로 잰다 — 어떤 배치에서도
 * 같은 값이 나온다.
 */

/** 편집기에서 각 줄이 시작하는 y. `lineStarts` 는 줄의 **문자 인덱스**다. */
export function measureEditorLineTops(
  editorEl: HTMLTextAreaElement,
  lineStarts: readonly number[],
): number[] {
  if (lineStarts.length === 0) return [];

  const doc = editorEl.ownerDocument;
  const style = doc.defaultView?.getComputedStyle(editorEl);
  if (!style) return [];

  const mirror = doc.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = style.width;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.font = style.font;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.tabSize = style.tabSize;
  mirror.style.boxSizing = style.boxSizing;

  const value = editorEl.value;
  const markers: HTMLElement[] = [];
  let cursor = 0;

  for (const start of lineStarts) {
    const index = Math.max(0, Math.min(value.length, start));
    if (index > cursor) {
      mirror.appendChild(doc.createTextNode(value.slice(cursor, index)));
      cursor = index;
    }
    const marker = doc.createElement("span");
    mirror.appendChild(marker);
    markers.push(marker);
  }
  if (cursor < value.length) {
    mirror.appendChild(doc.createTextNode(value.slice(cursor)));
  }

  doc.body.appendChild(mirror);
  const mirrorTop = mirror.getBoundingClientRect().top;
  const tops = markers.map((marker) => marker.getBoundingClientRect().top - mirrorTop);
  mirror.remove();

  return tops;
}

/**
 * 프리뷰 최상위 자식들의 y (프리뷰 스크롤 좌표계).
 *
 * **원문에 대응이 없는 블록(`data-generated`)은 세지 않는다.** 각주 절처럼
 * 렌더가 덧붙인 블록이 하나라도 끼면 개수가 어긋나 대응표가 통째로 버려지고,
 * 그 문서만 예전 비율 동기화로 돌아간다(이슈 #121 — 각주 문서에서 수십 px 어긋났다).
 */
export function measurePreviewBlockTops(previewEl: HTMLElement): number[] {
  const base = previewEl.getBoundingClientRect().top - previewEl.scrollTop;
  return [...previewEl.children]
    .filter((child) => !(child as HTMLElement).dataset?.generated)
    .map((child) => child.getBoundingClientRect().top - base);
}
