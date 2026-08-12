/**
 * localStorage 기반 세션 영속화.
 *
 * 브라우저에서는 탭 닫기·새로고침·크래시가 상시 발생하므로 편집 중인 문서를
 * 로컬에 자동 저장하고 재방문 시 복원한다. FileSystemFileHandle 은 직렬화할 수
 * 없고 재방문 시 권한도 초기화되므로 저장하지 않는다 — 복원된 탭은 항상
 * "이름은 알지만 핸들은 없는" 상태이며, 저장 시 다시 위치를 묻는다.
 */

const STORAGE_KEY = "markdown-editor:session:v1";
const SCHEMA_VERSION = 1;

export interface PersistedTab {
  id: string;
  fileName: string;
  content: string;
  isDirty: boolean;
}

export interface PersistedSession {
  version: number;
  activeTabId: string;
  tabs: PersistedTab[];
}

function storage(): Storage | null {
  try {
    // 시크릿 모드·정책 차단 환경에서는 접근 자체가 throw 한다.
    const s = window.localStorage;
    const probe = "__probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

export function saveSession(session: PersistedSession): boolean {
  const s = storage();
  if (!s) return false;

  try {
    s.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    // QuotaExceededError 등. 호출부가 사용자에게 알린다.
    return false;
  }
}

export function loadSession(): PersistedSession | null {
  const s = storage();
  if (!s) return null;

  const raw = s.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.tabs)) {
      return null;
    }
    // 손상된 항목은 조용히 버린다.
    const tabs = parsed.tabs.filter(
      (t): t is PersistedTab =>
        typeof t?.id === "string" &&
        typeof t?.fileName === "string" &&
        typeof t?.content === "string",
    );
    if (tabs.length === 0) return null;
    return { version: SCHEMA_VERSION, activeTabId: parsed.activeTabId, tabs };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  storage()?.removeItem(STORAGE_KEY);
}

export function createSession(
  tabs: PersistedTab[],
  activeTabId: string,
): PersistedSession {
  return { version: SCHEMA_VERSION, activeTabId, tabs };
}
