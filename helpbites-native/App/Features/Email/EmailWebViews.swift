import SwiftUI
import WebKit

/// Rendered email HTML, like the panel's sandboxed preview iframe: no scripts,
/// links don't navigate. The editor's Preview, the linked-master panel and the
/// canvas's custom-HTML blocks use it; `interactive: false` lets taps fall
/// through to the block underneath.
struct EmailHTMLPreview: UIViewRepresentable {
  let html: String
  var interactive = true

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.navigationDelegate = context.coordinator
    view.isUserInteractionEnabled = interactive
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    view.isUserInteractionEnabled = interactive
    guard context.coordinator.html != html else { return }
    context.coordinator.html = html
    view.loadHTMLString(html, baseURL: nil)
  }

  @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
    var html = ""
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
      navigationAction.navigationType == .linkActivated ? .cancel : .allow
    }
  }
}
