<!-- e2e-agent:generated source=195/E4 do-not-edit-above — 편집 시 이 줄 삭제 -->
<!--
  러너 중립 자연어 E2E 시나리오 (이슈 #239).
  - browser-use 전용 문법(액션 DSL / page.click / CSS 셀렉터 코드) 금지. 순수 자연어만.
  - 구독형 러너(claude/gpt/gemini) · 로컬 LLM(browser-use) · 향후 러너 · 사람이 공통 소비한다.
  - {base_url} 은 러너가 실행 시점에 치환하는 런타임 placeholder (그대로 남긴다).
  - 자격증명은 e2e_user / e2e_pass sensitive_data placeholder 로만 참조 — 평문 금지.
-->
# E2E 시나리오: 위험하거나 열 수 없는 주소를 거절한다 — 요청 0건 (E4, AC-5·AC-13)

대상 앱: {base_url}/?url=file:///Users/me/a.md · {base_url}/?url=javascript:alert(1) · {base_url}/?url=notaurl · {base_url}/?file=/Users/me/a.md

## 목표
로컬 파일 경로나 위험한 스킴(`file:` `javascript:` `data:` `blob:`), 형식이 잘못된 주소, 그리고 로컬 경로를 직접 넘기는 파라미터(`?file=`)는 확인창조차 뜨지 않고 곧바로 거절해야 한다. 왜 안 되는지와 대신 무엇을 하면 되는지를 함께 안내한다.

## 사전조건
없음. 이 앱에는 로그인이 없다. e2e_user/e2e_pass 는 사용하지 않는다.

## 수행 단계 (순서대로, 순수 자연어)
1. 위 네 가지 주소 각각으로 앱에 진입한다.
2. 뜨는 알림을 읽는다.
3. 편집 영역에 아무 글자나 입력해 본다.

## 성공 판정 신호 (관찰 가능)
- 네 경우 모두 확인 대화상자가 전혀 뜨지 않는다.
- 네 경우 모두 대상 주소로 나간 외부 요청이 0건이고, 파일 선택창도 뜨지 않는다.
- 알림은 실패를 알리는 종류다. 앞의 세 경우(`file:` `javascript:` `notaurl`)는 문구에 `http`라는 단어가 포함되어 "http(s) 주소만 열 수 있다"는 뜻을 전한다. `?file=` 경우는 문구에 `파일 선택`이라는 단어가 포함되어 대안을 안내한다.
- 문서 탭 개수는 변하지 않는다. 3단계에서 입력한 내용은 화면에 정상 반영된다.

## 부정/엣지 케이스
`?url=data:text/markdown,%23x`(데이터 URI)와 `?url=http://example.com/a.md`(로컬이 아닌 사이트에 평문 http로 접근)도 같은 방식으로 거절돼야 한다 — 로컬 개발 주소(localhost/127.0.0.1)에 대한 http만 예외로 허용된다는 규칙이 지켜지는지 보는 부정 케이스다.

## 결과 출력 (필수 계약)
마지막 줄에 정확히 한 줄로 출력한다:
- 성공: `E2E_RESULT=PASS`
- 실패: `E2E_RESULT=FAIL: <짧은 사유>`
