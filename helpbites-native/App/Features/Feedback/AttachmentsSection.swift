import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// An image or file on a post or board item (shared/itemAttachments.ts).
struct ItemAttachment: Codable, Equatable, Sendable, Hashable {
  var url: String
  var name: String
  var mime: String
  var size: Int

  var isImage: Bool { mime.hasPrefix("image/") }
  var asJSON: JSONValue { .object(["url": .string(url), "name": .string(name), "mime": .string(mime), "size": .number(Double(size))]) }

  static let maxCount = 10
  static let maxBytes = 25 * 1024 * 1024
  /// The extensions the server accepts besides images (ITEM_FILE_TYPES).
  static let fileExtensions = ["pdf", "txt", "md", "csv", "log", "json", "zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "mp4", "mov"]
}

/// Images and files on a post or item (AttachmentsField.vue): add from the photo library or Files, tap to open, remove.
/// The editor saves the list with the post or item; this only edits it. Uploads go to `POST /v1/feedback/attachments`.
struct AttachmentsSection: View {
  @Binding var attachments: [ItemAttachment]
  let session: SessionStore
  let projectId: String
  /// Only images (a changelog entry's); no files, and the picker takes images alone.
  var imagesOnly = false

  @State private var photos: [PhotosPickerItem] = []
  @State private var importing = false
  @State private var uploading = 0
  @State private var error = ""

  private var fileTypes: [UTType] { imagesOnly ? [.image] : [.image] + ItemAttachment.fileExtensions.compactMap { UTType(filenameExtension: $0) } }

  var body: some View {
    LabeledField(label: imagesOnly ? "Images" : "Images and files") {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(attachments, id: \.url) { file in
          HStack(spacing: 8) {
            if file.isImage, let url = URL(string: file.url) {
              AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
                .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
              Image(systemName: "doc").frame(width: 36, height: 36).background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
            }
            if let url = URL(string: file.url) { Link(file.name, destination: url).lineLimit(1) } else { Text(file.name).lineLimit(1) }
            Spacer()
            Button { attachments.removeAll { $0.url == file.url } } label: { Image(systemName: "xmark") }
              .buttonStyle(.plain).foregroundStyle(Theme.textMuted).accessibilityLabel("Remove \(file.name)")
          }
          .font(.lnMeta)
        }
        HStack(spacing: 8) {
          PhotosPicker(selection: $photos, maxSelectionCount: max(1, ItemAttachment.maxCount - attachments.count), matching: .images, preferredItemEncoding: .compatible) {
            Label("Photos", systemImage: "photo")
          }
          if !imagesOnly { Button { importing = true } label: { Label("Files", systemImage: "paperclip") } }
          if uploading > 0 { ProgressView().controlSize(.small) }
        }
        .buttonStyle(.lnSecondaryCompact)
        .disabled(attachments.count >= ItemAttachment.maxCount)
        if !error.isEmpty { Text(error).font(.lnCaption).foregroundStyle(Theme.error) }
      }
    }
    .onChange(of: photos) { _, items in
      guard !items.isEmpty else { return }
      photos = []
      Task {
        for item in items {
          guard let data = try? await item.loadTransferable(type: Data.self) else { error = String(localized: "Could not read that photo."); continue }
          await upload(data, filename: "Photo.\(item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg")")
        }
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: fileTypes, allowsMultipleSelection: true) { result in
      switch result {
      case .failure(let failure): error = failure.localizedDescription
      case .success(let urls):
        let files: [(Data, String)] = urls.compactMap { url in
          let scoped = url.startAccessingSecurityScopedResource()
          defer { if scoped { url.stopAccessingSecurityScopedResource() } }
          return (try? Data(contentsOf: url)).map { ($0, url.lastPathComponent) }
        }
        if files.count < urls.count { error = String(localized: "Some files could not be read.") }
        Task { for (data, name) in files { await upload(data, filename: name) } }
      }
    }
  }

  private func upload(_ data: Data, filename: String) async {
    guard attachments.count < ItemAttachment.maxCount else { return }
    guard data.count <= ItemAttachment.maxBytes else { error = String(localized: "\(filename) is larger than 25 MB."); return }
    uploading += 1
    defer { uploading -= 1 }
    error = ""
    let mime = UTType(filenameExtension: (filename as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    do {
      let file: ItemAttachment = try await session.upload("/v1/feedback/attachments?project=\(projectId)", file: data, filename: filename, mimeType: mime)
      attachments.append(file)
    } catch {
      self.error = "\(filename): \(error.localizedDescription)"
    }
  }
}
