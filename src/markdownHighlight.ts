/**
 * F-23 잔여 — 편집 영역 마크다운 하이라이팅 (이슈 #95).
 *
 * ## 지켜야 하는 단 하나의 성질
 *
 * 이 모듈의 출력은 textarea **위에 겹쳐 놓는다.** 그래서 정확도보다 먼저 지켜야
 * 하는 것이 있다:
 *
 * > **태그를 걷어낸 텍스트가 입력과 정확히 같아야 한다.**
 *
 * 한 글자라도 더하거나 빼면 그 줄부터 글자 위치가 밀려 오버레이가 어긋난다.
 * 색이 조금 틀린 것은 눈에 거슬리는 정도지만, 정렬이 틀리면 **기능이 못 쓰게
 * 된다.** 그래서 이 불변식을 단위 테스트로 못 박았다(`tests/markdownHighlight`
 * 의 "글자를 더하거나 빼지 않는다" 묶음).
 *
 * 그 결과 설계가 단순해진다 — 표식(`##`, `**`)을 **지우지 않고 흐리게** 칠한다.
 * 감추는 편집기도 있지만, 감추려면 글자를 빼야 하고 그러면 위 성질이 깨진다.
 *
 * ## 안 되면 그냥 두는 쪽으로
 *
 * 닫히지 않은 `**`, 줄을 넘는 링크처럼 애매한 것은 **칠하지 않는다.** 어설픈
 * 색은 단색보다 나쁘다(F-23 프리뷰 하이라이터와 같은 판단).
 *
 * DOM 을 만지지 않는 순수 모듈이다. 코드블록 안쪽은 기존 `highlight.ts` 를
 * 그대로 쓴다 — 토크나이저를 두 벌 두면 색이 갈린다.
 */

import { highlightToHtml, isSupportedLanguage } from "./highlight";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

/* ------------------------------------------------------------------ 인라인 */

/** 짝이 되는 닫는 표식의 위치. 없으면 -1. */
function findClosing(line: string, from: number, marker: string): number {
  const index = line.indexOf(marker, from);
  return index === -1 ? -1 : index;
}

/**
 * 링크·이미지 `[텍스트](주소)`. 매칭되면 소비한 길이와 HTML 을 준다.
 *
 * 괄호는 **중첩을 세면서** 닫는다 — 주소에 괄호가 든 위키 링크가 흔하다.
 */
