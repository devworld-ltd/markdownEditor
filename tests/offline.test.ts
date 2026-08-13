import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineHost } from "../src/offline";

/**
 * `offline.ts` 는 swUpdate.ts 와 동일하게 앱 모듈을 import 하지 않는 리프 모듈이다.
 * 전역 navigator.onLine/window 이벤트를 직접 읽지 않고 OfflineHost 로 주입받으므로
 * 가짜 host 만으로 전량 검증한다. `initialized` 는 모듈 스코프 상태라 테스트마다
 * `vi.resetModules()` 로 모듈을 새로 로드해 누수를 막는다.
 */
async function loadOffline(): Promise<typeof import("../src/offline")> {
  vi.resetModules();
  return import("../src/offline");
}

function createBadge(): HTMLElement {
  document.body.innerHTML = `<div id="offline-indicator" hidden></div>`;
  return document.querySelector<HTMLElement>("#offline-indicator")!;
}

function makeHost(
  badgeEl: HTMLElement,
  overrides: Partial<OfflineHost> = {},
): OfflineHost & {
  emitOffline: () => void;
  emitOnline: () => void;
} {
  const offlineListeners = new Set<() => void>();
  const onlineListeners = new Set<() => void>();
  const host: OfflineHost & { emitOffline: () => void; emitOnline: () => void } = {
    badgeEl,
    isOnline: vi.fn(() => true),
    onOffline: vi.fn((fn: () => void) => {
      offlineListeners.add(fn);
      return () => offlineListeners.delete(fn);
    }),
    onOnline: vi.fn((fn: () => void) => {
      onlineListeners.add(fn);
      return () => onlineListeners.delete(fn);
    }),
    emitOffline: () => offlineListeners.forEach((fn) => fn()),
    emitOnline: () => onlineListeners.forEach((fn) => fn()),
    ...overrides,
  };
  return host;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("offline — 초기 상태 판정", () => {
  it("로드 시점에 온라인이면 배지가 숨겨진 상태를 유지한다", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const host = makeHost(badgeEl, { isOnline: vi.fn(() => true) });

    initOfflineIndicator(host);

    expect(badgeEl.hidden).toBe(true);
  });

  it("로드 시점에 오프라인이면 배지를 즉시 표시한다", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const host = makeHost(badgeEl, { isOnline: vi.fn(() => false) });

    initOfflineIndicator(host);

    expect(badgeEl.hidden).toBe(false);
  });
});

describe("offline — 전환 반영", () => {
  it("offline 이벤트가 오면 배지를 표시한다", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const host = makeHost(badgeEl, { isOnline: vi.fn(() => true) });

    initOfflineIndicator(host);
    expect(badgeEl.hidden).toBe(true);

    host.emitOffline();
    expect(badgeEl.hidden).toBe(false);
  });

  it("online 이벤트가 오면 배지를 숨긴다", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const host = makeHost(badgeEl, { isOnline: vi.fn(() => false) });

    initOfflineIndicator(host);
    expect(badgeEl.hidden).toBe(false);

    host.emitOnline();
    expect(badgeEl.hidden).toBe(true);
  });

  it("오프라인 → 온라인 → 오프라인 반복 전환을 정확히 반영한다", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const host = makeHost(badgeEl, { isOnline: vi.fn(() => true) });

    initOfflineIndicator(host);
    host.emitOffline();
    expect(badgeEl.hidden).toBe(false);

    host.emitOnline();
    expect(badgeEl.hidden).toBe(true);

    host.emitOffline();
    expect(badgeEl.hidden).toBe(false);
  });
});

describe("offline — 재진입 가드", () => {
  it("두 번째 초기화 호출은 무시된다(첫 host 로 등록된 리스너만 유효)", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const host1 = makeHost(badgeEl, { isOnline: vi.fn(() => true) });
    const host2 = makeHost(badgeEl, { isOnline: vi.fn(() => true) });

    initOfflineIndicator(host1);
    initOfflineIndicator(host2);

    // host2 의 offline 구독자는 등록되지 않았어야 한다.
    host2.emitOffline();
    expect(badgeEl.hidden).toBe(true);

    // host1 을 통해서는 정상 반영된다.
    host1.emitOffline();
    expect(badgeEl.hidden).toBe(false);
  });
});

describe("offline — 예외 격리 (NFR-2 와 동일 원칙)", () => {
  it("isOnline() 이 예외를 던져도 초기화 자체가 앱을 중단시키지 않는다", async () => {
    const { initOfflineIndicator } = await loadOffline();
    const badgeEl = createBadge();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() =>
      initOfflineIndicator({
        badgeEl,
        isOnline: () => {
          throw new Error("boom");
        },
      }),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
  });
});
