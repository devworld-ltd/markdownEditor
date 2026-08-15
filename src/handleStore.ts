/**
 * 파일 핸들 보관소 (이슈 #125, F-36 잔여).
 *
 * ## 왜 IndexedDB 인가
 *
 * `FileSystemFileHandle` 은 **JSON 으로 직렬화되지 않는다** — 그래서 세션 저장
 * (localStorage)에는 넣을 수 없고, F-36 은 지금까지 이름과 시각만 저장했다.
 * 그 결과 새로고침 뒤에는 목록을 눌러도 파일 선택 창이 떴다.
 *
 * **IndexedDB 는 구조화 복제(structured clone)를 쓰므로 핸들을 그대로 보관한다.**
 * "직렬화가 안 된다" 와 "IndexedDB 에 못 넣는다" 는 다른 이야기다 — 이 구분이
 * 이 모듈이 존재하는 이유 전부다.
 *
 * ## 권한은 자동으로 복원되지 않는다
 *
 * 핸들을 되찾아도 **권한은 별개**다. 새 세션에서 `getFile()` 을 바로 부르면
 * `NotAllowedError` 가 난다. 권한 요청은 **사용자 제스처 안에서만** 통과하므로,
 * 이 모듈의 `recallHandle()` 은 반드시 **클릭 핸들러에서** 불러야 한다.
 *
 * 자동 복원(앱 기동 시 조용히 권한 요청)은 **하지 않는다.** 사용자가 아무것도
 * 누르지 않았는데 권한 창이 뜨면 그건 앱이 아니라 침입이다.
 *
 * ## 여기 문서 내용을 넣지 말 것
 *
 * 보관하는 것은 **핸들뿐**이다. 내용을 넣으면 세션 저장과 용량을 다투게 되고,
 * 그러면 자동 저장이 먼저 죽는다(트랩 #41 과 같은 이유).
 *
 * `fileOps.ts` 와 같은 **플랫폼 API 주입** 패턴이다 — IndexedDB 와 권한 API 만
 * 경계로 빼서, 정작 검증할 값어치가 있는 **권한 판단 로직**을 테스트가 볼 수 있게 한다.
 */

/** 이 앱이 쓰는 권한 API 부분만. 표준 타입에 아직 없는 브라우저가 있다. */
type PermissionMode = { mode: "read" | "readwrite" };
type HandleWithPermission = FileSystemFileHandle & {
  queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
};

export interface HandleStoreHost {
  /** IndexedDB 를 쓸 수 있는가. 사생활 보호 모드에서 막히는 브라우저가 있다. */
  isSupported: () => boolean;
  /** 이름 → 핸들. 없으면 `null`. */
  read: (name: string) => Promise<FileSystemFileHandle | null>;
  write: (name: string, handle: FileSystemFileHandle) => Promise<void>;
  erase: (name: string) => Promise<void>;
  /** 보관 중인 이름 전부. 목록의 상태 표시에 쓴다. */
  names: () => Promise<string[]>;
}

const DB_NAME = "markdown-editor-handles";
const DB_VERSION = 1;
const STORE = "handles";

