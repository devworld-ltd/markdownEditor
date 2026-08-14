/**
 * localStorage 기반 세션 영속화.
 *
 * 브라우저에서는 탭 닫기·새로고침·크래시가 상시 발생하므로 편집 중인 문서를
 * 로컬에 자동 저장하고 재방문 시 복원한다. FileSystemFileHandle 은 직렬화할 수
 * 없고 재방문 시 권한도 초기화되므로 저장하지 않는다 — 복원된 탭은 항상
 * "이름은 알지만 핸들은 없는" 상태이며, 저장 시 다시 위치를 묻는다.
 */

const STORAGE_KEY = "markdown-editor:session:v1";
/**
 * 레이아웃 설정은 **세션과 별도 키**다(F-32). 문서 세션은 손상 시 통째로 버리는
 * 정책인데, 그때 분할 비율까지 함께 날릴 이유가 없다. 반대로 비율이 깨져도
 * 문서는 멀쩡해야 한다.
 */
const LAYOUT_KEY = "markdown-editor:layout:v1";
/**
 * 최근 파일 목록(F-36)도 **별도 키**다. 문서 세션·레이아웃과 수명이 다르고,
 * 셋 중 하나가 깨져도 나머지는 살아야 한다.
 */
const RECENT_KEY = "markdown-editor:recent:v1";
const SCHEMA_VERSION = 1;

export interface PersistedTab {
  id: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  /**
   * 용량이 부족해 내용을 비운 탭(F-54 잔여). 복원 시 "왜 비었는지" 를 설명하는
   * 데 쓴다 — 빈 내용만 남기면 사용자는 문서가 사라진 줄 안다.
   *
   * 선택 필드라 **스키마 버전을 올리지 않는다.** 올리면 기존 세션이 통째로
   * 폐기되어(F-55), 공간을 벌려다 문서를 잃는다.
   */
  reclaimed?: boolean;
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
    // `reclaimed` 는 선택 필드다 — 예전 세션에는 없으므로 검증하지 않는다.
    if (tabs.length === 0) return null;
    return { version: SCHEMA_VERSION, activeTabId: parsed.activeTabId, tabs };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  storage()?.removeItem(STORAGE_KEY);
}

/** 레이아웃 설정 전체. 항목이 늘어도 키는 하나로 유지한다. */
interface StoredLayout {
  ratio?: unknown;
  mode?: unknown;
  fontId?: unknown;
  fontSize?: unknown;
  lineNumbers?: unknown;
  docStats?: unknown;
  editorHighlight?: unknown;
}

function readLayout(): StoredLayout {
  const s = storage();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s.getItem(LAYOUT_KEY) ?? "null") as unknown;
    // 배열도 typeof "object" 다. 객체가 아닌 값이 들어오면 통째로 무시한다.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as StoredLayout;
  } catch {
    return {};
  }
}

/**
 * 항목 하나만 바꿔 쓴다. 통째로 덮어쓰면 **다른 항목이 지워진다** — 비율을
 * 저장할 때 모드가 날아가는 식의 사고를 막는다.
 */
function writeLayout(patch: StoredLayout): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(LAYOUT_KEY, JSON.stringify({ ...readLayout(), ...patch }));
  } catch {
    // 용량 초과 등. 문서 저장과 달리 사용자에게 알릴 가치가 없다.
  }
}

/** 분할 비율을 읽는다. 없거나 손상되면 null — 호출부가 기본값을 정한다. */
export function loadSplitRatio(): number | null {
  const { ratio } = readLayout();
  // 타입 확인이 필요하다: JSON 은 파싱에 성공해도 값이 문자열·객체일 수 있고,
  // 그대로 흘려보내면 레이아웃 계산이 NaN 으로 무너진다.
  return typeof ratio === "number" ? ratio : null;
}

/** 분할 비율을 저장한다. 실패해도 조용히 넘어간다 — 레이아웃 설정은 문서가 아니다. */
export function saveSplitRatio(ratio: number): void {
  writeLayout({ ratio });
}

/** 뷰 모드를 읽는다 (F-33). 모르는 값은 null — 호출부가 기본값을 정한다. */
export function loadViewMode(): string | null {
  const { mode } = readLayout();
  return typeof mode === "string" ? mode : null;
}

/** 뷰 모드를 저장한다. */
export function saveViewMode(mode: string): void {
  writeLayout({ mode });
}

/** 편집 글꼴·크기를 읽는다 (F-35). 검증은 호출부(editorPrefs)가 한다. */
export function loadEditorPrefs(): { fontId?: unknown; fontSize?: unknown } {
  const { fontId, fontSize } = readLayout();
  return { fontId, fontSize };
}

/** 편집 글꼴·크기를 저장한다. */
export function saveEditorPrefs(prefs: { fontId: string; fontSize: number }): void {
  writeLayout(prefs);
}

/** 줄 번호 표시 여부 (F-24). */
export function loadLineNumbers(): boolean {
  return readLayout().lineNumbers === true;
}

export function saveLineNumbers(enabled: boolean): void {
  writeLayout({ lineNumbers: enabled });
}

/** 문서 통계 표시 여부 (F-29). 기본은 켜짐 — 방해되지 않는 한 줄이다. */
export function loadDocStats(): boolean {
  return readLayout().docStats !== false;
}

export function saveDocStats(enabled: boolean): void {
  writeLayout({ docStats: enabled });
}

/**
 * 편집 영역 하이라이팅 여부 (F-23 잔여). **기본은 꺼짐** — 정렬이 어긋날 수 있는
 * 환경(글꼴 폴백·확대)에서 사용자가 켠 적 없는 기능에 발목 잡히면 안 된다.
 */
export function loadEditorHighlight(): boolean {
  return readLayout().editorHighlight === true;
}

export function saveEditorHighlight(enabled: boolean): void {
  writeLayout({ editorHighlight: enabled });
}

/** 최근 파일 목록 원본을 읽는다 (F-36). 검증은 호출부(recentFiles)가 한다. */
export function loadRecentFilesRaw(): unknown {
  const s = storage();
  if (!s) return null;
  try {
    return JSON.parse(s.getItem(RECENT_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** 최근 파일 목록을 저장한다. **파일 내용은 절대 넣지 않는다** — 이름과 시각뿐이다. */
export function saveRecentFiles(list: Array<{ name: string; at: number }>): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 용량 초과 등. 문서 저장과 달리 사용자에게 알릴 가치가 없다.
  }
}

export function createSession(
  tabs: PersistedTab[],
  activeTabId: string,
): PersistedSession {
  return { version: SCHEMA_VERSION, activeTabId, tabs };
}
