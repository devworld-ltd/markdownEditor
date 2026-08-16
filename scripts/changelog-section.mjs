#!/usr/bin/env node
/**
 * `CHANGELOG.md` 에서 한 버전의 절만 잘라 stdout 으로 낸다 (이슈 #131).
 *
 * GitHub Release 본문이 여기서 나온다. 앱의 "새 소식" 과 **같은 파일**을 읽으므로
 * 두 곳이 갈라질 수 없다 — 그것이 이 스크립트가 존재하는 이유 전부다.
 *
 * 절을 찾지 못하면 **실패한다.** 빈 릴리스 노트는 없는 것보다 나쁘다.
 *
 * 사용법: node scripts/changelog-section.mjs 2.1.0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("사용법: node scripts/changelog-section.mjs <version>");
  process.exit(2);
}

const text = readFileSync(resolve(process.cwd(), "CHANGELOG.md"), "utf-8");
const lines = text.split("\n");
const heading = /^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/;

let collecting = false;
const out = [];
for (const line of lines) {
  const match = heading.exec(line);
  if (match) {
    if (collecting) break;
    collecting = match[1] === version;
    continue;
  }
  if (collecting) out.push(line);
}

const body = out.join("\n").trim();
if (!body) {
  console.error(
    `CHANGELOG.md 에 ${version} 절이 없거나 비어 있습니다. ` +
      `npm run release 로 절을 만든 뒤 다시 시도하세요.`,
  );
  process.exit(1);
}
console.log(body);
