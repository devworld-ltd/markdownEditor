import { describe, expect, it } from "vitest";

import {
  compareVersions,
  findRelease,
  latestRelease,
  parseChangelog,
  shouldAutoShow,
} from "../src/releaseNotes";

const SAMPLE = `# 변경 이력

머리말이다. 릴리스 노트가 아니다.

## [2.1.0] - 2026-08-16

### 추가
- 새 기능 (#125)

## [2.0.0] - 2026-08-12

### 변경
- 웹 앱으로 전환
`;

describe("parseChangelog", () => {
  it("버전별로 자르고 파일 순서를 그대로 지킨다", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((e) => e.version)).toEqual(["2.1.0", "2.0.0"]);
    expect(entries[0].date).toBe("2026-08-16");
    expect(entries[0].body).toContain("새 기능 (#125)");
  });

  it("첫 버전 헤딩 앞의 머리말은 버린다 — 릴리스 노트가 아니다", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries[0].body).not.toContain("머리말이다");
    expect(entries.some((e) => e.body.includes("머리말"))).toBe(false);
  });

  it("대괄호 없는 헤딩도 읽는다", () => {
    expect(parseChangelog("## 1.2.3 - 2026-01-01\n- 가").map((e) => e.version)).toEqual([
      "1.2.3",
    ]);
  });

  it("날짜가 없어도 읽는다", () => {
    const [entry] = parseChangelog("## [1.0.0]\n- 가");
    expect(entry.version).toBe("1.0.0");
    expect(entry.date).toBe("");
  });

  it("사전 릴리스 표기를 살린다", () => {
    expect(parseChangelog("## [1.0.0-rc.1] - 2026-01-01\n- 가")[0].version).toBe("1.0.0-rc.1");
  });

  it("버전 헤딩이 없으면 빈 목록 — 앱을 멈추지 않는다", () => {
    expect(parseChangelog("# 제목\n본문뿐")).toEqual([]);
  });

  it("빈 입력·잘못된 입력에도 던지지 않는다", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog(null as unknown as string)).toEqual([]);
  });
});

describe("latestRelease · findRelease", () => {
  it("맨 위 항목이 최신이다", () => {
    expect(latestRelease(parseChangelog(SAMPLE))?.version).toBe("2.1.0");
  });

  it("비었으면 null", () => {
    expect(latestRelease([])).toBeNull();
  });

  it("버전으로 찾는다", () => {
    const entries = parseChangelog(SAMPLE);
    expect(findRelease(entries, "2.0.0")?.body).toContain("웹 앱으로 전환");
    expect(findRelease(entries, "9.9.9")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("자리별 숫자로 본다", () => {
    expect(compareVersions("2.1.0", "2.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "2.0.1")).toBeLessThan(0);
    expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
  });

  it("두 자리 이상도 맞다 — 사전순이면 2.10.0 < 2.9.0 이 되어 큰 갱신에서만 틀린다", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
    expect(compareVersions("10.0.0", "9.99.99")).toBeGreaterThan(0);
  });

  it("v 접두사와 사전 릴리스 꼬리를 무시한다", () => {
    expect(compareVersions("v2.1.0", "2.1.0")).toBe(0);
    expect(compareVersions("2.1.0-rc.1", "2.1.0")).toBe(0);
  });

  it("형식이 어긋나면 같음으로 본다 — 추측해서 띄우지 않는다", () => {
    expect(compareVersions("이상함", "2.0.0")).toBe(0);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("", "")).toBe(0);
  });
});

describe("shouldAutoShow", () => {
  it("갱신됐으면 띄운다", () => {
    expect(shouldAutoShow("2.1.0", "2.0.0")).toBe(true);
  });

  it("이미 본 버전이면 띄우지 않는다", () => {
    expect(shouldAutoShow("2.1.0", "2.1.0")).toBe(false);
  });

  it("처음 온 사람에게는 띄우지 않는다 — 그 사람에게는 전부가 처음이다", () => {
    expect(shouldAutoShow("2.1.0", null)).toBe(false);
    expect(shouldAutoShow("2.1.0", "")).toBe(false);
  });

  it("기록이 현재보다 높아도(되돌린 배포) 띄우지 않는다", () => {
    expect(shouldAutoShow("2.0.0", "2.1.0")).toBe(false);
  });

  it("현재 버전을 모르면 띄우지 않는다", () => {
    expect(shouldAutoShow("", "2.0.0")).toBe(false);
  });
});
