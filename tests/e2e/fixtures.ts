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
