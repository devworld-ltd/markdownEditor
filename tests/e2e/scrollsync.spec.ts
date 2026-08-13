import { test, expect } from "@playwright/test";
import {
  buildProseDoc,
  getAnchorProximity,
  getScrollMetrics,
  setScrollTop,
  watchConsoleIssues,
} from "./fixtures";

/**
 * F-25(스크롤 동기화) + F-72(편집/프리뷰 시각 구분) — 이슈 #31.
 *
 * 기술 스펙 §10 이 확정한 시나리오(E1~E6)와 공통 테스트 데이터(DOC-A~D)를 그대로
 * 따른다. 신규 파일로 분리한 이유·판정 기준·주의점은 `tests/e2e/.devflow-hint.md`
 * 이슈 #31 절 참고.
 *
 * **판정 기준 경고**: 중간부 어긋남(E6, 균질 산문의 중간부 전반)은 PRD §3(b) 가
 * 명시적으로 수용한 한계다. "완전 일치"를 요구하지 않는다 — 정밀 일치는 양 끝
 * (scrollTop=0 / scrollHeight-clientHeight)에서만 요구한다.
 */

// DOC-A (균질 산문, §10.0): 300줄. 1행 마커-시작, 150행 마커-중간, 300행 마커-끝.
const DOC_A = buildProseDoc(300, { 1: "시작", 150: "중간", 300: "끝" });

// DOC-B (코드 블록 혼재, §10.0): 산문 40줄 → 마커-중간 → 200줄 코드 블록 → 산문 40줄 → 마커-끝.
function buildDocB(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 40; i++) {
    lines.push(`문단 ${i} — 스크롤 동기화 검증용 본문입니다.`);
  }
  lines.push("## 마커-중간");
  lines.push("```js");
  for (let i = 1; i <= 200; i++) {
    lines.push(`const 변수${i} = ${i};`);
  }
  lines.push("```");
  for (let i = 41; i <= 80; i++) {
    lines.push(`문단 ${i} — 스크롤 동기화 검증용 본문입니다.`);
  }
  lines.push("## 마커-끝");
  return lines.join("\n");
}
const DOC_B = buildDocB();

// DOC-C (짧은 문서, §10.0): 양쪽 스크롤 불가 (부정 케이스).
const DOC_C = "짧은 문서";

// DOC-D (한쪽만 스크롤, §10.0): 링크 참조 정의 200줄 — 렌더 결과가 비어 있다.
function buildDocD(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 200; i++) {
    lines.push(`[참조${i}]: https://example.com/aaaa`);
  }
  return lines.join("\n");
}
const DOC_D = buildDocD();

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
});

test.describe("F-72 편집/프리뷰 시각 구분", () => {
  // 이 절은 라이트 모드의 **구체적인 색값**을 단언한다. 기본값에 기대면 나중에
  // playwright.config 의 colorScheme 이 바뀔 때 F-57 다크 값을 받아 조용히
  // 깨진다. 여기서 명시해 두면 그 결합이 끊긴다.
  test.use({ colorScheme: "light" });

  test("E1: 편집 영역과 프리뷰 영역이 배경색·경계선으로 구분되고 색 토큰이 선언되어 있다", async ({
    page,
  }) => {
    const editorBg = await page
      .locator("#editor")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const previewBg = await page
      .locator("#preview")
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(editorBg).toBe("rgb(242, 242, 240)");
    expect(previewBg).toBe("rgb(255, 255, 255)");
    expect(editorBg).not.toBe(previewBg);

    // F-32 이후 경계선은 리사이저가 그린다 — #editor 에도 테두리를 두면
    // 1px 이 두 줄로 겹쳐 보인다. 경계는 한 곳에서만 그린다.
    const divider = await page.locator("#split-resizer").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: el.getBoundingClientRect().width, color: cs.backgroundColor };
    });
    expect(divider.width).toBeCloseTo(1, 0);
    expect(divider.color).toBe("rgb(200, 200, 200)");

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        editor: cs.getPropertyValue("--surface-editor").trim(),
        preview: cs.getPropertyValue("--surface-preview").trim(),
        border: cs.getPropertyValue("--border-split").trim(),
      };
    });
    expect(tokens.editor).toBe("#f2f2f0");
    expect(tokens.preview).toBe("#ffffff");
    expect(tokens.border).toBe("#c8c8c8");
  });

  test("E1 엣지: 너비 375px(720px 이하)에서는 가로 경계로 전환되지만 색 관계는 그대로다", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    const editor = await page.locator("#editor").evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
    }));
    const previewBg = await page
      .locator("#preview")
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    // 상하 분할에서는 리사이저가 가로 경계가 되고, 가로 경계는 세로보다 눈에
    // 덜 띄므로 2px 로 굵어진다.
    const divider = await page.locator("#split-resizer").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { height: rect.height, color: getComputedStyle(el).backgroundColor };
    });
    expect(divider.height).toBeCloseTo(2, 0);
    expect(divider.color).toBe("rgb(200, 200, 200)");
    // 위(입력)가 회색, 아래(결과)가 흰색이라는 색 관계는 유지된다.
    expect(editor.bg).toBe("rgb(242, 242, 240)");
    expect(previewBg).toBe("rgb(255, 255, 255)");
  });
});

