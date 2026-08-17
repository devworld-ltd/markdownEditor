#!/usr/bin/env node
/**
 * 다음 버전을 계산하고 `package.json` + `CHANGELOG.md` 를 갱신한다 (이슈 #131).
 *
 * ## 왜 CI 가 아니라 사람(또는 승격 워크플로)이 돌리는가
 *
 * `main`·`dev` 에는 브랜치 보호가 걸려 있어 **CI 가 되밀어 push 할 수 없다.**
 * 그래서 버전 올리기와 CHANGELOG 작성은 **승격 PR 안에서** 끝나고, CI 는 머지된
 * 결과를 읽어 태그와 GitHub Release 를 만들기만 한다(그쪽은 push 가 아니다).
 *
 * ## 버전 규칙
 *
 * 마지막 태그 이후의 커밋 제목을 본다:
 *   - `BREAKING CHANGE` 또는 `feat!:` `fix!:` 같은 `!` → **major**
 *   - `feat:` → **minor**
 *   - 그 밖(`fix:` `perf:` `refactor:` …) → **patch**
 *   - `docs:` `chore:` `test:` `style:` 만 있으면 → **올리지 않는다**
 *
 * 마지막이 중요하다. 문서만 고친 배포까지 버전을 올리면 "새 소식" 이 빈 내용으로
 * 뜨고, 그 경험이 반복되면 사용자가 알림을 무시하게 된다.
 *
 * 사용법:
 *   node scripts/release.mjs            # 계산 + 파일 갱신
 *   node scripts/release.mjs --dry-run  # 계산 결과만 출력
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const PKG = resolve(ROOT, "package.json");
const CHANGELOG = resolve(ROOT, "CHANGELOG.md");
const DRY_RUN = process.argv.includes("--dry-run");

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * 태그 목록에서 **가장 높은 버전**을 고른다.
 *
 * `git describe` 를 쓰면 안 된다 — 그것은 **HEAD 의 조상**에 붙은 태그만 본다.
 * 이 저장소는 태그를 `main` 의 머지 커밋에 붙이고 릴리스 계산은 `dev` 에서 하므로,
 * 태그가 dev HEAD 의 조상이 아니다. 그래서 `describe` 는 **영영 아무것도 못 찾고**,
 * 그러면 전체 이력을 훑어 이미 릴리스된 것까지 CHANGELOG 에 다시 싣는다
 * (실측: v2.1.0 이 있는데도 "기준 태그: 없음 · 커밋 91건").
 *
 * 순수 함수로 분리한 이유는 **정렬이 틀리기 쉬워서**다 — 사전순이면
 * `v2.10.0 < v2.9.0` 이 되어 큰 갱신에서만 조용히 틀린다.
 */
export function pickLatestTag(tags) {
  const parsed = [];
  for (const raw of tags) {
    const t = String(raw ?? "").trim();
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(t);
    if (m) parsed.push({ tag: t, nums: [+m[1], +m[2], +m[3]] });
  }
  if (parsed.length === 0) return null;

  parsed.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a.nums[i] !== b.nums[i]) return b.nums[i] - a.nums[i];
    }
    return 0;
  });
  return parsed[0].tag;
}

