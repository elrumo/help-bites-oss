import Foundation

/// What the share sheet holds, kept on disk while it is open: a sheet closed without sending (a swipe, Cancel, the
/// system) opens with it the next time. Its images and videos live in `files/` beside it from the moment they are
/// added, so nothing of them is held in memory. Gone once the item is sent or the draft deleted.
struct ShareDraft: Codable, Equatable {
  /// The server and workspace it was written for: a draft for another account is never shown.
  var endpoint, workspaceId: String
  var projectId: String
  var title, details, status, priority, assigneeId: String
  var targetDate: Date?
  var labels: [String]
  var posts: [SharePost]
  var isPublic: Bool
  var publicDescription: String
  var files: [File]

  struct File: Codable, Equatable {
    /// Its name in `files/`.
    var name: String
    var filename, mime: String
    /// Size and a hash of the start of what was shared, so sharing the same picture again does not attach it twice.
    var fingerprint: String
    /// Once uploaded: the server's attachment, and the project it was uploaded to (an item takes only its own).
    var uploaded: ShareAttachment?
    var uploadedTo: String
  }

  var isEmpty: Bool {
    title.isEmpty && details.isEmpty && publicDescription.isEmpty && labels.isEmpty && posts.isEmpty && files.isEmpty
  }

  /// Beside the outbox in the App Group, so the system never purges it.
  static let directory = PlanningOutbox.directory.deletingLastPathComponent().appending(path: "share-draft", directoryHint: .isDirectory)
  /// Made again when missing, since `clear()` removes it.
  static var files: URL {
    let url = directory.appending(path: "files", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  private static var file: URL { directory.appending(path: "draft.json") }

  /// The draft for this server and workspace, if one was left.
  static func load(endpoint: String, workspaceId: String) -> ShareDraft? {
    guard let data = try? Data(contentsOf: file), let draft = try? JSONDecoder().decode(ShareDraft.self, from: data),
          draft.endpoint == endpoint, draft.workspaceId == workspaceId, !draft.isEmpty else { return nil }
    return draft
  }

  func save() {
    _ = Self.files
    try? JSONEncoder().encode(self).write(to: Self.file, options: .atomic)
  }

  /// The draft and its files go.
  static func clear() {
    try? FileManager.default.removeItem(at: directory)
  }
}
