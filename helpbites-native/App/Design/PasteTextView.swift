import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

// A multi-line text field that also takes an image from the clipboard: a paste of
// an image calls `onPasteImage` with PNG data, any other paste is text as usual.
// SwiftUI's TextEditor cannot tell them apart, so the platform's own text view does.

#if canImport(UIKit)
struct PasteTextView: UIViewRepresentable {
  @Binding var text: String
  var monospaced = false
  var onPasteImage: (Data) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> PasteUITextView {
    let view = PasteUITextView()
    view.delegate = context.coordinator
    view.backgroundColor = .clear
    view.textContainerInset = UIEdgeInsets(top: 2, left: 7, bottom: 2, right: 7)
    view.text = text
    return view
  }

  func updateUIView(_ view: PasteUITextView, context: Context) {
    context.coordinator.parent = self
    view.onPasteImage = onPasteImage
    view.font = monospaced ? .monospacedSystemFont(ofSize: 12, weight: .regular) : .systemFont(ofSize: 15)
    view.textColor = PlatformColor(Theme.text)
    if view.text != text { view.text = text }
  }

  @MainActor final class Coordinator: NSObject, UITextViewDelegate {
    var parent: PasteTextView
    init(_ parent: PasteTextView) { self.parent = parent }
    func textViewDidChange(_ view: UITextView) { parent.text = view.text }
  }
}

final class PasteUITextView: UITextView {
  var onPasteImage: ((Data) -> Void)?

  override func paste(_ sender: Any?) {
    if let onPasteImage, UIPasteboard.general.hasImages, let png = UIPasteboard.general.image?.pngData() {
      onPasteImage(png)
      return
    }
    super.paste(sender)
  }
}
#else
struct PasteTextView: NSViewRepresentable {
  @Binding var text: String
  var monospaced = false
  var onPasteImage: (Data) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeNSView(context: Context) -> NSScrollView {
    let view = PasteNSTextView()
    view.delegate = context.coordinator
    view.drawsBackground = false
    view.isRichText = false
    view.isVerticallyResizable = true
    view.isHorizontallyResizable = false
    view.autoresizingMask = [.width]
    view.textContainer?.widthTracksTextView = true
    view.textContainerInset = NSSize(width: 7, height: 2)
    view.string = text
    let scroll = NSScrollView()
    scroll.documentView = view
    scroll.hasVerticalScroller = true
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    context.coordinator.parent = self
    guard let view = scroll.documentView as? PasteNSTextView else { return }
    view.onPasteImage = onPasteImage
    view.font = monospaced ? .monospacedSystemFont(ofSize: 12, weight: .regular) : .systemFont(ofSize: 15)
    view.textColor = PlatformColor(Theme.text)
    if view.string != text { view.string = text }
  }

  @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: PasteTextView
    init(_ parent: PasteTextView) { self.parent = parent }
    func textDidChange(_ notification: Notification) {
      guard let view = notification.object as? NSTextView else { return }
      parent.text = view.string
    }
  }
}

final class PasteNSTextView: NSTextView {
  var onPasteImage: ((Data) -> Void)?

  override func paste(_ sender: Any?) {
    if let onPasteImage, let image = NSImage(pasteboard: .general), let png = image.pngData {
      onPasteImage(png)
      return
    }
    super.paste(sender)
  }
}

private extension NSImage {
  var pngData: Data? {
    tiffRepresentation.flatMap { NSBitmapImageRep(data: $0) }?.representation(using: .png, properties: [:])
  }
}
#endif
