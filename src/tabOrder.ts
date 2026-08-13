/**
 * F-34 탭 재정렬 계산 (이슈 #62).
 *
 * `tabs.ts` 는 `Map<string, TabState>` 로 탭을 들고 있고, `Map` 은 **삽입 순서를
 * 보존**한다. 그래서 재정렬은 "새 순서대로 Map 을 다시 만드는 것" 이고, 그
 * 순서 계산이 이 모듈이다. DOM 도 Map 도 만지지 않는 순수 함수라 경계 조건을
 * 전부 단위 테스트로 확인한다.
 */

/**
 * `from` 위치의 항목을 뽑아 `to` 위치에 끼워 넣은 **새 배열**을 돌려준다.
 *
 * 원본을 바꾸지 않는다 — `tabs.ts` 가 새 순서를 받아 Map 을 재구성하는데,
 * 중간에 예외가 나면 원본이 반쯤 뒤섞인 채 남는 것이 최악이다.
 *
 * 범위를 벗어난 인덱스는 **원본 그대로** 돌려준다. 드래그는 화면 밖·빈 영역
 * 에서도 끝날 수 있고, 그때 순서가 조용히 바뀌면 사용자는 이유를 모른다.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  if (to < 0 || to >= items.length) return [...items];
  if (from === to) return [...items];

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 한 칸 이동한 결과. 끝에서는 **더 가지 않는다**(순환하지 않는다).
 *
 * 순환하면 화살표를 누르던 사용자의 탭이 반대쪽 끝으로 튕겨 나간다 — 목록의
 * 끝에 도달했다는 사실 자체가 정보다.
 */
export function stepItem<T>(items: readonly T[], id: T, direction: number): T[] {
  const from = items.indexOf(id);
  if (from === -1) return [...items];
  const to = from + direction;
  if (to < 0 || to >= items.length) return [...items];
  return moveItem(items, from, to);
}

/**
 * 드래그가 끝난 지점을 삽입 위치로 바꾼다.
 *
 * 놓은 탭의 **어느 절반**에 떨어뜨렸는지로 앞/뒤를 가른다. 항상 앞에 넣으면
 * 마지막 자리로 옮길 방법이 없고, 항상 뒤에 넣으면 첫 자리로 옮길 수 없다.
 */
export function dropIndex(
  items: readonly string[],
  draggedId: string,
  targetId: string,
  insertAfter: boolean,
): number {
  const from = items.indexOf(draggedId);
  const target = items.indexOf(targetId);
  if (from === -1 || target === -1) return from;

  let to = insertAfter ? target + 1 : target;
  // 자기 자신을 지나쳐 뒤로 넣을 때는 제거로 인해 인덱스가 하나 당겨진다.
  if (from < to) to -= 1;
  return Math.min(Math.max(to, 0), items.length - 1);
}
