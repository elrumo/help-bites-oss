import Foundation
import UniformTypeIdentifiers

// The shapes of /v1/admin/legal/** (shared/legal/types.ts, server/utils/legal.ts).

enum LegalType: String, CaseIterable, Identifiable, Sendable {
  case privacy, terms, cookies, refund
  var id: String { rawValue }
  var label: String {
    switch self {
    case .privacy: String(localized: "Privacy Policy")
    case .terms: String(localized: "Terms of Service")
    case .cookies: String(localized: "Cookie Policy")
    case .refund: String(localized: "Refund Policy")
    }
  }
}

/// The regions the wizard asks about, in the web's order (shared/legal/types.ts).
let legalRegions: [(value: String, label: String)] = [
  ("eu", String(localized: "European Union / EEA")), ("uk", String(localized: "United Kingdom")), ("us-ca", String(localized: "United States: California")),
  ("us-other", String(localized: "United States: other states")), ("br", String(localized: "Brazil")), ("ca", String(localized: "Canada")), ("au", String(localized: "Australia")), ("row", String(localized: "Rest of the world"))
]

/// A wizard answer: text, a yes/no, or a list of picked option values.
enum LegalAnswer: Codable, Equatable, Sendable {
  case text(String), flag(Bool), list([String])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let v = try? c.decode(Bool.self) { self = .flag(v) }
    else if let v = try? c.decode(String.self) { self = .text(v) }
    else if let v = try? c.decode([String].self) { self = .list(v) }
    else { self = .text("") }  // the server drops answers it does not know
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self { case .text(let v): try c.encode(v); case .flag(let v): try c.encode(v); case .list(let v): try c.encode(v) }
  }
}

typealias LegalAnswers = [String: LegalAnswer]

/// Where a section's or summary's text came from (template, ai or human), as a word for the person.
func legalSourceLabel(_ source: String) -> String {
  switch source {
  case "template": String(localized: "template")
  case "ai": String(localized: "ai")
  case "human": String(localized: "human")
  default: source
  }
}

struct LegalSection: Codable, Identifiable, Equatable, Sendable {
  var id: String
  var clauseId: String?
  var heading: String
  var body: String
  /// template, ai or human.
  var source: String
  var locked: Bool
  var satisfies: [String]
}

struct LegalTldr: Codable, Equatable, Sendable { let text: String; let source: String }

struct LegalDocument: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let type: String
  var slug: String
  var locale: String?
  /// The id of the document this one translates; nil for an original. Documents sharing one are the same text in other languages.
  var translationOf: String?
  var title: String
  var status: String
  var sections: [LegalSection]
  var answers: LegalAnswers
  var tldr: LegalTldr?
  var effectiveDate: String?
  var publishedAt: String?
  var version: Int
  var path: String
  var updatedAt: String?

  var kind: LegalType { LegalType(rawValue: type) ?? .privacy }
  /// The language tag of the text ("en" when the server sent none).
  var language: String { (locale ?? "").isEmpty ? ContentLocale.defaultTag : locale! }
  /// The id every language of one text shares: the original's.
  var group: String { translationOf ?? id }
  var isPublished: Bool { status == "published" }
  /// The date part of `effectiveDate` ("2025-01-31"), which is how the web shows it.
  var effectiveDay: String { String((effectiveDate ?? "").prefix(10)) }
}

struct LegalRequirementBrief: Codable, Identifiable, Equatable, Sendable {
  let id, pack, summary, citation, severity: String
}

struct LegalCoverage: Codable, Equatable, Sendable {
  let total: Int
  let covered: [LegalRequirementBrief]
  let gaps: [LegalRequirementBrief]
  let unreviewedPacks: [String]
  /// False for text nobody tied to requirements (an import): every requirement would show as a gap, so only the AI check says anything.
  let mapped: Bool?
  var isMapped: Bool { mapped ?? true }
}

struct LegalFinding: Codable, Identifiable, Equatable, Sendable {
  let requirement: String
  /// ok, unclear, missing or conflict.
  let status: String
  let note: String
  var id: String { requirement }
}

struct LegalVersion: Codable, Identifiable, Equatable, Sendable {
  let version: Int
  let note: String
  let authorName: String?
  let publishedAt: String?
  var id: Int { version }
}

// MARK: Wizard

/// A condition over the answers (shared/legal/when.ts): every key present must hold; `anyOf` holds when one member does.
struct LegalWhen: Decodable, Equatable, Sendable {
  var regions: [String]?
  var has: [String: [String]]?
  var equals: [String: LegalAnswer]?
  var anyOf: [LegalWhen]?
  enum CodingKeys: String, CodingKey { case regions, has, equals = "is", anyOf }

  func holds(_ answers: LegalAnswers) -> Bool {
    if let regions {
      var have = ["row"]
      if case .list(let picked)? = answers["regions"], !picked.isEmpty { have = picked }
      if !regions.contains(where: have.contains) { return false }
    }
    for (id, wanted) in has ?? [:] {
      var have: [String] = []
      switch answers[id] {
      case .list(let list)?: have = list
      case .text(let text)? where !text.isEmpty: have = [text]
      default: break
      }
      if !wanted.contains(where: have.contains) { return false }
    }
    for (id, want) in equals ?? [:] {
      let value = answers[id]
      if value == want { continue }
      if want == .flag(false), value == nil { continue }
      return false
    }
    if let anyOf, !anyOf.contains(where: { $0.holds(answers) }) { return false }
    return true
  }
}

