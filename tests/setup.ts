/**
 * Node 22+ 는 `localStorage` 전역을 자체적으로 예약해 두는데(플래그 없이는 undefined),
 * 그 때문에 vitest 의 jsdom 환경이 jsdom 쪽 localStorage 를 window 에 싣지 못한다.
 * 실제 브라우저에는 영향이 없는 테스트 전용 셰임으로, 없을 때만 채워 넣는다.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof window !== "undefined" && !window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
}