/** IndexedDB 요청을 Promise 로. 실패는 삼키지 않고 그대로 올린다. */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 한 번의 트랜잭션. 끝나면 연결을 닫는다 — 오래 잡고 있을 이유가 없다. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await toPromise(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

function defaultHost(): HandleStoreHost {
  return {
    isSupported: () => typeof indexedDB !== "undefined" && indexedDB !== null,
    read: async (name) =>
      (await withStore<unknown>("readonly", (store) => store.get(name))) as
        | FileSystemFileHandle
        | null,
    write: async (name, handle) => {
      await withStore("readwrite", (store) => store.put(handle, name));
    },
    erase: async (name) => {
      await withStore("readwrite", (store) => store.delete(name));
    },
    names: async () => {
      const keys = await withStore<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
      return keys.filter((key): key is string => typeof key === "string");
    },
  };
}

let host: HandleStoreHost = defaultHost();

/**
 * 테스트 전용 주입 지점. 프로덕션(`main.ts`)은 부르지 않으므로 기본 `host` 는
 * 항상 실제 IndexedDB 다. 인자를 생략하면 되돌린다(테스트 간 누수 방지).
 */
export function setHandleStoreHost(partial?: Partial<HandleStoreHost>): void {
  host = { ...defaultHost(), ...partial };
}

export function isHandleStoreSupported(): boolean {
  try {
    return host.isSupported();
  } catch {
    return false;
  }
}

/**
 * 이 핸들을 다음 세션에서도 쓸 수 있게 보관한다.
 *
 * **실패해도 조용히 넘어간다.** 보관은 편의 기능이고, 여기서 예외를 올리면
 * 파일을 여는 것 자체가 실패한다 — 훨씬 나쁜 일이다.
 */
export async function rememberHandle(
  name: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || !isHandleStoreSupported()) return;
  try {
    await host.write(trimmed, handle);
  } catch {
    // 보관 실패가 파일 열기·저장을 망치면 안 된다.
  }
}

/** 목록에서 지운 항목의 핸들도 함께 버린다. 목록에 없는 핸들은 쓸 데가 없다. */
export async function forgetHandle(name: string): Promise<void> {
  if (!isHandleStoreSupported()) return;
  try {
    await host.erase(name.trim());
  } catch {
    // 지우기 실패는 다음 기회에 정리된다.
  }
}

/** 보관 중인 이름 전부. 목록이 "바로 열 수 있음" 을 표시하는 데 쓴다. */
export async function storedNames(): Promise<string[]> {
  if (!isHandleStoreSupported()) return [];
  try {
    return await host.names();
  } catch {
    return [];
  }
}

/** `recallHandle()` 의 결과. 호출부가 세 갈래를 **구분해서** 안내해야 한다. */
export type RecallResult =
  | { status: "ok"; handle: FileSystemFileHandle }
  /** 보관된 핸들이 없다 — 이 브라우저에서 연 적이 없거나 정리됐다. */
  | { status: "missing" }
  /** 사용자가 권한을 주지 않았다. 파일 선택 창으로 되돌아간다. */
  | { status: "denied" };

/**
 * 권한을 확인한다. **이미 있으면 묻지 않는다** — 매번 물으면 사용자가 목록을 안 쓴다.
 *
 * `queryPermission` 이 없는 브라우저(구형 Chromium)에서는 곧바로 요청으로 간다.
 * 그것도 없으면 권한 개념이 없는 구현이므로 **통과시킨다** — 진짜로 못 읽으면
 * `getFile()` 이 실패하고 호출부가 그것을 잡는다.
 */
async function ensurePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const withPerm = handle as HandleWithPermission;
  const options: PermissionMode = { mode: "readwrite" };

  try {
    if (typeof withPerm.queryPermission === "function") {
      if ((await withPerm.queryPermission(options)) === "granted") return true;
    }
    if (typeof withPerm.requestPermission !== "function") return true;
    return (await withPerm.requestPermission(options)) === "granted";
  } catch {
    // 권한 API 가 예외를 던지면 열어 보게 둔다 — 실패는 여는 쪽에서 드러난다.
    return true;
  }
}

/**
 * 보관된 핸들을 되찾는다. **반드시 사용자 제스처(클릭) 안에서 호출한다** —
 * 권한 요청이 제스처 밖에서는 조용히 거부된다.
 */
export async function recallHandle(name: string): Promise<RecallResult> {
  if (!isHandleStoreSupported()) return { status: "missing" };

  let handle: FileSystemFileHandle | null = null;
  try {
    handle = await host.read(name.trim());
  } catch {
    return { status: "missing" };
  }
  if (!handle) return { status: "missing" };

  return (await ensurePermission(handle)) ? { status: "ok", handle } : { status: "denied" };
}
