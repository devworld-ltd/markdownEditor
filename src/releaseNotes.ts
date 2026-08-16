/**
 * 릴리스 노트 — 계산부 (이슈 #131).
 *
 * `CHANGELOG.md` 한 파일이 **단일 출처**다. 앱의 "새 소식" 화면과 GitHub Release
 * 본문이 모두 여기서 나온다 — 두 곳에 따로 쓰면 반드시 한쪽이 낡는다.
 *
 * ## 파싱은 관대하게, 실패는 조용하게
 *
 * 이 모듈이 던지면 **앱이 뜨지 않는다.** 릴리스 노트는 편의 기능이므로, 형식이
 * 어긋난 절은 **그 절만 버리고** 나머지를 살린다(`storage.ts` 의 세션 복원과 같은 태도).
 *
 * ## 자동으로 띄우는 판단이 이 모듈의 핵심이다
 *
 * 갱신 뒤 처음 한 번만 보여야 한다. 매번 뜨면 광고가 되고, 한 번도 안 뜨면
 * F-69 알림이 여전히 "무엇이" 를 말하지 못한다. 그 경계를 `shouldAutoShow()` 가 쥔다.
 *
 * DOM 을 만지지 않는 순수 모듈이다.
 */

export interface ReleaseEntry {
  /** `2.1.0` — `v` 접두사는 붙이지 않는다. */
  version: string;
  /** `2026-08-16`. 없으면 빈 문자열. */
  date: string;
  /** 그 버전 절의 마크다운 본문 (헤딩 제외). */
  body: string;
}

/** `## [2.1.0] - 2026-08-16` 또는 `## 2.1.0 - 2026-08-16`. 날짜는 없어도 된다. */
const HEADING = /^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s*[-–—]\s*(\S+))?\s*$/;

/**
 * `CHANGELOG.md` 본문을 버전별로 자른다.
 *
 * **위에서 아래로 만난 순서를 그대로 지킨다** — 파일이 최신순으로 쓰이므로 그것이
 * 곧 최신순이다. 여기서 정렬하면 사람이 의도적으로 올려 둔 항목이 밀려난다.
 */
export function parseChangelog(markdown: string): ReleaseEntry[] {
  if (typeof markdown !== "string" || !markdown) return [];

  const lines = markdown.split("\n");
  const entries: ReleaseEntry[] = [];
  let current: { version: string; date: string; body: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    entries.push({
      version: current.version,
      date: current.date,
      body: current.body.join("\n").trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      current = { version: match[1], date: match[2] ?? "", body: [] };
      continue;
    }
    // 첫 버전 헤딩 앞의 머리말은 버린다 — 릴리스 노트가 아니다.
    if (current) current.body.push(line);
  }
  flush();

  return entries;
}

/** 가장 위 항목. 목록이 최신순이므로 이것이 최신이다. */
export function latestRelease(entries: readonly ReleaseEntry[]): ReleaseEntry | null {
  return entries.length > 0 ? entries[0] : null;
}

/** 그 버전의 항목. 없으면 `null`. */
export function findRelease(
  entries: readonly ReleaseEntry[],
  version: string,
): ReleaseEntry | null {
  return entries.find((entry) => entry.version === version) ?? null;
}

/**
 * 유의적 버전 비교. `a` 가 `b` 보다 크면 양수.
 *
 * **사전순 비교를 쓰면 안 된다** — `"2.10.0" < "2.9.0"` 이 되어 큰 갱신에서만
 * 조용히 틀린다. 숫자로 자리별로 본다. 형식이 어긋나면 `0`(같음)으로 본다.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] | null => {
    const core = String(v ?? "").trim().replace(/^v/, "").split("-")[0];
    const parts = core.split(".");
    if (parts.length !== 3) return null;
    const nums = parts.map((p) => Number(p));
    return nums.every((n) => Number.isInteger(n) && n >= 0) ? nums : null;
  };

  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;

  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * 갱신 뒤 새 소식을 **자동으로** 띄울 것인가.
 *
 * | `seen` | 뜻 | 결과 |
 * |--------|-----|------|
 * | `null` | 이 브라우저에서 처음 쓴다 | **띄우지 않는다** |
 * | 현재보다 낮음 | 갱신됐다 | **띄운다** |
 * | 현재와 같거나 높음 | 이미 봤다 | 띄우지 않는다 |
 *
 * **처음 온 사람에게는 띄우지 않는다.** 앱을 처음 열었는데 "새 소식" 이 뜨는 것은
 * 새 소식이 아니라 방해다 — 그 사람에게는 전부가 처음이다.
 */
export function shouldAutoShow(current: string, seen: string | null): boolean {
  if (!current) return false;
  if (seen === null || seen === undefined || seen === "") return false;
  return compareVersions(current, seen) > 0;
}
