import { describe, expect, it } from "vitest";

// @ts-expect-error — 스크립트는 .mjs 라 타입 선언이 없다. 검증 대상은 순수 함수뿐이다.
import { decideBump, insertSection, nextVersion, pickLatestTag } from "../scripts/release.mjs";

/**
 * #131 버전 계산.
 *
 * 이 규칙이 틀리면 **버전이 조용히 잘못 올라간다** — 배포는 성공하고 테스트도
 * 통과하므로, 태그를 보고 나서야 드러난다.
 */

describe("decideBump", () => {
  it("feat 이 있으면 minor", () => {
    expect(decideBump(["feat: 새 기능", "fix: 버그"])).toBe("minor");
  });

  it("fix 만 있으면 patch", () => {
    expect(decideBump(["fix: 버그", "refactor: 정리"])).toBe("patch");
  });

  it("`!` 는 major — feat 보다 세다", () => {
    expect(decideBump(["feat: 기능", "fix!: 계약 변경"])).toBe("major");
  });

  it("본문의 BREAKING CHANGE 도 major", () => {
    expect(decideBump(["fix: 뭔가\n\nBREAKING CHANGE: 저장 형식이 바뀐다"])).toBe("major");
  });

  it("문서·잡무만 있으면 올리지 않는다 — 빈 새 소식이 뜨면 알림을 무시하게 된다", () => {
    expect(decideBump(["docs: 문서", "chore: 정리", "test: 추가", "ci: 워크플로"])).toBeNull();
  });

  it("규약을 벗어난 커밋은 세지 않는다", () => {
    expect(decideBump(["아무 말", "Merge branch 'dev'"])).toBeNull();
  });

  it("스코프가 붙어도 읽는다", () => {
    expect(decideBump(["feat(editor): 기능"])).toBe("minor");
    expect(decideBump(["docs(readme): 갱신"])).toBeNull();
  });

  it("커밋이 없으면 null", () => {
    expect(decideBump([])).toBeNull();
  });
});

describe("nextVersion", () => {
  it("자리별로 올리고 아래를 0 으로 되돌린다", () => {
    expect(nextVersion("2.1.3", "major")).toBe("3.0.0");
    expect(nextVersion("2.1.3", "minor")).toBe("2.2.0");
    expect(nextVersion("2.1.3", "patch")).toBe("2.1.4");
  });

  it("두 자리 이상도 맞다", () => {
    expect(nextVersion("2.9.0", "minor")).toBe("2.10.0");
  });
});

describe("insertSection", () => {
  const CHANGELOG = `# 변경 이력

머리말이다.

## [2.0.0] - 2026-08-12

- 예전 내용
`;

  it("첫 버전 헤딩 앞에 끼운다 — 머리말이 릴리스 본문으로 딸려 들어가면 안 된다", () => {
    const out = insertSection(CHANGELOG, "## [2.1.0] - 2026-08-16\n\n- 새 내용\n");
    expect(out.indexOf("2.1.0")).toBeGreaterThan(out.indexOf("머리말"));
    expect(out.indexOf("2.1.0")).toBeLessThan(out.indexOf("2.0.0"));
  });

  it("기존 내용을 지우지 않는다", () => {
    const out = insertSection(CHANGELOG, "## [2.1.0]\n- 가\n");
    expect(out).toContain("예전 내용");
    expect(out).toContain("머리말");
  });

  it("버전 헤딩이 하나도 없으면 뒤에 붙인다", () => {
    const out = insertSection("# 변경 이력\n\n아직 없음\n", "## [1.0.0]\n- 첫 릴리스\n");
    expect(out).toContain("1.0.0");
    expect(out.indexOf("아직 없음")).toBeLessThan(out.indexOf("1.0.0"));
  });
});


describe("pickLatestTag", () => {
  it("가장 높은 버전을 고른다", () => {
    expect(pickLatestTag(["v1.0.0", "v2.1.0", "v2.0.5"])).toBe("v2.1.0");
  });

  it("두 자리 이상도 맞다 — 사전순이면 v2.10.0 < v2.9.0 이 되어 큰 갱신에서만 틀린다", () => {
    expect(pickLatestTag(["v2.9.0", "v2.10.0"])).toBe("v2.10.0");
    expect(pickLatestTag(["v9.0.0", "v10.0.0"])).toBe("v10.0.0");
  });

  it("`v` 없는 태그·쓰레기 값은 무시한다", () => {
    expect(pickLatestTag(["2.0.0", "release-1", "v1.2.3", ""])).toBe("v1.2.3");
  });

  it("사전 릴리스 태그는 고르지 않는다 — 릴리스 기준점이 아니다", () => {
    expect(pickLatestTag(["v1.0.0", "v2.0.0-rc.1"])).toBe("v1.0.0");
  });

  it("태그가 없으면 null — 첫 릴리스", () => {
    expect(pickLatestTag([])).toBeNull();
    expect(pickLatestTag(["", "  "])).toBeNull();
  });

  it("공백이 섞여도 읽는다 (git 출력 그대로)", () => {
    expect(pickLatestTag([" v1.0.0 ", "v0.9.0"])).toBe("v1.0.0");
  });
});
