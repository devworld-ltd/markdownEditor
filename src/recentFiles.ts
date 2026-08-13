/**
 * F-36 최근 파일 목록 — 계산부 (이슈 #64).
 *
 * **이 기능의 핵심 제약은 파일 핸들을 직렬화할 수 없다는 것이다**(트랩 #6).
 * 그래서 저장되는 것은 **이름과 시각뿐**이고, 새로고침 뒤에는 "이 문서를 열었던
 * 적이 있다" 는 사실만 남는다. 핸들은 같은 세션 동안만 메모리에 살아 있다.
 *
 * 그 한계를 숨기면 사용자는 목록을 눌렀는데 아무 일도 안 일어나는 것처럼 느낀다.
 * 그래서 항목마다 **지금 바로 열 수 있는지**를 함께 들고 다닌다.
 *
 * DOM 을 만지지 않는 순수 모듈이다.
 */

export interface RecentEntry {
  /** 파일명. 목록의 신원이기도 하다 — 같은 이름은 같은 항목으로 본다. */
  name: string;
  /** 마지막으로 연/저장한 시각 (epoch ms). 정렬과 표시에 쓴다. */
  at: number;
}

/** 목록 상한. 넘으면 오래된 것부터 버린다. */
export const RECENT_LIMIT = 10;

/**
 * 항목을 맨 앞에 넣는다. 같은 이름이 있으면 **옮긴다**(중복을 만들지 않는다).
 *
 * 이름으로 중복을 판정하는 이유: 핸들은 직렬화되지 않아 세션이 바뀌면 신원이
 * 없어진다. 경로까지 알면 좋겠지만 File System Access API 는 경로를 주지 않는다 —
 * 그래서 이름이 우리가 가진 전부다. 이 한계는 UI 문구로 함께 드러낸다.
 */
export function addRecent(
  list: readonly RecentEntry[],
  name: string,
  at: number,
  limit = RECENT_LIMIT,
): RecentEntry[] {
  const trimmed = name.trim();
  if (!trimmed) return [...list];

  const rest = list.filter((entry) => entry.name !== trimmed);
  return [{ name: trimmed, at }, ...rest].slice(0, Math.max(1, limit));
}

/** 목록에서 뺀다 (사용자가 지우거나, 열기에 실패했을 때). */
export function removeRecent(list: readonly RecentEntry[], name: string): RecentEntry[] {
  return list.filter((entry) => entry.name !== name);
}

/**
 * 저장된 값을 읽는다. **손상된 항목만 버리고 나머지는 살린다** —
 * 목록 하나가 깨졌다고 전부 잃을 이유가 없다(`storage.ts` 의 탭 복원과 같은 태도).
 */
export function parseRecent(raw: unknown, limit = RECENT_LIMIT): RecentEntry[] {
  if (!Array.isArray(raw)) return [];

  const entries: RecentEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name, at } = item as { name?: unknown; at?: unknown };
    if (typeof name !== "string" || !name.trim()) continue;
    entries.push({ name: name.trim(), at: typeof at === "number" && Number.isFinite(at) ? at : 0 });
  }

  // 같은 이름이 여러 번 들어 있으면 가장 최근 것만 남긴다.
  const seen = new Set<string>();
  return entries
    .sort((a, b) => b.at - a.at)
    .filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    })
    .slice(0, Math.max(1, limit));
}

/** "3분 전" 같은 상대 표기. 절대 시각은 파일명보다 덜 유용하다. */
export function formatRelativeTime(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return "오래 전";
}
