/**
 * mermaid 다이어그램 렌더 (이슈 #118).
 *
 * ## 이 모듈이 짊어진 것
 *
 * 이 저장소는 기능 80여 개를 더하는 동안 런타임 의존성을 `marked`·`DOMPurify`
 * **둘로 유지**했다. 이 기능으로 셋이 된다(사용자 결정). 그 대가를 최대한 줄이는
 * 것이 이 모듈의 일이다:
 *
 * 1. **지연 로드** — ```mermaid 블록이 문서에 하나도 없으면 라이브러리를 아예
 *    내려받지 않는다. `load()` 를 주입으로 받는 이유이기도 하다.
 * 2. **정화 경로는 하나** — 그린 SVG 도 `parseMarkdown()` 과 **같은**
 *    `DOMPurify.sanitize()` 를 통과한다(F-18). 그리는 주체가 바뀌었다고 정화를
 *    건너뛰면 그 순간 두 번째 경로가 생긴다.
 * 3. **같은 그림은 다시 그리지 않는다** — 타이핑마다 전부 다시 그리면 큰 문서에서
 *    입력이 멈춘다. 내용+테마를 키로 캐시한다.
 *
 * ## `htmlLabels: false` 는 선택이 아니다
 *
 * mermaid 는 기본적으로 라벨을 `<foreignObject>` 안의 HTML 로 그리는데,
 * **DOMPurify 가 `foreignObject` 를 지운다**(실측). 그대로 두면 글자 없는 도형만
 * 남는다. 정화를 느슨하게 푸는 대신 mermaid 쪽을 `<text>` 로 그리게 한다 —
 * 허용 목록을 여는 것은 F-18 을 약하게 만든다.
 *
 * ## 실패는 조용히 넘기지 않는다
 *
 * 문법이 틀리면 **원래 코드블록을 그대로 두고** 그 아래에 사유를 적는다. 빈 자리를
 * 남기면 사용자는 앱이 멈춘 줄 안다.
 *
 * `swUpdate.ts`·`editorOverlay.ts` 와 같은 주입형 리프다.
 */

/** mermaid 모듈 중 이 앱이 쓰는 부분만. 테스트가 가짜를 주기 쉬우라고 좁게 잡았다. */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  parse(text: string, options?: { suppressErrors?: boolean }): Promise<unknown>;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export interface MermaidViewHost {
  previewEl: HTMLElement;
  /** mermaid 를 가져온다. **여기가 지연 로드 경계다** — 필요할 때 처음 한 번만 부른다. */
  load: () => Promise<MermaidLike>;
  /** `parseMarkdown()` 과 같은 정화 함수를 넣는다. 경로를 둘로 만들지 않기 위해서다. */
  sanitize: (html: string) => string;
  /** 다크 모드인가. 테마가 바뀌면 다시 그린다. */
  isDark?: () => boolean;
  /** 다 그린 뒤. 그림 높이가 바뀌므로 스크롤 앵커(#114)를 무효화하는 데 쓴다. */
  onRendered?: () => void;
  notify?: (message: string, kind?: "info" | "error") => void;
}

export interface MermaidViewController {
  /** 프리뷰가 다시 그려진 뒤 호출한다. mermaid 블록이 없으면 아무 일도 하지 않는다. */
  render(): void;
  /** 지금까지 라이브러리를 내려받았는가. 테스트와 진단용. */
  isLoaded(): boolean;
}

const noopController: MermaidViewController = {
  render() {},
  isLoaded: () => false,
};

let initialized = false;

