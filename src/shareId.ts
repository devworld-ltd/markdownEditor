/**
 * F-60 공유 링크 — ID·검증 계산 (이슈 #66).
 *
 * Worker 와 브라우저 **양쪽에서 쓰인다.** 그래서 DOM 도 Node API 도 만지지 않고
 * `crypto.subtle`(둘 다 있는 표준)만 쓴다.
 *
 * ## ID 를 내용 해시로 만드는 이유
 *
 * 난수 ID 는 같은 문서를 두 번 공유하면 두 개의 객체를 만든다. 내용 해시는
 * **같은 문서 = 같은 링크**라 중복 저장이 없고, 링크를 다시 만들어도 예전 링크가
 * 그대로 산다. 익명 공개 쓰기 엔드포인트에서 스토리지 증가를 억제하는 가장
 * 단순한 수단이기도 하다.
 *
 * 해시는 **비밀이 아니다.** 내용을 아는 사람은 링크를 계산할 수 있다 — 공유 링크는
 * "아는 사람만 본다" 는 수준의 보호이고, 그 이상이 필요하면 서버 인증이 필요하다.
 * 이 성질을 문서에 명시한다.
 */

/** 링크에 쓰는 해시 길이(16진수 문자 수). 64비트 — 충돌 확률이 실질적으로 0 이다. */
export const SHARE_ID_LENGTH = 16;

/**
 * 업로드 상한.
 *
 * 익명 공개 쓰기 엔드포인트라 상한이 없으면 남용된다. 256KB 는 이 앱이 다루는
 * 문서(수백~수천 줄)보다 훨씬 큰 값이고, 그보다 큰 문서는 애초에 링크로 주고받을
 * 물건이 아니다.
 */
export const MAX_SHARE_BYTES = 256 * 1024;

/** ID 형식. 경로 조작·이상한 키를 걸러낸다. */
const ID_PATTERN = new RegExp(`^[0-9a-f]{${SHARE_ID_LENGTH}}$`);

export function isValidShareId(id: unknown): boolean {
  return typeof id === "string" && ID_PATTERN.test(id);
}

/** 내용에서 공유 ID 를 만든다. 같은 내용이면 항상 같은 값이다. */
export async function computeShareId(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, SHARE_ID_LENGTH);
}

export type ShareValidation =
  | { ok: true; bytes: number }
  | { ok: false; reason: "empty" | "too-large"; bytes: number };

/** 업로드 전 검증. 서버와 클라이언트가 **같은 판정**을 쓰도록 여기 한 곳에 둔다. */
export function validateShareContent(content: string): ShareValidation {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes === 0) return { ok: false, reason: "empty", bytes };
  if (bytes > MAX_SHARE_BYTES) return { ok: false, reason: "too-large", bytes };
  return { ok: true, bytes };
}

/** 사용자에게 보일 실패 사유. */
export function shareErrorMessage(reason: "empty" | "too-large"): string {
  if (reason === "empty") return "빈 문서는 공유할 수 없습니다.";
  return `문서가 너무 큽니다. ${Math.floor(MAX_SHARE_BYTES / 1024)}KB 이하만 공유할 수 있습니다.`;
}

/** 공유 링크 URL. 프래그먼트가 아니라 경로다 — 서버가 문서를 갖고 있다. */
export function shareUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${id}`;
}

/** 현재 경로가 공유 링크면 그 ID 를 돌려준다. */
export function shareIdFromPath(pathname: string): string | null {
  const match = /^\/s\/([0-9a-f]+)\/?$/.exec(pathname);
  if (!match || !isValidShareId(match[1])) return null;
  return match[1];
}
