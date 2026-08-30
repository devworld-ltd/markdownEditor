/**
 * F-88 파일 변경 감지 새로고침 — 감지·재읽기 배선 (이슈 #187).
 *
 * **주입형 배선 리프.** `diskStamp.ts`(순수) 만 import 한다. 파일 메타 읽기·
 * 권한 조회/요청·내용 읽기·탭 상태 갱신·알림·배너·대화상자는 전부 `ReloadHost`
 * 로 주입받는다 — 이 모듈 자신은 `FileSystemFileHandle` 을 직접 만지지 않고
 * `tabs.ts` 를 import 하지 않는다(D-1). 그래야 단위 테스트가 평범한 객체로
 * 권한 3상태 × 더티 2상태 × 판정 4결과 전 분기를 돌 수 있다(트랩 #15 / PRD N-3).
 *
 * **폴링 없음.** 이 모듈은 `setInterval`/`setTimeout` 을 단 한 줄도 쓰지 않는다
 * (M-2 / AC-13) — 확인은 사용자 신호(포커스 복귀·탭 전환·수동 클릭)에서만 일어난다.
 *
 * 핵심 위험은 하나다: **사용자가 편집 중인 글을 앱이 지우는 것.** 더티 탭은
 * 절대 자동으로 다시 읽지 않는다(M-4) — 조용한 경로(`checkAll`/`checkTab`)는
 * 더티 탭을 발견하면 배지·배너만 세우고 본문은 건드리지 않는다. 실제로 본문을
 * 바꾸는 것은 `reloadActive()` 뿐이고, 더티 탭에서는 그 안에서마저
 * `confirmReload()` 확인을 거친다.
 */

import { compareStamp, isRealChange, type DiskStamp } from "./diskStamp";

export type ReloadTrigger = "focus" | "tabSwitch" | "manual";

/** `tabs.ts` 를 import 하지 않기 위한 최소 뷰. */
export interface ReloadTabView {
  id: string;
  fileName: string;
  handle: FileSystemFileHandle | null;
  isDirty: boolean;
  diskStamp: DiskStamp | null;
}

export interface ReloadConfirmInfo {
  fileName: string;
  diskModifiedAt: number | null;
}

export type SaveConflictChoice = "cancel" | "reload" | "overwrite";

export interface ReloadHost {
  /** 핸들에서 메타만 읽는다. 실패(삭제·이동)는 null. */
  readStamp: (handle: FileSystemFileHandle) => Promise<DiskStamp | null>;
  /** 핸들에서 내용을 읽는다. 실패는 throw — 호출부가 E-1 로 처리한다. */
  readText: (handle: FileSystemFileHandle) => Promise<string>;
  /** 조용한 조회. 절대 권한 창을 띄우지 않는다 (M-7). */
  queryPermission: (
    handle: FileSystemFileHandle,
  ) => Promise<PermissionState | "unsupported">;
  /** 제스처 안에서만 호출된다 (M-8). */
  requestPermission: (handle: FileSystemFileHandle) => Promise<PermissionState>;

  getTabs: () => ReloadTabView[];
  getActiveTabId: () => string;
  /** 활성 탭이면 실시간 편집기 값을, 아니면 저장된 탭 내용을 준다. */
  getTabText: (tabId: string) => string;

  /** 재읽기 적용. 본문 교체 + isDirty=false + 기준값 갱신 + 프리뷰 재렌더까지 호출부 몫. */
  applyReload: (tabId: string, text: string, stamp: DiskStamp) => void;
  setStamp: (tabId: string, stamp: DiskStamp | null) => void;
  setChanged: (tabId: string, changed: boolean) => void;

  notify: (message: string, kind?: "info" | "error") => void;
  showBanner: (tabId: string, fileName: string) => void;
  hideBanner: (tabId?: string) => void;
  /** 재읽기 확인 대화상자. true = 다시 읽기. */
  confirmReload: (info: ReloadConfirmInfo) => Promise<boolean>;
  /** S-1 저장 충돌 대화상자. */
  confirmSaveConflict: (info: ReloadConfirmInfo) => Promise<SaveConflictChoice>;
  /** 모달이 열려 있는가 — E-11 (트랩 #57). 열려 있으면 조용한 경로는 배너를 미룬다. */
  isModalOpen: () => boolean;
}

