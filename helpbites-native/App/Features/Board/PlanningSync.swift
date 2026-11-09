import Foundation
import Observation

/// Sends the outbox (`PlanningOutbox`): new planning items made on this device, in the app or the share sheet,
/// that the server has not taken yet. Every new item goes through it, so none is lost to a dropped connection or a
/// closed app. It sends on launch, on coming back to the app and when the network returns.
/// ponytail: only while the app is open; a background task could send them sooner if that is ever missed.
@MainActor @Observable final class PlanningSync {
  let session: SessionStore
  /// What waits for this server and workspace, oldest first.
  private(set) var pending: [PendingItem] = []
  /// Bumped when an item went up or was refused, so an open board reads its items again.
  private(set) var revision = 0
  /// Uploaded this session: local id → server id, so an editor still open on a waiting item keeps working.
  private var uploaded: [String: String] = [:]
  /// Items on their way up, so one is never sent twice at once.
  private var sending: Set<String> = []
  /// Files uploaded this session, by their name in the outbox: an editor still holding the local copy saves the server's.
  private var sentFiles: [String: JSONValue] = [:]
  private var run: Task<Void, Never>?

  init(session: SessionStore) {
    self.session = session
    reload()
  }

  func reload() {
    pending = PlanningOutbox.all().filter { $0.endpoint == session.endpoint && $0.workspaceId == session.workspaceId }
  }

  func entries(_ projectId: String) -> [PendingItem] { pending.filter { $0.projectId == projectId } }
  func entry(_ id: String) -> PendingItem? { pending.first { $0.id == id } }
  func serverId(_ localId: String) -> String? { uploaded[localId] }

  enum Submitted { case sent(BoardItem), queued(PendingItem) }

  /// A new item: written to the outbox, then sent. With no answer from the server it stays there and goes up later;
  /// a refusal takes it out again and throws, so the editor says why and keeps the form (and its files).
  func submit(_ projectId: String, _ fields: [String: JSONValue]) async throws -> Submitted {
    var entry = PendingItem(endpoint: session.endpoint, workspaceId: session.workspaceId, projectId: projectId, fields: fields)
    try PlanningOutbox.save(entry)
    await settled()
    do {
      return .sent(try await deliver(&entry))
    } catch APIError.server(let message) {
      PlanningOutbox.remove(entry, keepingFiles: true)
      throw APIError.server(message)
    } catch APIError.transport {
      reload()
      return .queued(entry)
    } catch {
      reload()
      throw error
    }
  }

  /// Sends what waits, oldest first, and stops at the first item that gets no answer. One the server refuses keeps
  /// the reason, which its card shows, and is tried again next time.
  func drain() {
    guard run == nil, !session.token.isEmpty else { return }
    run = Task {
      await sendAll()
      run = nil
    }
  }

  /// Waits for a run in progress, so an edit or a delete never races the upload of the same item.
  func settled() async { await run?.value }

  private func sendAll() async {
    reload()
    var changed = false
    outbox: for id in pending.map(\.id) where !sending.contains(id) {
      guard var entry = PlanningOutbox.load(id) else { continue }
      do {
        _ = try await deliver(&entry)
      } catch {
        switch error {
        case APIError.transport, APIError.unauthorized, APIError.cancelled: break outbox
        default:
          entry.error = error.localizedDescription
          try? PlanningOutbox.save(entry)
        }
      }
      changed = true
    }
    reload()
    if changed { revision += 1 }
  }

  private func deliver(_ entry: inout PendingItem) async throws -> BoardItem {
    struct Created: Decodable, Sendable { let item: BoardItem }
    guard sending.insert(entry.id).inserted else { throw APIError.cancelled }
    defer { sending.remove(entry.id) }
    let session = session
    let projectId = entry.projectId
    let created: Created = try await PlanningOutbox.deliver(&entry, upload: { file, name, mime in
      try await upload(file, name: name, mime: mime, projectId: projectId)
    }, create: { body in
      try await session.send("/v1/admin/board-items?project=\(projectId)", body: body)
    })
    uploaded[entry.id] = created.item.id
    PlanningOutbox.replace(entry.id, with: created.item.id)
    reload()
    return created.item
  }

  private func upload(_ file: URL, name: String, mime: String, projectId: String) async throws -> JSONValue {
    // Mapped, so a 100 MB video is read from disk as it is sent.
    let data = try Data(contentsOf: file, options: .mappedIfSafe)
    let attachment: ItemAttachment = try await session.upload("/v1/feedback/attachments?project=\(projectId)", file: data, filename: name, mimeType: mime)
    sentFiles[file.lastPathComponent] = attachment.asJSON
    return attachment.asJSON
  }

  /// An edit to an item already on the server that still names files on this device (its editor was open while it
  /// went up): the copies uploaded meanwhile stand in, and the rest are uploaded now.
  func uploadingFiles(_ fields: [String: JSONValue], projectId: String) async throws -> [String: JSONValue] {
    guard let list = fields["attachments"]?.array, !PlanningOutbox.localFiles(fields).isEmpty else { return fields }
    var files: [JSONValue] = []
    for value in list {
      guard let file = value.object, let local = file["url"]?.string.flatMap(PlanningOutbox.fileURL) else { files.append(value); continue }
      if let sent = sentFiles[local.lastPathComponent] {
        files.append(sent)
      } else if FileManager.default.fileExists(atPath: local.path) {
        files.append(try await upload(local, name: file["name"]?.string ?? local.lastPathComponent, mime: file["mime"]?.string ?? "application/octet-stream", projectId: projectId))
        try? FileManager.default.removeItem(at: local)
      }
    }
    var next = fields
    next["attachments"] = .array(files)
    return next
  }

  /// An edit to an item still waiting, merged into what will be sent (`.null` clears a field); files it no longer
  /// carries are deleted. nil when it is not waiting any more.
  func amend(_ id: String, _ patch: [String: JSONValue]) throws -> PendingItem? {
    guard var entry = PlanningOutbox.load(id) else { return nil }
    let before = Set(PlanningOutbox.localFiles(entry.fields))
    for (key, value) in patch { entry.fields[key] = value == .null ? nil : value }
    entry.error = nil
    try PlanningOutbox.save(entry)
    before.subtracting(PlanningOutbox.localFiles(entry.fields)).forEach { try? FileManager.default.removeItem(at: $0) }
    reload()
    return entry
  }

  /// Deleting a waiting item: it never goes up, and its files go.
  func discard(_ id: String) {
    if let entry = PlanningOutbox.load(id) { PlanningOutbox.remove(entry) }
    reload()
  }
}
