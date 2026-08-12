/** E2E 테스트에서 주입하는 File System Access 목의 전역 타입 선언. */
interface E2EFsMock {
  openName: string;
  saveName: string;
  contents: Record<string, string>;
  writes: Array<{ name: string; content: string }>;
  cancel: boolean;
  failWrite: boolean;
}

interface Window {
  __fsMock?: E2EFsMock;
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>;
}
