# API 명세 — 브라우저 플랫폼 API

> 최종 갱신: 2026-08-31 · 대상: v2.6.1 (F-88·F-89, #187)
> 이전 문서(`bridge-api.md`, JS↔Swift 브리지)는 네이티브 앱 제거와 함께 이 문서로 대체됐다.

## 0. HTTP API 현황

**HTTP API 가 없다.** REST/GraphQL 엔드포인트, 인증 토큰, 서버 호출이 전무하다. Cloudflare Workers 는 정적 자산만 서빙하며 앱은 최초 로드 이후 어떤 요청도 보내지 않는다.

프로세스/보안 경계를 넘는 인터페이스는 **브라우저 표준 API 3종**이다.

| 인터페이스 | 용도 | 지원 |
|-----------|------|------|
| File System Access API | 로컬 파일 열기·덮어쓰기 | Chrome·Edge |
| `<input type="file">` + Blob 다운로드 | 폴백 열기·저장 | 전 브라우저 |
| `localStorage` | 세션 자동 저장 | 전 브라우저 (시크릿 모드 예외) |
| Service Worker + Cache Storage | 오프라인 지원 | 전 최신 브라우저 (프로덕션 빌드만) |
| Web App Manifest | 설치형 PWA | 전 최신 브라우저 |

노출되는 URL 목록은 [테스트 계획 §3](../testing/test-plan.md#3-url-인벤토리) 참고.

---

## 1. 능력 탐지

```ts
export function isFileSystemAccessSupported(): boolean {
  return typeof window.showOpenFilePicker === "function"
      && typeof window.showSaveFilePicker === "function";
}
```

결과는 `document.body.dataset.fsAccess` 에 `"true"`/`"false"` 로 반영된다 (E2E·디버깅용).

> File System Access API 는 **보안 컨텍스트(HTTPS 또는 localhost)** 에서만 노출된다. LAN IP 로 접속하면 자동으로 폴백 경로가 선택된다.

---

## 2. 파일 열기

### 2.1 File System Access 경로

```ts
const [handle] = await window.showOpenFilePicker({
  types: [{
    description: "Markdown",
    accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
  }],
  multiple: false,
});
```

| 단계 | 동작 |
|------|------|
| 1 | 핸들 획득 (사용자 제스처 필요) |
| 2 | `await findTabByHandle(handle)` — `isSameEntry()` 로 중복 검사 |
| 3 | 이미 열려 있으면 `switchTab()` 후 **조기 반환** |
| 4 | 아니면 `handle.getFile()` → `file.text()` → `createTab(text, handle, file.name)` |

| 결과 | 처리 |
|------|------|
| 성공 | 새 탭 생성 및 활성화 |
| 사용자 취소 | `AbortError` → **무시** (알림 없음) |
| 그 외 오류 | `showNotice("파일을 열지 못했습니다: …", "error")` |

### 2.2 폴백 경로

`initFileOps()` 가 숨김 `<input type="file" id="file-input" accept=".md,.markdown,.txt,text/markdown,text/plain">` 을 `document.body` 에 붙여 둔다. `openFile()` 은 이 요소를 `click()` 한다.

`change` 이벤트에서:
1. `input.value = ""` — 같은 파일을 연속 선택해도 이벤트가 발생하도록 초기화
2. `createTab(await file.text(), null, file.name)`

**제약**: 핸들이 없으므로 **중복 열기 판별이 불가능**하다. 같은 파일을 두 번 열면 탭이 2개 생긴다.

---

## 3. 파일 저장

### 3.1 `saveFile()` — 분기

```
saveFile()
 ├─ 활성 탭 없음 → return
 ├─ syncActiveTab()
 ├─ tab.handle 있음 → writeToHandle(tab.handle, ...)   // 대화상자 없이 덮어쓰기
 └─ tab.handle 없음 → saveFileAs()
```

### 3.2 `saveFileAs()` — 분기

| 조건 | 동작 |
|------|------|
| FS Access 미지원 | `downloadFile(content, suggestedName)` → `updateActiveTab({fileName, isDirty:false})` → "내려받았습니다" 알림 |
| FS Access 지원 | `showSaveFilePicker({ types, suggestedName })` → `writeToHandle(handle, content, handle.name)` |

`suggestFileName()` 규칙:

| 입력 | 출력 |
|------|------|
| `"Untitled"` 또는 공백 | `"Untitled.md"` |
| `"note.md"` / `"a.markdown"` / `"b.txt"` | 그대로 유지 |
| `"보고서"` | `"보고서.md"` |

### 3.3 `writeToHandle()`

```ts
const writable = await handle.createWritable();
await writable.write(content);
await writable.close();
updateActiveTab({ handle, fileName, isDirty: false });
showNotice(`${fileName} 에 저장했습니다.`);
```

| 결과 | 처리 |
|------|------|
| 성공 | dirty 해제 + 성공 알림 |
| `AbortError` (권한 대화상자 취소) | 무시 |
| 그 외 (권한 없음·디스크 오류) | `showNotice("저장하지 못했습니다: …", "error")` — **dirty 는 유지** |

### 3.4 폴백 다운로드

```ts
const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
const url = URL.createObjectURL(blob);
// <a download> 생성 → click → remove → revokeObjectURL
```

**제약**: 덮어쓰기 개념이 없다. 저장할 때마다 브라우저 다운로드 폴더에 새 파일이 생기며, 동일 이름이면 `note (1).md` 처럼 번호가 붙는다.

---

## 3.9 `<dialog>` — 단축키 안내 (F-58)

| API | 용도 | 주의 |
|-----|------|------|
| `showModal()` | 모달 열기 | `show()` 를 쓰면 포커스 트랩·백드롭이 붙지 않아 바깥 타이핑이 에디터로 들어간다 |
| `close()` | 닫기 | 사유(버튼·Esc·`close()`)와 무관하게 `close` 이벤트가 한 번 발생한다 → 포커스 복귀를 여기 한 곳에서 처리 |
| `::backdrop` | 배경 | 클릭 히트 타깃은 `dialog` 가 **아니다**(Chromium 은 아래 요소를 준다) |

전역 리셋 `* { margin: 0 }` 이 UA 의 `dialog:modal { margin: auto }` 를 덮어쓰므로 `margin: auto` 를 되살려야 중앙에 온다.

## 3.10 내보내기 저장 경로 (F-38)

`exportFile()` 은 기존 저장과 같은 2경로 분기(FS Access API ↔ 다운로드 폴백)를 쓰되 **탭 상태를 갱신하지 않는다.** MIME 과 확장자만 인자로 받아 F-39 등 다른 형식에도 재사용된다.

## 3.11 파일 핸들의 수명 (F-36)

`FileSystemFileHandle` 은 **직렬화할 수 없고** 재방문 시 권한도 초기화된다. 그래서 최근 목록은 두 층으로 나뉜다.

- **메모리**: 이름 → 핸들 (`main.ts` 의 `liveHandles`). 이번 세션 동안만 유효
- **localStorage**: 이름과 시각만. 새로고침 뒤에는 "열었던 적이 있다" 는 사실만 남는다

끊긴 항목을 누르면 `showOpenFilePicker()` 를 열되 **이유를 함께 알린다.** 조용히 선택 창만 띄우면 사용자는 버그로 받아들인다.

## 3.12 클립보드 (F-40)

| API | 용도 | 실패 조건 |
|-----|------|-----------|
| `ClipboardItem` | `text/html` + `text/plain` 동시 제공 | 미지원 브라우저에는 아예 없다 |
| `navigator.clipboard.write` | 서식 있는 복사 | 비보안 컨텍스트·권한 거부·사용자 제스처 없음 |
| `navigator.clipboard.writeText` | 폴백 | 위와 같음 |

**두 형식을 함께 넣어야 한다.** 붙여넣는 곳이 서식을 모르면 `text/html` 만 있을 때 **태그가 날것 그대로** 들어간다.

## 3.10 DataTransferItem.getAsFileSystemHandle (F-56)

드롭된 항목에서 파일 **핸들**을 얻는다. 이것이 있어야 드롭으로 연 문서를 그 파일에 바로 저장할 수 있다.

| 항목 | 내용 |
|------|------|
| 지원 | Chrome·Edge. Safari·Firefox 에는 **없다** — 핸들 없이 열고 저장 시 위치를 묻는다 |
| 호출 시점 | **드롭 이벤트 처리 중** — `DataTransferItem` 은 핸들러가 끝나면 비워진다 |
| 반환 | `Promise<FileSystemHandle | null>` — 디렉터리일 수 있으므로 `kind === "file"` 확인 |

## 4. 세션 저장 (`localStorage`)

| 항목 | 값 |
|------|-----|
| 키 | `markdown-editor:session:v1` |
| 쓰기 시점 | 상태 변경 후 500ms 디바운스, `beforeunload`, `visibilitychange(hidden)` |
| 읽기 시점 | `initTabs()` 최초 1회 |
| 스키마 | [데이터 모델 §3](../architecture/data-model.md#3-localstorage-세션-스키마) |

접근 불가 환경(시크릿 모드 등)에서는 기동 시 8초짜리 오류 알림을 띄우고 자동 저장 없이 동작한다.

**용량 초과 처리 (F-54)**: `saveSession()` 이 `false` 를 반환하면 `persistNow()` 가 "브라우저 저장 공간이 부족해 자동 저장이 중단됐습니다" 오류 알림을 띄운다. 500ms 마다 반복되지 않도록 플래그로 1회만 알리고, 저장이 다시 성공하면 플래그를 해제한다.

---

## 3.9 IndexedDB — 파일 핸들 보관 (#125)

| 항목 | 값 |
|------|-----|
| DB | `markdown-editor-handles` (버전 1) |
| 저장소 | `handles` — 키는 파일명, 값은 `FileSystemFileHandle` |
| 모듈 | `src/handleStore.ts` |

**IndexedDB 는 구조화 복제(structured clone)를 쓰므로 핸들을 그대로 담는다.** 세션 저장(localStorage)은 JSON 이라 담을 수 없다 — 이 차이가 이 저장소를 따로 두는 이유 전부다.

되살린 핸들에는 **권한이 따라오지 않는다.** `queryPermission({ mode: "readwrite" })` 로 확인하고, `granted` 가 아니면 `requestPermission()` 을 부른다. 권한 요청은 **사용자 제스처 안에서만** 통과하므로 최근 목록의 **클릭 핸들러에서** 호출한다 — 앱 기동 시 자동 복원은 하지 않는다(누르지도 않았는데 권한 창이 뜨면 침입이다).

`read` 가 아니라 `readwrite` 로 묻는다. 읽기 권한만 받으면 그 다음 저장에서 다시 막힌다.

**문서 내용은 넣지 않는다** — 핸들뿐이다.

## 3.10 File Handling API — OS 파일 연결 (#135)

브라우저 탭에는 앱 번들이 없어 macOS **Launch Services** 에 등록될 수 없다. 그런데 Chrome·Edge 로 **PWA 를 설치하면 실제 `.app` 셸이 생기고**, 매니페스트의 `file_handlers` 선언이 그 번들의 문서 타입이 된다. 그때 Finder "다음으로 열기" 목록에 뜬다.

| 항목 | 값 |
|------|-----|
| 선언 | `public/manifest.webmanifest` 의 `file_handlers` |
| 수신 | `window.launchQueue.setConsumer()` → `src/launchFiles.ts` |
| 넘어오는 것 | **`FileSystemFileHandle`** — 파일 선택 창으로 연 것과 같은 종류 |
| 지원 | Chrome · Edge (설치된 PWA). **Safari · Firefox 미지원** |

핸들은 `fileOps.openFileFromHandle()` 에 **그대로 넘긴다.** 여기서 파일을 직접 읽어 탭을 만들면 중복 탭 방지·최근 목록(F-36)·핸들 보관(#125)을 다시 구현하게 되고, 곧 두 경로가 갈라진다.

여러 파일은 **순서를 지켜 하나씩** 연다. 동시에 열면 탭 순서가 실행 인자 순서와 달라지고, 중복 탭 판정(`isSameEntry`)도 서로를 못 본 채 지나쳐 같은 파일이 두 탭으로 열릴 수 있다.

확장자는 `.md`·`.markdown`·`.mdown`·`.mkd` 를 `text/markdown` 과 `text/plain` **양쪽에** 건다 — `.md` 의 MIME 은 환경마다 다르고 빈 문자열로 오는 경우도 흔하다(트랩 #61).

## 3.13 파일 변경 감지 새로고침 (F-88, #187)

디스크에서 파일이 바뀌었는지 확인하는 유일한 근거는 **핸들에서 다시 읽은 `File` 객체**다 — 별도 파일 감시 API 는 쓰지 않는다.

| 항목 | 값 |
|------|-----|
| 기준값 | `File.lastModified` + `File.size` (`src/diskStamp.ts` `DiskStamp`) |
| 1단 판정 | `compareStamp()` — mtime·크기만 비교 |
| 2단 판정 | `isRealChange()` — 1단이 "changed" 일 때만 `file.text()` 로 내용까지 비교(S-3, mtime 만 바뀐 경우를 걸러낸다) |
| 확인 시점 | `window` `focus` 이벤트, `visibilitychange`(`visible`), 탭 전환(`switchTab()`), 수동 클릭(툴바 `Reload` / `Alt+R`) |
| 확인 방식 | **폴링 없음** — `setInterval`/`setTimeout` 을 쓰지 않는다 |
| 권한 | `handle.queryPermission({mode:"readwrite"})` — 조용한 경로는 `"granted"` 가 아니면 그 자리에서 물러난다. 수동 경로만 `requestPermission()` 을 호출할 수 있다(제스처 필요) |

`FileSystemFileHandle.queryPermission`/`requestPermission` 은 표준 타입에 아직 없는 브라우저가 있어 `"unsupported"` 로 관대하게 취급한다 — `handleStore.ts` 의 `ensurePermission()` 과 같은 원칙.

**감지가 만드는 UI 는 세 갈래다** (`src/reloadUi.ts`):

| 상황 | UI | DOM |
|------|-----|-----|
| 깨끗한 탭 자동 반영 | 기존 `#notice` 토스트 | `notice.ts` |
| 더티 탭 변경 감지 | 정적 배너 — 모달 아님, 타이핑을 막지 않는다 | `#reload-banner` |
| 재읽기 확정 / 저장 충돌 | `<dialog>` + `showModal()`, 기본 포커스 = 취소 | `#reload-dialog`, `#save-conflict-dialog` |

저장(`fileOps.saveFile()`)은 쓰기 전에 `fileReload.confirmBeforeSave()` 를 거친다(S-1) — 디스크 기준값이 바뀌어 있으면 취소/다시 읽기/덮어쓰기 세 갈래로 묻는다.

핸들이 없는 탭(폴백·세션 복원·업로드)은 감지 대상이 아니다 — `Reload` 버튼은 `aria-disabled` 로 낮추되 `disabled` 는 쓰지 않는다(포커스를 유지해야 스크린리더에 이유가 전달된다).

## 3.14 `launch_handler` — 앱 중복 실행 방지 (F-89, #187)

| 항목 | 값 |
|------|-----|
| 선언 | `public/manifest.webmanifest` 의 `launch_handler.client_mode = "focus-existing"` |
| 효과 | PWA 창이 이미 떠 있으면 새 창을 띄우지 않고 기존 창을 앞으로 가져온다(문서 상태 보존) |
| 배제한 값 | `"navigate-existing"` — 기존 창을 다시 로드시켜 편집 중인 미저장 내용을 잃는다 |
| 파일 수신 | **변경 없음** — 이미 있는 `window.launchQueue` → `src/launchFiles.ts` → `fileOps.openFileFromHandle()` 경로를 그대로 쓴다(§3.10) |
| 실기기 검증 | 헤드리스 Chromium 에는 Launch Services·창 관리자가 없어 "새 창이 안 뜨는가" 자체는 E2E 로 확인 불가(트랩 #82). PWA 설치 후 실기기에서 확인한다 |

## 4.1 Service Worker / Cache Storage

| 항목 | 값 |
|------|-----|
| 스크립트 | `/sw.js` (scope `/`) |
| 등록 조건 | `import.meta.env.PROD && "serviceWorker" in navigator` |
| 등록 시점 | `window` `load` 이벤트 |
| 캐시 이름 | `markdown-editor-<빌드 ID>` (빌드마다 달라짐) |
| 실패 처리 | `console.warn` 후 무시 — 오프라인은 부가 기능이라 앱 동작에 영향 없음 |

캐시 전략은 [서비스 아키텍처 §7.1](../architecture/service-architecture.md#71-오프라인-서비스-워커) 참고.

`/sw.js` 는 `_headers` 에서 `Cache-Control: no-cache` 로 지정한다. 서비스 워커 스크립트가 캐시되면 업데이트가 영원히 막히기 때문이다.

### 4.1.1 갱신 메시지 프로토콜 (F-69)

| 방향 | 메시지 | 트리거 | 수신 측 동작 |
|------|--------|--------|--------------|
| 페이지 → 워커 | `{ type: "SKIP_WAITING" }` | 사용자가 "새로고침" 클릭 | `self.skipWaiting()` |
| 워커 → 페이지 | (없음) | — | `controllerchange` 이벤트로 대체 |

**전송 대상은 `registration.waiting` 이다.** `navigator.serviceWorker.controller` 로 보내면 구 워커에게 가서 아무 일도 일어나지 않는다.

`install` 에서 `skipWaiting()` 을 호출하지 않으므로 새 워커는 대기 상태에 머무른다. 이것이 "대기 중인 새 버전" 을 감지할 수 있는 전제다.

### 4.1.2 감지 이벤트

| 이벤트 | 용도 | 주의 |
|--------|------|------|
| `registration.waiting` (즉시 조회) | 로드 시점에 이미 대기 중인 경우 | 1초 지연 후 표시해 초기 렌더를 방해하지 않는다 |
| `registration.updatefound` | 세션 중 새 워커 설치 시작 | `installing.state === "installed"` 까지 기다린다 |
| `serviceWorker.controllerchange` | 새 워커 활성화 완료 | **갱신 수락 시점에만 구독.** 상시 구독하면 최초 설치의 `clients.claim()` 으로도 발화한다 |
| `registration.update()` | 능동 확인 | 60분 주기 + 가시성 복귀 시(10분 스로틀) |

### 4.1.3 `swUpdate.ts` — 리프 모듈 계약

`SwUpdateHost` 로 모든 능력을 주입받아 앱 모듈을 하나도 import 하지 않는다. `notice.ts` 확장은 `tabs → notice → tabs` 순환을 만들어 기각했다.

| host 필드 | 기본 구현 | `main.ts` 주입값 |
|-----------|-----------|------------------|
| `register()` | `navigator.serviceWorker.register("/sw.js")` | 기본 |
| `onControllerChange(fn)` | `addEventListener` + 해제 함수 반환 | 기본 |
| `persist()` | `() => false` | `tabs.persistNow` |
| `hasDirty()` | `() => false` | `tabs.hasDirtyTabs` |
| `confirmUnsafeReload(msg)` | `window.confirm` | 기본 |
| `reload()` | `location.reload()` | 기본 |
| `returnFocusTo` | `null` | `editorEl` |

`isUpdateReloadPending()` 을 export 해 `main.ts` 의 `beforeunload` 가 억제 여부를 판단한다.

## 4.2 Web App Manifest

`/manifest.webmanifest` — `display: standalone`, `start_url: /`, `theme_color: #1e1e1e`, 아이콘은 `/icon.svg`(`any` + `maskable`). `launch_handler: { client_mode: "focus-existing" }` (F-89, §3.14) — 미지원 브라우저는 알 수 없는 필드를 무시할 뿐 아무것도 깨지지 않는다.

---

## 5. 키보드 단축키

| 단축키 | 동작 | 비고 |
|--------|------|------|
| `Cmd/Ctrl + O` | 파일 열기 | `preventDefault()` 로 브라우저 기본 동작 차단 |
| `Cmd/Ctrl + S` | 저장 | 동일 |
| `Cmd/Ctrl + Shift + S` | 다른 이름으로 저장 | 웹 전환에서 신설 |
| `Alt + N` | 새 문서 | `Cmd/Ctrl+N` 은 브라우저가 선점 |
| `Alt + W` | 탭 닫기 | `Cmd/Ctrl+W` 는 브라우저가 선점하며 차단 불가 |
| `Alt + R` | 디스크에서 다시 읽기 (F-88, #187) | `Cmd/Ctrl+R` 은 브라우저 새로고침이라 쓸 수 없다 |

Alt 조합은 macOS 에서 `e.key` 가 특수문자로 바뀌므로 **`e.code`(`KeyN`/`KeyW`)로 판별**한다. `Cmd`/`Ctrl` 조합은 `e.key.toLowerCase()` 로 판별한다.

---

## 6. 이탈 방지

```ts
window.addEventListener("beforeunload", (e) => {
  persistNow();
  if (hasDirtyTabs()) { e.preventDefault(); e.returnValue = ""; }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistNow();
});
```

`beforeunload` 문구는 모든 최신 브라우저가 무시하고 자체 경고를 띄운다. 모바일 Safari 는 `beforeunload` 를 신뢰할 수 없어 `visibilitychange` 로 보강한다.

---

## 7. 전체 시퀀스

### 7.1 파일 열기 (FS Access)

```mermaid
sequenceDiagram
  participant U as 사용자
  participant SC as shortcuts.ts
  participant FO as fileOps.ts
  participant B as 브라우저
  participant T as tabs.ts
  participant N as notice.ts

  U->>SC: Cmd+O
  SC->>FO: openFile()
  FO->>FO: isFileSystemAccessSupported()
  FO->>B: showOpenFilePicker()
  alt 선택 완료
    B-->>FO: FileSystemFileHandle
    FO->>T: findTabByHandle(handle)
    alt 이미 열림
      FO->>T: switchTab(existing.id)
    else 신규
      FO->>B: handle.getFile() → file.text()
      FO->>T: createTab(text, handle, file.name)
    end
  else 취소 (AbortError)
    B-->>FO: throw
    FO->>FO: 무시
  else 오류
    FO->>N: showNotice(..., "error")
  end
```

### 7.2 파일 저장

```mermaid
sequenceDiagram
  participant U as 사용자
  participant FO as fileOps.ts
  participant T as tabs.ts
  participant B as 브라우저
  participant N as notice.ts

  U->>FO: Cmd+S
  FO->>T: getActiveTab() + syncActiveTab()
  alt handle 있음
    FO->>B: handle.createWritable() → write → close
  else handle 없음 + FS Access 지원
    FO->>B: showSaveFilePicker()
    B-->>FO: 새 handle
    FO->>B: createWritable() → write → close
  else handle 없음 + 미지원
    FO->>B: Blob + <a download> 클릭
  end
  alt 성공
    FO->>T: updateActiveTab({handle, fileName, isDirty:false})
    FO->>N: "저장했습니다" / "내려받았습니다"
  else 실패
    FO->>N: showNotice("저장하지 못했습니다: …", "error")
  end
```

---

## 7.9 marked 확장 (F-73)

각주·정의 목록은 `marked.use({ extensions })` 로 더했다. 확장이 만든 HTML 도 `parseMarkdown()` 의 `DOMPurify.sanitize()` 를 그대로 통과한다 — **정화 경로는 하나뿐이다**(F-18).

| 확장 | level | 비고 |
|------|-------|------|
| `footnoteDef` | block | 정의를 등록부에 모으고 그 자리에는 아무것도 남기지 않는다 |
| `footnoteRef` | inline | 등록부에 정의가 있을 때만 각주로 본다 |
| `definitionList` | block | 용어 다음 줄의 `: ` 를 잡는다 (문단보다 먼저 봐야 한다) |

`start()` 는 `src.slice(1)` 을 받으므로 `^` 앵커를 쓰면 줄 한가운데서 오탐한다.

## 8. 보안 노트

| 항목 | 상태 |
|------|------|
| XSS | ✅ **2중 방어** — `parser.ts` 의 DOMPurify 정화 + CSP `script-src 'self'` |
| 파일 접근 범위 | ✅ 사용자가 명시적으로 고른 파일만. 앱이 임의 경로를 읽을 수 없다 |
| 경로 노출 | ✅ 브라우저가 절대 경로를 숨긴다 |
| 문서 유출 | ✅ 문서가 네트워크로 전송되지 않는다 |
| localStorage 격리 | ⚠️ 같은 오리진의 다른 스크립트가 세션을 읽을 수 있다. 공유 호스팅 오리진에 배포하지 말 것 |
| CSP | ✅ `public/_headers` — `script-src 'self' + CF Insights 비콘`, `object-src 'none'`, `frame-ancestors 'none'`. [인프라 §6.1](../architecture/infrastructure.md#61-보안-헤더-public_headers) |

---

## 9. 관련 문서

- [서비스 아키텍처](../architecture/service-architecture.md)
- [데이터 모델](../architecture/data-model.md)
- [기능 ↔ 모듈 ↔ API 상호 관계](../architecture/traceability.md)
- [테스트 계획](../testing/test-plan.md)
