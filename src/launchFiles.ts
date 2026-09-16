/**
 * PWA 파일 핸들러 — Finder "다음으로 열기" 로 실행됐을 때 (이슈 #135).
 *
 * ## 무엇이 이걸 가능하게 하나
 *
 * 브라우저 탭에는 앱 번들이 없어 macOS Launch Services 에 등록될 수 없다. 그런데
 * Chrome·Edge 로 **PWA 를 설치하면 실제 `.app` 셸이 생기고**, 매니페스트의
 * `file_handlers` 선언이 그 번들의 문서 타입이 된다. 그때 사용자가 Finder 에서
 * 파일을 열면 `launchQueue` 로 핸들이 들어온다.
 *
 * ## 들어오는 것은 진짜 핸들이다
 *
 * `LaunchParams.files` 는 `FileSystemFileHandle` 배열이다 — 파일 선택 창으로 연
 * 것과 **같은 종류**다. 그래서 `fileOps.openFileFromHandle()` 에 그대로 물리면
 * 중복 탭 방지·최근 목록(F-36)·핸들 보관(#125)이 전부 따라온다. 여기서 파일을
 * 직접 읽어 탭을 만들면 그 셋을 다시 구현하게 되고, 곧 갈라진다.
 *
 * ## 소비자는 늦게 등록하면 안 된다
 *
 * `launchQueue` 는 소비자가 붙기 전까지 실행 인자를 들고 기다리지만, **등록 자체를
 * 잊으면 조용히 아무 일도 일어나지 않는다** — 사용자는 앱이 빈 문서로 뜨는 것만 본다.
 * 그래서 `main.ts` 초기화 끝에서 한 번 부른다.
 *
 * 미지원 브라우저(Safari·Firefox)에서는 **아무 일도 하지 않는다.**
 *
 * `swUpdate.ts`·`offline.ts` 와 같은 주입형 리프다.
 *
 * ## F-90/F-91: `targetURL` 분기 (이슈 #195)
 *
 * `launchQueue.setConsumer()` 는 **두 번 부르면 예외 없이 조용히 교체된다**
 * (기술 스펙 §1-3 실측) — 그래서 F-90(`?url=`)·F-91(`?open=local`)이 PWA
 * `focus-existing` 경로(`LaunchParams.targetURL`)를 처리하려고 별도 소비자를
 * 등록하면 **이 소비자가 조용히 죽는다.** 그래서 분기는 이 소비자 안에,
 * **`files` 우선 + 즉시 `return`** 으로 둔다: 파일 연결 실행에도 `targetURL`
 * 이 매니페스트의 `action`("/")로 항상 채워져 오므로, 먼저 보면 파일 열기와
 * 경쟁한다(F-89 회귀).
 */

/** 이 앱이 쓰는 `launchQueue` 부분만. 표준 타입에 아직 없는 브라우저가 있다. */
export interface LaunchParamsLike {
  files?: readonly FileSystemFileHandle[];
  /** Chromium 실측: `LaunchParams.prototype` 에 실재한다(기술 스펙 §1-3). */
  targetURL?: string;
}

export interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}

export interface LaunchFilesHost {
  /** `window.launchQueue`. 없으면 이 기능이 없는 브라우저다. */
  queue?: LaunchQueueLike | null;
  /** 핸들 하나를 연다. 앱은 `fileOps.openFileFromHandle` 을 넘긴다. */
  openHandle: (handle: FileSystemFileHandle) => Promise<void>;
  notify?: (message: string, kind?: "info" | "error") => void;
  /**
   * F-90/F-91. 없으면 `targetURL` 분기는 아무 일도 하지 않는다 — F-89 만 쓰는
   * 기존 호출부(단위 테스트 포함)와 호환된다.
   */
  openTargetUrl?: (href: string) => void;
}

export interface LaunchFilesController {
  /** 소비자를 등록했는가. 테스트와 진단용. */
  isListening(): boolean;
}

const noopController: LaunchFilesController = { isListening: () => false };

let initialized = false;

export function initLaunchFiles(host: LaunchFilesHost): LaunchFilesController {
  if (initialized) {
    console.warn("[launchFiles] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const queue = host?.queue;
    // 미지원 브라우저. 조용히 물러난다 — 이 기능이 없다고 앱이 달라질 것은 없다.
    if (!queue || typeof queue.setConsumer !== "function") return noopController;

    queue.setConsumer((params) => {
      const files = params?.files ?? [];

      // ① 파일 핸들이 있으면 그것이 이 실행의 의도다(F-89). 기존 경로 그대로 —
      //    **여기서 return 한다.** 파일 연결 실행에도 targetURL 은 항상 채워져
      //    오지만 그것은 매니페스트의 action("/")일 뿐, 사용자가 준 주소가 아니다.
      if (files.length > 0) {
        // **순서를 지켜 하나씩 연다.** 동시에 열면 탭 순서가 실행 인자 순서와
        // 달라지고, 중복 탭 판정(`isSameEntry`)도 서로를 못 본 채 지나쳐 같은
        // 파일이 두 탭으로 열릴 수 있다.
        void (async () => {
          let failed = 0;
          for (const handle of files) {
            try {
              await host.openHandle(handle);
            } catch {
              // 한 파일이 실패해도 나머지는 연다 — 하나 때문에 전부 잃으면 안 된다.
              failed += 1;
            }
          }
          if (failed > 0) {
            host.notify?.(
              failed === files.length
                ? "파일을 열지 못했습니다."
                : `파일 ${failed}개를 열지 못했습니다.`,
              "error",
            );
          }
        })();
        return;
      }

      // ② 파일이 없을 때만 주소를 본다(F-90·F-91 / M-13).
      const href = params?.targetURL;
      if (typeof href === "string" && href) {
        try {
          host.openTargetUrl?.(href);
        } catch (error) {
          console.warn("[launchFiles] targetURL 처리 실패:", error);
        }
      }
    });

    initialized = true;
    return { isListening: () => true };
  } catch (error) {
    console.warn("[launchFiles] 초기화 실패:", error);
    return noopController;
  }
}
