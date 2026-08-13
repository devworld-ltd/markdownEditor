import { describe, expect, it, vi } from "vitest";
import type { ScrollPanel, ScrollSyncHost } from "../src/scrollSync";

/**
 * `scrollSync.ts` 는 offline.ts/fsLimitNotice.ts 와 동일하게 앱 모듈을 import 하지
 * 않는 주입형 리프 모듈이다. jsdom 은 scrollHeight/clientHeight 를 항상 0 으로
 * 보고하므로, 가짜 패널 + 수동 프레임 스케줄러 host 주입이 매핑 함수·소유권
 * 전이·0 나눗셈 가드를 검증하는 유일한 수단이다(기술 스펙 D-1).
 */
async function loadScrollSync(): Promise<typeof import("../src/scrollSync")> {
  vi.resetModules();
  return import("../src/scrollSync");
}

/**
 * 실제 DOM 요소를 흉내내는 가짜 패널. `scrollTop` 대입은 실제 브라우저처럼
 * scroll 이벤트를 동기적으로 만들지 않는다 — 테스트가 `fireScroll()` 로
 * "큐에서 이벤트가 도착한 시점"을 직접 제어한다.
 */
class FakePanel implements ScrollPanel {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  private listener: (() => void) | null = null;

  constructor(scrollHeight: number, clientHeight: number, scrollTop = 0) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.scrollTop = scrollTop;
  }

  addEventListener(_type: "scroll", listener: () => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: "scroll", listener: () => void): void {
    if (this.listener === listener) this.listener = null;
  }

  /** 리스너가 붙어 있는지 — 초기화 롤백 검증용(#33). */
  hasListener(): boolean {
    return this.listener !== null;
  }

  /** 사용자 스크롤(또는 프로그램적 대입 후 지연 도착하는 이벤트)을 시뮬레이션한다. */
  fireScroll(): void {
    this.listener?.();
  }
}

/** 수동 프레임 스케줄러 — 테스트가 `flush()` 로 "프레임이 흘러갔다"를 결정한다. */
function createManualHost(
  editor: FakePanel,
  preview: FakePanel,
): ScrollSyncHost & { flush: () => void; pendingCount: () => number } {
  const queue = new Map<number, () => void>();
  let nextId = 1;

  return {
    editor,
    preview,
    requestFrame: (cb) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      queue.delete(id);
    },
    flush: () => {
      const callbacks = [...queue.values()];
      queue.clear();
      callbacks.forEach((cb) => cb());
    },
    pendingCount: () => queue.size,
  };
}

function setup(editorH = { scrollHeight: 2000, clientHeight: 500 }, previewH = { scrollHeight: 3000, clientHeight: 500 }) {
  const editor = new FakePanel(editorH.scrollHeight, editorH.clientHeight);
  const preview = new FakePanel(previewH.scrollHeight, previewH.clientHeight);
  const host = createManualHost(editor, preview);
  return { editor, preview, host };
}

describe("scrollSync — 매핑 함수: 기본 비율 추종", () => {
  it("에디터를 스크롤하면 프레임 플러시 후 프리뷰가 같은 비율로 이동한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();

    initScrollSync(host);

    // d(editor) = 1500, 750/1500 = 0.5 → d(preview) = 2500, target = 1250
    editor.scrollTop = 750;
    editor.fireScroll();
    expect(host.pendingCount()).toBe(1); // 프레임은 아직 흐르지 않음

    host.flush();
    expect(preview.scrollTop).toBe(1250);
  });

  it("프리뷰를 스크롤하면 에디터가 대응 위치로 따라온다 (양방향)", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();

    initScrollSync(host);

    // d(preview) = 2500, 500/2500 = 0.2 → d(editor) = 1500, target = 300
    preview.scrollTop = 500;
    preview.fireScroll();
    host.flush();

    expect(editor.scrollTop).toBe(300);
  });
});

