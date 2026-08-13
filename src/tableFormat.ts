/**
 * F-30 표 편집 보조 — 계산 (이슈 #82).
 *
 * ## 왜 "문자 수" 로 정렬하면 안 되는가
 *
 * 파이프를 맞추는 일은 각 칸의 **표시 폭**을 재는 일이다. 그런데 문자 수와 표시
 * 폭은 다르다 — 고정폭 글꼴에서 한글·한자·가나·이모지는 라틴 문자의 **두 칸**을
 * 차지한다. `"이름".length === 2` 지만 화면에서는 4칸이다. 문자 수로 맞추면
 * 한글이 섞인 표는 오히려 지금보다 더 어긋난다.
 *
 * 그래서 폭 계산을 이 모듈의 중심에 둔다:
 *
 * 1. **자소 단위로 끊는다** (`Intl.Segmenter`). 이모지 가족(👨‍👩‍👧)은 코드
 *    포인트가 5개지만 한 글자로 보이고 두 칸을 쓴다. 코드 포인트로 세면 6칸이
 *    된다.
 * 2. **자소 안의 어느 코드 포인트든 넓으면 그 자소는 2칸이다.** 변형 선택자나
 *    ZWJ 같은 폭 0 문자가 섞여도 결과가 흔들리지 않는다.
 * 3. **결합 문자는 0칸이다.** `e` + U+0301 은 한 칸이다.
 *
 * `Intl.Segmenter` 가 없는 환경에서는 코드 포인트 단위로 떨어지며, 이모지 가족만
 * 과대 계산된다 — 표가 조금 헐거워질 뿐 깨지지는 않는다.
 *
 * ## 순수 모듈
 *
 * DOM 을 만지지 않는다. 삽입은 `tableUi.ts` 가 `execCommand` 로 한다 — undo
 * 스택을 지키기 위해서다(트랩: `execCommand("insertText")` 외의 방법은 Cmd+Z 를
 * 망가뜨린다).
 */

export type ColumnAlign = "left" | "center" | "right";

export interface TableBlock {
  /** 표가 시작하는 줄 번호(0-based). */
  startLine: number;
  /** 표가 끝나는 줄 번호(0-based, 포함). */
  endLine: number;
  /** 헤더 행. */
  header: string[];
  /** 본문 행들. */
  body: string[][];
  /** 열별 정렬. 길이는 `header` 와 같다. */
  align: ColumnAlign[];
}

/* ------------------------------------------------------------------ 표시 폭 */

/**
 * 두 칸을 차지하는 코드 포인트 구간.
 *
 * East Asian Wide/Fullwidth + 흔히 쓰는 이모지 블록이다. 유니코드 표 전체를
 * 넣지 않은 것은 의도다 — 번들에 수 KB 의 표를 싣는 대신, **실제로 이 에디터에
 * 입력되는 문자**를 덮는다. 빠진 문자가 있으면 그 칸만 한 칸 좁게 잡히고, 표는
 * 여전히 유효한 마크다운이다.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // 한글 자모
  [0x2e80, 0x303e], // CJK 부수 · 한중일 기호
  [0x3041, 0x33ff], // 히라가나 · 가타카나 · 한글 호환 자모 · CJK 기호
  [0x3400, 0x4dbf], // CJK 확장 A
  [0x4e00, 0x9fff], // CJK 통합 한자
  [0xa000, 0xa4cf], // 이족 문자
  [0xa960, 0xa97f], // 한글 자모 확장 A
  [0xac00, 0xd7a3], // 한글 음절 — 한국어 문서의 대부분
  [0xf900, 0xfaff], // CJK 호환 한자
  [0xfe10, 0xfe19], // 세로쓰기 형태
  [0xfe30, 0xfe6f], // CJK 호환 형태
  [0xff00, 0xff60], // 전각 형태
  [0xffe0, 0xffe6], // 전각 기호
  [0x1f300, 0x1f64f], // 그림 기호 · 이모티콘
  [0x1f680, 0x1f6ff], // 교통 · 지도 기호
  [0x1f900, 0x1f9ff], // 보충 그림 기호
  [0x20000, 0x3fffd], // CJK 확장 B 이상
];

/** 폭 0 — 결합 문자, 폭 없는 공백, 변형 선택자, ZWJ. */
const ZERO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f],
];

