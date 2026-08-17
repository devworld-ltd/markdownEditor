/**
 * 표 미리보기 (이슈 #150).
 *
 * ## 왜 필요한가
 *
 * 표 대화상자는 행·열·정렬만 받고 **결과를 보여주지 않았다.** 넣어 보고 나서야
 * 모양을 알고, 아니면 지우고 다시 열었다. 넣기 전에 보이면 그 왕복이 사라진다.
 *
 * ## 마크다운을 만들지 않는다
 *
 * 미리보기는 **`<table>` 로 그린다** — 마크다운 문자열을 만들어 다시 파싱하면
 * 렌더 경로가 둘이 되고(트랩 #33 과 같은 성격), 파이프 정렬은 화면에서 아무
 * 의미도 없다. 세로줄은 브라우저가 맞춘다.
 *
 * 그래서 `displayWidth()` 는 여기서 쓰지 않는다 — **표시 폭 계산은 마크다운
 * 문자열을 만드는 `formatTable()` 의 일**이고, 그쪽은 그대로다.
 *
 * ## 셀 내용을 손질하지 않는다
 *
 * `tableFormat.splitRow()` 는 칸을 trim 하므로 **렌더용이 아니다**
 * (`markdownHighlight.ts` 가 같은 이유로 피한다). 여기서는 `TableBlock` 을
 * 그대로 받아 칸을 있는 그대로 넣는다.
 *
 * ## 정화가 필요 없는 유일한 경로
 *
 * 셀은 `textContent` 로만 넣는다. `innerHTML` 을 쓰기 시작하면 F-18 의 정화
 * 경로 밖에 두 번째 주입 지점이 생긴다.
 *
 * 순수 리프다 — 넘겨받은 컨테이너 밖을 만지지 않는다.
 */

import type { TableBlock } from "./tableFormat";

/** 비어 있는 칸에 보일 글자. 빈 칸이면 표의 격자가 무너져 보인다. */
const EMPTY_CELL = "";

/**
 * `containerEl` 안에 표 미리보기를 다시 그린다.
 *
 * 매번 통째로 갈아 끼운다 — 행·열이 함께 바뀌는 조작이라 부분 갱신이 더 어렵고,
 * 표는 최대 50×20 이라 다시 그리는 값이 싸다.
 */
export function renderTablePreview(containerEl: HTMLElement, block: TableBlock): void {
  const doc = containerEl.ownerDocument;
  containerEl.textContent = "";

  const table = doc.createElement("table");
  table.className = "table-preview-table";
  // 미리보기는 **그림**이다 — 스크린리더가 빈 격자를 읽어 봐야 얻는 것이 없고,
  // 대화상자의 입력값이 이미 같은 내용을 말한다.
  table.setAttribute("aria-hidden", "true");

  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  block.header.forEach((cell, i) => {
    const th = doc.createElement("th");
    th.textContent = cell || EMPTY_CELL;
    th.style.textAlign = block.align[i] ?? "left";
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  for (const row of block.body) {
    const tr = doc.createElement("tr");
    block.align.forEach((align, i) => {
      const td = doc.createElement("td");
      td.textContent = row[i] ?? EMPTY_CELL;
      td.style.textAlign = align;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  containerEl.appendChild(table);
}
