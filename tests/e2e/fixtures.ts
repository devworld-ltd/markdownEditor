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

/* ────────────────────────────────────────────────────────────────────────
 * F-25/F-72 스크롤 동기화 (이슈 #31) — 검증 헬퍼
 *
 * 이 이슈는 파일 시스템·서비스 워커처럼 "플랫폼 API 를 흉내 낼" 대상이 없다.
 * `textarea#editor`/`div#preview` 는 둘 다 실제 DOM 요소이고 스크롤은 네이티브
 * 동작이므로, 앞의 두 스텁과 달리 여기서는 **목(mock)이 아니라 측정·조작
 * 유틸리티**만 필요하다. 아래 5개 함수는 신규 export 이며 기존 8종의 시그니처와
 * 동작은 건드리지 않는다.
 * ──────────────────────────────────────────────────────────────────────── */

/** 스크롤 컨테이너 하나의 3대 메트릭. `scrollSync.ts` 의 매핑 함수가 쓰는 값과 동일하다. */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** `selector` 요소의 현재 스크롤 메트릭을 읽는다. */
export function getScrollMetrics(page: Page, selector: string): Promise<ScrollMetrics> {
  return page.locator(selector).evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
}

/**
 * `selector` 요소의 `scrollTop` 을 직접 대입해 스크롤을 유발한다.
 *
 * **주의 — `mouse.wheel` 과의 차이를 이해하고 골라 쓸 것**:
 * - `setScrollTop()`(본 함수) 은 목표 위치에 **정확히, 한 번에** 도달한다.
 *   브라우저는 이 대입에 대해서도 실제 `scroll` 이벤트를 (다음 렌더링 프레임 직전에)
 *   발화하므로, 앱 쪽 `scrollSync.ts` 입장에서는 "누가 움직였는지" 구분할 수 없는
 *   진짜 스크롤과 동일하게 처리된다 — 즉 **R1/R2 판별 로직을 속이는 편법이 아니라
 *   유효한 자극**이다. 양 끝 정합(AC-08/09)처럼 **정확한 좌표**가 필요한 단언에 쓴다.
 * - `page.mouse.wheel(dx, dy)` 는 실제 휠 이벤트 시퀀스를 보내 브라우저가 자체
 *   가감속으로 `scrollTop` 을 여러 번에 걸쳐 바꾼다 — 정확한 목표 좌표를 보장하지
 *   않지만, "연속 `scroll` 이벤트가 여러 번 온다"(AC-14 프레임 병합) 같은 **연속성
 *   자체**를 검증해야 하는 단언에 쓴다.
 * - 두 수단을 섞어 같은 단언에 쓰지 말 것 — 오차 허용치가 다르다.
 */
export async function setScrollTop(page: Page, selector: string, top: number): Promise<void> {
  await page.locator(selector).evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
}

/**
 * 콘솔 `error`/`warning` 을 페이지 이동 전부터 수집한다.
 *
 * AC-19~21(엣지 케이스)은 "콘솔 오류·경고가 한 건도 없다" 를 요구한다.
 * `page.goto()` 이전에 호출해야 초기 로드 시점의 메시지도 놓치지 않는다.
 */
export function watchConsoleIssues(page: Page): { errors: string[]; warnings: string[] } {
  const issues = { errors: [] as string[], warnings: [] as string[] };
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.errors.push(msg.text());
    if (msg.type() === "warning") issues.warnings.push(msg.text());
  });
  return issues;
}

/**
 * `containerSelector` 안에서 `text` 를 포함하는 요소가 (a) 현재 뷰포트 안에 보이는지,
 * (b) 보이지 않는다면 뷰포트 경계로부터 몇 px 떨어져 있는지를 반환한다.
 *
 * AC-10/11(균질 산문은 화면 안, 코드 블록 혼재 문서는 "한 화면 이내") 판정에 쓴다.
 * `distancePx` 는 요소가 이미 보이면 `0`, 위/아래 어느 쪽으로든 벗어난 만큼의
 * 양수 거리다. "한 화면 이내" 판정은 호출부에서
 * `distancePx <= containerClientHeight` 로 비교한다(컨테이너 높이는
 * `getScrollMetrics()` 로 별도 조회).
 */
export function getAnchorProximity(
  page: Page,
  containerSelector: string,
  text: string,
): Promise<{ visible: boolean; distancePx: number }> {
  return page.evaluate(
    ({ containerSelector, text }) => {
      const container = document.querySelector(containerSelector);
      if (!container) return { visible: false, distancePx: Infinity };

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let target: Element | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.includes(text)) {
          target = node.parentElement;
          break;
        }
      }
      if (!target) return { visible: false, distancePx: Infinity };

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      if (targetRect.bottom >= containerRect.top && targetRect.top <= containerRect.bottom) {
        return { visible: true, distancePx: 0 };
      }
      const distancePx =
        targetRect.top > containerRect.bottom
          ? targetRect.top - containerRect.bottom
          : containerRect.top - targetRect.bottom;
      return { visible: false, distancePx };
    },
    { containerSelector, text },
  );
}

/**
 * 지정한 길이의 균질 산문 문서를 만든다 (기술 스펙 §10.0 DOC-A 패턴).
 * `markerLines` 에 준 줄 번호에는 대신 `## 마커-<label>` 제목을 심는다.
 */
export function buildProseDoc(
  totalLines: number,
  markers: Record<number, string> = {},
): string {
  const lines: string[] = [];
  for (let i = 1; i <= totalLines; i++) {
    lines.push(markers[i] ? `## 마커-${markers[i]}` : `문단 ${i} — 스크롤 동기화 검증용 본문입니다.`);
  }
  return lines.join("\n");
}

/**
 * **진짜** 파일 핸들로 파일 선택 창을 흉내낸다 (이슈 #125).
 *
 * `installFsMock()` 의 목 핸들은 **메서드를 가진 평범한 객체**라 구조화 복제가
 * 아예 안 된다(`DataCloneError`). 그래서 그것으로는 핸들을 IndexedDB 에 보관하는
 * 경로를 **검증할 수 없다** — 통과해도 진짜로 되는지 알 수 없고, 깨져도 안 보인다.
 *
 * OPFS(`navigator.storage.getDirectory()`)는 파일 선택 창 없이 **실제
 * `FileSystemFileHandle`** 을 준다. 브라우저가 실제로 그 핸들을 복제·복원하는지가
 * 이 기능의 전제이므로, 그 전제를 진짜 객체로 확인한다.
 */
export async function installRealHandleMock(
  page: Page,
  files: Record<string, string>,
): Promise<void> {
  await page.addInitScript((seed: Record<string, string>) => {
    const state = { openName: Object.keys(seed)[0] ?? "a.md" };
    (window as unknown as { __realMock: typeof state }).__realMock = state;

    async function handleFor(name: string): Promise<FileSystemFileHandle> {
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle(name, { create: true });
      // 이미 내용이 있으면 덮지 않는다 — 앱이 저장한 것을 지우면 안 된다.
      const existing = await handle.getFile();
      if (existing.size === 0 && seed[name] !== undefined) {
        const writable = await handle.createWritable();
        await writable.write(seed[name]);
        await writable.close();
      }
      return handle;
    }

    window.showOpenFilePicker = async () => [await handleFor(state.openName)];
    window.showSaveFilePicker = async () => handleFor(state.openName);
  }, files);
}

/** 다음에 열릴 파일명을 바꾼다 (`installRealHandleMock` 전용). */
export async function setRealMockOpenName(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    (window as unknown as { __realMock: { openName: string } }).__realMock.openName = n;
  }, name);
}