describe("scrollSync — 매핑 함수: 양 끝 정확 일치", () => {
  it("맨 위(0)로 스크롤하면 반대편도 정확히 0이다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 1500; // 먼저 중간으로
    editor.fireScroll();
    host.flush();

    editor.scrollTop = 0;
    editor.fireScroll();
    host.flush();

    expect(preview.scrollTop).toBe(0);
  });

  it("맨 아래로 스크롤하면 반대편도 정확히 최대값(scrollHeight-clientHeight)이다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 1500; // d(editor) 전체
    editor.fireScroll();
    host.flush();

    expect(preview.scrollTop).toBe(2500); // d(preview) 전체
  });

  it("HiDPI 소수점 오차(1px 이내)도 맨 위/맨 아래로 스냅한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 0.6; // 1px 이내 → 0으로 스냅
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(0);

    editor.scrollTop = 1499.5; // d(editor)=1500, 차이 0.5 → 1로 스냅
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(2500);
  });
});

describe("scrollSync — 0 나눗셈 가드 (M13 / AC-19~21)", () => {
  it("양쪽 다 스크롤 불가(d<=0)면 무동작이고 오류가 없다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup(
      { scrollHeight: 100, clientHeight: 100 },
      { scrollHeight: 100, clientHeight: 100 },
    );
    initScrollSync(host);

    expect(() => {
      editor.scrollTop = 0;
      editor.fireScroll();
      host.flush();
    }).not.toThrow();

    expect(preview.scrollTop).toBe(0);
    expect(Number.isNaN(preview.scrollTop)).toBe(false);
  });

  it("소스가 스크롤 불가(d(src)<=0)면 계산 자체를 하지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup(
      { scrollHeight: 100, clientHeight: 100 }, // 에디터는 스크롤 불가
      { scrollHeight: 3000, clientHeight: 500 },
    );
    initScrollSync(host);

    // scrollTop 대입 자체가 의미 없지만(불가능한 상태) 이벤트만 발화해도 안전해야 한다.
    editor.fireScroll();
    host.flush();

    expect(preview.scrollTop).toBe(0);
  });

  it("종속이 스크롤 불가(d(dep)<=0)면 대입하지 않고 반환한다 (한쪽만 스크롤 가능)", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup(
      { scrollHeight: 2000, clientHeight: 500 },
      { scrollHeight: 100, clientHeight: 100 }, // 프리뷰는 스크롤 불가
    );
    initScrollSync(host);

    editor.scrollTop = 750;
    editor.fireScroll();

    expect(() => host.flush()).not.toThrow();
    expect(preview.scrollTop).toBe(0);
  });

  it("음수 분모(d<0, 레이아웃 전이 중)에서도 계산을 건너뛴다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup(
      { scrollHeight: 400, clientHeight: 500 }, // scrollHeight < clientHeight → d < 0
      { scrollHeight: 3000, clientHeight: 500 },
    );
    initScrollSync(host);

    editor.scrollTop = 0;
    editor.fireScroll();

    expect(() => host.flush()).not.toThrow();
    expect(preview.scrollTop).toBe(0);
  });
});

describe("scrollSync — 소유권 전이 (R1) 및 시간 만료 없음 (R3)", () => {
  it("마지막으로 사용자가 스크롤한 패널이 소스가 되고, 방향이 즉시 전환된다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 750; // source = editor
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(1250);

    // 이제 프리뷰를 사용자가 스크롤 → source 가 즉시 preview 로 전환된다.
    preview.scrollTop = 0;
    preview.fireScroll();
    host.flush();
    expect(editor.scrollTop).toBe(0);
  });

  it("시간이 흘러도(프레임 미실행) 소유권이 저절로 뒤집히지 않는다 (R3 — 시간 만료로 해제되지 않는다)", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 750;
    editor.fireScroll();
    // 프레임을 흘리지 않고 시간만 흘렀다고 가정 — 아무 것도 변하지 않는다.
    expect(preview.scrollTop).toBe(0);

    host.flush();
    expect(preview.scrollTop).toBe(1250);
  });
});