export interface ReloadController {
  /** I-1: 창 포커스 복귀 / visible 전환. 핸들 있는 모든 탭을 조용히 확인. */
  checkAll(): Promise<void>;
  /** I-2: 탭 전환. 그 탭만. */
  checkTab(tabId: string): Promise<void>;
  /** I-3·I-4: 툴바 버튼 / Alt+R. 제스처 안이므로 권한을 물을 수 있다. */
  reloadActive(): Promise<void>;
  /** 배너 "내 내용 유지" 배선. */
  keepMine(): void;
  /** S-1: saveFile() 이 저장 직전에 부른다. false = 저장을 중단한다. */
  confirmBeforeSave(tabId: string): Promise<boolean>;
  /** 활성 탭이 재읽기 가능한 핸들을 가졌는가 — 툴바 버튼 활성화 판정용. */
  canReloadActive(): boolean;
}

function granted(state: PermissionState | "unsupported"): boolean {
  // "unsupported"(구형 Chromium)는 관대하게 허용한다 — handleStore.ts의
  // ensurePermission() 과 같은 원칙. 진짜 못 읽으면 readStamp/readText 가 실패한다.
  return state === "granted" || state === "unsupported";
}

export function initFileReload(host: ReloadHost): ReloadController {
  /** 배너가 지금 걸려 있는 탭. keepMine() 이 어느 탭을 닫을지 알아야 한다. */
  let bannerTabId: string | null = null;

  function findTab(tabId: string): ReloadTabView | undefined {
    return host.getTabs().find((t) => t.id === tabId);
  }

  function applyAndNotify(
    tabId: string,
    text: string,
    stamp: DiskStamp,
    fileName: string,
    silent: boolean,
  ): void {
    host.applyReload(tabId, text, stamp);
    host.setChanged(tabId, false);
    if (bannerTabId === tabId) {
      host.hideBanner(tabId);
      bannerTabId = null;
    }
    if (!silent) {
      host.notify(`"${fileName}" 를 디스크에서 다시 읽었습니다.`);
    }
  }

  /**
   * 조용한 경로(포커스 복귀·탭 전환) 공용 판정.
   *
   * 권한을 **요청하지 않는다**(M-7) — `queryPermission` 이 granted 가 아니면
   * 그 자리에서 조용히 물러난다.
   */
  async function checkQuiet(tabId: string): Promise<void> {
    const tab = findTab(tabId);
    if (!tab || !tab.handle) return; // M-9: 핸들 없으면 조용히 종료

    const permission = await host.queryPermission(tab.handle);
    if (!granted(permission)) return; // M-7 / AC-9 / E-2: 권한 창 절대 금지

    const stamp = await host.readStamp(tab.handle);
    if (!stamp) return; // M-10 / E-1: 조용한 경로에서는 알림 없이 종료, 탭 내용 무변경

    const verdict = compareStamp(tab.diskStamp, stamp);
    if (verdict !== "changed") return; // AC-12 1차 방어 ("same"/"unknown")

    let diskText: string;
    try {
      diskText = await host.readText(tab.handle);
    } catch {
      return; // 읽던 중 사라졌다 — 조용히 포기, 다음 신호에서 다시 시도
    }

    const tabText = host.getTabText(tabId);
    if (!isRealChange(diskText, tabText)) {
      // S-3: mtime 만 바뀌고 내용은 같다 — 기준값만 조용히 갱신한다.
      host.setStamp(tabId, stamp);
      return;
    }

    if (tab.isDirty) {
      // M-4: 본문은 절대 건드리지 않는다. 배지 + (활성 탭이면) 배너만.
      host.setChanged(tabId, true);
      if (tabId === host.getActiveTabId()) {
        if (host.isModalOpen()) return; // E-11: 모달이 닫힌 뒤 다음 신호에서 다시 시도
        bannerTabId = tabId;
        host.showBanner(tabId, tab.fileName);
      }
      return;
    }

    // 깨끗한 탭 — 즉시 자동 반영 (M-5 / AC-2)
    applyAndNotify(tabId, diskText, stamp, tab.fileName, false);
  }

  return {
    async checkAll() {
      // P-4: 병렬로 던지면 권한 창 경합·알림 폭주가 난다 — 직렬로 돈다.
      for (const tab of host.getTabs()) {
        if (!tab.handle) continue;
        await checkQuiet(tab.id);
      }
    },

    async checkTab(tabId) {
      await checkQuiet(tabId);
    },

    async reloadActive() {
      const activeId = host.getActiveTabId();
      const tab = findTab(activeId);
      if (!tab || !tab.handle) {
        host.notify("이 탭은 파일 핸들이 없어 다시 읽을 수 없습니다.", "error");
        return;
      }

      // I-3/I-4: 제스처 안이므로 필요하면 권한을 물을 수 있다 (M-8 / AC-10).
      let permission = await host.queryPermission(tab.handle);
      if (!granted(permission)) {
        permission = await host.requestPermission(tab.handle);
      }
      if (!granted(permission)) {
        host.notify("파일 접근 권한이 없습니다.", "error"); // E-3
        return;
      }

      const stamp = await host.readStamp(tab.handle);
      if (!stamp) {
        host.notify("파일을 찾을 수 없습니다. 다른 이름으로 저장하세요.", "error"); // E-1
        return;
      }

      let diskText: string;
      try {
        diskText = await host.readText(tab.handle);
      } catch {
        host.notify("파일을 찾을 수 없습니다. 다른 이름으로 저장하세요.", "error");
        return;
      }

      const tabText = host.getTabText(activeId);
      if (!isRealChange(diskText, tabText)) {
        host.setStamp(activeId, stamp);
        host.setChanged(activeId, false);
        if (bannerTabId === activeId) {
          host.hideBanner(activeId);
          bannerTabId = null;
        }
        host.notify("최신 상태입니다.");
        return;
      }

      if (tab.isDirty) {
        // I-8: 파괴적 동작 — 반드시 확인을 거친다. 기본 포커스는 취소(D-6, reloadUi.ts).
        const ok = await host.confirmReload({
          fileName: tab.fileName,
          diskModifiedAt: stamp.lastModified,
        });
        if (!ok) return; // E10 취소 — 배너·본문 그대로
      }

      applyAndNotify(activeId, diskText, stamp, tab.fileName, false);
    },

    keepMine() {
      // I-9/I-10: 배너만 닫는다. ⚠ 배지는 남는다 — 충돌은 해소되지 않았다.
      if (bannerTabId) {
        host.hideBanner(bannerTabId);
        bannerTabId = null;
      }
    },

    async confirmBeforeSave(tabId) {
      const tab = findTab(tabId);
      if (!tab || !tab.handle) return true;

      const permission = await host.queryPermission(tab.handle);
      if (!granted(permission)) return true; // 확인할 수 없으면 저장을 막지 않는다

      const stamp = await host.readStamp(tab.handle);
      if (!stamp) return true; // 사라졌으면 저장 시도 자체가 새 위치를 묻게 된다

      const verdict = compareStamp(tab.diskStamp, stamp);
      if (verdict !== "changed") return true;

      let diskText: string;
      try {
        diskText = await host.readText(tab.handle);
      } catch {
        return true;
      }

      const tabText = host.getTabText(tabId);
      if (!isRealChange(diskText, tabText)) return true; // S-3

      const choice = await host.confirmSaveConflict({
        fileName: tab.fileName,
        diskModifiedAt: stamp.lastModified,
      });

      if (choice === "cancel") return false; // AC-11: 디스크 보존, 아무 일도 없음
      if (choice === "reload") {
        // 저장을 취소하고 재읽기 흐름으로 합류한다 (경로 C → 경로 A).
        if (tab.isDirty) {
          const ok = await host.confirmReload({
            fileName: tab.fileName,
            diskModifiedAt: stamp.lastModified,
          });
          if (ok) applyAndNotify(tabId, diskText, stamp, tab.fileName, false);
        } else {
          applyAndNotify(tabId, diskText, stamp, tab.fileName, false);
        }
        return false;
      }
      return true; // "overwrite" — 저장을 계속 진행. E-6: 성공 후 호출부가 배지 해제
    },

    canReloadActive() {
      const tab = findTab(host.getActiveTabId());
      return !!tab?.handle;
    },
  };
}
