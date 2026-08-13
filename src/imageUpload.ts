/**
 * F-28 이미지 업로드 — 검증·계산 (이슈 #80).
 *
 * Worker 와 브라우저 **양쪽에서 쓰인다.** 두 곳이 같은 판정을 내려야 하므로
 * DOM 도 Node API 도 만지지 않는다.
 *
 * ## SVG 를 받지 않는 이유
 *
 * SVG 는 **스크립트를 담을 수 있는 문서 형식**이다. `<img>` 안에서는 실행되지
 * 않지만, 업로드된 파일은 우리 오리진의 URL 을 갖게 되고 사용자가 그 주소로
 * **직접 이동하면 우리 오리진에서 스크립트가 실행된다.** 공유 링크(F-60)와
 * 합쳐지면 "이미지 링크를 눌렀더니 내 문서가 털린다" 가 성립한다.
 *
 * 헤더로 막는 방법(`Content-Security-Policy: sandbox`)도 있지만, **막을 수 있다는
 * 것과 막혀 있다는 것은 다르다** — 헤더 하나가 빠지면 조용히 뚫린다. 래스터 형식만
 * 받으면 그 경로가 아예 생기지 않는다.
 */

/** 허용 형식 → 확장자. 여기 없는 형식은 받지 않는다. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * 업로드 상한. 공유 문서(256KB)보다 크지만 무제한은 아니다 — 익명 공개 쓰기
 * 엔드포인트라 상한이 없으면 남용된다.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageRejectReason = "type" | "too-large" | "empty";

export type ImageValidation =
  | { ok: true; extension: string }
  | { ok: false; reason: ImageRejectReason };

export function validateImage(type: string, size: number): ImageValidation {
  const extension = ALLOWED_IMAGE_TYPES[type];
  if (!extension) return { ok: false, reason: "type" };
  if (size <= 0) return { ok: false, reason: "empty" };
  if (size > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };
  return { ok: true, extension };
}

export function imageErrorMessage(reason: ImageRejectReason): string {
  if (reason === "type") {
    // SVG 를 시도했을 가능성이 높으므로 허용 형식을 분명히 말한다.
    return "PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.";
  }
  if (reason === "empty") return "빈 파일은 넣을 수 없습니다.";
  return `이미지가 너무 큽니다. ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB 이하만 넣을 수 있습니다.`;
}

/** 이미지 키 형식. 경로 조작을 막는다. */
const KEY_PATTERN = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/;

export function isValidImageKey(key: unknown): boolean {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

/** 키에서 content-type 을 되돌린다. 모르는 확장자면 null. */
export function contentTypeForKey(key: string): string | null {
  // **키 형식 검증을 겸한다.** 호출부(Worker)가 별도로 검증하지 않고 이 함수의
  // null 만 보므로, 여기서 빼면 임의 R2 객체를 읽으려는 시도가 통한다.
  if (!isValidImageKey(key)) return null;
  const extension = key.split(".").pop()!;
  const entry = Object.entries(ALLOWED_IMAGE_TYPES).find(([, ext]) => ext === extension);
  return entry ? entry[0] : null;
}

/**
 * 내용 해시로 키를 만든다. 같은 이미지를 두 번 넣어도 객체가 하나다 — 공유
 * 문서(F-60)와 같은 이유로 스토리지가 단조 증가하지 않는다.
 */
export async function computeImageKey(bytes: ArrayBuffer, extension: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  return `${hex}.${extension}`;
}

/** 삽입할 마크다운. 대체 텍스트는 사용자가 채우도록 자리만 만든다. */
export function imageMarkdown(url: string, alt: string): string {
  // 대체 텍스트에 대괄호가 있으면 링크 문법이 깨진다.
  const safeAlt = alt.replace(/[[\]]/g, "");
  return `![${safeAlt}](${url})`;
}

/** 파일명에서 대체 텍스트 후보를 만든다. */
export function altFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base || "이미지";
}