test.describe("F-25 스크롤 동기화", () => {
  test("E2: 편집 영역을 스크롤하면 프리뷰가 따라오고 양 끝에서 정확히 일치한다", async ({
    page,
  }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_A);
    await page.waitForTimeout(400); // 150ms 디바운스 렌더 완료 대기

    const editorMetrics = await getScrollMetrics(page, "#editor");
    const midTop = Math.round((editorMetrics.scrollHeight - editorMetrics.clientHeight) / 2);

    // ① 중간까지 스크롤
    await setScrollTop(page, "#editor", midTop);
    await page.waitForTimeout(200);

    const midPreview = await getScrollMetrics(page, "#preview");
    expect(midPreview.scrollTop).toBeGreaterThan(0);
    const anchor = await getAnchorProximity(page, "#preview", "마커-중간");
    expect(anchor.visible).toBe(true);

    // ② 맨 아래까지 스크롤 — 끝점은 오차 2px 이내
    await setScrollTop(page, "#editor", editorMetrics.scrollHeight - editorMetrics.clientHeight);
    await page.waitForTimeout(200);
    const bottomPreview = await getScrollMetrics(page, "#preview");
    const bottomMax = bottomPreview.scrollHeight - bottomPreview.clientHeight;
    expect(Math.abs(bottomPreview.scrollTop - bottomMax)).toBeLessThanOrEqual(2);

    // ③ 맨 위로 복귀 — 정확히 0
    await setScrollTop(page, "#editor", 0);
    await page.waitForTimeout(200);
    const topPreview = await getScrollMetrics(page, "#preview");
    expect(topPreview.scrollTop).toBe(0);

    expect(issues.errors).toEqual([]);
  });

  test("E2 엣지: 짧은 문서(DOC-C)는 스크롤을 시도해도 양쪽 모두 0에 머물고 콘솔 오류가 없다", async ({
    page,
  }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_C);
    await page.waitForTimeout(400);

    await setScrollTop(page, "#editor", 500);
    await page.waitForTimeout(200);

    const editorMetrics = await getScrollMetrics(page, "#editor");
    const previewMetrics = await getScrollMetrics(page, "#preview");
    expect(editorMetrics.scrollTop).toBe(0);
    expect(previewMetrics.scrollTop).toBe(0);
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toEqual([]);
  });

  test("E3: 프리뷰를 스크롤하면 편집 영역이 따라오고(양방향), 멈추면 완전히 정지한다(루프 없음)", async ({
    page,
  }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_A);
    await page.waitForTimeout(400);

    // ① 편집 영역을 아래로
    const editorMetrics = await getScrollMetrics(page, "#editor");
    const editorMax = editorMetrics.scrollHeight - editorMetrics.clientHeight;
    await setScrollTop(page, "#editor", Math.round(editorMax * 0.6));
    await page.waitForTimeout(200);
    const afterEditorScroll = await getScrollMetrics(page, "#editor");

    // ② 이어서 프리뷰를 위로 — 편집 영역이 따라와 값이 작아진다
    const previewMetrics = await getScrollMetrics(page, "#preview");
    await setScrollTop(page, "#preview", Math.round(previewMetrics.scrollTop * 0.3));
    await page.waitForTimeout(200);
    const afterPreviewScroll = await getScrollMetrics(page, "#editor");
    expect(afterPreviewScroll.scrollTop).toBeLessThan(afterEditorScroll.scrollTop);

    // ③ 다시 편집 영역을 아래로 — 마지막 조작 쪽이 소스가 되어 프리뷰가 다시 커진다
    const beforeSecondEditorScroll = await getScrollMetrics(page, "#preview");
    await setScrollTop(page, "#editor", editorMax);
    await page.waitForTimeout(200);
    const afterSecondEditorScroll = await getScrollMetrics(page, "#preview");
    expect(afterSecondEditorScroll.scrollTop).toBeGreaterThan(beforeSecondEditorScroll.scrollTop);

    // ④ 1초간 대기 — 시작·종료 시점 값이 완전히 같아야 한다(진동 없음)
    const start = {
      editor: (await getScrollMetrics(page, "#editor")).scrollTop,
      preview: (await getScrollMetrics(page, "#preview")).scrollTop,
    };
    await page.waitForTimeout(1000);
    const end = {
      editor: (await getScrollMetrics(page, "#editor")).scrollTop,
      preview: (await getScrollMetrics(page, "#preview")).scrollTop,
    };
    expect(end).toEqual(start);

    expect(issues.errors).toEqual([]);
  });

  test("E3 엣지: 원문만 긴 문서(DOC-D)는 편집 영역만 정상 스크롤되고 프리뷰는 0에 머문다", async ({
    page,
  }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_D);
    await page.waitForTimeout(400);

    const editorMetrics = await getScrollMetrics(page, "#editor");
    expect(editorMetrics.scrollHeight - editorMetrics.clientHeight).toBeGreaterThan(0);

    await setScrollTop(page, "#editor", 300);
    await page.waitForTimeout(200);

    const afterEditor = await getScrollMetrics(page, "#editor");
    const afterPreview = await getScrollMetrics(page, "#preview");
    expect(afterEditor.scrollTop).toBe(300);
    expect(afterPreview.scrollTop).toBe(0);
    expect(issues.errors).toEqual([]);
  });

  test("E4: 탭을 전환해도 편집 위치가 보존되고 미리보기가 그 위치에 맞춰진다", async ({ page }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    // ① 탭 A 에 DOC-A 입력 후 중간까지 스크롤
    await editor.fill(DOC_A);
    await page.waitForTimeout(400);
    const editorMetrics = await getScrollMetrics(page, "#editor");
    const midTop = Math.round((editorMetrics.scrollHeight - editorMetrics.clientHeight) / 2);
    await setScrollTop(page, "#editor", midTop);
    await page.waitForTimeout(200);
    const leftAt = (await getScrollMetrics(page, "#editor")).scrollTop;

    // ② New 버튼으로 탭 B 를 만들고 짧은 글을 입력 (파일 목 의존 없음)
    await page.locator('.toolbar-btn[title="New"]').click();
    await editor.fill("# 두번째 탭");
    await page.waitForTimeout(400);

    // ③ 탭 A 로 되돌아온다
    await page.locator("#tab-bar .tab").first().click();
    await page.waitForTimeout(300);

    const restoredEditor = await getScrollMetrics(page, "#editor");
    expect(Math.abs(restoredEditor.scrollTop - leftAt)).toBeLessThanOrEqual(5); // F-06 무회귀

    const restoredPreview = await getScrollMetrics(page, "#preview");
    expect(restoredPreview.scrollTop).toBeGreaterThan(0); // 맨 위로 튀지 않았다 (M11)

    // ④ 추가로 500ms 더 대기해도 편집 영역 값이 유지된다 — 프리뷰가 소스가 되어
    //    에디터를 0 으로 되돌리는 일이 없다 (F-06/F-51 회귀 방지 핵심 단언)
    await page.waitForTimeout(500);
    const stillRestored = await getScrollMetrics(page, "#editor");
    expect(Math.abs(stillRestored.scrollTop - leftAt)).toBeLessThanOrEqual(5);

    expect(issues.errors).toEqual([]);
  });

  test("E5: 타이핑으로 미리보기가 다시 그려져도 스크롤 위치가 유지된다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); // §10.0: E5 만 375x812
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_A);
    await page.waitForTimeout(400);

    const editorMetrics = await getScrollMetrics(page, "#editor");
    const midTop = Math.round((editorMetrics.scrollHeight - editorMetrics.clientHeight) / 2);
    await setScrollTop(page, "#editor", midTop);
    await page.waitForTimeout(200);
    const beforeType = await getScrollMetrics(page, "#preview");
    expect(beforeType.scrollTop).toBeGreaterThan(0);

    // 편집 영역 끝에 한 글자 추가 — 렌더 디바운스 완료까지 대기.
    // `type()`/`press("End")` 대신 값을 직접 조작해 input 이벤트만 발화시킨다.
    // 키보드로 커서를 문서 끝(현재 스크롤 위치 밖)으로 이동시키면 브라우저가
    // 캐럿을 따라 자동 스크롤하는데, 이는 이 시나리오(M9: 재렌더 후 위치 유지)가
    // 검증하려는 것과 무관한 별개의 네이티브 동작이라 섞으면 안 된다.
    await editor.evaluate((el: HTMLTextAreaElement) => {
      el.value = el.value + ".";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(400);

    const afterType = await getScrollMetrics(page, "#preview");
    expect(afterType.scrollTop).not.toBe(0);
    expect(Math.abs(afterType.scrollTop - beforeType.scrollTop)).toBeLessThanOrEqual(
      afterType.clientHeight * 0.1,
    );
    expect(issues.errors).toEqual([]);
  });

  test("E5 엣지: 문서 전체를 삭제하면 오류 없이 양쪽 모두 맨 위로 돌아온다", async ({ page }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_A);
    await page.waitForTimeout(400);
    const editorMetrics = await getScrollMetrics(page, "#editor");
    await setScrollTop(page, "#editor", editorMetrics.scrollHeight - editorMetrics.clientHeight);
    await page.waitForTimeout(200);

    await editor.fill("");
    await page.waitForTimeout(400);

    const finalEditor = await getScrollMetrics(page, "#editor");
    const finalPreview = await getScrollMetrics(page, "#preview");
    expect(finalEditor.scrollTop).toBe(0);
    expect(finalPreview.scrollTop).toBe(0);
    expect(issues.errors).toEqual([]);
  });

  test("E6: 코드 블록이 긴 문서에서도 대응 대목이 화면 근처에 있다 (수용된 한계)", async ({
    page,
  }) => {
    const issues = watchConsoleIssues(page);
    const editor = page.locator("#editor");

    await editor.fill(DOC_B);
    await page.waitForTimeout(400);

    // '마커-중간'이 편집 영역 화면 세로 중앙에 오도록 스크롤한다.
    const target = await page.evaluate(() => {
      const el = document.querySelector("#editor") as HTMLTextAreaElement;
      const idx = el.value.indexOf("## 마커-중간");
      const before = el.value.slice(0, idx);
      const totalLines = el.value.split("\n").length;
      const lineIndex = before.split("\n").length - 1;
      const lineHeight = el.scrollHeight / totalLines;
      return Math.max(0, Math.round(lineIndex * lineHeight - el.clientHeight / 2));
    });
    await setScrollTop(page, "#editor", target);
    await page.waitForTimeout(200);

    const previewMetrics = await getScrollMetrics(page, "#preview");
    const anchor = await getAnchorProximity(page, "#preview", "마커-중간");

    // 완전 일치는 요구하지 않는다 — 보이거나, 한 화면(프리뷰 창 높이) 이내로 근접.
    const withinOneScreen = anchor.visible || anchor.distancePx <= previewMetrics.clientHeight;
    expect(withinOneScreen).toBe(true);

    expect(issues.errors).toEqual([]);
  });

  test("E6 엣지: 코드 블록 문서라도 맨 아래까지 스크롤하면 끝점은 2px 이내로 정확히 일치한다", async ({
    page,
  }) => {
    const editor = page.locator("#editor");
    await editor.fill(DOC_B);
    await page.waitForTimeout(400);

    const editorMetrics = await getScrollMetrics(page, "#editor");
    await setScrollTop(page, "#editor", editorMetrics.scrollHeight - editorMetrics.clientHeight);
    await page.waitForTimeout(200);

    const previewMetrics = await getScrollMetrics(page, "#preview");
    const bottomMax = previewMetrics.scrollHeight - previewMetrics.clientHeight;
    expect(Math.abs(previewMetrics.scrollTop - bottomMax)).toBeLessThanOrEqual(2);
  });
});
