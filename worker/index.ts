/**
 * F-60 공유 링크 Worker (이슈 #66).
 *
 * ⚠️ **이 파일이 프로젝트의 성격을 바꾼다.** 지금까지 이 저장소는 "서버·DB·
 * 네트워크 호출이 없는 100% 클라이언트 앱" 이었고 `wrangler.jsonc` 에 `main`
 * 진입점조차 없었다(정적 자산 전용 Worker). 이제 R2 에 문서를 저장하는 코드가
 * 생겼으므로, **공유 기능을 쓰지 않는 한** 앱은 여전히 네트워크를 타지 않는다는
 * 점을 분명히 해 둔다 — 편집·저장·프리뷰는 전부 브라우저 안에서 끝난다.
 *
 * ## 설계
 *
 * | 항목 | 결정 | 이유 |
 * |------|------|------|
 * | ID | **내용 SHA-256 앞 16자** | 같은 문서 = 같은 링크. 중복 저장이 없고 스토리지가 단조 증가하지 않는다 |
 * | 크기 | 256KB 상한 | 익명 공개 쓰기 엔드포인트라 상한이 없으면 남용된다 |
 * | 수정·삭제 | **없다** | 지원하려면 권한 체계가 필요하다. 읽기 전용이면 인증이 없어도 된다 |
 * | 보존 | 무기한(수동 정리) | R2 수명 규칙은 계정 설정이라 코드로 강제할 수 없다. 운영 문서에 적었다 |
 * | 정화 | **브라우저에서** | 공유 문서는 남이 만든 것이다. 렌더는 기존 `parseMarkdown()` 경로를 그대로 탄다 |
 *
 * **서버는 마크다운 원문만 저장하고, HTML 로 만들지 않는다.** 렌더를 서버에서 하면
 * 정화 정책이 두 곳으로 갈라진다(F-38·F-40 과 같은 이유).
 */

import {
  MAX_SHARE_BYTES,
  computeShareId,
  isValidShareId,
  validateShareContent,
} from "../src/shareId";

export interface Env {
  /** 정적 자산 (wrangler 의 assets 바인딩) */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** 공유 문서 저장소 */
  SHARES: R2Bucket;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // API 응답은 캐시하지 않는다. 공유 문서는 불변이지만 목록·오류는 아니다.
  "cache-control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** `POST /api/share` — 문서를 저장하고 ID 를 돌려준다. */
async function createShare(request: Request, env: Env): Promise<Response> {
  // Content-Length 로 먼저 거른다 — 본문을 다 읽고 나서 거절하면 대역폭이 낭비된다.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SHARE_BYTES) {
    return json({ error: "too-large", limit: MAX_SHARE_BYTES }, 413);
  }

  let content: string;
  try {
    const body = (await request.json()) as { content?: unknown };
    if (typeof body?.content !== "string") return json({ error: "bad-request" }, 400);
    content = body.content;
  } catch {
    return json({ error: "bad-request" }, 400);
  }

  const check = validateShareContent(content);
  if (!check.ok) {
    return json(
      { error: check.reason, limit: MAX_SHARE_BYTES },
      check.reason === "too-large" ? 413 : 400,
    );
  }

  const id = await computeShareId(content);

  // 같은 내용이면 이미 있다 — 다시 쓰지 않는다.
  const existing = await env.SHARES.head(id);
  if (!existing) {
    await env.SHARES.put(id, content, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { createdAt: new Date().toISOString() },
    });
  }

  return json({ id, reused: Boolean(existing) }, 201);
}

/** `GET /api/share/:id` — 문서 원문을 돌려준다. */
async function readShare(id: string, env: Env): Promise<Response> {
  if (!isValidShareId(id)) return json({ error: "not-found" }, 404);

  const object = await env.SHARES.get(id);
  if (!object) return json({ error: "not-found" }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // 내용 주소 지정이라 같은 ID 의 내용은 절대 바뀌지 않는다 — 영구 캐시 가능.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/share") {
      if (request.method === "POST") return createShare(request, env);
      return json({ error: "method-not-allowed" }, 405);
    }

    const readMatch = /^\/api\/share\/([^/]+)$/.exec(url.pathname);
    if (readMatch) {
      if (request.method === "GET") return readShare(readMatch[1], env);
      return json({ error: "method-not-allowed" }, 405);
    }

    // `/s/<id>` 는 **앱을 그대로 띄운다.** 문서는 브라우저가 API 로 가져와
    // 기존 정화 파이프라인(parseMarkdown)을 태운다 — 서버가 HTML 을 만들면
    // 정화 정책이 두 곳으로 갈라진다.
    if (url.pathname.startsWith("/s/")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }

    return env.ASSETS.fetch(request);
  },
};
