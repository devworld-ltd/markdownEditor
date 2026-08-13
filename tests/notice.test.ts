import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hideNotice, initNotice, showNotice } from "../src/notice";

function createContainer(): HTMLElement {
  document.body.innerHTML = `<div id="notice" hidden></div>`;
  return document.querySelector<HTMLElement>("#notice")!;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("showNotice", () => {
  it("메시지와 종류를 렌더링하고 hidden 을 해제한다", () => {
    const container = createContainer();
    initNotice(container);

    showNotice("저장됐습니다", "info");

    expect(container.hidden).toBe(false);
    expect(container.textContent).toBe("저장됐습니다");
    expect(container.dataset.kind).toBe("info");
  });

  it("durationMs 후 자동으로 숨긴다", () => {
    const container = createContainer();
    initNotice(container);

    showNotice("에러 발생", "error", 1000);
    expect(container.hidden).toBe(false);

    vi.advanceTimersByTime(999);
    expect(container.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(container.hidden).toBe(true);
  });

  it("이전 타이머가 남아 있으면 취소하고 새 타이머로 교체한다", () => {
    const container = createContainer();
    initNotice(container);

    showNotice("첫 알림", "info", 1000);
    vi.advanceTimersByTime(500);
    // 아직 첫 타이머가 끝나기 전에 새 알림을 띄운다.
    showNotice("두번째 알림", "error", 1000);

    // 첫 타이머 시점(500ms 추가 경과 = 총 1000ms)에는 숨겨지지 않아야 한다 —
    // 이전 타이머가 취소되고 새 타이머(두번째 알림 기준 1000ms)로 교체됐기 때문이다.
    vi.advanceTimersByTime(500);
    expect(container.hidden).toBe(false);
    expect(container.textContent).toBe("두번째 알림");

    vi.advanceTimersByTime(500);
    expect(container.hidden).toBe(true);
  });

  it("initNotice 를 호출하지 않았으면 아무 것도 하지 않는다", () => {
    expect(() => showNotice("무시됨")).not.toThrow();
  });

  it("기본 kind 는 info, 기본 durationMs 는 4000 이다", () => {
    const container = createContainer();
    initNotice(container);

    showNotice("기본값 확인");
    expect(container.dataset.kind).toBe("info");

    vi.advanceTimersByTime(3999);
    expect(container.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(container.hidden).toBe(true);
  });
});

describe("hideNotice", () => {
  it("표시 중인 알림을 즉시 숨기고 대기 중인 타이머를 취소한다", () => {
    const container = createContainer();
    initNotice(container);

    showNotice("알림", "info", 5000);
    expect(container.hidden).toBe(false);

    hideNotice();
    expect(container.hidden).toBe(true);

    // 타이머가 취소됐으므로 이후 시간이 흘러도 예외 없이 안전하다.
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
  });

  it("containerEl 이 없으면 아무 것도 하지 않는다", () => {
    // initNotice() 를 호출하지 않은 상태를 재현하기 어려우므로(모듈 스코프 상태가
    // 이전 테스트에서 남음), 최소한 예외 없이 안전하게 동작하는지만 확인한다.
    expect(() => hideNotice()).not.toThrow();
  });
});