/**
 * 버전 비교. 음수면 `a < b`.
 *
 * **자리별 숫자로 비교한다** — 사전순이면 `2.10.0 < 2.9.0` 이 되어 큰 갱신에서만
 * 조용히 틀린다.
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 가장 높은 `v*` 태그. 없으면 `null` — 첫 릴리스다. */
function lastTag() {
  // `--sort` 에 기대지 않고 직접 고른다 — git 버전에 따라 `v:refname` 지원이 다르다.
  return pickLatestTag(git("tag", "--list", "v*").split("\n"));
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const out = git("log", range, "--format=%s%n%b%n---COMMIT---");
  return out
    .split("---COMMIT---")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** 커밋 묶음 → `"major" | "minor" | "patch" | null`. */
export function decideBump(commits) {
  let bump = null;
  const rank = { patch: 1, minor: 2, major: 3 };

  for (const commit of commits) {
    const subject = commit.split("\n")[0] ?? "";
    const match = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
    if (!match) continue;

    const [, type, , bang] = match;
    let level;
    if (bang || /BREAKING[ -]CHANGE/.test(commit)) level = "major";
    else if (type === "feat") level = "minor";
    else if (["docs", "chore", "test", "style", "ci", "build"].includes(type)) continue;
    else level = "patch";

    if (!bump || rank[level] > rank[bump]) bump = level;
  }
  return bump;
}

export function nextVersion(current, bump) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** 커밋 제목에서 사람이 읽을 한 줄을 만든다. 타입 접두사와 꼬리 PR 번호를 뗀다. */
function describe(subject) {
  const body = subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "");
  const pr = /\(#(\d+)\)\s*$/.exec(body);
  const text = body.replace(/\s*\(#\d+\)\s*$/, "").trim();
  return pr ? `${text} (#${pr[1]})` : text;
}

function buildSection(version, commits) {
  const added = [];
  const fixed = [];
  const other = [];

  for (const commit of commits) {
    const subject = commit.split("\n")[0] ?? "";
    const match = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
    if (!match) continue;
    const type = match[1];
    if (["docs", "chore", "test", "style", "ci", "build"].includes(type)) continue;

    const line = `- ${describe(subject)}`;
    if (type === "feat") added.push(line);
    else if (type === "fix") fixed.push(line);
    else other.push(line);
  }

  // 날짜는 인자로 받지 않는다 — 릴리스 시각이 곧 오늘이다.
  const today = new Date().toISOString().slice(0, 10);
  const parts = [`## [${version}] - ${today}`, ""];
  if (added.length) parts.push("### 추가", ...added, "");
  if (fixed.length) parts.push("### 수정", ...fixed, "");
  if (other.length) parts.push("### 변경", ...other, "");
  return parts.join("\n").trimEnd() + "\n";
}

/**
 * 새 절을 **첫 버전 헤딩 바로 앞**에 끼운다.
 *
 * 파일 맨 앞에 붙이면 머리말(형식 설명)이 릴리스 노트 본문으로 딸려 들어가고,
 * 맨 뒤에 붙이면 최신이 맨 아래로 간다 — 파서는 순서를 그대로 믿는다.
 */
export function insertSection(changelog, section) {
  const index = changelog.search(/^##\s+\[?\d+\.\d+\.\d+/m);
  if (index < 0) return `${changelog.trimEnd()}\n\n${section}`;
  return `${changelog.slice(0, index)}${section}\n${changelog.slice(index)}`;
}

function main() {
  const pkg = JSON.parse(readFileSync(PKG, "utf-8"));
  const tag = lastTag();
  if (!tag) {
    console.log(
      "[release] 경고: `v*` 태그가 하나도 없습니다 — 전체 이력을 기준으로 계산합니다.\n" +
        "          이미 릴리스한 적이 있다면 `git fetch --tags` 후 다시 실행하세요.",
    );
  }
  /**
   * **기준 태그가 지금 버전보다 낮으면 태그를 덜 받아온 것이다.**
   *
   * 태그는 `main` 의 머지 커밋에 붙고 릴리스 계산은 `dev` 에서 하므로, 승격
   * 직후에 `git fetch --tags` 를 하지 않으면 로컬에 최신 태그가 없다. 그러면
   * **이미 릴리스한 항목이 CHANGELOG 에 다시 실린다**(실측: v2.5.0 이 있는데
   * 기준이 v2.4.0 으로 잡혀 5건이 두 번 나왔다). 조용히 틀리는 종류라 막는다.
   */
  if (tag && compareVersions(tag.replace(/^v/, ""), pkg.version) < 0) {
    console.error(
      `[release] 중단: 기준 태그(${tag})가 현재 버전(v${pkg.version})보다 낮습니다.\n` +
        "          태그를 덜 받아온 상태입니다 — `git fetch --tags` 후 다시 실행하세요.",
    );
    process.exitCode = 1;
    return;
  }

  const commits = commitsSince(tag);
  const bump = decideBump(commits);

  if (!bump) {
    console.log(
      `[release] 올릴 것이 없습니다 — ${tag ?? "최초"} 이후 사용자에게 보이는 변경이 없습니다.\n` +
        `          (docs·chore·test·style·ci·build 만 있으면 버전을 올리지 않습니다.)`,
    );
    return;
  }

  const version = nextVersion(pkg.version, bump);
  const section = buildSection(version, commits);

  console.log(`[release] ${pkg.version} → ${version} (${bump}), 기준 태그: ${tag ?? "없음"}`);
  console.log(`[release] 커밋 ${commits.length}건`);
  console.log("---");
  console.log(section);

  if (DRY_RUN) {
    console.log("[release] --dry-run — 파일을 고치지 않았습니다.");
    return;
  }

  pkg.version = version;
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
  writeFileSync(CHANGELOG, insertSection(readFileSync(CHANGELOG, "utf-8"), section), "utf-8");

  console.log(
    `[release] package.json · CHANGELOG.md 갱신 완료.\n` +
      `          문구를 다듬은 뒤 커밋하고, main 에 머지되면 CI 가 v${version} 태그와 릴리스를 만듭니다.`,
  );
}

// 테스트가 import 할 때는 실행하지 않는다.
if (process.argv[1] && process.argv[1].endsWith("release.mjs")) main();
