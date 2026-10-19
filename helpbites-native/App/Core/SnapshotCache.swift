import Foundation

/// Last-known server state kept on disk, so the app can paint its shell (who you are, your
/// projects, the inbox's first page) on launch before the network answers, then refresh.
/// Lives in Caches, so the system may drop it; a miss is just a slower first paint.
enum SnapshotCache {
  private static let directory: URL = {
    let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "snapshots", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }()

  static func load<Value: Decodable>(_ type: Value.Type, _ key: String) -> Value? {
    guard let data = try? Data(contentsOf: directory.appending(path: key + ".json")) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  /// Written off the caller's thread; a failed write only costs the next launch its head start.
  static func save<Value: Encodable & Sendable>(_ value: Value, _ key: String) {
    let url = directory.appending(path: key + ".json")
    Task.detached(priority: .utility) {
      if let data = try? JSONEncoder().encode(value) { try? data.write(to: url, options: .atomic) }
    }
  }

  /// Sign-out and server changes: nothing cached belongs to the next account.
  static func clear() {
    try? FileManager.default.removeItem(at: directory)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
}
