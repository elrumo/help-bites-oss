import Foundation

enum APIError: LocalizedError {
  case invalidURL, unauthorized, cancelled, server(String), transport(Error)
  var errorDescription: String? {
    switch self {
    case .invalidURL: "The API URL is invalid."
    case .unauthorized: "Your session expired."
    // A screen that went away mid-request: nothing for anyone to read.
    case .cancelled: ""
    case .server(let message): message
    case .transport(let error): error.localizedDescription
    }
  }
}

actor APIClient {
  private let baseURL: URL
  private let session: URLSession
  /// The workspace this client acts in (`X-Workspace`); empty means the agent's default.
  private var workspaceId = ""

  init(baseURL: String) {
    self.baseURL = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) ?? URL(string: "http://localhost:3100")!
    let configuration = URLSessionConfiguration.default
    // AI calls (drafting, checks, generation) answer in a minute or two; the web doesn't cut them off either.
    configuration.timeoutIntervalForRequest = 300
    configuration.httpMaximumConnectionsPerHost = 8
    configuration.waitsForConnectivity = false
    configuration.httpShouldUsePipelining = true
    self.session = URLSession(configuration: configuration)
  }

  func setWorkspace(_ id: String) { workspaceId = id }

  func get<Value: Decodable & Sendable>(_ path: String, token: String? = nil, query: [URLQueryItem] = []) async throws -> Value {
    try await request(path, method: "GET", token: token, query: query, body: Optional<Empty>.none)
  }

  func send<Value: Decodable & Sendable, Body: Encodable & Sendable>(_ path: String, method: String, token: String? = nil, body: Body) async throws -> Value {
    try await request(path, method: method, token: token, query: [], body: body)
  }

  func delete(_ path: String, token: String) async throws {
    let _: Empty = try await request(path, method: "DELETE", token: token, query: [], body: Optional<Empty>.none)
  }

  /// A reply's image, uploaded before the message that carries it.
  func upload(_ data: Data, filename: String, conversationId: String, token: String) async throws -> Attachment {
    try await upload("/v1/admin/attachments", token: token, fields: ["conversationId": conversationId], file: data, filename: filename, mimeType: "image/jpeg", fileField: "file")
  }

  /// Multipart POST: text `fields`, then the file under `fileField`.
  func upload<Value: Decodable & Sendable>(_ path: String, token: String, fields: [String: String], file: Data, filename: String, mimeType: String, fileField: String) async throws -> Value {
    let boundary = "HelpBites-\(UUID().uuidString)"
    var body = Data()
    func append(_ value: String) { body.append(Data(value.utf8)) }
    for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
      append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
    }
    append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(filename)\"\r\nContent-Type: \(mimeType)\r\n\r\n")
    body.append(file)
    append("\r\n--\(boundary)--\r\n")
    var request = try makeRequest(path, method: "POST", token: token)
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    return try await decode(request)
  }

  /// POST with the file itself as the body (an export to import).
  func uploadRaw<Value: Decodable & Sendable>(_ path: String, token: String, file: Data) async throws -> Value {
    var request = try makeRequest(path, method: "POST", token: token)
    request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    request.httpBody = file
    return try await decode(request)
  }

  /// Raw response bytes (downloads).
  func data(_ path: String, token: String) async throws -> Data {
    let request = try makeRequest(path, method: "GET", token: token)
    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw APIError.server("Invalid server response.") }
      if http.statusCode == 401 { throw APIError.unauthorized }
      guard (200..<300).contains(http.statusCode) else { throw APIError.server("Download failed (\(http.statusCode)).") }
      return data
    } catch let error as APIError { throw error }
    catch { throw APIError.transport(error) }
  }

  func eventStream(token: String) -> AsyncThrowingStream<SupportEvent, Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          var request = try makeRequest("/v1/admin/events", method: "GET", token: token)
          request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
          let (bytes, response) = try await session.bytes(for: request)
          guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError.server("Could not connect to live updates.") }
          // The server writes one `data:` line per event (server/utils/sse.ts), and
          // bytes.lines drops the blank line that ends a frame, so decode each
          // data line as it arrives. Ping and ready frames don't decode and are skipped.
          for try await line in bytes.lines where line.hasPrefix("data:") {
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if let event = try? JSONDecoder().decode(SupportEvent.self, from: Data(payload.utf8)) { continuation.yield(event) }
          }
          continuation.finish()
        } catch is CancellationError { continuation.finish() }
        catch { continuation.finish(throwing: error) }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  private struct Empty: Codable, Sendable {}
  private struct ErrorBody: Decodable { let statusMessage: String?; let message: String?; let error: String? }

  private func request<Value: Decodable & Sendable, Body: Encodable & Sendable>(_ path: String, method: String, token: String?, query: [URLQueryItem], body: Body?) async throws -> Value {
    var request = try makeRequest(path, method: method, token: token, query: query)
    if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    return try await decode(request)
  }

  private func makeRequest(_ path: String, method: String, token: String?, query: [URLQueryItem] = []) throws -> URLRequest {
    // A path may carry its own query ("…?confirm=true"): split it off, or
    // appending(path:) would escape the "?" into the path.
    var route = path
    var items = query
    if let mark = path.firstIndex(of: "?") {
      route = String(path[..<mark])
      items = (URLComponents(string: String(path[mark...]))?.queryItems ?? []) + query
    }
    guard var components = URLComponents(url: baseURL.appending(path: route), resolvingAgainstBaseURL: false) else { throw APIError.invalidURL }
    components.queryItems = items.isEmpty ? nil : items
    guard let url = components.url else { throw APIError.invalidURL }
    var request = URLRequest(url: url); request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if !workspaceId.isEmpty { request.setValue(workspaceId, forHTTPHeaderField: "X-Workspace") }
    return request
  }

  private func decode<Value: Decodable & Sendable>(_ request: URLRequest) async throws -> Value {
    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw APIError.server("Invalid server response.") }
      guard (200..<300).contains(http.statusCode) else {
        if http.statusCode == 401 { throw APIError.unauthorized }
        let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
        throw APIError.server(error?.statusMessage ?? error?.message ?? error?.error ?? "Request failed (\(http.statusCode)).")
      }
      if data.isEmpty, Value.self == Empty.self { return Empty() as! Value }
      return try JSONDecoder().decode(Value.self, from: data)
    } catch let error as APIError { throw error }
    catch let error as URLError where error.code == .cancelled { throw APIError.cancelled }
    catch is CancellationError { throw APIError.cancelled }
    catch { throw APIError.transport(error) }
  }
}
