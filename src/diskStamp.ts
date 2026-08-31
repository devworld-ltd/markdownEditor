/**
 * F-88 파일 변경 감지 새로고침 — 순수 계산 (이슈 #187).
 *
 * 이 모듈은 브라우저 API 를 하나도 만지지 않는다. "디스크 기준값이 다른가",
 * "캐럿을 어디로 옮겨야 하는가" 처럼 **주어진 값만으로 답이 나오는 계산**만
 * 담는다 — 그래야 단위 테스트가 권한 3상태 × 더티 2상태 × 판정 4결과의 조합을
 * 평범한 객체만으로 전부 돌 수 있다(CLAUDE.md 트랩 #15, PRD N-3).
 *
 * 의존은 0. `fileReload.ts`(배선)만 이 모듈을 import 한다.
 */

/** 핸들로 연 파일의 디스크 기준값. `File.lastModified` + `File.size`. */
export interface DiskStamp {
  /** `File.lastModified` (epoch ms). */
  lastModified: number;
  /** `File.size` (bytes). */
  size: number;
}

export type StampVerdict =
  | "same" // 기준값이 동일 — 아무것도 하지 않는다
  | "changed" // 기준값이 다르다 — 내용 확인이 필요하다
  | "unknown"; // 기준값이 없다(핸들 없음·최초) — 판정하지 않는다

/** mtime + 크기만 비교한다(D-5 1단). 내용은 보지 않는다 — 매 신호마다 파일을 읽지 않기 위해서다. */
export function compareStamp(
  base: DiskStamp | null,
  current: DiskStamp | null,
): StampVerdict {
  if (!base || !current) return "unknown";
  if (base.lastModified === current.lastModified && base.size === current.size) {
    return "same";
  }
  return "changed";
}

/**
 * S-3: `compareStamp` 가 "changed" 일 때만 호출된다(D-5 2단).
 * 저장 도구가 mtime 만 건드리고 내용은 그대로인 흔한 경우를 걸러낸다.
 */
export function isRealChange(diskText: string, tabText: string): boolean {
  return diskText !== tabText;
}

/**
 * M-6·D-7: 새 길이에 맞춰 캐럿 오프셋을 클램프한다. 줄 기준이 아니라
 * **오프셋 기준 + 클램프**다 — 줄이 삽입·삭제되면 줄 기준은 더 크게 틀리면서
 * "맞춘 척"을 한다.
 */
export function clampCaret(offset: number, newLength: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  if (!Number.isFinite(newLength) || newLength < 0) return 0;
  return offset > newLength ? newLength : offset;
}

/**
 * M-6·D-7: 스크롤 위치를 새 콘텐츠 높이에 맞춰 클램프한다.
 *
 * 트랩 #18: `0/0 = NaN` 을 `scrollTop` 에 대입하면 브라우저가 조용히 0 으로
 * 클램프해 예외 없이 맨 위로 튄다 — 그래서 `!== 0` 이 아니라 **`> 0`** 으로
 * 비교해 NaN 을 걸러낸다(NaN > 0 은 항상 false).
 */
export function clampScroll(
  top: number,
  newScrollHeight: number,
  clientHeight: number,
): number {
  if (!(top > 0)) return 0;
  const maxScroll = newScrollHeight - clientHeight;
  if (!(maxScroll > 0)) return 0;
  return top > maxScroll ? maxScroll : top;
}