export function initMermaidView(host: MermaidViewHost): MermaidViewController {
  if (initialized) {
    console.warn("[mermaidView] 이미 초기화되어 재호출을 무시합니다.");
    return noopController;
  }

  try {
    const { previewEl } = host;

    /** 내용+테마 → 정화된 SVG. 같은 그림을 다시 그리지 않는다. */
    const cache = new Map<string, string>();
    let mermaidPromise: Promise<MermaidLike> | null = null;
    let loadedMermaid: MermaidLike | null = null;
    let appliedTheme: string | null = null;
    let idSeq = 0;

    function themeName(): string {
      return host.isDark?.() ? "dark" : "default";
    }

    async function ensureMermaid(): Promise<MermaidLike> {
      if (!mermaidPromise) mermaidPromise = host.load();
      const mermaid = await mermaidPromise;
      loadedMermaid = mermaid;

      const theme = themeName();
      if (appliedTheme !== theme) {
        mermaid.initialize({
          startOnLoad: false,
          // 라벨 안의 텍스트는 남이 쓴 문서에서 온다. mermaid 자체 방어선도 켠다.
          securityLevel: "strict",
          theme,
          // **DOMPurify 가 foreignObject 를 지운다** — HTML 라벨을 쓰면 글자가 사라진다.
          // 최상위와 다이어그램별 설정 **둘 다** 꺼야 한다(노드 라벨은 최상위 값을 본다).
          htmlLabels: false,
          flowchart: { htmlLabels: false, useMaxWidth: true },
          class: { htmlLabels: false },
        });
        appliedTheme = theme;
        // 테마가 바뀌면 예전 그림은 색이 맞지 않는다.
        cache.clear();
      }
      return mermaid;
    }

    function sourceOf(codeEl: Element): string {
      return codeEl.textContent ?? "";
    }

    function showError(pre: Element, message: string): void {
      const note = pre.ownerDocument.createElement("p");
      note.className = "mermaid-error";
      note.textContent = `다이어그램을 그리지 못했습니다: ${message}`;
      pre.after(note);
    }

    async function renderAll(): Promise<void> {
      const blocks = [...previewEl.querySelectorAll("pre > code.language-mermaid")];
      // **블록이 없으면 라이브러리를 부르지 않는다.** 지연 로드의 핵심이다.
      if (blocks.length === 0) return;

      let mermaid: MermaidLike;
      try {
        mermaid = await ensureMermaid();
      } catch (error) {
        // 오프라인에서 한 번도 받은 적이 없으면 여기로 온다. 코드블록은 그대로 남는다.
        host.notify?.(
          `다이어그램 기능을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      const theme = themeName();

      for (const codeEl of blocks) {
        const pre = codeEl.parentElement;
        // 이 실행이 시작된 뒤 본문이 바뀌었으면 이 블록은 이미 화면에서 떨어져
        // 나갔다. **비싼 렌더를 하지 않고 건너뛴다** — 낡은 문서를 그리느라
        // 새 문서가 늦어지면 안 된다.
        if (!pre || !pre.isConnected) continue;

        const source = sourceOf(codeEl);
        const key = `${theme}\n${source}`;
        let svg = cache.get(key);

        if (svg === undefined) {
          try {
            // 먼저 문법만 본다. `render()` 로 바로 가면 mermaid 가 실패 시
            // 문서에 오류 요소를 심는데, 그것까지 치우는 것보다 이쪽이 깔끔하다.
            await mermaid.parse(source);
            idSeq += 1;
            const result = await mermaid.render(`mermaid-${idSeq}`, source);
            // 그린 SVG 도 같은 정화를 통과한다 (F-18).
            svg = host.sanitize(result.svg);
            cache.set(key, svg);
          } catch (error) {
            showError(pre, error instanceof Error ? error.message : String(error));
            continue;
          }
        }

        // 여기에 다시 `isConnected` 를 두지 말 것. 떨어져 나간 노드의
        // `replaceWith()` 는 **아무 일도 하지 않는다** — 낡은 결과가 화면에 붙는
        // 경로가 애초에 없다. 한때 실행 토큰과 재확인을 함께 뒀지만 **어떤 테스트도
        // 있고 없음을 구별하지 못해** 지웠다.
        const figure = pre.ownerDocument.createElement("figure");
        figure.className = "mermaid-figure";
        figure.innerHTML = svg;
        pre.replaceWith(figure);
      }

      // 그림이 들어오면 프리뷰 높이가 바뀐다 — 스크롤 앵커를 다시 재야 한다(#114).
      host.onRendered?.();
    }

    const controller: MermaidViewController = {
      render() {
        void renderAll();
      },
      isLoaded: () => loadedMermaid !== null,
    };

    initialized = true;
    return controller;
  } catch (error) {
    console.warn("[mermaidView] 초기화 실패:", error);
    return noopController;
  }
}
