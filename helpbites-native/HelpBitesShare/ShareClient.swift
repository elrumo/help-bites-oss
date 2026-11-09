import Foundation

// The few calls the share sheet makes, against the same /v1/admin/* API as the panel and the app:
//   GET   /v1/admin/projects          every project with its Planning board (statuses, labels)
//   GET   /v1/admin/agents            who an item can be assigned to
//   GET   /v1/feedback                the posts an item can answer
//   POST  /v1/feedback/attachments    one image or video
//   POST  /v1/admin/board-items       the item
//   PATCH /v1/admin/projects/:id      a new label (the board's lists, saved whole as in BoardStore.saveLists)
// Offline, the boards are the ones the app last read (ResponseCache), and the item waits in the outbox
// (PlanningOutbox) for the app to upload it.

enum ShareError: LocalizedError {
  case signedOut, server(String), unreadable

  var errorDescription: String? {
    switch self {
    case .signedOut: String(localized: "Open HelpBites and sign in, then share again.")
    case .server(let message): message
    case .unreadable: String(localized: "Could not read that image.")
    }
  }
}

/// The project row, cut down to what an item needs.
struct ShareProject: Decodable, Identifiable {
  let id, name: String
  let board: ShareBoard?
  let feedback: Feedback?
  struct Feedback: Decodable { let enabled: Bool?; let roadmap: Bool? }

  /// The public roadmap is published through public feedback: on, with its Roadmap view.
  var roadmapReady: Bool { feedback?.enabled == true && feedback?.roadmap == true && board?.enabled == true }
}

struct ShareBoard: Codable {
  var enabled: Bool
  var statuses: [ShareStatus]
  var labels: [ShareLabel]

  static let roadmapCategories = ["planned", "active", "done"]
  var defaultStatusKey: String { (statuses.first { $0.isDefault == true } ?? statuses.first)?.key ?? "" }
  func status(_ key: String) -> ShareStatus? { statuses.first { $0.key == key } }
  func isOnRoadmap(_ key: String) -> Bool { Self.roadmapCategories.contains(status(key)?.category ?? "open") }
}

/// Every field the server stores, so saving the lists again drops nothing.
struct ShareStatus: Codable, Identifiable {
  var key, label, category, color: String
  var isDefault, notify: Bool?
  var id: String { key }
}

struct ShareLabel: Codable, Identifiable {
  var key, label, color: String
  var id: String { key }
}

struct ShareAgent: Decodable, Identifiable {
  let id, username: String
  let name: String?
  var displayName: String { (name ?? "").isEmpty ? username : name ?? username }
}

struct SharePost: Codable, Identifiable, Equatable {
  let id, title: String
  let number: Int?
  let voteCount: Int?
}

/// An upload's answer, and what an item stores (shared/itemAttachments.ts).
struct ShareAttachment: Codable, Equatable {
  let url, name, mime: String
  let size: Int
}

struct ShareClient {
  let baseURL: URL
  let token: String
  let workspaceId: String

  /// The session and server the app published, or nil while nobody is signed in.
  static func current() -> ShareClient? {
    guard let token = KeychainStore.loadShared(), !token.isEmpty,
          let base = URL(string: SharedStore.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), base.host != nil else { return nil }
    return ShareClient(baseURL: base, token: token, workspaceId: SharedStore.workspaceId)
  }

  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 120
    return URLSession(configuration: configuration)
  }()

  /// A GET; its answer is kept in the App Group's response cache, which the app writes too.
  func get<Value: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> Value {
    let request = try makeRequest(path, method: "GET", query: query)
    let (data, response) = try await Self.session.data(for: request)
    let value: Value = try Self.decode(data, response)
    if let url = request.url { ResponseCache.save(data, for: url, workspaceId: workspaceId) }
    return value
  }

  /// The last answer to that GET, from this sheet or the app, for when the server cannot be reached.
  func cached<Value: Decodable>(_ path: String, query: [String: String] = [:]) -> Value? {
    guard let url = try? makeRequest(path, method: "GET", query: query).url, let data = ResponseCache.load(url, workspaceId: workspaceId) else { return nil }
    return try? JSONDecoder().decode(Value.self, from: data)
  }

  func send<Value: Decodable, Body: Encodable>(_ path: String, method: String = "POST", query: [String: String] = [:], body: Body) async throws -> Value {
    var request = try makeRequest(path, method: method, query: query)
    request.httpBody = try JSONEncoder().encode(body)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    return try await run(request)
  }

  /// A multipart POST whose `file` part is read from disk, for a video: the body is written to a temporary file in
  /// chunks and sent from there, so a 100 MB video never sits in memory (an extension is killed at about 120 MB).
  func upload(_ path: String, query: [String: String], fileURL: URL, filename: String, mimeType: String) async throws -> ShareAttachment {
    let boundary = "HelpBites-\(UUID().uuidString)"
    let body = FileManager.default.temporaryDirectory.appending(path: "upload-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: body) }
    FileManager.default.createFile(atPath: body.path, contents: nil)
    let output = try FileHandle(forWritingTo: body)
    let input = try FileHandle(forReadingFrom: fileURL)
    defer { try? input.close() }
    try output.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8))
    while let chunk = try input.read(upToCount: 1 << 20), !chunk.isEmpty { try output.write(contentsOf: chunk) }
    try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
    try output.close()
    var request = try makeRequest(path, method: "POST", query: query)
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    let (data, response) = try await Self.session.upload(for: request, fromFile: body)
    return try Self.decode(data, response)
  }

  private func makeRequest(_ path: String, method: String, query: [String: String]) throws -> URLRequest {
    guard var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false) else { throw ShareError.server(String(localized: "The API URL is invalid.")) }
    components.queryItems = query.isEmpty ? nil : query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    guard let url = components.url else { throw ShareError.server(String(localized: "The API URL is invalid.")) }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if !workspaceId.isEmpty { request.setValue(workspaceId, forHTTPHeaderField: "X-Workspace") }
    return request
  }

  private struct ErrorBody: Decodable { let statusMessage, message, error: String? }

  private func run<Value: Decodable>(_ request: URLRequest) async throws -> Value {
    let (data, response) = try await Self.session.data(for: request)
    return try Self.decode(data, response)
  }

  private static func decode<Value: Decodable>(_ data: Data, _ response: URLResponse) throws -> Value {
    guard let http = response as? HTTPURLResponse else { throw ShareError.server(String(localized: "Invalid server response.")) }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 { throw ShareError.signedOut }
      let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
      throw ShareError.server(body?.statusMessage ?? body?.message ?? body?.error ?? String(localized: "Request failed (\(http.statusCode))."))
    }
    return try JSONDecoder().decode(Value.self, from: data)
  }
}
