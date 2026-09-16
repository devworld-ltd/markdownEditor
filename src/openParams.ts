/**
 * F-90(원격 URL 열기) · F-91(로컬 열기 파라미터) — 파라미터 파싱·검증 (이슈 #195).
 *
 * **순수 모듈이다.** DOM·`fetch`·`window`·`navigator`·다른 앱 모듈(순수 모듈
 * 두 개만 예외)을 하나도 import 하지 않는다 — 그래서 `location.href` 와
 * PWA 의 `LaunchParams.targetURL` 이 **같은 함수**를 탈 수 있다(M-13). 두 경로가
 * 갈라지면 한쪽만 고치는 사고가 난다.
 *
 * ## 문구가 판정 근거다
 *
 * `fetchErrorMessage`·`rejectMessage` 가 만드는 문자열은 E2E 의 판정 신호다
 * (기술 스펙 §3-1) — `404`·`CORS`·`닿지 못했습니다`·`2MB`·`http`·`파일 선택` 이
 * 갈래마다 정확히 한 곳에만 나타나야 한다. 문구를 고칠 때 이 구별을 지우지 말 것.
 *
 * ## `/s/<id>` 공유 링크가 항상 이긴다
 *
 * 경로가 공유 링크(F-60)면 `readOpenIntent` 는 무조건 `null` 을 돌려준다 — 공유
 * 처리가 단독으로 문서를 연다(기술 스펙 §7-2). 판정은 `shareId.ts` 의
 * `shareIdFromPath` 를 그대로 재사용한다 — 정규식을 두 번 쓰면 갈라진다(트랩 #33
 * 과 같은 성격).
 */

import { DOCUMENT_EXTENSIONS, extensionOf } from "./dropFiles";
import { shareIdFromPath } from "./shareId";
import { MAX_IMAGE_BYTES } from "./imageUpload";

/** 원격 문서 상한. imageUpload.ts 의 MAX_IMAGE_BYTES 와 같은 값(PRD 결정 4). */
export const MAX_REMOTE_BYTES = MAX_IMAGE_BYTES;

/** 전체 가져오기 시한. 없으면 "가져오는 중…" 이 영원히 남는다. */
export const FETCH_TIMEOUT_MS = 15_000;
/** 탐침 시한. 분류를 위한 보조 요청이므로 짧다. */
export const PROBE_TIMEOUT_MS = 5_000;

/** 주소에서 읽어낸 의도. 파라미터가 없으면 null. */
export type OpenIntent =
  | { kind: "remote"; url: string; host: string }
  | { kind: "local" }
  | { kind: "reject"; reason: RejectReason };

export type RejectReason =
  | "scheme" // http(s) 가 아님 (file: javascript: data: blob: 및 비-localhost http:)
  | "not-absolute" // 상대경로·스킴 없음·파싱 실패
  | "local-path"; // ?file=/Users/... (M-11)

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname);
}

/**
 * `?url=` 값 하나를 판정한다. 성공하면 remote intent, 실패하면 reject(scheme
 * 또는 not-absolute) — **local-path 는 여기서 만들지 않는다.** `url=file://...`
 * 같은 값도 "http(s) 주소만 열 수 있습니다" 로 거절한다(AC-5 실측 그대로) —
 * local-path 는 `?file=` 파라미터 전용이다(AC-13).
 *
 * `http:` 예외는 **앱 자신이 로컬에서 돌 때만** 연다(이슈 #198). 대상만 보고
 * 열어 주면 배포된 앱의 `?url=http://localhost:3000/...` 링크도 확인창까지
 * 도달하는데, 거기 뜨는 호스트가 `localhost` 라 사용자가 위화감을 느끼기
 * 어렵다 — 배포 환경에서 이 예외가 필요한 이유도 없다. 판정 근거인 앱
 * 호스트명은 **인자로 받는다**(전역을 읽지 말 것 — 트랩 #15).
 */
function classifyUrlParam(value: string, appHostname: string): OpenIntent {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { kind: "reject", reason: "not-absolute" };
  }

  if (parsed.protocol === "https:") {
    return { kind: "remote", url: value, host: parsed.hostname };
  }
  if (
    parsed.protocol === "http:" &&
    isLocalHostname(parsed.hostname) &&
    isLocalHostname(appHostname)
  ) {
    return { kind: "remote", url: value, host: parsed.hostname };
  }
  return { kind: "reject", reason: "scheme" };
}

