/// <reference types="vite/client" />

/**
 * #131: 빌드 시각에 `CHANGELOG.md` 와 `package.json` 버전을 넣어 주는 가상 모듈.
 * 구현은 `vite.config.ts` 의 `releaseNotesPlugin()`.
 */
declare module "virtual:release-notes" {
  /** `CHANGELOG.md` 원문. 파싱은 `src/releaseNotes.ts` 가 한다. */
  export const changelog: string;
  /** `package.json` 의 `version`. */
  export const version: string;
}