function inRanges(
  code: number,
  ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
  return ranges.some(([lo, hi]) => code >= lo && code <= hi);
}

function codePointWidth(code: number): 0 | 1 | 2 {
  if (inRanges(code, ZERO_RANGES)) return 0;
  if (inRanges(code, WIDE_RANGES)) return 2;
  return 1;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemes(text: string): string[] {
  if (!segmenter) return [...text];
  return [...segmenter.segment(text)].map((s) => s.segment);
}

/**
 * 고정폭 글꼴에서 차지하는 칸 수.
 *
 * **`text.length` 를 쓰면 안 된다.** 한글 한 글자는 `length` 로 1 이지만 두 칸을
 * 차지하고, 이모지는 `length` 로 2 지만 역시 두 칸이다 — 두 방향으로 다 틀린다.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const cluster of graphemes(text)) {
    let clusterWidth = 0;
    for (const ch of cluster) {
      const w = codePointWidth(ch.codePointAt(0)!);
      // 자소 안에 넓은 코드 포인트가 하나라도 있으면 그 자소는 두 칸이다.
      if (w === 2) {
        clusterWidth = 2;
        break;
      }
      clusterWidth = Math.max(clusterWidth, w);
    }
    width += clusterWidth;
  }
  return width;
}

/** 목표 폭까지 공백을 채운다. 이미 넘치면 그대로 둔다(칸을 깨지 않는다). */
function pad(text: string, target: number, align: ColumnAlign): string {
  const gap = Math.max(0, target - displayWidth(text));
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

/* -------------------------------------------------------------------- 파싱 */

/**
 * 표 한 줄을 칸으로 나눈다.
 *
 * `\|` 는 칸 구분자가 아니라 **내용에 들어간 파이프**다. 이걸 구분자로 읽으면
 * 칸 수가 어긋나 표가 통째로 망가진다.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "\\|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);

  // 표 줄은 보통 `| a | b |` 라 앞뒤로 빈 칸이 하나씩 생긴다. 그것만 걷어낸다.
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();

  return cells.map((cell) => cell.trim());
}

/** `---` · `:---` · `:---:` · `---:` 인지. */
function parseDelimiterCell(cell: string): ColumnAlign | null {
  const trimmed = cell.trim();
  if (!/^:?-{1,}:?$/.test(trimmed)) return null;
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":") && trimmed.length > 1;
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "left";
}

/** 구분선 행이면 열별 정렬을, 아니면 null. */
export function parseDelimiterRow(line: string): ColumnAlign[] | null {
  if (!line.includes("|") || !line.includes("-")) return null;
  const cells = splitRow(line);
  const aligns = cells.map(parseDelimiterCell);
  if (aligns.some((a) => a === null)) return null;
  return aligns as ColumnAlign[];
}

/** 표 줄로 볼 수 있는가 — 파이프가 있고 빈 줄이 아니면. */
function isTableLine(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

/**
 * 커서가 놓인 줄을 포함하는 표를 찾는다. 없으면 null.
 *
 * **구분선이 없으면 표가 아니다.** 파이프만 있는 줄(예: 코드에서의 `a | b`)까지
 * 표로 잡으면 서식이 아닌 본문을 마음대로 고치게 된다.
 */
export function findTableAt(text: string, cursor: number): TableBlock | null {
  const lines = text.split("\n");

  // 커서가 몇 번째 줄인지
  let offset = 0;
  let cursorLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const end = offset + lines[i].length;
    if (cursor <= end) {
      cursorLine = i;
      break;
    }
    offset = end + 1;
    cursorLine = i + 1;
  }
  if (cursorLine >= lines.length) cursorLine = lines.length - 1;
  if (cursorLine < 0 || !lines.length) return null;

  if (!isTableLine(lines[cursorLine])) return null;

  let start = cursorLine;
  while (start > 0 && isTableLine(lines[start - 1])) start -= 1;
  let end = cursorLine;
  while (end < lines.length - 1 && isTableLine(lines[end + 1])) end += 1;

  // 두 번째 줄이 구분선이어야 표다.
  if (end - start < 1) return null;
  const align = parseDelimiterRow(lines[start + 1]);
  if (!align) return null;

  const header = splitRow(lines[start]);
  const body: string[][] = [];
  for (let i = start + 2; i <= end; i += 1) body.push(splitRow(lines[i]));

  // 칸 수는 헤더가 정한다 — 모자라면 빈 칸으로 채우고 넘치면 버리지 않고 둔다.
  const columns = Math.max(header.length, ...body.map((r) => r.length), align.length);
  const fill = (row: string[]): string[] =>
    Array.from({ length: columns }, (_, i) => row[i] ?? "");

  return {
    startLine: start,
    endLine: end,
    header: fill(header),
    body: body.map(fill),
    align: Array.from({ length: columns }, (_, i) => align[i] ?? "left"),
  };
}

/* ------------------------------------------------------------------- 렌더 */

function delimiterCell(align: ColumnAlign, width: number): string {
  const inner = Math.max(3, width);
  if (align === "center") return `:${"-".repeat(Math.max(1, inner - 2))}:`;
  if (align === "right") return `${"-".repeat(Math.max(2, inner - 1))}:`;
  return "-".repeat(inner);
}

/**
 * 표를 파이프가 맞은 마크다운으로 만든다.
 *
 * 정렬 방향(`align`)은 **구분선에만** 반영하고 칸 안의 내용은 항상 왼쪽으로
 * 붙인다 — 원문에서 오른쪽 정렬된 칸은 앞의 공백이 길어져, 편집할 때 커서를
 * 어디에 둬야 할지 알기 어렵다. 렌더 결과의 정렬은 구분선이 결정하므로 보이는
 * 표는 그대로다.
 */
export function formatTable(block: TableBlock): string {
  const rows = [block.header, ...block.body];
  const widths = block.align.map((_, col) =>
    Math.max(3, ...rows.map((row) => displayWidth(row[col] ?? ""))),
  );

  const line = (cells: string[]): string =>
    `| ${cells.map((cell, i) => pad(cell ?? "", widths[i], "left")).join(" | ")} |`;

  return [
    line(block.header),
    `| ${block.align.map((a, i) => delimiterCell(a, widths[i])).join(" | ")} |`,
    ...block.body.map(line),
  ].join("\n");
}

/** 빈 표를 만든다. 헤더 1행 + 본문 `rows` 행. */
export function buildTable(
  rows: number,
  columns: number,
  align: ColumnAlign = "left",
): string {
  const safeRows = Math.max(1, Math.min(50, Math.floor(rows)));
  const safeCols = Math.max(1, Math.min(20, Math.floor(columns)));

  return formatTable({
    startLine: 0,
    endLine: 0,
    header: Array.from({ length: safeCols }, (_, i) => `제목 ${i + 1}`),
    body: Array.from({ length: safeRows }, () =>
      Array.from({ length: safeCols }, () => ""),
    ),
    align: Array.from({ length: safeCols }, () => align),
  });
}

/** 열 정렬을 바꾼 새 블록. 원본은 건드리지 않는다. */
export function withAlignment(
  block: TableBlock,
  column: number,
  align: ColumnAlign,
): TableBlock {
  if (column < 0 || column >= block.align.length) return block;
  const next = [...block.align];
  next[column] = align;
  return { ...block, align: next };
}

/** 줄 번호 범위를 문자 오프셋 범위로. 표 교체에 쓴다. */
export function lineRangeToOffsets(
  text: string,
  startLine: number,
  endLine: number,
): { start: number; end: number } {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < startLine && i < lines.length; i += 1) {
    start += lines[i].length + 1;
  }
  let end = start;
  for (let i = startLine; i <= endLine && i < lines.length; i += 1) {
    end += lines[i].length + (i === endLine ? 0 : 1);
  }
  return { start, end };
}
