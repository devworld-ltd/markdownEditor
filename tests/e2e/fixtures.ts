import type { Page } from "@playwright/test";

/**
 * File System Access API 목(mock)을 페이지에 주입한다.
 *
 * 실제 파일 선택 대화상자는 자동화할 수 없으므로 showOpenFilePicker /
 * showSaveFilePicker 를 대체해 앱이 핸들을 다루는 로직만 검증한다.
 * 같은 이름의 핸들은 동일 객체로 재사용되므로 isSameEntry() 기반 중복 탭 방지도
 * 실제와 같은 방식으로 동작한다.
 */
export async function installFsMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const handles = new Map<string, FileSystemFileHandle>();

    const mock = {
      /** 다음 열기에서 반환할 파일명 */
      openName: "a.md",
      /** 다음 "다른 이름으로 저장"에서 선택될 파일명 */
      saveName: "saved.md",
      /** 파일명 → 내용 */
      contents: {} as Record<string, string>,
      /** 디스크에 기록된 순서대로 누적 */
      writes: [] as Array<{ name: string; content: string }>,
      /** true 면 다음 대화상자가 취소된 것처럼 동작 */
      cancel: false,
      /** true 면 다음 쓰기가 실패 */
      failWrite: false,
    };
    window.__fsMock = mock;

    function abort(): never {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    function getHandle(name: string): FileSystemFileHandle {
      const cached = handles.get(name);
      if (cached) return cached;

      const handle = {
        kind: "file" as const,
        name,
        async getFile() {
          return new File([mock.contents[name] ?? ""], name, {
            type: "text/markdown",
          });
        },
        async isSameEntry(other: FileSystemHandle) {
          return other === handle;
        },
        async createWritable() {
          if (mock.failWrite) {
            throw new DOMException("쓰기 권한이 없습니다.", "NotAllowedError");
          }
          let buffer = "";
          return {
            async write(chunk: string) {
              buffer += chunk;
            },
            async close() {
              mock.contents[name] = buffer;
              mock.writes.push({ name, content: buffer });
            },
          };
        },
      } as unknown as FileSystemFileHandle;

      handles.set(name, handle);
      return handle;
    }

    window.showOpenFilePicker = async () => {
      if (mock.cancel) abort();
      return [getHandle(mock.openName)];
    };

    window.showSaveFilePicker = async () => {
      if (mock.cancel) abort();
      return getHandle(mock.saveName);
    };
  });
}

/**
 * File System Access API 를 제거해 Safari/Firefox 폴백 경로를 강제한다.
 */
export async function installFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
}

/** 목 상태를 갱신한다. */
export async function setFsMock(
  page: Page,
  patch: Partial<{
    openName: string;
    saveName: string;
    contents: Record<string, string>;
    cancel: boolean;
    failWrite: boolean;
  }>,
): Promise<void> {
  await page.evaluate((p) => Object.assign(window.__fsMock!, p), patch);
}

/** 목 디스크에 기록된 쓰기 이력을 반환한다. */
export function getWrites(page: Page) {
  return page.evaluate(() => window.__fsMock!.writes);
}

/**
 * F-69 서비스 워커 업데이트 알림 — 플랫폼 스텁 (U10 STUB 전략).
 *
 * `navigator.serviceWorker` 를 앱 스크립트가 실행되기 **전에** 가짜 객체로 치환해,
 * 실제 재배포 없이 "대기 중인 새 버전"·"이 페이지를 제어하는 활성 워커" 같은 상태를
 * 재현한다. 앱 쪽 `swUpdate.ts`(기술 스펙 §4.2 `SwUpdateHost`)가 기대하는 표면
 * (`register()` / `registration.waiting` / `waiting.postMessage` / `controllerchange`)
 * 만 흉내 내므로, 검증되는 것은 앱의 판정·표시·갱신 로직 전체다.
 *
 * 이 스텁으로는 검증되지 않는 것: 브라우저가 `/sw.js` 바이트 차이로 실제 업데이트를
 * 감지하는 부분. 그 부분은 `hardening.spec.ts` 의 REMOTE 전용 케이스(E8)로 별도 검증한다.
 *
 * 주의: 이 프로젝트는 `import.meta.env.PROD` 에서만 `navigator.serviceWorker.register()`
 * 를 호출하므로(F-61), 이 스텁이 실제로 쓰이려면 **프로덕션 빌드(preview 서버 등)** 로
 * 실행해야 한다. 개발 서버(`npm run dev`)에서는 등록 자체가 일어나지 않는다.
 *
 * @param options.controlled  true = 이 페이지를 제어하는 활성 워커가 이미 있음
 *   (`navigator.serviceWorker.controller !== null`). false = 최초 설치(controller 없음).
 * @param options.waitingOnLoad  true = `register()` 직후부터 `registration.waiting` 이
 *   채워져 있음 (경로 A: 로드 시점에 이미 대기 중). 기본 false.
 */
