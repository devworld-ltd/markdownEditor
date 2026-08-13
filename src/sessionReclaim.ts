/**
 * F-54 잔여 — 용량 초과 시 세션 공간 회수 (이슈 #84).
 *
 * ## 무엇을 버려도 되는가
 *
 * 이 기능은 **데이터 유실과 직결된다.** 그래서 규칙을 좁게 잡고 여기 한 곳에
 * 적어 둔다. 회수 대상은 다음을 **모두** 만족하는 탭뿐이다.
 *
 * | 조건 | 이유 |
 * |------|------|
 * | 더티가 아니다 | 미저장 편집분은 **여기에만** 있다. 버리면 영영 사라진다 |
 * | 활성 탭이 아니다 | 지금 보고 있는 문서를 건드리면 즉시 티가 난다 |
 * | 파일 이름이 있다 (`Untitled` 아님) | 디스크에 원본이 있어야 다시 열 수 있다 |
 * | 내용이 비어 있지 않다 | 이미 비어 있으면 회수해도 얻는 게 없다 |
 *
 * ## 회수해도 잃는 것이 없는 이유
 *
 * 회수는 **저장된 사본만** 비운다. 편집기에 떠 있는 내용은 그대로다 — 이번
 * 세션에서는 아무것도 달라지지 않고, 새로고침 뒤 복원되는 사본만 사라진다.
 * 그리고 그 사본은 조건상 **디스크 파일과 같은 내용**이므로 파일을 다시 열면
 * 되찾는다.
 *
 * ## 탭을 닫지 않는다
 *
 * 탭은 사용자가 열어 둔 것이다. 내용만 비우고 이름은 남겨, 복원 뒤에도 "이
 * 파일을 보고 있었다" 는 사실이 유지된다.
 *
 * ## "오래된" 대신 "큰" 것부터
 *
 * 요구사항은 오래된 탭이지만 **세션 스키마에 시각이 없다.** 넣으려면 스키마
 * 버전을 올려야 하고 그러면 기존 세션이 통째로 폐기된다(F-55) — 공간을 벌려다
 * 문서를 잃는 셈이다. 대신 **큰 것부터** 회수한다. 한 번에 가장 많이 벌어
 * **건드리는 탭 수가 최소**가 되므로, 목적(자동 저장 재개)에 더 곧게 닿는다.
 *
 * DOM 도 localStorage 도 만지지 않는 순수 모듈이다.
 */

import type { PersistedSession, PersistedTab } from "./storage";

/** 이름 없는 탭의 표시 이름. `tabs.ts` 의 `UNTITLED` 와 같은 값이다. */
const UNTITLED = "Untitled";

/** 이 탭의 내용을 버려도 되는가. 위 표의 네 조건 전부. */
export function isReclaimable(tab: PersistedTab, activeTabId: string): boolean {
  if (tab.isDirty) return false;
  if (tab.id === activeTabId) return false;
  if (tab.fileName === UNTITLED || tab.fileName.trim() === "") return false;
  return tab.content.length > 0;
}

/** 회수 후보를 **큰 것부터** 나열한다. */
export function reclaimCandidates(session: PersistedSession): PersistedTab[] {
  return session.tabs
    .filter((tab) => isReclaimable(tab, session.activeTabId))
    .sort((a, b) => b.content.length - a.content.length);
}

/**
 * 탭 하나의 내용을 비운 새 세션. **원본은 건드리지 않는다** — 저장이 끝내 실패하면
 * 아무 일도 없었던 것으로 되돌아가야 한다.
 */
export function reclaimTab(
  session: PersistedSession,
  tabId: string,
): PersistedSession {
  return {
    ...session,
    tabs: session.tabs.map((tab) =>
      tab.id === tabId
        ? // `reclaimed` 로 표시해 두면 복원 시 "왜 비었는지" 를 설명할 수 있다.
          // 빈 내용만 남기면 사용자는 문서가 사라진 줄 안다.
          { ...tab, content: "", isDirty: false, reclaimed: true }
        : tab,
    ),
  };
}

export interface ReclaimResult {
  saved: boolean;
  /** 내용을 비운 탭의 파일 이름. 순서대로. */
  reclaimed: string[];
}

/**
 * 저장을 시도하고, 실패하면 후보를 하나씩 비우며 다시 시도한다.
 *
 * `trySave` 는 성공 여부를 돌려주는 저장 함수다(테스트가 실패를 주입한다).
 * **후보를 다 써도 실패하면 아무것도 회수하지 않은 것으로 보고한다** — 공간을
 * 벌지도 못하면서 사본만 잃는 최악을 피한다.
 */
export function saveWithReclaim(
  session: PersistedSession,
  trySave: (session: PersistedSession) => boolean,
): ReclaimResult {
  if (trySave(session)) return { saved: true, reclaimed: [] };

  const candidates = reclaimCandidates(session);
  let current = session;
  const reclaimed: string[] = [];

  for (const candidate of candidates) {
    current = reclaimTab(current, candidate.id);
    reclaimed.push(candidate.fileName);
    if (trySave(current)) return { saved: true, reclaimed };
  }

  // 여기까지 왔다면 회수로는 해결되지 않는다. 마지막 시도의 부작용을 남기지
  // 않기 위해, 호출부가 원본 세션을 그대로 쓰도록 빈 목록을 돌려준다.
  return { saved: false, reclaimed: [] };
}

/** 회수 사실을 알리는 문구. 무엇을 어떻게 되찾는지까지 말한다. */
export function reclaimMessage(fileNames: string[]): string {
  const names = fileNames.join(", ");
  return `저장 공간이 부족해 ${names} 의 임시 사본을 비웠습니다. 편집 중인 내용은 그대로이며, 새로고침 후에는 파일에서 다시 열어주세요.`;
}

/** 복원 시 비어 있는 탭을 설명하는 문구. */
export function restoredEmptyMessage(fileNames: string[]): string {
  const names = fileNames.join(", ");
  return `저장 공간이 부족해 ${names} 의 내용은 복원하지 못했습니다. 파일에서 다시 열어주세요.`;
}
