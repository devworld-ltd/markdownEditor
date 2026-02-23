import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct WebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let schemeHandler = BundleSchemeHandler()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "app")
        config.userContentController.add(context.coordinator, name: "fileHandler")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView

        if let url = URL(string: "app://localhost/index.html") {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[WebView] Navigation failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[WebView] Provisional navigation failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[WebView] Page loaded successfully")
        }

        // MARK: - WKScriptMessageHandler

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }

            switch action {
            case "open":
                handleOpen()
            case "save":
                let content = body["content"] as? String ?? ""
                let filePath = body["filePath"] as? String
                handleSave(content: content, filePath: filePath)
            case "saveAs":
                let content = body["content"] as? String ?? ""
                handleSaveAs(content: content)
            default:
                break
            }
        }

        // MARK: - File Operations

        private func handleOpen() {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [
                UTType(filenameExtension: "md") ?? .plainText,
                .plainText,
            ]
            panel.allowsMultipleSelection = false
            panel.canChooseDirectories = false

            panel.begin { [weak self] response in
                guard response == .OK, let url = panel.url else {
                    self?.callBridge("window._bridge.onFileCancelled()")
                    return
                }

                do {
                    let content = try String(contentsOf: url, encoding: .utf8)
                    let base64 = Data(content.utf8).base64EncodedString()
                    let path = url.path.replacingOccurrences(of: "'", with: "\\'")
                    let name = url.lastPathComponent.replacingOccurrences(of: "'", with: "\\'")
                    self?.callBridge("window._bridge.onFileOpened(new TextDecoder().decode(Uint8Array.from(atob('\(base64)'),c=>c.charCodeAt(0))), '\(path)', '\(name)')")
                } catch {
                    let msg = error.localizedDescription.replacingOccurrences(of: "'", with: "\\'")
                    self?.callBridge("window._bridge.onFileError('\(msg)')")
                }
            }
        }

        private func handleSave(content: String, filePath: String?) {
            if let filePath = filePath {
                let url = URL(fileURLWithPath: filePath)
                writeFile(content: content, to: url)
            } else {
                handleSaveAs(content: content)
            }
        }

        private func handleSaveAs(content: String) {
            let panel = NSSavePanel()
            panel.allowedContentTypes = [
                UTType(filenameExtension: "md") ?? .plainText,
            ]
            panel.nameFieldStringValue = "Untitled.md"

            panel.begin { [weak self] response in
                guard response == .OK, let url = panel.url else {
                    self?.callBridge("window._bridge.onFileCancelled()")
                    return
                }
                self?.writeFile(content: content, to: url)
            }
        }

        private func writeFile(content: String, to url: URL) {
            do {
                try content.write(to: url, atomically: true, encoding: .utf8)
                let path = url.path.replacingOccurrences(of: "'", with: "\\'")
                let name = url.lastPathComponent.replacingOccurrences(of: "'", with: "\\'")
                callBridge("window._bridge.onFileSaved('\(path)', '\(name)')")
            } catch {
                let msg = error.localizedDescription.replacingOccurrences(of: "'", with: "\\'")
                callBridge("window._bridge.onFileError('\(msg)')")
            }
        }

        private func callBridge(_ js: String) {
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(js)
            }
        }
    }
}

class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let path = url.path.isEmpty ? nil : String(url.path.dropFirst()) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        guard let resourceURL = Bundle.main.resourceURL else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let fileURL = resourceURL
            .appendingPathComponent("WebContent")
            .appendingPathComponent(path)

        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let mimeType = mimeTypeForPath(path)
        let response = URLResponse(
            url: url,
            mimeType: mimeType,
            expectedContentLength: data.count,
            textEncodingName: mimeType.hasPrefix("text/") ? "utf-8" : nil
        )

        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    private func mimeTypeForPath(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html": return "text/html"
        case "css":  return "text/css"
        case "js":   return "application/javascript"
        case "json": return "application/json"
        case "svg":  return "image/svg+xml"
        case "png":  return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default:     return "application/octet-stream"
        }
    }
}