export async function installSwUpdateStub(
  page: Page,
  options: { controlled: boolean; waitingOnLoad?: boolean },
): Promise<void> {
  await page.addInitScript((opts: { controlled: boolean; waitingOnLoad?: boolean }) => {
    type Listener = (...args: unknown[]) => void;

    function makeEmitter() {
      const byType = new Map<string, Set<Listener>>();
      return {
        on(type: string, fn: Listener) {
          if (!byType.has(type)) byType.set(type, new Set());
          byType.get(type)!.add(fn);
        },
        off(type: string, fn: Listener) {
          byType.get(type)?.delete(fn);
        },
        emit(type: string, ...args: unknown[]) {
          byType.get(type)?.forEach((fn) => fn(...args));
        },
      };
    }

    function makeFakeWorker() {
      const emitter = makeEmitter();
      const postMessageCalls: unknown[] = [];
      return {
        state: "installing",
        postMessage(data: unknown) {
          postMessageCalls.push(data);
        },
        addEventListener: (t: string, fn: Listener) => emitter.on(t, fn),
        removeEventListener: (t: string, fn: Listener) => emitter.off(t, fn),
        __emit: emitter.emit,
        __postMessageCalls: postMessageCalls,
      };
    }

    const swContainerEmitter = makeEmitter();
    const regEmitter = makeEmitter();

    let controller: ReturnType<typeof makeFakeWorker> | null = opts.controlled
      ? makeFakeWorker()
      : null;
    if (controller) controller.state = "activated";

    let waiting: ReturnType<typeof makeFakeWorker> | null = null;
    let installing: ReturnType<typeof makeFakeWorker> | null = null;
    if (opts.waitingOnLoad) {
      waiting = makeFakeWorker();
      waiting.state = "installed";
    }

    const registration = {
      get waiting() {
        return waiting;
      },
      get installing() {
        return installing;
      },
      addEventListener: (t: string, fn: Listener) => regEmitter.on(t, fn),
      removeEventListener: (t: string, fn: Listener) => regEmitter.off(t, fn),
      update: async () => {
        /* STUB: 능동 확인 호출을 무해하게 흡수한다. 필요 시 테스트가 __swStub 로 직접 상태를 바꾼다 */
      },
    };

    const stub = {
      get controller() {
        return controller;
      },
      register: async () => registration,
      addEventListener: (t: string, fn: Listener) => swContainerEmitter.on(t, fn),
      removeEventListener: (t: string, fn: Listener) => swContainerEmitter.off(t, fn),
      ready: Promise.resolve(registration),
    };

    (window as unknown as { __swStub: unknown }).__swStub = {
      /** 경로 B: 세션 중 새 워커가 설치된다 (updatefound → installing → statechange:installed) */
      triggerUpdateFound() {
        installing = makeFakeWorker();
        installing.state = "installing";
        regEmitter.emit("updatefound");
        installing.state = "installed";
        waiting = installing;
        installing.__emit("statechange");
      },
      /** 사용자가 갱신을 수락해 새 워커가 활성화된 뒤 도착하는 신호 (U3) */
      triggerControllerChange() {
        if (waiting) {
          controller = waiting;
          controller.state = "activated";
          waiting = null;
        }
        swContainerEmitter.emit("controllerchange");
      },
      /** FR-S5: 활성화 신호를 의도적으로 보내지 않는다(타임아웃 경로 검증용) — 아무 것도 하지 않는다. */
      getWaitingPostMessageCalls() {
        return (waiting ?? controller)?.__postMessageCalls ?? [];
      },
    };

    Object.defineProperty(Navigator.prototype, "serviceWorker", {
      configurable: true,
      get: () => stub,
    });
  }, options);
}

/** 경로 B(세션 중 새 워커 설치)를 시뮬레이션한다. `installSwUpdateStub` 이후에만 유효하다. */
export async function triggerSwUpdateFound(page: Page): Promise<void> {
  await page.evaluate(() => window.__swStub?.triggerUpdateFound());
}

/** 갱신 수락 후 활성화 완료 신호(`controllerchange`)를 발화한다. */
export async function triggerSwControllerChange(page: Page): Promise<void> {
  await page.evaluate(() => window.__swStub?.triggerControllerChange());
}

/** 대기 워커(또는 활성화 후 컨트롤러)에 전달된 `postMessage` 호출 이력을 반환한다. */
export function getSwWaitingPostMessageCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(() => window.__swStub?.getWaitingPostMessageCalls() ?? []);
}