struct LegalQuestion: Decodable, Identifiable, Sendable {
  struct Option: Decodable, Identifiable, Equatable, Sendable { let value, label: String; var id: String { value } }
  let id, label: String
  let help: String?
  /// text, longtext, boolean, select or multi.
  let kind: String
  let options: [Option]?
  let required: Bool?
  let showIf: LegalWhen?
  let placeholder: String?
}

struct LegalWizardSpec: Decodable, Sendable {
  let notice: String?
  let label: String
  let questions: [LegalQuestion]
  let defaults: LegalAnswers
  /// Whether answers were saved for reuse (`saveAnswers`), so `defaults` carries more than the company details.
  let shared: Bool?
}

/// A .md, .txt or .html file picked with `fileImporter`, read as text for an import.
struct LegalImportFile: Sendable {
  let name: String
  let text: String

  private struct Unreadable: LocalizedError {
    let errorDescription: String?
  }

  static let maxBytes = 500_000

  static var types: [UTType] { [.plainText, .html] + ["md", "markdown"].compactMap { UTType(filenameExtension: $0) } }

  /// markdown, html or text from the extension; nil lets the server detect it.
  var format: String? {
    switch (name as NSString).pathExtension.lowercased() {
    case "md", "markdown": "markdown"
    case "html", "htm": "html"
    case "txt": "text"
    default: nil
    }
  }

  static func read(_ url: URL) throws -> LegalImportFile {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let data = try Data(contentsOf: url)
    if data.count > maxBytes { throw Unreadable(errorDescription: String(localized: "That file is too large. Policies are text; the limit is 500 KB.")) }
    guard let text = String(data: data, encoding: .utf8) else { throw Unreadable(errorDescription: String(localized: "That file is not text.")) }
    return LegalImportFile(name: url.lastPathComponent, text: text)
  }
}

struct LegalSuggestion: Decodable, Sendable {
  struct Repo: Decodable, Sendable { let repo: String; let read: Bool }
  let answers: LegalAnswers
  let evidence: [String: [String]]
  let repos: [Repo]
}

struct LegalPreview: Decodable, Sendable {
  let markdown: String
  let coverage: LegalCoverage
  let notice: String?
}

struct LegalAnalysis: Decodable, Sendable {
  let findings: [LegalFinding]
  let requirements: Int?
}

struct LegalRulepacks: Decodable, Sendable {
  struct Pack: Decodable, Sendable { struct Requirement: Decodable, Sendable { let id, summary: String }; let requirements: [Requirement] }
  let rulepacks: [Pack]
}

// MARK: Identity and look (shared/legal/config.ts)

struct LegalConfig: Codable, Equatable, Sendable {
  struct Entity: Codable, Equatable, Sendable { var name = "", address = "", email = "", dpo = "" }
  var entity = Entity()
  var accent = ""
  /// system, serif or mono.
  var font = "system"
  var logoUrl = ""
  var footerText = ""

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    entity = (try? c.decode(Entity.self, forKey: .entity)) ?? Entity()
    accent = (try? c.decode(String.self, forKey: .accent)) ?? ""
    font = (try? c.decode(String.self, forKey: .font)) ?? "system"
    logoUrl = (try? c.decode(String.self, forKey: .logoUrl)) ?? ""
    footerText = (try? c.decode(String.self, forKey: .footerText)) ?? ""
  }
}

// MARK: Requests

struct LegalEmpty: Decodable, Sendable {}

/// Which bytes the web panel's `api()` would send. The AI-backed calls (a whole
/// document written by the model, a check, a rewrite) can take a minute or two,
/// longer than `URLSession.shared` waits, so those go through `slow`.
@MainActor enum LegalAPI {
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 300
    configuration.timeoutIntervalForResource = 300
    return URLSession(configuration: configuration)
  }()

  private struct Failure: Decodable { let statusMessage: String?; let message: String? }

  static func slow<Value: Decodable & Sendable, Body: Encodable & Sendable>(_ store: SessionStore, _ path: String, _ body: Body) async throws -> Value {
    let base = store.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: base + path) else { throw APIError.invalidURL }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(store.token)", forHTTPHeaderField: "Authorization")
    if let workspace = UserDefaults.standard.string(forKey: "helpbites.workspace"), !workspace.isEmpty {
      request.setValue(workspace, forHTTPHeaderField: "X-Workspace")
    }
    request.httpBody = try JSONEncoder().encode(body)
    let data: Data, response: URLResponse
    do { (data, response) = try await session.data(for: request) }
    catch let error as URLError where error.code == .cancelled { throw APIError.cancelled }
    catch { throw APIError.transport(error) }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 { await store.recover(APIError.unauthorized); throw APIError.unauthorized }
    guard (200..<300).contains(status) else {
      let failure = try? JSONDecoder().decode(Failure.self, from: data)
      throw APIError.server(failure?.statusMessage ?? failure?.message ?? String(localized: "Request failed (\(status))."))
    }
    return try JSONDecoder().decode(Value.self, from: data)
  }

  /// The public page of a document: the server's own origin plus its path.
  static func publicURL(_ store: SessionStore, _ path: String) -> URL? {
    URL(string: store.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)
  }
}

/// "yyyy-MM-dd" in UTC, the way the web's date input and `slice(0, 10)` see the stored instant.
enum LegalDay {
  private static let formatter: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()
  static func date(_ day: String) -> Date? { formatter.date(from: day) }
  static func string(_ date: Date) -> String { formatter.string(from: date) }
  static let utc = TimeZone(identifier: "UTC") ?? .gmt
}
