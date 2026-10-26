import ImageIO
import Observation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// One image on its way to the item: the bytes the server accepts, and a small preview.
struct SharedImage: Identifiable {
  let id = UUID()
  let data: Data
  let filename: String
  let mime: String
  let preview: UIImage
}

/// The share sheet's state: what was shared, the project's board, and the fields of "New item" in the app
/// (BoardItemEditor): title, internal description, status, priority, assignee, target date, labels, images,
/// feedback to answer, and whether (and with what text) it goes on the public roadmap.
@MainActor @Observable final class ShareModel {
  enum Phase { case loading, signedOut, noBoard, failed, ready }

  var phase = Phase.loading
  var error = ""
  var projects: [ShareProject] = []
  var agents: [ShareAgent] = []

  private(set) var projectId = ""
  var title = ""
  var details = ""
  var status = ""
  var priority = ""
  var assigneeId = ""
  var hasDate = false
  var targetDate = Date()
  var labels: [String] = []
  var newLabel = ""
  var addingLabel = false
  var images: [SharedImage] = []
  var posts: [SharePost] = []
  var isPublic = false
  var publicDescription = ""
  var sending = false
  var sent = false
  var writingTitle = false

  static let priorities = ["urgent", "high", "normal", "low"]
  static let maxImages = 10
  /// The server takes images up to 8 MB (POST /v1/feedback/attachments).
  private static let maxImageBytes = 8 * 1024 * 1024

  private var client: ShareClient?
  /// Which title request counts: a newer one makes an older answer stale.
  private var titleRun = 0
  /// Uploads that went through, so a retry after a failed save does not send them twice.
  private var uploaded: [UUID: ShareAttachment] = [:]

  var project: ShareProject? { projects.first { $0.id == projectId } }
  var board: ShareBoard? { project?.board }
  var canSend: Bool { !(title.trimmed.isEmpty && details.trimmed.isEmpty) && project != nil && !sending && !sent }

  // MARK: Loading

  func start(_ extensionItems: [NSExtensionItem]) async {
    guard let client = ShareClient.current() else { phase = .signedOut; return }
    self.client = client
    async let shared: Void = read(extensionItems)
    await loadBoards(client)
    await shared
  }

  private func loadBoards(_ client: ShareClient) async {
    struct Response: Decodable { let projects: [ShareProject] }
    struct Team: Decodable { let agents: [ShareAgent] }
    do {
      let response: Response = try await client.get("/v1/admin/projects")
      projects = response.projects.filter { $0.board?.enabled == true }
      // The team is optional: without it an item is simply not assigned.
      if let team: Team = try? await client.get("/v1/admin/agents") { agents = team.agents }
    } catch ShareError.signedOut {
      phase = .signedOut
      return
    } catch {
      self.error = error.localizedDescription
    }
    guard !projects.isEmpty else {
      phase = error.isEmpty ? .noBoard : .failed
      return
    }
    let last = SharedStore.lastProjectId
    select(project: projects.contains { $0.id == last } ? last : projects[0].id)
    phase = .ready
  }

  /// Another project has its own statuses, labels and feedback: those start over.
  func select(project id: String) {
    guard id != projectId else { return }
    projectId = id
    status = board?.defaultStatusKey ?? ""
    labels = []
    posts = []
    assigneeId = ""
  }

  // MARK: What was shared

  /// Images become attachments, a link or text becomes the description, a page's title the title.
  private func read(_ extensionItems: [NSExtensionItem]) async {
    var lines: [String] = []
    for item in extensionItems {
      let heading = firstLine(item.attributedTitle?.string) ?? firstLine(item.attributedContentText?.string)
      var gotLink = false
      for provider in item.attachments ?? [] {
        if let image = imageType(of: provider) {
          if let data = try? await loadData(of: provider, type: image) { addImage(data: data) }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier), let url = try? await loadURL(of: provider) {
          if url.isFileURL {
            if UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) == true, let data = try? Data(contentsOf: url) { addImage(data: data) }
          } else {
            gotLink = true
            lines.append(heading.map { "[\($0)](\(url.absoluteString))" } ?? url.absoluteString)
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), let text = try? await loadText(of: provider) {
          let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
          // A page often hands over its address as text too.
          if !trimmed.isEmpty, !lines.contains(where: { $0.contains(trimmed) }) { lines.append(trimmed) }
        }
      }
      if title.isEmpty, let heading, gotLink || !lines.isEmpty { title = String(heading.prefix(200)) }
    }
    if details.isEmpty { details = lines.joined(separator: "\n\n") }
    if title.isEmpty, let first = lines.first.flatMap({ firstLine($0) }), !first.hasPrefix("http") { title = String(first.prefix(200)) }
  }

