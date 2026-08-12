/**
 * 서비스 워커 — 오프라인 지원.
 *
 * 캐시 전략을 자산 성격에 따라 나눈다.
 *
 *   /assets/*  콘텐츠 해시가 붙어 내용이 절대 바뀌지 않음 → cache-first
 *   내비게이션  새 배포를 즉시 반영해야 함              → network-first (실패 시 캐시)
 *   그 외 동일 출처                                     → network-first (실패 시 캐시)
 *
 * 해시 없는 진입 문서를 cache-first 로 두면 새 배포가 영원히 반영되지 않는다.
 * 반대로 해시 자산을 network-first 로 두면 오프라인 이점이 사라진다.
 *
 * 빌드 타임 프리캐시 목록 주입(workbox 등)을 쓰지 않으므로, 설치 시에는 앱 셸만
 * 캐시하고 나머지는 첫 요청 때 채운다.
 */

// F-69: 빌드마다 vite.config.ts 의 writeBundle 플러그인이 이 플레이스홀더를
// 실제 빌드 ID 로 치환한다(dist/sw.js). 치환되지 않으면 /sw.js 바이트가 배포마다
// 동일해져 브라우저가 업데이트를 감지하지 못한다 — 빌드 자체를 실패시키는 이유가 이것이다.
const VERSION = "__BUILD_ID__";
const CACHE = `markdown-editor-${VERSION}`;
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 일부 실패가 전체 설치를 막지 않도록 개별 처리한다.
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
      // F-69: 즉시 활성화하지 않는다. 새 워커는 여기서 waiting 상태에 머무르고,
      // 페이지가 SKIP_WAITING 메시지를 보낼 때만 활성화된다(아래 message 리스너).
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// F-69: 페이지가 갱신을 수락하면 registration.waiting(= 이 워커)에 이 메시지를 보낸다.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached =
      (await caches.match(request)) ||
      (fallbackUrl ? await caches.match(fallbackUrl) : undefined);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 이 아니거나 다른 출처면 그대로 통과시킨다.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