/**
 * 주소 하나에서 의도를 읽는다. `location.href` 와 `LaunchParams.targetURL` 이
 * **같은 함수**를 탄다(M-13). 파라미터가 없거나 `?url=` 이 빈 문자열이면 null.
 * 경로가 `/s/<id>` 면 무조건 null — 공유 링크가 우선이다(§7-2).
 *
 * `href` 는 **앱 자신의 주소**다(양쪽 호출부 모두 그렇다) — 그래서 `http:`
 * 예외를 좁히는 데 필요한 앱 호스트명을 따로 받지 않고 여기서 꺼낸다(#198).
 * 인자를 늘리면 두 호출부가 각자 오리진을 구해 넘기게 되고, 그 순간 한쪽만
 * 틀리는 경로가 생긴다.
 */
export function readOpenIntent(href: string): OpenIntent | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (shareIdFromPath(url.pathname) !== null) return null;

  const urlParam = url.searchParams.get("url");
  if (urlParam !== null && urlParam !== "") {
    return classifyUrlParam(urlParam, url.hostname);
  }

  const fileParam = url.searchParams.get("file");
  if (fileParam !== null && fileParam !== "") {
    return { kind: "reject", reason: "local-path" };
  }

  const openParam = url.searchParams.get("open");
  if (openParam === "local") {
    return { kind: "local" };
  }

  return null;
}

/** 탭 이름. 마지막 경로 조각 → 없으면 호스트명. 항상 확장자가 붙는다. */
export function fileNameFromUrl(url: string): string {
  let pathname = "";
  let hostname = "document";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname || hostname;
  } catch {
    return "document.md";
  }

  const lastSlash = pathname.lastIndexOf("/");
  let raw = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 디코딩 실패 — 원문을 그대로 쓴다.
  }

  // 제어문자·경로 구분자 제거(트랩: 경로 조작이 탭 이름에 새면 안 된다).
  // eslint-disable-next-line no-control-regex
  raw = raw.replace(/[\x00-\x1f\x7f/\\]/g, "");
  raw = raw.trim();
  if (raw.length > 120) raw = raw.slice(0, 120);

  if (!raw) raw = hostname;

  const ext = extensionOf(raw);
  if (!ext || !(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    raw = `${raw}.md`;
  }
  return raw;
}

/** 실패 갈래. 문구가 서로 달라야 한다는 불변식이 여기 붙는다. */
export type FetchReason =
  | { kind: "http"; status: number }
  | { kind: "cors" }
  | { kind: "network" }
  | { kind: "offline" }
  | { kind: "too-large" }
  | { kind: "timeout" }
  | { kind: "empty" }
  | { kind: "ambiguous" };

/** 사용자에게 보일 실패 문구. 와이어프레임 §2-4 표가 이 함수의 명세다. */
export function fetchErrorMessage(reason: FetchReason): string {
  switch (reason.kind) {
    case "http":
      return `문서를 가져오지 못했습니다 (HTTP ${reason.status}).`;
    case "cors":
      return "그 사이트가 다른 사이트에서의 읽기를 허용하지 않습니다 (CORS). 원본(raw) 주소인지 확인해 보세요.";
    case "network":
      return "주소에 닿지 못했습니다. 연결과 주소를 확인해 주세요.";
    case "offline":
      return "오프라인 상태입니다. 연결된 뒤에 다시 시도해 주세요.";
    case "too-large":
      return `문서가 너무 큽니다. ${Math.floor(MAX_REMOTE_BYTES / 1024 / 1024)}MB 이하만 열 수 있습니다.`;
    case "timeout":
      return "시간 안에 응답이 오지 않았습니다. 잠시 뒤 다시 시도해 주세요.";
    case "empty":
      return "가져온 문서가 비어 있습니다.";
    case "ambiguous":
      return "문서를 가져오지 못했습니다. 그 사이트가 읽기를 막았거나(CORS) 주소에 닿지 못했습니다.";
  }
}

/** 거절 문구(확인창 이전 단계). */
export function rejectMessage(reason: RejectReason): string {
  if (reason === "local-path") {
    return "브라우저는 주소로 받은 로컬 경로를 열 수 없습니다. '파일 선택'을 누르거나 설치한 앱에서 파일을 연결해 주세요.";
  }
  return "열 수 없는 주소입니다. http(s) 주소만 열 수 있습니다.";
}

/** 성공 문구. 출처 호스트를 남긴다(S-4). */
export function openedMessage(host: string, fileName: string, htmlHint: boolean): string {
  const base = `${host} 에서 ${fileName} 를 열었습니다.`;
  if (!htmlHint) return base;
  return `${base} 웹페이지로 보입니다 — 원본(raw) 주소를 써 보세요.`;
}

/** S-3: 이 타입이면 "웹페이지로 보임" 힌트를 덧붙인다. 열기를 막지는 않는다. */
export function looksLikeWebPage(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return essence === "text/html" || essence === "application/xhtml+xml";
}