describe("scrollSync — 프로그램적 메아리 폐기 (R2, 무한 루프 방지)", () => {
  it("종속 패널에 대입한 값과 같은 scroll 이벤트는 폐기되어 반대 방향 루프를 만들지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(1250);

    // 브라우저가 위 대입의 결과로 지연 발화하는 scroll 이벤트를 시뮬레이션한다.
    // expectedTop 과 일치하므로 프로그램적 메아리로 폐기되어야 한다 — 폐기되지
    // 않으면 preview 가 소스가 되어 editor 를 다시 움직이는 루프가 생긴다.
    preview.fireScroll();

    // 새 프레임이 예약되지 않았어야 한다(메아리는 소스 전환을 일으키지 않는다).
    expect(host.pendingCount()).toBe(0);

    editor.scrollTop = 0; // 에디터가 다시 사용자 스크롤로 움직여도 정상 동작해야 한다
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(0);
  });

  it("1px 이내 오차의 메아리도 폐기된다 (HiDPI 대응)", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();
    const applied = preview.scrollTop;

    // 브라우저가 대입값을 그대로 반영하지 않고 0.4px 어긋나게 보고하는 상황을 흉내낸다.
    preview.scrollTop = applied + 0.4;
    preview.fireScroll();

    expect(host.pendingCount()).toBe(0); // 메아리로 처리되어 새 프레임이 없다
  });
});

describe("scrollSync — 성능: 프레임 병합 (M8)", () => {
  it("같은 프레임 안의 연속 scroll 이벤트는 프레임당 1회로 병합된다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, host } = setup();
    initScrollSync(host);

    editor.scrollTop = 100;
    editor.fireScroll();
    expect(host.pendingCount()).toBe(1);

    editor.scrollTop = 200;
    editor.fireScroll();
    editor.scrollTop = 300;
    editor.fireScroll();

    // 여러 번 발화해도 대기 중인 프레임은 하나뿐이다.
    expect(host.pendingCount()).toBe(1);
  });
});

describe("scrollSync — suspend()/resumeAfterFrame() 억제·해제 순서 (M10/M11)", () => {
  it("suspend() 중에는 모든 scroll 이벤트가 폐기된다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    controller.suspend();
    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();

    expect(preview.scrollTop).toBe(0);
  });

  it("resumeAfterFrame() 은 즉시가 아니라 다음 프레임에 해제한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    controller.suspend();
    controller.resumeAfterFrame();

    // 아직 프레임이 흐르지 않았으므로 억제 상태 그대로다.
    editor.scrollTop = 750;
    editor.fireScroll();
    expect(host.pendingCount()).toBeGreaterThan(0);

    // 해제 프레임을 흘려보낸다.
    host.flush();

    // 이제 해제됐으니 사용자 스크롤이 정상 반영된다.
    editor.scrollTop = 800;
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBeGreaterThan(0);
  });

  it("suspend() 는 대기 중이던 프레임과 예약된 해제를 함께 취소한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, host } = setup();
    const controller = initScrollSync(host);

    // 두 종류의 대기 작업을 **모두** 만들어야 이 테스트가 이름값을 한다.
    // (1) 사용자 스크롤이 예약한 동기화 프레임
    editor.scrollTop = 750;
    editor.fireScroll();
    // (2) 예약된 억제 해제 — 이것을 만들지 않으면 doSuspend() 의
    //     pendingResumeId 취소 분기가 아예 실행되지 않는다.
    controller.resumeAfterFrame();
    expect(host.pendingCount()).toBe(2);

    controller.suspend();
    expect(host.pendingCount()).toBe(0);
  });

  it("예약된 해제가 취소되므로, 억제 구간이 프레임 경과로 조기 종료되지 않는다", async () => {
    // 회귀 방지의 핵심: 이 가드가 없으면 예약된 해제가 나중 억제 구간 한복판에서
    // 발화해 suspended 를 조기 해제한다. 그러면 renderPreview() 의 innerHTML
    // 교체가 큐에 넣은 scroll 이 사용자 스크롤로 분류되어 ratio=0 이 되고,
    // 에디터 복원값이 날아간다(F-06/F-51 회귀 — 기술 스펙 함정 #2).
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    // 예약된 해제를 만든 뒤 곧바로 다시 억제한다 (탭 전환 중 렌더가 겹치는 상황).
    controller.resumeAfterFrame();
    controller.suspend();

    // 프레임을 흘려보내도 억제가 풀리면 안 된다.
    host.flush();

    // 억제 중이므로 이 scroll 은 폐기되어야 한다 — 프리뷰가 움직이면 조기 해제된 것이다.
    const previewBefore = preview.scrollTop;
    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();

    expect(preview.scrollTop).toBe(previewBefore);
  });

  it("suspend() 중 발생한 scroll 은 expectedTop 을 남기지 않아, 해제 후 재개된 사용자 스크롤이 정상 분류된다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    controller.suspend();
    // 탭 전환 중 value 교체로 인한 중간 상태 scroll 이벤트를 흉내낸다.
    editor.scrollTop = 999;
    editor.fireScroll();

    controller.resumeAfterFrame();
    host.flush();

    // 해제 이후 실제 사용자 스크롤이 정상적으로 소스가 된다.
    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(1250);
  });
});

