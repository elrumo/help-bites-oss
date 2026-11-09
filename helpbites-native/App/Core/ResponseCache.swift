import CryptoKit
import Foundation

/// The last answer to every GET, kept on disk so a screen still opens when the server cannot be reached: the
/// API client and the share sheet write each answer and read it back only when a request gets no answer at all.
/// Keyed by the full URL and the workspace. It sits in the App Group's caches on iPhone and iPad, so the share
/// sheet finds the boards the app loaded; the system may purge it, which only costs an offline open.
/// Compiled into the app and the share extension.
enum ResponseCache {
  static let directory: URL = {
    #if os(iOS)
    let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.group)?.appending(path: "Library/Caches", directoryHint: .isDirectory)
    #else
    let base: URL? = nil
    #endif
    let url = (base ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]).appending(path: "responses", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }()

  private static func file(_ url: URL, workspaceId: String) -> URL {
    let digest = SHA256.hash(data: Data("\(workspaceId)|\(url.absoluteString)".utf8))
    return directory.appending(path: digest.map { String(format: "%02x", $0) }.joined() + ".json")
  }

  /// Written off the caller's thread; a failed write only costs an offline open.
  static func save(_ data: Data, for url: URL, workspaceId: String) {
    let target = file(url, workspaceId: workspaceId)
    Task.detached(priority: .utility) { try? data.write(to: target, options: .atomic) }
  }

  static func load(_ url: URL, workspaceId: String) -> Data? { try? Data(contentsOf: file(url, workspaceId: workspaceId)) }

  /// Sign-out and server changes: nothing cached belongs to the next account.
  static func clear() {
    try? FileManager.default.removeItem(at: directory)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
}
