import Foundation
import Observation

enum SessionPhase { case loading, signedOut, signedIn }

@MainActor @Observable final class SessionStore {
  var api: APIClient
  private(set) var phase: SessionPhase = .loading
  private(set) var agent: Agent?
  private(set) var token = ""
  private(set) var endpoint: String
  var needsSetup = false
  var error = ""
  /// A password-reset link opened into the app, picked up by the sign-in screen.
  var pendingResetLink = ""

  init() {
    let configured = Bundle.main.object(forInfoDictionaryKey: "APP_BASE_URL") as? String ?? "https://help.example.com"
    let saved = UserDefaults.standard.string(forKey: "helpbites.apiBaseURL") ?? configured
    endpoint = saved
    api = APIClient(baseURL: saved)
  }

  func bootstrap() async {
    token = KeychainStore.load() ?? ""
    guard !token.isEmpty else { await checkSetup(); return }
    do {
      let me: MeResponse = try await api.get("/v1/admin/me", token: token)
      agent = me.agent; phase = .signedIn; await registerPushDevice()
    } catch { await recover(error) }
  }

  func checkSetup() async {
    do { let setup: SetupStatus = try await api.get("/v1/admin/setup"); needsSetup = setup.needsSetup }
    catch { self.error = error.localizedDescription }
    phase = .signedOut
  }

  func login(username: String, password: String) async {
    await authenticate("/v1/admin/login", body: Credentials(username: username, password: password))
  }

  func setup(username: String, password: String, name: String, email: String) async {
    await authenticate("/v1/admin/setup", body: SetupInput(username: username, password: password, name: name, email: email))
  }

  func signOut() async {
    if !token.isEmpty {
      if !PushRegistration.shared.token.isEmpty { try? await api.delete("/v1/admin/devices/\(PushRegistration.shared.token)", token: token) }
      let _: EmptyBody? = try? await api.send("/v1/admin/logout", method: "POST", token: token, body: EmptyBody())
    }
    clear()
  }

  func recover(_ error: Error) async {
    if case APIError.unauthorized = error { clear(); await checkSetup() }
    else { self.error = error.localizedDescription }
  }

  func clear() { KeychainStore.remove(); token = ""; agent = nil; phase = .signedOut }

  func setEndpoint(_ value: String) async {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: normalized), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
      error = "Enter a valid http(s) API URL."
      return
    }
    guard normalized != endpoint else { return }
    UserDefaults.standard.set(normalized, forKey: "helpbites.apiBaseURL")
    endpoint = normalized
    api = APIClient(baseURL: normalized)
    clear()
    await checkSetup()
  }

  // MARK: Requests
  // Every screen calls the admin API through these: they carry the bearer and
  // turn a 401 into "sign in again", the way the web panel's useAgent().api does.

  func get<Value: Decodable & Sendable>(_ path: String, query: [String: String] = [:]) async throws -> Value {
    let items = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return try await guarded { try await api.get(path, token: token, query: items) }
  }

  func send<Value: Decodable & Sendable, Body: Encodable & Sendable>(_ path: String, method: String = "POST", body: Body) async throws -> Value {
    try await guarded { try await api.send(path, method: method, token: token, body: body) }
  }

  func send<Value: Decodable & Sendable>(_ path: String, method: String = "POST") async throws -> Value {
    try await guarded { try await api.send(path, method: method, token: token, body: EmptyBody()) }
  }

  func delete(_ path: String) async throws {
    try await guarded { try await api.delete(path, token: token) }
  }

  /// Multipart upload: `fields` as text parts, then the file under `fileField`.
  func upload<Value: Decodable & Sendable>(_ path: String, fields: [String: String] = [:], file: Data, filename: String, mimeType: String, fileField: String = "file") async throws -> Value {
    try await guarded { try await api.upload(path, token: token, fields: fields, file: file, filename: filename, mimeType: mimeType, fileField: fileField) }
  }

  /// Raw bytes, for downloads such as a knowledge document's source file.
  func download(_ path: String) async throws -> Data {
    try await guarded { try await api.data(path, token: token) }
  }

  private func guarded<Value>(_ operation: () async throws -> Value) async throws -> Value {
    do { return try await operation() }
    catch {
      if case APIError.unauthorized = error { clear(); await checkSetup() }
      throw error
    }
  }

  private func authenticate<Body: Encodable & Sendable>(_ path: String, body: Body) async {
    error = ""
    do {
      let result: LoginResponse = try await api.send(path, method: "POST", body: body)
      token = result.sessionToken; agent = result.agent; KeychainStore.save(token); needsSetup = false; phase = .signedIn
      await registerPushDevice()
    } catch { self.error = error.localizedDescription }
  }

  func registerPushDevice() async {
    let push = PushRegistration.shared
    guard !push.token.isEmpty else { return }
    let platform = Platform.deviceName
    do { let _: EmptyBody = try await api.send("/v1/admin/devices", method: "POST", token: token, body: DeviceInput(token: push.token, platform: platform, env: push.environment)) }
    catch { if case APIError.unauthorized = error { await recover(error) } }
  }
}

private struct Credentials: Codable, Sendable { let username, password: String }
private struct SetupInput: Codable, Sendable { let username, password, name, email: String }
struct EmptyBody: Codable, Sendable {}
private struct DeviceInput: Codable, Sendable { let token, platform, env: String }

enum KeychainStore {
  private static let service = "com.helpbites.operator"
  private static let account = "session"
  static func load() -> String? {
    let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecReturnData: true]
    var value: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func save(_ token: String) {
    remove()
    let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecValueData: Data(token.utf8), kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    SecItemAdd(query as CFDictionary, nil)
  }
  static func remove() {
    let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    SecItemDelete(query as CFDictionary)
  }
}