describe("scrollSync — syncFromEditorOnce() (M11, 탭 전환 복원 직후 1회 동기화)", () => {
  it("에디터의 현재 위치를 기준으로 프리뷰를 1회 맞춘다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    editor.scrollTop = 750; // 탭 복원으로 세팅됐다고 가정 (scroll 이벤트 발화 없이)
    controller.syncFromEditorOnce();

    expect(preview.scrollTop).toBe(1250);
  });

  it("에디터가 스크롤 불가 상태면 아무 것도 하지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup(
      { scrollHeight: 100, clientHeight: 100 },
      { scrollHeight: 3000, clientHeight: 500 },
    );
    const controller = initScrollSync(host);

    preview.scrollTop = 500;
    controller.syncFromEditorOnce();

    expect(preview.scrollTop).toBe(500); // 변경되지 않았다
  });
});

describe("scrollSync — reapplyAfterRender() (M9, 프리뷰 재렌더 후 위치 유지)", () => {
  it("직전 동기화 비율을 프리뷰에 재적용한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(1250);

    // innerHTML 교체로 프리뷰가 리셋됐다고 가정.
    preview.scrollTop = 0;

    controller.reapplyAfterRender();
    expect(preview.scrollTop).toBe(1250);
  });

  it("한 번도 동기화된 적 없으면(lastRatio=null) 아무 것도 하지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { preview, host } = setup();
    const controller = initScrollSync(host);

    controller.reapplyAfterRender();

    expect(preview.scrollTop).toBe(0);
  });

  it("소스가 프리뷰였고 에디터가 스크롤 불가여도 lastRatio 를 그대로 재적용해 0으로 튀지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup(
      { scrollHeight: 100, clientHeight: 100 }, // 에디터 스크롤 불가
      { scrollHeight: 3000, clientHeight: 500 },
    );
    const controller = initScrollSync(host);

    preview.scrollTop = 500; // 사용자가 프리뷰를 스크롤 (소스 = preview)
    preview.fireScroll();
    host.flush();

    preview.scrollTop = 0; // 재렌더로 리셋됐다고 가정
    controller.reapplyAfterRender();

    expect(preview.scrollTop).toBe(500); // 0 으로 튀지 않고 직전 비율이 재적용된다
  });

  it("reapplyAfterRender() 도중 발생하는 scroll 이벤트는 억제되어 루프를 만들지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    editor.scrollTop = 750;
    editor.fireScroll();
    host.flush();

    preview.scrollTop = 0;
    controller.reapplyAfterRender();
    // reapplyAfterRender 내부의 scrollTop 대입이 만든 지연 이벤트가 도착했다고 가정.
    preview.fireScroll();

    expect(host.pendingCount()).toBe(1); // resumeAfterFrame() 이 예약한 해제 프레임 하나뿐
  });
});

