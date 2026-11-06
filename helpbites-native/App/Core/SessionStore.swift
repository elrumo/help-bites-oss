import Foundation
import Observation

enum SessionPhase { case loading, signedOut, signedIn }

@MainActor @Observable final class SessionStore {
  var api: APIClient
  /// `.signedIn` from the first frame when a session and its last `/me` are on disk; `bootstrap()` then confirms it.
  private(set) var phase: SessionPhase = .loading
  private(set) var agent: Agent?
  /// The workspace this app acts in, your role there, every workspace you belong to, and the plan.
  private(set) var context: MeResponse?
  private(set) var token = ""
  private(set) var endpoint: String
  var needsSetup = false
  /// The server lets anyone create an account (HelpBites Cloud), not just the first operator.
  private(set) var signupOpen = false
  var error = ""
  /// A password-reset link opened into the app, picked up by the sign-in screen.
  var pendingResetLink = ""
  private(set) var workspaceId = ""

  var workspace: WorkspaceSummary? { context?.workspace }
  var workspaces: [WorkspaceSummary] { context?.workspaces ?? [] }
  /// Your role in this workspace: owner, admin or agent. Owners and admins manage the team, AI and connections.
  var role: String { context?.role ?? "agent" }
  var canManage: Bool { role == "owner" || role == "admin" }
  var plan: PlanSummary? { context?.plan }
  /// Whether the workspace's plan includes a feature (absent keys are included).
  func hasFeature(_ key: String) -> Bool { context?.features?[key] ?? true }
  /// Whether the plan leaves a feature out, to say so before the server refuses (web: usePlanLocks).
  /// Never on an unlimited plan, which every self-hosted install is.
  func isLocked(_ key: String) -> Bool { plan.map { !$0.unlimited } == true && !hasFeature(key) }

  init() {
    workspaceId = UserDefaults.standard.string(forKey: "helpbites.workspace") ?? ""
    let configured = Bundle.main.object(forInfoDictionaryKey: "APP_BASE_URL") as? String ?? "https://helpbites.app"
    let saved = UserDefaults.standard.string(forKey: "helpbites.apiBaseURL") ?? configured
    endpoint = saved
    api = APIClient(baseURL: saved)
    // Paint the signed-in shell straight away from what we knew last time; bootstrap() revalidates.
    token = KeychainStore.load() ?? ""
    SharedStore.publish(endpoint: saved, workspaceId: workspaceId)
    if !token.isEmpty, let cached = SnapshotCache.load(MeResponse.self, "me") {
      agent = cached.agent
      context = cached
      phase = .signedIn
    }
  }

  func bootstrap() async {
    guard !token.isEmpty else { await checkSetup(); return }
    await api.setWorkspace(workspaceId)
    let optimistic = phase == .signedIn
    do {
      let me: MeResponse = try await api.get("/v1/admin/me", token: token)
      apply(me); phase = .signedIn; await registerPushDevice()
    } catch {
      // Offline with a remembered session: stay in, the screens show their own errors.
      if optimistic, case APIError.transport = error { return }
      await recover(error)
    }
  }

  /// Takes the server's view of who you are and where you are working. A stale remembered
  /// workspace falls back to your default on the server, so adopt whatever it names.
  private func apply(_ me: MeResponse) {
    agent = me.agent
    context = me
    SnapshotCache.save(me, "me")
    if let id = me.workspace?.id, id != workspaceId {
      workspaceId = id
      UserDefaults.standard.set(id, forKey: "helpbites.workspace")
      SharedStore.publish(endpoint: endpoint, workspaceId: id)
      Task { await api.setWorkspace(id) }
    }
  }

  /// The welcome tour is finished or skipped: clear it on the server so no device shows it again.
  func finishTour() async {
    struct Input: Encodable, Sendable { let tourPending: Bool }
    let _: EmptyBody? = try? await send("/v1/admin/me", method: "PATCH", body: Input(tourPending: false))
    await refreshContext()
  }

  /// Re-reads `/me` (after a rename, a new workspace, a role change).
  func refreshContext() async {
    if let me: MeResponse = try? await get("/v1/admin/me") { apply(me) }
  }

