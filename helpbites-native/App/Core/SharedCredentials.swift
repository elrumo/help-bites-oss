import Foundation
import Security

/// What the share extension (`HelpBitesShare`) needs from the app: who is signed in, on which server, in which
/// workspace. It travels through the App Group, which is also a keychain access group, so the session token
/// needs no second capability. The app writes it; the extension only reads it.
/// Compiled into both targets.
enum SharedStore {
  static let group = "group.com.helpbites.operator"
  private static let endpointKey = "endpoint"
  private static let workspaceKey = "workspace"
  private static let projectKey = "lastBoardProject"

  /// The group's defaults on iOS; the Mac has no extension and keeps the app's own.
  static var defaults: UserDefaults {
    #if os(iOS)
    UserDefaults(suiteName: group) ?? .standard
    #else
    .standard
    #endif
  }

  static func publish(endpoint: String, workspaceId: String) {
    defaults.set(endpoint, forKey: endpointKey)
    defaults.set(workspaceId, forKey: workspaceKey)
  }

  static var endpoint: String { defaults.string(forKey: endpointKey) ?? "" }
  static var workspaceId: String { defaults.string(forKey: workspaceKey) ?? "" }

  /// The project the last shared item went to, so the next one starts there.
  static var lastProjectId: String {
    get { defaults.string(forKey: projectKey) ?? "" }
    set { defaults.set(newValue, forKey: projectKey) }
  }
}

enum KeychainStore {
  #if os(macOS)
  /// The Mac has no extension to share with: a build under another bundle id (a dev copy) keeps its own session
  /// instead of reading or clearing the installed app's.
  private static let service = Bundle.main.bundleIdentifier ?? "com.helpbites.operator"
  #else
  private static let service = "com.helpbites.operator"
  #endif
  private static let account = "session"

  private static func query(shared: Bool) -> [CFString: Any] {
    var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    #if os(iOS)
    if shared { query[kSecAttrAccessGroup] = SharedStore.group }
    #endif
    return query
  }

  private static func read(_ base: [CFString: Any]) -> String? {
    var query = base
    query[kSecReturnData] = true
    var value: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  /// The session token. A token saved before the extension existed sits outside the shared group: it is found
  /// and moved there, so the extension sees it from now on.
  static func load() -> String? {
    if let token = read(query(shared: true)) { return token }
    guard let legacy = read(query(shared: false)) else { return nil }
    save(legacy)
    return legacy
  }

  /// Only the shared copy: what the extension is allowed to see.
  static func loadShared() -> String? { read(query(shared: true)) }

  static func save(_ token: String) {
    remove()
    var item = query(shared: true)
    item[kSecValueData] = Data(token.utf8)
    // iOS keeps it off backups and available once unlocked; the Mac's file keychain has no such attribute without a signed team.
    #if os(iOS)
    item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    #endif
    // A build without the App Group capability cannot write to the group: keep the app itself signed in.
    if SecItemAdd(item as CFDictionary, nil) != errSecSuccess {
      item = query(shared: false)
      item[kSecValueData] = Data(token.utf8)
      #if os(iOS)
      item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      #endif
      SecItemAdd(item as CFDictionary, nil)
    }
  }

  static func remove() {
    SecItemDelete(query(shared: false) as CFDictionary)
    SecItemDelete(query(shared: true) as CFDictionary)
  }
}