describe("scrollSync — 재진입 가드 및 예외 격리", () => {
  it("두 번째 초기화는 경고와 함께 no-op 컨트롤러를 반환한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { host: host1 } = setup();
    const { host: host2 } = setup();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    initScrollSync(host1);
    const second = initScrollSync(host2);

    expect(warnSpy).toHaveBeenCalled();
    expect(() => second.suspend()).not.toThrow();
    expect(() => second.resumeAfterFrame()).not.toThrow();
    expect(() => second.syncFromEditorOnce()).not.toThrow();
    expect(() => second.reapplyAfterRender()).not.toThrow();
  });

  it("초기화 중 예외가 나도 앱을 중단시키지 않고 no-op 컨트롤러를 반환한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const brokenEditor = {} as ScrollPanel; // addEventListener 없음 → 호출 시 예외
    const okPreview = new FakePanel(3000, 500);

    let controller: ReturnType<typeof initScrollSync> | undefined;
    expect(() => {
      controller = initScrollSync({ editor: brokenEditor, preview: okPreview });
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    expect(controller).toBeDefined();
    expect(() => controller!.suspend()).not.toThrow();
  });
});

describe("scrollSync — 초기화 실패와 재시도 (#33)", () => {
  /** 지정한 순번의 addEventListener 호출에서 던지는 패널. */
  class ThrowingPanel extends FakePanel {
    constructor(private failOnAttach: boolean, scrollHeight = 2000, clientHeight = 500) {
      super(scrollHeight, clientHeight);
    }

    addEventListener(type: "scroll", listener: () => void): void {
      if (this.failOnAttach) throw new Error("attach 실패");
      super.addEventListener(type, listener);
    }
  }

  it("초기화가 실패하면 재시도가 가능하다 — 잠금이 걸리지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear(); // 앞선 테스트의 누적 호출과 섞이지 않도록

    // 1차: 프리뷰 부착에서 실패
    const badPreview = new ThrowingPanel(true);
    const editor1 = new FakePanel(2000, 500);
    const failed = initScrollSync({ ...createManualHost(editor1, badPreview), preview: badPreview });
    failed.syncFromEditorOnce(); // no-op 컨트롤러 — 던지지 않아야 한다

    // 이 호출이 만든 경고만 본다(다른 테스트의 spy 누적과 섞이지 않도록 즉시 스냅샷).
    const firstCallWarnings = warn.mock.calls.map((call) => String(call[0]));
    expect(firstCallWarnings).toEqual(["[scrollSync] 초기화 실패:"]);

    // 2차: 정상 패널로 재시도 → 실제로 동작해야 한다
    const editor2 = new FakePanel(2000, 500);
    const preview2 = new FakePanel(3000, 500);
    const host2 = createManualHost(editor2, preview2);
    initScrollSync(host2);

    editor2.scrollTop = 750;
    editor2.fireScroll();
    host2.flush();
    expect(preview2.scrollTop).toBe(1250); // 재시도가 막혔다면 0 에 머문다

    warn.mockRestore();
  });

  it("부분 부착 상태로 실패하면 붙은 리스너를 떼어낸다 — 엔진 2개가 생기지 않는다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear(); // 앞선 테스트의 누적 호출과 섞이지 않도록

    const editor = new FakePanel(2000, 500);
    const badPreview = new ThrowingPanel(true);
    initScrollSync({ ...createManualHost(editor, badPreview), preview: badPreview });

    // 에디터에는 부착이 성공했었다. 롤백되지 않으면 죽은 클로저가 남는다.
    expect(editor.hasListener()).toBe(false);

    warn.mockRestore();
  });

  it("리스너를 뗄 수단이 없으면 재시도를 막는다 — 엔진 중복보다 잠금이 낫다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();

    // removeEventListener 를 제공하지 않는 패널. 부착은 되지만 되돌릴 수 없다.
    class UnremovablePanel extends FakePanel {
      declare removeEventListener: never;
    }
    const editor = new UnremovablePanel(2000, 500);
    delete (editor as unknown as Record<string, unknown>).removeEventListener;
    Object.defineProperty(editor, "removeEventListener", { value: undefined });
    const badPreview = new ThrowingPanel(true);

    initScrollSync({ ...createManualHost(editor, badPreview), preview: badPreview });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[scrollSync] 초기화 실패:",
    ]);

    // 잠긴 상태여야 한다 — 재시도하면 죽은 클로저와 새 엔진이 공존하게 된다.
    warn.mockClear();
    const retry = initScrollSync(setup().host);
    retry.syncFromEditorOnce();
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[scrollSync] 이미 초기화되어 재호출을 무시합니다.",
    ]);

    warn.mockRestore();
  });

  it("성공한 뒤의 재호출은 여전히 무시된다 — 잠금 자체는 살아 있다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear(); // 앞선 테스트의 누적 호출과 섞이지 않도록
    const { editor, preview, host } = setup();

    initScrollSync(host);
    const second = initScrollSync(createManualHost(editor, preview));
    second.syncFromEditorOnce();

    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[scrollSync] 이미 초기화되어 재호출을 무시합니다.",
    ]);
    warn.mockRestore();
  });
});

