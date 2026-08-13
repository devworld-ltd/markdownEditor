/**
 * F-60 공유 링크 — 클라이언트 (이슈 #66).
 *
 * ⚠️ **이 앱에서 유일하게 네트워크를 타는 기능이다.** 다른 모든 동작(편집·저장·
 * 프리뷰·내보내기)은 브라우저 안에서 끝난다. 그래서 공유를 쓰지 않는 사용자에게는
 * 이 모듈이 아무 요청도 만들지 않아야 한다 — 버튼을 누를 때만 fetch 한다.
 *
 * 설계 판단:
 *
 * 1) **서버는 마크다운 원문만 주고받는다.** 서버가 HTML 을 만들면 정화 정책이
 *    두 곳으로 갈라진다(F-38·F-40 과 같은 이유). 공유 문서는 **남이 만든 것**이라
 *    기존 `parseMarkdown()` 경로를 반드시 타야 한다.
 * 2) **같은 문서 = 같은 링크.** ID 가 내용 해시라 다시 공유해도 링크가 그대로다.
 *    대신 **해시는 비밀이 아니다** — 내용을 아는 사람은 링크를 계산할 수 있다.
 *    "아는 사람만 본다" 수준의 보호임을 UI 문구로 밝힌다.
 * 3) **검증은 보내기 전에도 한다.** 서버와 같은 판정(`validateShareContent`)을
 *    써서, 어차피 거절될 요청을 굳이 보내지 않는다.
 *
 * `clipboardExport.ts` 와 같은 주입형 리프다 — `shareId.ts`(순수) 외에는 앱
 * 모듈을 import 하지 않는다.
 */

import {
  shareErrorMessage,
  shareUrl,
  validateShareContent,
  type ShareValidation,
} from "./shareId";

export interface ShareHost {
  /** `POST /api/share` 를 수행하고 ID 를 돌려준다. */
  upload: (content: string) => Promise<{ id: string }>;
  /** `GET /api/share/:id` 로 원문을 가져온다. */
  download: (id: string) => Promise<string>;
  /** 현재 오리진 (링크 조립용). */
  origin: string;
  notify?: (message: string, kind?: "info" | "error") => void;
  /** 링크를 클립보드에 넣는다. 실패해도 링크 자체는 보여줘야 한다. */
  copyLink?: (url: string) => Promise<void>;
}

export type ShareResult =
  | { ok: true; url: string }
  | { ok: false; reason: ShareValidation extends { ok: false } ? never : string };

/** 문서를 업로드하고 공유 링크를 만든다. */
export async function createShareLink(
  host: ShareHost,
  content: string,
): Promise<ShareResult> {
  const check = validateShareContent(content);
  if (!check.ok) {
    // 어차피 서버가 거절할 요청을 보내지 않는다.
    host.notify?.(shareErrorMessage(check.reason), "error");
    return { ok: false, reason: check.reason };
  }

  try {
    const { id } = await host.upload(content);
    const url = shareUrl(host.origin, id);

    try {
      await host.copyLink?.(url);
      host.notify?.(`공유 링크를 클립보드에 복사했습니다. 링크를 아는 사람은 누구나 볼 수 있습니다.`);
    } catch {
      // 복사만 실패한 것이다 — 링크는 만들어졌으므로 그것을 알려야 한다.
      host.notify?.(`공유 링크: ${url}`);
    }

    return { ok: true, url };
  } catch (error) {
    host.notify?.(
      `공유하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return { ok: false, reason: "upload-failed" };
  }
}

/**
 * 공유 링크로 들어왔을 때 문서를 가져온다.
 *
 * 실패해도 **앱은 정상적으로 떠야 한다** — 링크가 만료됐거나 오타여도 빈 편집기를
 * 쓸 수 있어야지, 흰 화면이 되면 안 된다.
 */
export async function loadSharedDocument(
  host: ShareHost,
  id: string,
): Promise<string | null> {
  try {
    return await host.download(id);
  } catch {
    host.notify?.("공유 문서를 찾을 수 없습니다. 링크가 만료되었거나 잘못되었습니다.", "error");
    return null;
  }
}
