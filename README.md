# MarkdownEditor

바닐라 TypeScript로 만든 macOS 마크다운 에디터. 프레임워크 없이 순수 TypeScript + DOM API를 사용하며, SwiftUI + WKWebView로 네이티브 macOS 앱으로 패키징한다.

## 주요 기능

- 실시간 마크다운 프리뷰 (좌우 분할 레이아웃)
- GFM(GitHub Flavored Markdown) 지원
- 멀티 탭 파일 관리 (탭 전환, 닫기, 중복 열기 방지)
- 파일 열기/저장/다른 이름으로 저장 (네이티브 파일 대화상자)
- 마크다운 툴바 (볼드, 이탤릭, 헤딩, 링크, 코드 블록 등)
- 키보드 단축키 (Cmd+O, Cmd+S, Cmd+W)
- 입력 디바운스 (150ms)

## 기술 스택

| 영역 | 기술 |
|------|------|
| 에디터 (웹) | TypeScript, DOM API |
| 마크다운 파싱 | [marked](https://github.com/markedjs/marked) (GFM + line breaks) |
| 번들러 | [Vite](https://vitejs.dev/) |
| 테스트 | [Vitest](https://vitest.dev/) |
| 네이티브 앱 | SwiftUI + WKWebView (macOS 14.0+) |
| JS-Native 브리지 | WKScriptMessageHandler + custom `app://` URL scheme |

## 프로젝트 구조

```
markupEditor/
├── src/                      # TypeScript 소스
│   ├── main.ts               # 엔트리포인트
│   ├── editor.ts             # 에디터 초기화 + 디바운스 입력 처리
│   ├── preview.ts            # 프리뷰 패널 렌더링
│   ├── parser.ts             # marked 라이브러리 래퍼
│   ├── tabs.ts               # 멀티 탭 상태 관리 + UI
│   ├── fileOps.ts            # 파일 열기/저장 + Swift 브리지
│   ├── toolbar.ts            # 툴바 UI + 버튼 액션
│   ├── shortcuts.ts          # 키보드 단축키
│   └── style.css             # 스타일
├── tests/                    # 테스트
│   └── parser.test.ts        # 마크다운 파싱 테스트
├── index.html                # HTML 엔트리포인트
├── MarkupEditorApp/          # Xcode 프로젝트 (macOS 앱)
│   ├── MarkupEditorApp/
│   │   ├── MarkupEditorApp.swift    # @main 앱 엔트리
│   │   ├── ContentView.swift        # SwiftUI 뷰
│   │   ├── WebView.swift            # WKWebView + 파일 I/O 브리지
│   │   ├── Assets.xcassets/         # 앱 아이콘
│   │   └── Resources/WebContent/    # 빌드된 웹 에셋
│   └── MarkupEditorApp.xcodeproj/
├── build.sh                  # 웹 빌드 + Xcode 빌드 통합 스크립트
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 아키텍처

```
[textarea] → input 이벤트 (디바운스 150ms)
    → editor.ts → preview.ts → parser.ts → marked → [프리뷰 div]

[탭 바] → switchTab → textarea.value 교체 + 프리뷰 갱신

[Cmd+O] → Swift 파일 대화상자 → _bridge.onFileOpened → createTab
[Cmd+S] → Swift 파일 저장 → _bridge.onFileSaved → updateActiveTab
```

## 시작하기

### 요구사항

- Node.js 18+
- macOS 14.0+ (네이티브 앱 빌드 시)
- Xcode (네이티브 앱 빌드 시)

### 개발 서버

```bash
npm install
npm run dev
```

### 테스트

```bash
npm test              # 전체 테스트
npm run test:watch    # 워치 모드
```

### macOS 앱 빌드

```bash
bash build.sh
```

빌드된 앱: `MarkupEditorApp/build/Build/Products/Release/MarkdownEditor.app`

### DMG 설치 파일 생성

```bash
# build.sh 실행 후
hdiutil create -volname "MarkdownEditor" \
  -srcfolder MarkupEditorApp/build/Build/Products/Release/MarkdownEditor.app \
  -ov -format UDZO MarkdownEditor.dmg
```

## 단축키

| 단축키 | 동작 |
|--------|------|
| Cmd+O | 파일 열기 |
| Cmd+S | 파일 저장 |
| Cmd+W | 현재 탭 닫기 |