describe("scrollSync — 렌더가 진행 중이던 동기화를 삼키지 않는다 (#34)", () => {
  it("스크롤 직후 렌더가 끼어들어도 최신 비율이 적용된다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    // 1) 먼저 한 번 동기화해 lastRatio 를 0.2 로 만든다.
    editor.scrollTop = 300; // 300/1500 = 0.2
    editor.fireScroll();
    host.flush();
    expect(preview.scrollTop).toBe(500); // 0.2 * 2500

    // 2) 사용자가 더 스크롤한다 — 프레임이 예약되지만 아직 흐르지 않았다.
    editor.scrollTop = 1200; // 0.8
    editor.fireScroll();
    expect(host.pendingCount()).toBe(1);

    // 3) 그 사이 150ms 디바운스 렌더가 끝나 innerHTML 이 교체된다.
    preview.scrollTop = 0; // 렌더가 프리뷰를 맨 위로 리셋
    controller.reapplyAfterRender();

    // 낡은 lastRatio(0.2)가 아니라 방금 만든 0.8 이 적용돼야 한다.
    expect(preview.scrollTop).toBe(2000); // 0.8 * 2500
  });

  it("대기 중인 스크롤이 없으면 기존대로 직전 비율을 재적용한다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    editor.scrollTop = 300;
    editor.fireScroll();
    host.flush();
    expect(host.pendingCount()).toBe(0);

    preview.scrollTop = 0;
    controller.reapplyAfterRender();
    expect(preview.scrollTop).toBe(500); // lastRatio 0.2 유지
  });

  it("되살린 비율이 lastRatio 로 승격돼 다음 렌더에도 이어진다", async () => {
    const { initScrollSync } = await loadScrollSync();
    const { editor, preview, host } = setup();
    const controller = initScrollSync(host);

    editor.scrollTop = 300;
    editor.fireScroll();
    host.flush();

    editor.scrollTop = 1200;
    editor.fireScroll();
    preview.scrollTop = 0;
    controller.reapplyAfterRender();
    host.flush(); // 억제 해제

    // 두 번째 렌더 — 대기 프레임 없이 lastRatio 만으로 복원된다.
    preview.scrollTop = 0;
    controller.reapplyAfterRender();
    expect(preview.scrollTop).toBe(2000);
  });
});
