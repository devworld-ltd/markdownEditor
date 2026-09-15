/**
 * F-90 원격 문서 가져오기 — 주입형 리프 (이슈 #195).
 *
 * `openParams.ts`(순수) **만** import 한다. DOM·`notice`·`tabs`·`fileOps` 는
 * 전혀 모른다 — 그래서 "요청이 몇 건 나갔나"(오류 4분류 × 상한 2지점 × 타임아웃 ×
 * 빈 본문)를 가짜 `fetch` 하나만 주입해 전부 단위 테스트로 고정할 수 있다.
 * `fileOps.ts` 를 5% → 90% 로 올린 것과 같은 수법이다(트랩 #15).
 *
 * ## 이 함수는 사용자 제스처 핸들러 안에서 호출된다
 *
 * 그래서 내부에서 `await` 뒤에 파일 선택창 같은 제스처 의존 API 를 부르지
 * 않는다 — 여기서 부르는 것은 `fetch` 뿐이다.
 *
 * ## 오류 4분류 판정 순서는 불변식이다(기술 스펙 §4-3)
 *
 * `AbortError` 를 **가장 먼저** 본다 — 그렇지 않으면 우리가 시한으로 끊은
 * 것이 `network` 로 오분류된다(`abort()` 도 `fetch` 를 reject 시킨다).
 * `navigator.onLine === false` 는 탐침 없이 곧바로 `offline` — 나갈 요청이
 * 없다. 그 다음에야 `no-cors` 탐침으로 `cors`/`network`/`ambiguous` 를 가른다.
 */

import { type FetchReason, MAX_REMOTE_BYTES } from "./openParams";

export interface RemoteDocHost {
  /** `globalThis.fetch`. 테스트는 가짜를 준다. */
  fetch: typeof fetch;
  /** `navigator.onLine`. */
  isOnline: () => boolean;
  /** 진행 알림. main.ts 가 showNotice 를 넘긴다(이 모듈은 언제 부를지 모른다 — 배선쪽 책임). */
  notify?: (message: string, kind?: "info" | "error") => void;
  /** 테스트가 시한을 줄일 수 있도록 주입 경계로 뺀다. */
  timeoutMs?: number;
  probeTimeoutMs?: number;
}

export type RemoteDocResult =
  | { ok: true; content: string; contentType: string | null }
  | { ok: false; reason: FetchReason };

type ProbeOutcome = "opaque" | "rejected" | "unavailable";

async function noCorsProbe(
  host: RemoteDocHost,
  url: string,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("probe timeout", "AbortError")),
    timeoutMs,
  );
  try {
    const res = await host.fetch(url, {
      method: "GET",
      mode: "no-cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    return res && res.type === "opaque" ? "opaque" : "unavailable";
  } catch {
    return "rejected";
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError";
}

/**
 * 대상 문서를 한 번 가져온다. **이 함수는 사용자 제스처 핸들러 안에서 호출된다**
 * — 그래서 내부에서 `await` 뒤에 파일 선택창 같은 제스처 의존 API 를 부르지
 * 않는다. 여기서 부르는 것은 `fetch` 뿐이다.
 */
export async function fetchRemoteDocument(
  host: RemoteDocHost,
  url: string,
): Promise<RemoteDocResult> {
  const timeoutMs = host.timeoutMs ?? 15_000;
  const probeTimeoutMs = host.probeTimeoutMs ?? 5_000;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("timeout", "AbortError")),
    timeoutMs,
  );

  let res: Response;
  try {
    res = await host.fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { accept: "text/markdown, text/plain;q=0.9, */*;q=0.8" },
    });
  } catch (error) {
    clearTimeout(timer);
    // ★ 반드시 첫 검사 — 아니면 우리가 끊은 타임아웃이 network 로 오분류된다.
    if (isAbortError(error)) return { ok: false, reason: { kind: "timeout" } };
    if (host.isOnline() === false) return { ok: false, reason: { kind: "offline" } };

    const outcome = await noCorsProbe(host, url, probeTimeoutMs);
    if (outcome === "opaque") return { ok: false, reason: { kind: "cors" } };
    if (outcome === "rejected") return { ok: false, reason: { kind: "network" } };
    return { ok: false, reason: { kind: "ambiguous" } };
  }

  if (!res.ok) {
    clearTimeout(timer);
    return { ok: false, reason: { kind: "http", status: res.status } };
  }

  try {
    // 1) Content-Length 사전 검사 — 본문을 한 바이트도 읽기 전에 끊는다.
    const clHeader = res.headers.get("content-length");
    const contentLength = clHeader === null ? NaN : Number(clHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_BYTES) {
      controller.abort();
      return { ok: false, reason: { kind: "too-large" } };
    }

    const contentType = res.headers.get("content-type");

    // 2) 본문 누적 검사 — 헤더가 없거나 거짓일 수 있다.
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_REMOTE_BYTES) {
            controller.abort();
            try {
              await reader.cancel();
            } catch {
              // 연결 정리 실패는 무시 — 상한 판정 자체는 이미 확정됐다.
            }
            return { ok: false, reason: { kind: "too-large" } };
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      // 3) 디코드 — ignoreBOM=false(기본)이라 UTF-8 BOM 은 여기서 벗겨진다.
      const content = new TextDecoder("utf-8").decode(merged);
      if (content.trim().length === 0) return { ok: false, reason: { kind: "empty" } };
      return { ok: true, content, contentType };
    }

    // res.body 가 없는 환경(가짜 fetch 포함) → text() 폴백 후 바이트 재검사.
    const rawText = await res.text();
    const bytes = new TextEncoder().encode(rawText);
    if (bytes.byteLength > MAX_REMOTE_BYTES) {
      return { ok: false, reason: { kind: "too-large" } };
    }
    // ignoreBOM=false(기본)이라 UTF-8 BOM 은 여기서도 벗겨진다 — 스트리밍
    // 경로와 같은 결과를 내야 한다.
    const content = new TextDecoder("utf-8").decode(bytes);
    if (content.trim().length === 0) return { ok: false, reason: { kind: "empty" } };
    return { ok: true, content, contentType };
  } finally {
    clearTimeout(timer);
  }
}
