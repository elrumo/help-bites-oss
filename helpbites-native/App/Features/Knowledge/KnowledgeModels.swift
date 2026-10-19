import Foundation
import UniformTypeIdentifiers

// Knowledge-only DTOs. Core's KnowledgeModel is used as is; its KnowledgeNode
// and Faq lack the fields these screens show, so these decode just what's used.

let knowledgeFAQStatuses = ["draft", "active", "disabled", "archived", "outdated"]
let knowledgeModelStatuses = ["active", "draft", "archived"]

/// A theme (the API's node): one entry of a model's path tree.
struct KnowledgeTheme: Decodable, Sendable, Identifiable, Hashable {
  let id, parentId, name, pathCache: String
  let depth: Int
}

struct KnowledgeThemeList: Decodable, Sendable { let nodes: [KnowledgeTheme] }

/// `{ id, name }`: an assistant that can reach an FAQ, or one in the tester's picker.
struct KnowledgeNamed: Decodable, Sendable, Identifiable, Hashable { let id, name: String }

struct KnowledgeFAQItem: Decodable, Sendable, Identifiable {
  let id, nodeId, pathCache, question, status, origin: String
  let updatedAt: String?
  let agents: [KnowledgeNamed]?
}

struct KnowledgeFAQPage: Decodable, Sendable { let faqs: [KnowledgeFAQItem]; let total: Int }

struct KnowledgeFAQDetail: Decodable, Sendable {
  struct FAQ: Decodable, Sendable {
    let question, answer, nodeId, status, sourceSection: String
    let aliases, tags: [String]
    let sourceVersion: Int
    let detached: Bool
    let lastProcessedAt: String?
  }
  struct Source: Decodable, Sendable { let filename: String }
  let faq: FAQ
  let sourceDocument: Source?
  let agentIds: [String]
}

struct KnowledgeDashboard: Decodable, Sendable {
  let faqsTotal, faqsActive, faqsDraft, faqsOutdated, nodes, documents, agents: Int
  // Served but not shown by the web; worth a glance after an import or reindex.
  let failedDocuments, needsReindex: Int?
}

struct KnowledgeDocumentItem: Decodable, Sendable, Identifiable {
  let id, originalFilename, status, processingError: String
  let version: Int
  let faqCount: Int?
  let createdAt: String?
}

struct KnowledgeImportPreview: Decodable, Sendable {
  struct Entry: Decodable, Sendable { let key, pathCache, question, answer, duplicate: String; let path: [String] }
  struct Invalid: Decodable, Sendable { let section, reason: String }
  struct Counts: Decodable, Sendable { let faqs, nodes, duplicates, existing: Int }
  let documentId: String
  let entries: [Entry]
  let warnings: [String]
  let invalid: [Invalid]
  let counts: Counts
}

struct KnowledgePreviewResponse: Decodable, Sendable { let preview: KnowledgeImportPreview }

struct KnowledgeCommitStats: Decodable, Sendable { let created, updated, skippedDetached, outdated: Int }

/// The first DELETE of a model, theme or document answers with what it would remove.
struct KnowledgeDeleteCheck<Impact: Decodable & Sendable>: Decodable, Sendable { let deleted: Bool; let impact: Impact? }

/// A .md/.markdown/.txt file picked with `fileImporter`.
struct KnowledgePickedFile: Sendable {
  let name: String
  let data: Data
  var mimeType: String { name.lowercased().hasSuffix(".txt") ? "text/plain" : "text/markdown" }

  static var types: [UTType] { [.plainText] + ["md", "markdown"].compactMap { UTType(filenameExtension: $0) } }

  static func read(_ url: URL) throws -> KnowledgePickedFile {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return KnowledgePickedFile(name: url.lastPathComponent, data: try Data(contentsOf: url))
  }
}

/// SessionStore's send/delete/upload percent-encode a "?" in the path, but the
/// knowledge API needs a query on two calls: `DELETE …?confirm=true` and the
/// import upload's `?modelId=&nodeId=`. This builds those requests with the
/// same bearer, Accept header, error message and 401 handling.
@MainActor enum KnowledgeAPI {
  static func request<Value: Decodable & Sendable>(_ session: SessionStore, _ method: String, _ path: String, query: [String: String], file: KnowledgePickedFile? = nil) async throws -> Value {
    let base = session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard var components = URLComponents(string: base + path) else { throw APIError.invalidURL }
    if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
    guard let url = components.url else { throw APIError.invalidURL }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    if let file {
      let boundary = "HelpBites-\(UUID().uuidString)"
      let filename = file.name.replacingOccurrences(of: "\"", with: "_")
      var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: \(file.mimeType)\r\n\r\n".utf8)
      body.append(file.data)
      body.append(Data("\r\n--\(boundary)--\r\n".utf8))
      request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
    }
    let data: Data, response: URLResponse
    do { (data, response) = try await URLSession.shared.data(for: request) } catch { throw APIError.transport(error) }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 { await session.recover(APIError.unauthorized); throw APIError.unauthorized }
    guard (200..<300).contains(status) else {
      let failure = try? JSONDecoder().decode(Failure.self, from: data)
      throw APIError.server(failure?.statusMessage ?? failure?.message ?? "Request failed (\(status)).")
    }
    return try JSONDecoder().decode(Value.self, from: data)
  }

  private struct Failure: Decodable { let statusMessage: String?; let message: String? }
}
