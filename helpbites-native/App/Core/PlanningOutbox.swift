import Foundation

/// A new planning item the server has not taken yet: made offline in the app or the share sheet, or on its way up.
struct PendingItem: Codable, Identifiable, Sendable {
  /// `local-…`: the card's id on this device until it is uploaded, and the `clientId` that keeps a retried upload
  /// from making a second item.
  let id: String
  /// The server and workspace it belongs to: it is only ever sent there.
  let endpoint: String
  let workspaceId: String
  let projectId: String
  /// The body of `POST /v1/admin/board-items`. An attachment still on this device has a `local:<file>` url.
  var fields: [String: JSONValue]
  let createdAt: Date
  /// Why the server refused it last time (a label or epic deleted since). It stays, and is tried again.
  var error: String?

  static let prefix = "local-"
  static func isLocal(_ id: String) -> Bool { id.hasPrefix(prefix) }

  init(endpoint: String, workspaceId: String, projectId: String, fields: [String: JSONValue]) {
    id = Self.prefix + UUID().uuidString.lowercased()
    self.endpoint = endpoint
    self.workspaceId = workspaceId
    self.projectId = projectId
    self.fields = fields
    createdAt = Date()
  }
}

/// The outbox of new planning items, on disk so none is ever lost: an item is written here before it is sent and
/// removed only once the server has answered with it, and the files it carries wait here too. One JSON file per
/// item, so the share sheet can add one while the app sends another. In the App Group on iPhone and iPad (the share
/// sheet writes, the app sends), in Application Support so the system never purges it.
/// Compiled into the app and the share extension.
enum PlanningOutbox {
  static let directory: URL = {
    #if os(iOS)
    let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.group)?.appending(path: "Library/Application Support", directoryHint: .isDirectory)
    #else
    let base: URL? = nil
    #endif
    let url = (base ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]).appending(path: "outbox", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: url.appending(path: "files", directoryHint: .isDirectory), withIntermediateDirectories: true)
    return url
  }()

  private static func entryURL(_ id: String) -> URL { directory.appending(path: "\(id).json") }

  static func save(_ entry: PendingItem) throws {
    try JSONEncoder().encode(entry).write(to: entryURL(entry.id), options: .atomic)
  }

  static func load(_ id: String) -> PendingItem? {
    (try? Data(contentsOf: entryURL(id))).flatMap { try? JSONDecoder().decode(PendingItem.self, from: $0) }
  }

  /// Every waiting item, oldest first: the order they are sent in, so an epic goes up before its cards.
  static func all() -> [PendingItem] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    return names.filter { $0.hasSuffix(".json") }.compactMap { load(String($0.dropLast(5))) }.sorted { $0.createdAt < $1.createdAt }
  }

  /// The item leaves the outbox. Its files go with it, unless an editor still shows them (`keepingFiles`).
  static func remove(_ entry: PendingItem, keepingFiles: Bool = false) {
    if !keepingFiles { localFiles(entry.fields).forEach { try? FileManager.default.removeItem(at: $0) } }
    try? FileManager.default.removeItem(at: entryURL(entry.id))
  }

  // MARK: Files

  static let localScheme = "local:"

  /// Keeps a file for an item that is not uploaded yet, and returns the attachment url that stands for it.
  static func keep(_ data: Data, ext: String) throws -> String {
    let name = "\(UUID().uuidString.lowercased()).\(ext)"
    try data.write(to: directory.appending(path: "files/\(name)"), options: .atomic)
    return localScheme + name
  }

  /// The same for a file already on disk (a video), copied rather than read into memory.
  static func keep(copying file: URL, ext: String) throws -> String {
    let name = "\(UUID().uuidString.lowercased()).\(ext)"
    try FileManager.default.copyItem(at: file, to: directory.appending(path: "files/\(name)"))
    return localScheme + name
  }

  /// The file behind a `local:` attachment url; nil for one already on the server.
  static func fileURL(_ attachmentURL: String) -> URL? {
    guard attachmentURL.hasPrefix(localScheme) else { return nil }
    let name = (String(attachmentURL.dropFirst(localScheme.count)) as NSString).lastPathComponent
    return name.isEmpty ? nil : directory.appending(path: "files/\(name)")
  }

  static func localFiles(_ fields: [String: JSONValue]) -> [URL] {
    (fields["attachments"]?.array ?? []).compactMap { $0.object?["url"]?.string.flatMap(fileURL) }
  }

  // MARK: Sending

  /// Uploads the files still on this device, then creates the item with its `clientId`; the entry leaves the outbox
  /// once the server has it. Each upload that goes through is saved at once, so a retry never sends it again. A file
  /// that has gone from the disk is dropped rather than holding the item back forever. Throws whatever the server or
  /// the network did; the entry then stays as it is.
  @MainActor static func deliver<Created>(
    _ entry: inout PendingItem,
    upload: (_ file: URL, _ name: String, _ mime: String) async throws -> JSONValue,
    create: (_ body: [String: JSONValue]) async throws -> Created
  ) async throws -> Created {
    var attachments = entry.fields["attachments"]?.array ?? []
    var index = 0
    while index < attachments.count {
      let file = attachments[index].object ?? [:]
      guard let local = file["url"]?.string.flatMap(fileURL) else { index += 1; continue }
      if FileManager.default.fileExists(atPath: local.path) {
        attachments[index] = try await upload(local, file["name"]?.string ?? local.lastPathComponent, file["mime"]?.string ?? "application/octet-stream")
        index += 1
      } else {
        attachments.remove(at: index)
      }
      entry.fields["attachments"] = .array(attachments)
      try save(entry)
      try? FileManager.default.removeItem(at: local)
    }
    var body = entry.fields
    body["clientId"] = .string(entry.id)
    let created = try await create(body)
    remove(entry)
    return created
  }

  /// Once `localId` is on the server as `serverId`, the items still waiting that named it as their epic name it too.
  static func replace(_ localId: String, with serverId: String) {
    for var entry in all() {
      var changed = false
      for key in ["epicId", "releaseId"] where entry.fields[key]?.string == localId {
        entry.fields[key] = .string(serverId)
        changed = true
      }
      if changed { try? save(entry) }
    }
  }
}
