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
  /// Where to open it: the server's address, or the file on this device for one waiting to upload (`local:`).
  var link: URL? { PlanningOutbox.fileURL(url) ?? URL(string: url) }
  var isVideo: Bool { mime.hasPrefix("video/") }
  var asJSON: JSONValue { .object(["url": .string(url), "name": .string(name), "mime": .string(mime), "size": .number(Double(size))]) }

  static let maxCount = 10
  static let maxBytes = 25 * 1024 * 1024
  /// MP4 and MOV videos may be larger (ITEM_VIDEO_MAX_BYTES).
  static let maxVideoBytes = 100 * 1024 * 1024
  /// Programs and scripts the server refuses (ITEM_BLOCKED_EXTENSIONS); checked here so the file is never sent.
  static let blockedExtensions: Set<String> = ["exe", "dll", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "lnk", "vbs", "vbe", "jse", "wsf", "wsh", "ps1", "msc", "reg", "hta", "jar", "sh", "command", "app", "apk", "dmg", "pkg"]

  /// Uploads one file to `POST /v1/feedback/attachments` for the caller to add to its list. A file over the limit is not sent.
  /// Whatever fails throws a line fit to show, with the file's name in it. With `keepOffline` (a planning item not on the
  /// server yet), no answer from the server keeps the file on this device instead, and it goes up with the item.
  @MainActor static func upload(_ data: Data, filename: String, session: SessionStore, projectId: String, keepOffline: Bool = false) async throws -> ItemAttachment {
    let ext = (filename as NSString).pathExtension.lowercased()
    if ["mp4", "mov"].contains(ext) {
      guard data.count <= maxVideoBytes else { throw APIError.server(String(localized: "\(filename) is larger than 100 MB.")) }
    } else {
      guard data.count <= maxBytes else { throw APIError.server(String(localized: "\(filename) is larger than 25 MB.")) }
    }
    guard !blockedExtensions.contains(ext) else { throw APIError.server(String(localized: "\(filename): programs and scripts cannot be attached.")) }
    let mime = UTType(filenameExtension: (filename as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    func keep() throws -> ItemAttachment {
      ItemAttachment(url: try PlanningOutbox.keep(data, ext: ext.isEmpty ? "bin" : ext), name: filename, mime: mime, size: data.count)
    }
    if keepOffline, Connectivity.shared.offline { return try keep() }
    do {
      return try await session.upload("/v1/feedback/attachments?project=\(projectId)", file: data, filename: filename, mimeType: mime)
    } catch APIError.transport where keepOffline {
      return try keep()
    } catch {
      throw APIError.server("\(filename): \(error.localizedDescription)")
    }
  }
}

/// Images and files on a post or item (AttachmentsField.vue): add from the photo library or Files, tap to open, remove.
/// The editor saves the list with the post or item; this only edits it. Uploads go to `POST /v1/feedback/attachments`.
struct AttachmentsSection: View {
  @Binding var attachments: [ItemAttachment]
  let session: SessionStore
  let projectId: String
  /// Only images (a changelog entry's); no files, and the picker takes images alone.
  var imagesOnly = false
  /// A planning item not on the server yet: offline, files wait on the device with it.
  var keepOffline = false
  /// How many files are uploading, for an editor whose Save waits for them.
  var busy: Binding<Int>?

  @State private var photos: [PhotosPickerItem] = []
  @State private var importing = false
  @State private var uploading = 0
  @State private var error = ""

  private var fileTypes: [UTType] { imagesOnly ? [.image] : [.item] }

  var body: some View {
    LabeledField(label: imagesOnly ? "Images" : "Images and files") {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(attachments, id: \.url) { file in
          HStack(spacing: 8) {
            AttachmentOpener(file: file)
            Spacer()
            Button { attachments.removeAll { $0.url == file.url } } label: { Image(systemName: "xmark") }
              .buttonStyle(.plain).foregroundStyle(Theme.textMuted).accessibilityLabel("Remove \(file.name)")
          }
          .font(.lnMeta)
        }
        HStack(spacing: 8) {
          PhotosPicker(selection: $photos, maxSelectionCount: max(1, ItemAttachment.maxCount - attachments.count), matching: imagesOnly ? .images : .any(of: [.images, .videos]), preferredItemEncoding: .compatible) {
            Label("Photos", systemImage: "photo")
          }
          if !imagesOnly { Button { importing = true } label: { Label("Files", systemImage: "paperclip") } }
          Button { Task { await pasteImage() } } label: { Label("Paste", systemImage: "doc.on.clipboard") }
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
          if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
            guard let movie = try? await item.loadTransferable(type: PickedMovie.self) else { error = String(localized: "Could not read that video."); continue }
            defer { try? FileManager.default.removeItem(at: movie.url) }
            // Mapped, so the 100 MB sits on disk rather than in memory until the upload reads it.
            guard let data = try? Data(contentsOf: movie.url, options: .mappedIfSafe) else { error = String(localized: "Could not read that video."); continue }
            await upload(data, filename: "Video.\(movie.serverName.ext)")
            continue
          }
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

  /// The image on the clipboard, as a PNG attachment (the Paste button; iOS asks first when another app copied it).
  private func pasteImage() async {
    guard let data = Clipboard.pngImage() else { error = String(localized: "There is no image on the clipboard."); return }
    await upload(data, filename: "Pasted image.png")
  }

  private func upload(_ data: Data, filename: String) async {
    guard attachments.count < ItemAttachment.maxCount else { return }
    uploading += 1
    busy?.wrappedValue += 1
    defer { uploading -= 1; busy?.wrappedValue -= 1 }
    error = ""
    do {
      let file = try await ItemAttachment.upload(data, filename: filename, session: session, projectId: projectId, keepOffline: keepOffline)
      attachments.append(file)
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// An attachment's tile: a picture, a play badge for a video or a document icon.
struct AttachmentThumb: View {
  let file: ItemAttachment

  var body: some View {
    if file.isImage, let url = file.link {
      CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
        .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: 6))
    } else {
      Image(systemName: file.isVideo ? "play.fill" : "doc").frame(width: 36, height: 36).background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
    }
  }
}

/// An attachment's tile and name. An image or a video opens in a full-screen viewer in the app; any other file opens in the browser.
struct AttachmentOpener: View {
  let file: ItemAttachment
  @State private var preview: PreviewItem?

  var body: some View {
    if let url = file.link, file.isImage || file.isVideo {
      Button { preview = PreviewItem(url: url, isVideo: file.isVideo) } label: {
        HStack(spacing: 8) { AttachmentThumb(file: file); Text(file.name).foregroundStyle(Theme.accentText).lineLimit(1) }
      }
      .buttonStyle(.plain)
      .accessibilityHint(file.isVideo ? "Plays it full screen" : "Opens it full screen")
      .fullScreenCover(item: $preview) { ImagePreview(url: $0.url, isVideo: $0.isVideo) }
    } else {
      HStack(spacing: 8) {
        AttachmentThumb(file: file)
        if let url = file.link { Link(file.name, destination: url).lineLimit(1) } else { Text(file.name).lineLimit(1) }
      }
    }
  }
}
