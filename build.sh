#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Building web assets..."
npm run build

echo "==> Patching dist/index.html for WKWebView file:// compatibility..."
sed -i '' 's/ crossorigin//g' dist/index.html

echo "==> Copying dist/ to WebContent..."
rm -rf MarkupEditorApp/MarkupEditorApp/Resources/WebContent/*
cp -R dist/* MarkupEditorApp/MarkupEditorApp/Resources/WebContent/

echo "==> Building macOS app..."

# Auto-detect Xcode if xcodebuild is not available via default path
if ! xcodebuild -version &>/dev/null; then
  XCODE_PATH="$(mdfind 'kMDItemCFBundleIdentifier == "com.apple.dt.Xcode"' | head -1)"
  if [ -n "$XCODE_PATH" ]; then
    export DEVELOPER_DIR="$XCODE_PATH/Contents/Developer"
    echo "    Using Xcode at: $XCODE_PATH"
  else
    echo "Error: Xcode not found. Install Xcode from the App Store." >&2
    exit 1
  fi
fi

xcodebuild \
  -project MarkupEditorApp/MarkupEditorApp.xcodeproj \
  -scheme MarkupEditorApp \
  -configuration Release \
  -derivedDataPath MarkupEditorApp/build \
  build

APP_PATH="$(find MarkupEditorApp/build -name 'MarkdownEditor.app' -type d | head -1)"
echo "==> Build complete: $APP_PATH"
