import SwiftUI

private extension KeyedDecodingContainer {
  /// A string, or an id/count the tracker sent as a number.
  func lenient(_ key: Key) -> String {
    (try? decode(String.self, forKey: key)) ?? (try? decode(Int.self, forKey: key)).map(String.init) ?? ""
  }
}

/// One issue from the project's error trackers (`GET /v1/admin/errors`). GlitchTip
/// sends `count` as a string and Bugsink as a number, so it decodes either.
struct ErrorIssue: Decodable, Identifiable, Sendable {
  let issueId, title, culprit, level, shortId, lastSeen, linkId, linkLabel, providerName: String
  /// Open in the tracker. Both optional: the inbox's per-customer list reads them as such.
  let url, conversationId: String?
  let count: Int

  /// Two tracker projects can share an issue id, so the link is part of the identity.
  var id: String { "\(linkId):\(issueId)" }
  var isSevere: Bool { level == "error" || level == "fatal" }

  enum CodingKeys: String, CodingKey { case id, title, culprit, level, url, conversationId, shortId, lastSeen, linkId, linkLabel, providerName, count }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    issueId = c.lenient(.id)
    title = c.lenient(.title).isEmpty ? "Untitled error" : c.lenient(.title)
    culprit = c.lenient(.culprit)
    level = c.lenient(.level)
    url = (try? c.decode(String.self, forKey: .url)).flatMap { $0.isEmpty ? nil : $0 }
    conversationId = (try? c.decode(String.self, forKey: .conversationId)).flatMap { $0.isEmpty ? nil : $0 }
    shortId = c.lenient(.shortId)
    lastSeen = c.lenient(.lastSeen)
    linkId = c.lenient(.linkId)
    linkLabel = c.lenient(.linkLabel)
    providerName = c.lenient(.providerName)
    count = Int(c.lenient(.count)) ?? 0
  }
}

struct ErrorIssuePage: Decodable, Sendable { let issues: [ErrorIssue]; let next: String? }

/// `GET /v1/admin/errors/:id` (shared/errors.ts `ErrorDetail`): the issue with its latest event boiled down.
struct ErrorDetail: Decodable, Sendable {
  struct Info: Decodable, Sendable { let shortId, status, firstSeen, lastSeen: String; let count: Int }
  struct Exception: Decodable, Sendable { let type, value: String }
  struct Frame: Decodable, Sendable, Identifiable {
    let file, function, context: String
    let line: Int
    let before, after: [String]
    let inApp: Bool
    var id: String { "\(file):\(line):\(function)" }
  }
  struct Crumb: Decodable, Sendable { let at, category, level, message: String }

  let issue: Info
  let exception: Exception
  let frames: [Frame]
  let tags, details: [[String]]
  let breadcrumbs: [Crumb]
  let at: String
}

/// `GET` and `POST /v1/admin/errors/:id/board`: the board item an error was filed as. `boardEnabled` is
/// only sent by the GET (filing needs the project board on).
struct ErrorBoardState: Decodable, Sendable {
  struct Item: Decodable, Equatable, Identifiable, Sendable { let id, title: String; let number: Int? }
  let item: Item?
  let boardEnabled: Bool?
}

/// `POST /v1/admin/errors/:id/analyze`.
struct ErrorAnalysis: Decodable, Sendable { let text: String; let files: [String]; let cached: Bool }

/// `POST /v1/admin/errors/analyze`: AI triage of every unresolved error.
struct ErrorOverview: Decodable, Sendable { let text: String; let count: Int }

/// shared/errorAlerts.ts `ErrorAlertRule`.
struct ErrorAlertRule: Codable, Identifiable, Sendable, Equatable {
  var id, name, kind: String
  var threshold, windowMinutes, cooldownMinutes: Int
  var link: String
  var enabled: Bool

  static let kinds = [("new", "a new error appears"), ("total", "an error totals"), ("rate", "an error happens")]
  /// How long before the same error alerts again, by kind.
  static let defaultCooldown = ["new": 1440, "total": 1440, "rate": 60]

  static func blank() -> ErrorAlertRule {
    ErrorAlertRule(id: "r" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36), name: "", kind: "rate", threshold: 10, windowMinutes: 60, cooldownMinutes: 60, link: "", enabled: true)
  }

  /// The rule in words, the placeholder for an unnamed one (`describeRule`).
  var summary: String {
    switch kind {
    case "new": "a new error appears"
    case "total": "an error has happened \(threshold) times in total"
    default: "an error happens \(threshold) times within \(windowMinutes) min"
    }
  }
}

/// An alert that fired recently; `at` is epoch milliseconds.
struct FiredErrorAlert: Decodable, Sendable, Identifiable {
  let at: Double
  let rule, title, url, link: String
  let count: Int
  var id: String { "\(at):\(rule):\(title)" }
}

/// A tracker server of the workspace (`GET /v1/admin/errors/servers`). Tokens are never sent, only `hasToken`.
struct TrackerServer: Decodable, Identifiable, Sendable, Equatable {
  let id, provider, providerName, name, url, apiUrl, org: String
  let hasToken, builtIn: Bool
}

struct TrackerProvider: Decodable, Identifiable, Sendable, Equatable {
  let id, name: String
  let required: [String]
  let manualAlerts: Bool
}

struct TrackerServersResponse: Decodable, Sendable { let servers: [TrackerServer]; let providers: [TrackerProvider] }

/// Renders the AI's markdown answer. Inline styling only (bold, code, links): headings and lists show as written.
struct ErrorMarkdown: View {
  let text: String
  var body: some View {
    Text((try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
      .font(.lnCallout).foregroundStyle(Theme.text).tint(Theme.accentText)
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The Bugsink alert webhook steps, shared by the connect sheet and the Errors page.
enum ErrorsText {
  static let webhookSteps = "In Bugsink, open the project's alerts, click Add, set Kind to Slack (HelpBites reads Slack-format alerts) and use this Webhook url. Leave Discord and Mattermost alone."
}