  private func firstLine(_ text: String?) -> String? {
    text?.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
  }

  /// The PNG, JPEG, GIF or WebP the provider holds if it has one, else any image type.
  private func imageType(of provider: NSItemProvider) -> UTType? {
    let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }.filter { $0.conforms(to: .image) }
    return types.first { [UTType.png, .jpeg, .gif, .webP].contains($0) } ?? types.first
  }

  private func loadData(of provider: NSItemProvider, type: UTType) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, error in
        if let data { continuation.resume(returning: data) } else { continuation.resume(throwing: error ?? ShareError.unreadable) }
      }
    }
  }

  private func loadURL(of provider: NSItemProvider) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
        if let url = item as? URL { continuation.resume(returning: url) }
        else if let text = item as? String, let url = URL(string: text) { continuation.resume(returning: url) }
        else { continuation.resume(throwing: error ?? ShareError.unreadable) }
      }
    }
  }

  private func loadText(of provider: NSItemProvider) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, error in
        if let text = item as? String { continuation.resume(returning: text) }
        else if let attributed = item as? NSAttributedString { continuation.resume(returning: attributed.string) }
        else { continuation.resume(throwing: error ?? ShareError.unreadable) }
      }
    }
  }

  // MARK: Images

  /// Keeps PNG, JPEG, GIF and WebP as they are; anything else (HEIC) or anything over 8 MB becomes a JPEG
  /// that fits. A photo is decoded once, so a 48 MP picture stays inside the extension's memory.
  func addImage(data: Data) {
    guard images.count < Self.maxImages else { error = String(localized: "An item takes up to 10 images and files."); return }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil), let identifier = CGImageSourceGetType(source), let type = UTType(identifier as String) else {
      error = String(localized: "Could not read that image.")
      return
    }
    let number = images.count + 1
    var bytes = data
    var mime = type.preferredMIMEType ?? "image/jpeg"
    var ext = type.preferredFilenameExtension ?? "jpg"
    if ![UTType.png, .jpeg, .gif, .webP].contains(type) || data.count > Self.maxImageBytes {
      guard let jpeg = Self.jpeg(from: source) else { error = String(localized: "Could not read that image."); return }
      bytes = jpeg
      mime = "image/jpeg"
      ext = "jpg"
    }
    guard let preview = Self.thumbnail(from: source) else { error = String(localized: "Could not read that image."); return }
    images.append(SharedImage(data: bytes, filename: "Image \(number).\(ext)", mime: mime, preview: preview))
  }

  func removeImage(_ id: UUID) {
    images.removeAll { $0.id == id }
    uploaded[id] = nil
  }

  private static func thumbnail(from source: CGImageSource) -> UIImage? {
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 480]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
  }

  /// A JPEG under the limit: the full size at 0.85, then smaller until it fits.
  private static func jpeg(from source: CGImageSource) -> Data? {
    for longest in [0, 3600, 2400, 1600] as [Int] {
      var options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true]
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
      let full = max(properties?[kCGImagePropertyPixelWidth] as? Int ?? 0, properties?[kCGImagePropertyPixelHeight] as? Int ?? 0)
      options[kCGImageSourceThumbnailMaxPixelSize] = longest == 0 ? max(full, 1) : longest
      guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
            let data = UIImage(cgImage: image).jpegData(compressionQuality: longest == 0 ? 0.85 : 0.75) else { continue }
      if data.count <= maxImageBytes { return data }
    }
    return nil
  }

  // MARK: Labels

  func toggle(label key: String) {
    if labels.contains(key) { labels.removeAll { $0 == key } } else { labels.append(key) }
  }

  /// A label typed here joins the board's labels (the lists saved whole, as the app does) and this item takes it.
  func addLabel() async {
    let name = String(newLabel.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
    let key = Self.normalizeKey(name)
    guard !key.isEmpty, let client, let project, var board = project.board else { return }
    addingLabel = true
    defer { addingLabel = false }
    if !board.labels.contains(where: { $0.key == key }) {
      struct Lists: Encodable { let statuses: [ShareStatus]; let labels: [ShareLabel] }
      struct Patch: Encodable { let board: Lists }
      struct Saved: Decodable { let project: ShareProject }
      board.labels.append(ShareLabel(key: key, label: name, color: "neutral"))
      do {
        let saved: Saved = try await client.send("/v1/admin/projects/\(project.id)", method: "PATCH", body: Patch(board: Lists(statuses: board.statuses, labels: board.labels)))
        if let index = projects.firstIndex(where: { $0.id == project.id }) { projects[index] = saved.project }
      } catch {
        self.error = error.localizedDescription
        return
      }
    }
    if !labels.contains(key) { labels.append(key) }
    newLabel = ""
  }

  /// FeedbackFormat.normalizeKey: lowercase letters, digits, `_` and `-`, at most 40.
  static func normalizeKey(_ value: String) -> String {
    var key = String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)).lowercased()
    key = key.replacingOccurrences(of: "[^a-z0-9_-]+", with: "-", options: .regularExpression)
    key = key.replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)
    return String(key.prefix(40))
  }

  // MARK: Feedback

  func loadPosts() async throws -> [SharePost] {
    struct Response: Decodable { let posts: [SharePost] }
    guard let client else { return [] }
    let response: Response = try await client.get("/v1/feedback", query: ["project": projectId, "includeHidden": "1", "limit": "500", "sort": "new"])
    return response.posts
  }

  // MARK: Title

  /// The AI reads the description and writes the title (a spinner shows in the field meanwhile). `manual` is the AI
  /// button: it replaces a title and says why when it fails. Otherwise a title typed in the meantime stays.
  func writeTitle(manual: Bool = false) async {
    let description = details.trimmed
    guard !description.isEmpty, let client, !projectId.isEmpty else { return }
    struct Body: Encodable { let description: String }
    struct Reply: Decodable { let title: String }
    titleRun += 1
    let run = titleRun
    writingTitle = true
    defer { if run == titleRun { writingTitle = false } }
    do {
      let reply: Reply = try await client.send("/v1/admin/board-items/suggest-title", query: ["project": projectId], body: Body(description: description))
      guard run == titleRun, manual || title.trimmed.isEmpty else { return }
      title = String(reply.title.prefix(BoardTitle.maxLength))
    } catch {
      if manual, run == titleRun { self.error = error.localizedDescription }
    }
  }

  /// A new item with no title gets one a second after the description stops changing.
  func writeTitleAfterPause() async {
    guard phase == .ready, title.trimmed.isEmpty, !details.trimmed.isEmpty else { return }
    try? await Task.sleep(for: .seconds(BoardTitle.debounce))
    guard !Task.isCancelled else { return }
    await writeTitle()
  }

  // MARK: Send

  private struct NewItem: Encodable {
    var title, description, publicDescription: String
    var labels: [String]
    var attachments: [ShareAttachment]
    var isPublic: Bool
    var status, priority, assigneeId, targetDate: String?
    var feedbackPostIds: [String]?
    enum CodingKeys: String, CodingKey {
      case title, description, publicDescription, labels, attachments, status, priority, assigneeId, targetDate, feedbackPostIds
      case isPublic = "public"
    }
  }

  /// Uploads the images, then creates the item; true once the server has it.
  func send() async -> Bool {
    guard canSend, let client, let project else { return false }
    sending = true
    error = ""
    defer { sending = false }
    // Send with no title: the AI writes it now; with no AI, the description's first line stands in.
    if title.trimmed.isEmpty {
      await writeTitle()
      if title.trimmed.isEmpty { title = BoardTitle.fallback(details) }
    }
    do {
      for image in images where uploaded[image.id] == nil {
        uploaded[image.id] = try await client.upload("/v1/feedback/attachments", query: ["project": project.id], file: image.data, filename: image.filename, mimeType: image.mime)
      }
      let item = NewItem(
        title: String(title.trimmed.prefix(BoardTitle.maxLength)),
        description: details,
        publicDescription: publicDescription,
        labels: labels,
        attachments: images.compactMap { uploaded[$0.id] },
        isPublic: isPublic,
        status: status.isEmpty ? nil : status,
        priority: priority.isEmpty ? nil : priority,
        assigneeId: assigneeId.isEmpty ? nil : assigneeId,
        targetDate: hasDate ? Self.day(targetDate) : nil,
        feedbackPostIds: posts.isEmpty ? nil : posts.map(\.id)
      )
      struct Created: Decodable { let item: Item; struct Item: Decodable { let id: String } }
      let _: Created = try await client.send("/v1/admin/board-items", query: ["project": project.id], body: item)
      SharedStore.lastProjectId = project.id
      sent = true
      return true
    } catch ShareError.signedOut {
      phase = .signedOut
    } catch {
      self.error = error.localizedDescription
    }
    return false
  }

  /// "2026-11-15", the day as the person picked it; a calendar day, so no time zone moves it.
  private static func day(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
  }
}

private extension String {
  var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
