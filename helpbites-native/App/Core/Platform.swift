import SwiftUI
import WebKit
#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
typealias PlatformColor = UIColor
#else
import AppKit
typealias PlatformImage = NSImage
typealias PlatformColor = NSColor
#endif

// The seams between iOS/iPadOS and macOS. Everything else is shared SwiftUI;
// anything that touches UIKit or AppKit goes through here.

@MainActor enum Platform {
  static var isMac: Bool {
    #if os(macOS)
    true
    #else
    false
    #endif
  }
  /// The platform name the server stores on a push device.
  static var deviceName: String {
    #if os(macOS)
    "macos"
    #else
    UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
    #endif
  }
  /// Whether the device is an iPhone (a stack of pages, not a sidebar).
  static var isPhone: Bool {
    #if os(macOS)
    false
    #else
    UIDevice.current.userInterfaceIdiom == .phone
    #endif
  }
}

enum Clipboard {
  static func copy(_ string: String?) {
    guard let string else { return }
    #if os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(string, forType: .string)
    #else
    UIPasteboard.general.string = string
    #endif
  }
}

extension PlatformColor {
  convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
  }
  /// A colour that flips with the appearance.
  static func dynamic(light: UInt32, dark: UInt32) -> PlatformColor {
    #if os(macOS)
    PlatformColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? PlatformColor(hex: dark) : PlatformColor(hex: light) }
    #else
    PlatformColor { $0.userInterfaceStyle == .dark ? PlatformColor(hex: dark) : PlatformColor(hex: light) }
    #endif
  }
  var rgba: (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    #if os(macOS)
    (usingColorSpace(.sRGB) ?? self).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    #else
    getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    #endif
    return (red, green, blue, alpha)
  }
}

extension PlatformImage {
  func jpegBytes(quality: CGFloat) -> Data? {
    #if os(macOS)
    guard let tiff = tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
    return rep.representation(using: .jpeg, properties: [.compressionFactor: quality])
    #else
    jpegData(compressionQuality: quality)
    #endif
  }
}

extension Image {
  init(platformImage: PlatformImage) {
    #if os(macOS)
    self.init(nsImage: platformImage)
    #else
    self.init(uiImage: platformImage)
    #endif
  }
}

/// A hairline: one device pixel.
@MainActor enum Hairline {
  static var width: CGFloat {
    #if os(macOS)
    1 / (NSScreen.main?.backingScaleFactor ?? 2)
    #else
    1 / UIScreen.main.scale
    #endif
  }
}

// Text-input hints that only exist on iOS. On the Mac they're no-ops, so call sites stay shared.
enum URLKeyboard { case url, emailAddress, numberPad, decimalPad, asciiCapable, `default` }
enum Capitalization { case never, words, sentences, characters }

extension View {
  func inputHints(_ keyboard: URLKeyboard = .default, capitalization: Capitalization = .sentences) -> some View {
    #if os(iOS)
    self
      .keyboardType(keyboard.platform)
      .textInputAutocapitalization(capitalization.platform)
    #else
    self
    #endif
  }
}

#if os(iOS)
private extension URLKeyboard {
  var platform: UIKeyboardType {
    switch self {
    case .url: .URL
    case .emailAddress: .emailAddress
    case .numberPad: .numberPad
    case .decimalPad: .decimalPad
    case .asciiCapable: .asciiCapable
    case .default: .default
    }
  }
}
private extension Capitalization {
  var platform: TextInputAutocapitalization {
    switch self {
    case .never: .never
    case .words: .words
    case .sentences: .sentences
    case .characters: .characters
    }
  }
}
#endif

/// The system share sheet for a file (iOS) or the share menu (macOS).
struct ShareSheet: View {
  let url: URL
  var body: some View {
    #if os(iOS)
    ActivitySheet(url: url)
    #else
    MacShare(url: url)
    #endif
  }
}

#if os(iOS)
private struct ActivitySheet: UIViewControllerRepresentable {
  let url: URL
  func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#else
/// On the Mac a file the app wrote is revealed in Finder; the user shares or opens it from there.
private struct MacShare: View {
  let url: URL
  var body: some View {
    ShareLink(item: url).labelStyle(.titleAndIcon).padding(24).frame(minWidth: 280)
      .onAppear { NSWorkspace.shared.activateFileViewerSelecting([url]) }
  }
}
#endif

/// Rendered HTML without scripts (an email preview). Links don't navigate.
struct SandboxedWebView: PlatformViewRepresentable {
  let html: String
  var interactive = true

  func makeCoordinator() -> Coordinator { Coordinator() }

  private func make(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = context.coordinator
    #if os(iOS)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.isUserInteractionEnabled = interactive
    #else
    view.setValue(false, forKey: "drawsBackground")
    #endif
    return view
  }

  private func update(_ view: WKWebView, context: Context) {
    #if os(iOS)
    view.isUserInteractionEnabled = interactive
    #endif
    guard context.coordinator.html != html else { return }
    context.coordinator.html = html
    view.loadHTMLString(html, baseURL: nil)
  }

  #if os(iOS)
  func makeUIView(context: Context) -> WKWebView { make(context: context) }
  func updateUIView(_ view: WKWebView, context: Context) { update(view, context: context) }
  #else
  func makeNSView(context: Context) -> WKWebView { make(context: context) }
  func updateNSView(_ view: WKWebView, context: Context) { update(view, context: context) }
  #endif

  @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
    var html = ""
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
      navigationAction.navigationType == .linkActivated ? .cancel : .allow
    }
  }
}

#if os(iOS)
typealias PlatformViewRepresentable = UIViewRepresentable
#else
typealias PlatformViewRepresentable = NSViewRepresentable
#endif
