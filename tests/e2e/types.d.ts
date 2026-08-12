/** E2E 테스트에서 주입하는 File System Access 목의 전역 타입 선언. */
interface E2EFsMock {
  openName: string;
  saveName: string;
  contents: Record<string, string>;
  writes: Array<{ name: string; content: string }>;
  cancel: boolean;
  failWrite: boolean;
}

/** F-69 서비스 워커 업데이트 플랫폼 스텁의 테스트 제어 핸들 (`installSwUpdateStub` 참고). */
interface E2ESwStub {
  triggerUpdateFound(): void;
  triggerControllerChange(): void;
  getWaitingPostMessageCalls(): unknown[];
}

interface Window {
  __fsMock?: E2EFsMock;
  __swStub?: E2ESwStub;
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>;
}
