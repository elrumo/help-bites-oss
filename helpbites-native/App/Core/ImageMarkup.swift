#if os(iOS)
import QuickLook
import SwiftUI

/// Apple's own Markup (the pen, shapes, text and signature tools of Photos and Mail): QuickLook opened for editing.
/// It edits `file` in place, a copy this view's owner made, and calls `onSave` with it when the person taps Done after
/// drawing; `onClose` when the viewer goes away.
/// Compiled into the app and the share extension.
struct ImageMarkupView: UIViewControllerRepresentable {
  let file: URL
  let onSave: (URL) -> Void
  let onClose: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIViewController(context: Context) -> QLPreviewController {
    let controller = QLPreviewController()
    controller.dataSource = context.coordinator
    controller.delegate = context.coordinator
    return controller
  }

  func updateUIViewController(_ controller: QLPreviewController, context: Context) { context.coordinator.parent = self }

  @MainActor final class Coordinator: NSObject, @preconcurrency QLPreviewControllerDataSource, @preconcurrency QLPreviewControllerDelegate {
    var parent: ImageMarkupView
    init(_ parent: ImageMarkupView) { self.parent = parent }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { parent.file as NSURL }
    func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .updateContents }
    func previewController(_ controller: QLPreviewController, didUpdateContentsOf previewItem: QLPreviewItem) { parent.onSave(parent.file) }
    func previewControllerDidDismiss(_ controller: QLPreviewController) { parent.onClose() }
  }
}

/// A picture on its way to Markup: its address on the server, or on this device, copied to a file Markup may change.
struct MarkupJob: Identifiable {
  let id = UUID()
  let file: URL

  /// Copies the picture at `source` (a file or a web address) into the temporary folder, keeping its extension.
  static func make(from source: URL, ext: String) async throws -> MarkupJob {
    let data = source.isFileURL ? try Data(contentsOf: source) : try await URLSession.shared.data(from: source).0
    let file = FileManager.default.temporaryDirectory.appending(path: "markup-\(UUID().uuidString.lowercased()).\(ext.isEmpty ? "png" : ext)")
    try data.write(to: file, options: .atomic)
    return MarkupJob(file: file)
  }

  func discard() { try? FileManager.default.removeItem(at: file) }
}
#endif