function matchLink(line: string, start: number): { length: number; html: string } | null {
  const isImage = line[start] === "!" && line[start + 1] === "[";
  const bracketStart = isImage ? start + 1 : start;
  if (line[bracketStart] !== "[") return null;

  const textEnd = findClosing(line, bracketStart + 1, "]");
  if (textEnd === -1 || line[textEnd + 1] !== "(") return null;

  let depth = 1;
  let i = textEnd + 2;
  for (; i < line.length; i += 1) {
    if (line[i] === "(") depth += 1;
    else if (line[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;

  const text = line.slice(bracketStart + 1, textEnd);
  const url = line.slice(textEnd + 2, i);

  const html =
    (isImage ? span("md-marker", "!") : "") +
    span("md-marker", "[") +
    span("md-link-text", text) +
    span("md-marker", "](") +
    span("md-url", url) +
    span("md-marker", ")");

  return { length: i + 1 - start, html };
}

/** `**굵게**` 같은 쌍 표식. */
function matchWrapped(
  line: string,
  start: number,
  marker: string,
  cls: string,
): { length: number; html: string } | null {
  if (!line.startsWith(marker, start)) return null;
  const contentStart = start + marker.length;
  // 표식 바로 뒤가 공백이면 강조가 아니다 (`* 목록`, `2 * 3`).
  if (contentStart >= line.length || line[contentStart] === " ") return null;

  const close = findClosing(line, contentStart, marker);
  if (close === -1 || close === contentStart) return null;

  return {
    length: close + marker.length - start,
    html:
      span("md-marker", marker) +
      span(cls, line.slice(contentStart, close)) +
      span("md-marker", marker),
  };
}

/**
 * 한 줄의 인라인 서식.
 *
 * **한 번의 선형 스캔**이다. 되돌아가지 않으므로 어떤 입력에도 O(n) 이고,
 * 정규식 대안(alternation)이 없어 ReDoS 가 구조적으로 불가능하다(F-23 과 같은
 * 이유 — 오버레이는 매 타이핑마다 다시 그리므로 여기가 느리면 곧바로 체감된다).
 */
export function highlightInline(line: string): string {
  let out = "";
  let plain = "";
  let i = 0;

  const flush = (): void => {
    if (plain) {
      out += escapeHtml(plain);
      plain = "";
    }
  };

  while (i < line.length) {
    const ch = line[i];

    // 이스케이프된 표식은 서식이 아니다. 두 글자를 그대로 흘려보낸다.
    if (ch === "\\" && i + 1 < line.length) {
      plain += line.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === "`") {
      const close = findClosing(line, i + 1, "`");
      if (close !== -1) {
        flush();
        out += span("md-code", line.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }

    if (ch === "[" || (ch === "!" && line[i + 1] === "[")) {
      const link = matchLink(line, i);
      if (link) {
        flush();
        out += link.html;
        i += link.length;
        continue;
      }
    }

    const wrapped =
      matchWrapped(line, i, "**", "md-strong") ??
      matchWrapped(line, i, "__", "md-strong") ??
      matchWrapped(line, i, "~~", "md-strike") ??
      matchWrapped(line, i, "*", "md-em") ??
      matchWrapped(line, i, "_", "md-em");
    if (wrapped) {
      flush();
      out += wrapped.html;
      i += wrapped.length;
      continue;
    }

    plain += ch;
    i += 1;
  }

  flush();
  return out;
}

/* -------------------------------------------------------------------- 블록 */

const HEADING = /^(#{1,6})(\s)(.*)$/;
const QUOTE = /^(\s*)((?:>\s?)+)(.*)$/;
const LIST = /^(\s*)([-*+]|\d+[.)])(\s)(.*)$/;
const HR = /^(\s*)((?:-{3,}|\*{3,}|_{3,}))(\s*)$/;
const FENCE = /^(\s*)(```|~~~)(.*)$/;

/** 한 줄의 블록 서식. 코드블록 밖에서만 쓴다. */
function highlightBlockLine(line: string): string {
  const hr = HR.exec(line);
  if (hr) return escapeHtml(hr[1]) + span("md-marker", hr[2]) + escapeHtml(hr[3]);

  const heading = HEADING.exec(line);
  if (heading) {
    return (
      span("md-marker", heading[1]) +
      escapeHtml(heading[2]) +
      span("md-heading", heading[3])
    );
  }

  const quote = QUOTE.exec(line);
  if (quote) {
    return (
      escapeHtml(quote[1]) +
      span("md-marker", quote[2]) +
      highlightInline(quote[3])
    );
  }

  const list = LIST.exec(line);
  if (list) {
    return (
      escapeHtml(list[1]) +
      span("md-list", list[2]) +
      escapeHtml(list[3]) +
      highlightInline(list[4])
    );
  }

  return highlightInline(line);
}

/**
 * 문서 전체를 하이라이트한 HTML.
 *
 * 줄 단위로 처리하고 `\n` 을 그대로 남긴다 — 오버레이가 `white-space: pre-wrap`
 * 이므로 줄바꿈 위치가 textarea 와 정확히 같아야 한다.
 */
export function highlightMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  let fenceMarker: string | null = null;
  let fenceLanguage = "";
  let buffer: string[] = [];

  const flushFence = (): void => {
    if (buffer.length === 0) return;
    const code = buffer.join("\n");
    // 언어를 알면 기존 토크나이저로, 모르면 코드 색만 입힌다.
    out.push(
      isSupportedLanguage(fenceLanguage)
        ? highlightToHtml(code, fenceLanguage)
        : span("md-code-block", code),
    );
    buffer = [];
  };

  for (const line of lines) {
    const fence = FENCE.exec(line);

    if (fenceMarker === null && fence) {
      fenceMarker = fence[2];
      fenceLanguage = fence[3].trim().split(/\s+/)[0] ?? "";
      out.push(
        escapeHtml(fence[1]) + span("md-marker", fence[2]) + span("md-lang", fence[3]),
      );
      continue;
    }

    if (fenceMarker !== null) {
      // 여는 표식과 같은 종류여야 닫힌다. 내용의 ``` 로 끊기지 않는다.
      if (fence && fence[2] === fenceMarker && fence[3].trim() === "") {
        flushFence();
        out.push(escapeHtml(fence[1]) + span("md-marker", fence[2]) + escapeHtml(fence[3]));
        fenceMarker = null;
        continue;
      }
      buffer.push(line);
      continue;
    }

    out.push(highlightBlockLine(line));
  }

  // 닫히지 않은 코드블록은 끝까지 코드다 — 편집 중에 흔한 상태다.
  flushFence();

  return out.join("\n");
}