  /// Work in another workspace: everything on screen belongs to the old one, so the app starts over.
  func switchWorkspace(_ id: String) async {
    guard !id.isEmpty, id != workspaceId else { return }
    workspaceId = id
    UserDefaults.standard.set(id, forKey: "helpbites.workspace")
    SharedStore.publish(endpoint: endpoint, workspaceId: id)
    await api.setWorkspace(id)
    SnapshotCache.clear()
    memo.removeAll()
    struct Input: Encodable, Sendable { let defaultWorkspaceId: String }
    let _: EmptyBody? = try? await send("/v1/admin/me", method: "PATCH", body: Input(defaultWorkspaceId: id))
    await refreshContext()
    generation += 1
  }
  /// Bumped on a workspace switch; the shell keys its screens on it to rebuild them.
  private(set) var generation = 0

  func checkSetup() async {
    do { let setup: SetupStatus = try await api.get("/v1/admin/setup"); needsSetup = setup.needsSetup; signupOpen = setup.signup == "open" }
    catch { self.error = error.localizedDescription }
    phase = .signedOut
  }

  func login(username: String, password: String) async {
    await authenticate("/v1/admin/login", body: Credentials(username: username, password: password))
  }

  func setup(username: String, password: String, name: String, email: String) async {
    await authenticate("/v1/admin/setup", body: SetupInput(username: username, password: password, name: name, email: email))
  }

  func signUp(name: String, email: String, password: String) async {
    await authenticate("/v1/cloud/signup", body: SignUpInput(name: name, email: email, password: password))
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

  func clear() { KeychainStore.remove(); SnapshotCache.clear(); memo.removeAll(); token = ""; agent = nil; context = nil; phase = .signedOut }

  func setEndpoint(_ value: String) async {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: normalized), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
      error = String(localized: "Enter a valid http(s) API URL.")
      return
    }
    guard normalized != endpoint else { return }
    UserDefaults.standard.set(normalized, forKey: "helpbites.apiBaseURL")
    endpoint = normalized
    api = APIClient(baseURL: normalized)
    workspaceId = ""
    UserDefaults.standard.removeObject(forKey: "helpbites.workspace")
    SharedStore.publish(endpoint: normalized, workspaceId: "")
    clear()
    await checkSetup()
  }

  // MARK: Requests
  // Every screen calls the admin API through these: they carry the bearer and
  // turn a 401 into "sign in again", the way the web panel's useAgent().api does.

  func get<Value: Decodable & Sendable>(_ path: String, query: [String: String] = [:]) async throws -> Value {
    let items = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    let value: Value = try await guarded { try await api.get(path, token: token, query: items) }
    remember(value, Self.memoKey(path, query))
    return value
  }

  // MARK: Last answers
  // A page you come back to paints straight away from what it showed last time (`peek`), then
  // its own load refreshes it, the way the web keeps a page's data while it refetches.

  private var memo: [String: any Sendable] = [:]

  /// The last answer to this GET in this session, if any. Read it only to fill an empty page.
  func peek<Value: Sendable>(_ path: String, query: [String: String] = [:]) -> Value? {
    memo[Self.memoKey(path, query)] as? Value
  }

  private func remember(_ value: some Sendable, _ key: String) {
    // ponytail: drops everything past 300 answers; an LRU if long sessions ever need more.
    if memo.count > 300 { memo.removeAll(keepingCapacity: true) }
    memo[key] = value
  }

  private static func memoKey(_ path: String, _ query: [String: String]) -> String {
    query.isEmpty ? path : path + "?" + query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
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

  /// POST with the file itself as the body.
  func uploadRaw<Value: Decodable & Sendable>(_ path: String, file: Data) async throws -> Value {
    try await guarded { try await api.uploadRaw(path, token: token, file: file) }
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
      await api.setWorkspace(workspaceId)
      await refreshContext()
      await registerPushDevice()
    } catch {
      // A 401 here is a bad login, not an expired session.
      if case APIError.unauthorized = error { self.error = String(localized: "Wrong email or password.") }
      else { self.error = error.localizedDescription }
    }
  }

  func registerPushDevice() async {
    let push = PushRegistration.shared
    push.enable()
    guard !push.token.isEmpty else { return }
    let platform = Platform.deviceName
    do { let _: EmptyBody = try await api.send("/v1/admin/devices", method: "POST", token: token, body: DeviceInput(token: push.token, platform: platform, env: push.environment)) }
    catch { if case APIError.unauthorized = error { await recover(error) } }
  }
}

private struct Credentials: Codable, Sendable { let username, password: String }
private struct SignUpInput: Codable, Sendable { let name, email, password: String }
private struct SetupInput: Codable, Sendable { let username, password, name, email: String }
struct EmptyBody: Codable, Sendable {}
private struct DeviceInput: Codable, Sendable { let token, platform, env: String }
