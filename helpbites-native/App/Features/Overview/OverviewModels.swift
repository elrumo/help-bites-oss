import Foundation

// shared/overview.ts and server/routes/v1/admin/overview.get.ts: every project at
// once, the latest unread conversations, and revenue from each project with Stripe.

/// `GET /v1/admin/overview?range=`.
struct WorkspaceOverview: Codable, Sendable {
  struct Totals: Codable, Sendable {
    /// Unread customer messages outside the archive: the inbox badge.
    let unreadMessages: Int
    let unread, open, errors: Int
  }
  /// Open, unread (outside the archive) and open error conversations of one project.
  struct ProjectStats: Codable, Identifiable, Sendable { let id, name: String; let open, unread, errors: Int }
  struct Unread: Codable, Identifiable, Sendable {
    let conversationId, projectId, name, email, subject, preview: String
    let unread: Int
    let at: String
    var id: String { conversationId }
  }
  let totals: Totals
  /// Every project, in the sidebar's order.
  let projects: [ProjectStats]
  /// The latest conversations with unread messages, newest first.
  let unread: [Unread]
  /// Nil for agents: revenue is for admins and owners.
  let revenue: WorkspaceRevenue?
}

/// Each project counts in its own currency, the one its Revenue tab totals in. Amounts are in
/// major units (19.99). `change` is the move from the period before as a fraction (0.12 is 12%
/// up); nil for all time, or when the period before had nothing.
struct WorkspaceRevenue: Codable, Sendable {
  struct Month: Codable, Identifiable, Sendable { let month: String; let net: Double; var id: String { month } }
  struct Total: Codable, Identifiable, Sendable {
    let currency: String
    let net: Double
    let previousNet, change: Double?
    let mrr: Double
    let subscribers: Int
    let months: [Month]
    var id: String { currency }
  }
  struct ProjectRevenue: Codable, Identifiable, Sendable {
    let projectId, currency: String
    let net: Double
    let previousNet, change: Double?
    let mrr: Double
    let subscribers, payments: Int
    var id: String { projectId }
  }
  let range: String
  /// Projects with Stripe connected, synced or not.
  let connected: Int
  /// One per currency, the most revenue first.
  let totals: [Total]
  /// Projects that have synced, the most revenue first.
  let projects: [ProjectRevenue]
}

// shared/attention.ts and server/utils/attention.ts: the things that wait on someone,
// across the workspace (`GET /v1/admin/attention`) or inside one project (its overview).

/// A vue-i18n "singular | plural" string held as its two forms (en.json uses them for counts).
struct PluralText: Sendable {
  let one, many: String
  init(_ one: String, _ many: String? = nil) {
    self.one = one
    self.many = many ?? one
  }

  /// vue-i18n's two-form pick: exactly 1 is the singular, anything else (0 too) the plural.
  /// Each `{name}` is then filled from `values`.
  func text(_ number: Int, _ values: [String: String] = [:]) -> String {
    var result = number == 1 ? one : many
    for (name, value) in values { result = result.replacingOccurrences(of: "{\(name)}", with: value) }
    return result
  }
}

/// One thing that waits on you. `kind` is unread, drafts, sync, bounces, alerts, paused, errors, documents
/// or triage; `section` is the web section path that deals with it (`email?view=log`); `projectId`
/// is empty for the workspace itself (`paused`).
struct AttentionItem: Decodable, Identifiable, Sendable {
  let key, kind, projectId, value, detail, section: String
  let count: Int
  let at: String?
  var id: String { key }

  /// The row's words (`attention.<kind>` in en.json).
  var text: String {
    let words: PluralText
    switch kind {
    case "unread": words = PluralText(String(localized: "{count} unread conversation"), String(localized: "{count} unread conversations"))
    case "drafts": words = PluralText(String(localized: "{count} changelog draft waiting for approval"), String(localized: "{count} changelog drafts waiting for approval"))
    case "sync": words = PluralText(String(localized: "{value} sync is failing"))
    case "bounces": words = PluralText(String(localized: "{count} email bounced or failed this week"), String(localized: "{count} emails bounced or failed this week"))
    case "alerts": words = PluralText(String(localized: "{count} error alert fired today"), String(localized: "{count} error alerts fired today"))
    case "paused": words = PluralText(String(localized: "Campaigns and sequences are paused"))
    case "errors": words = PluralText(String(localized: "{count} open error report"), String(localized: "{count} open error reports"))
    case "documents": words = PluralText(String(localized: "{count} knowledge document failed to process"), String(localized: "{count} knowledge documents failed to process"))
    case "triage": words = PluralText(String(localized: "{count} feedback post to triage"), String(localized: "{count} feedback posts to triage"))
    default: words = PluralText(kind)
    }
    return words.text(count, ["count": String(count), "value": value])
  }

  /// The web's row icons, as SF Symbols.
  var systemImage: String {
    switch kind {
    case "unread": "tray"
    case "drafts": "square.and.pencil"
    case "sync": "arrow.triangle.2.circlepath"
    case "bounces": "envelope.badge"
    case "alerts": "bell.badge"
    case "paused": "pause.circle"
    case "errors": "ladybug"
    case "documents": "doc.text"
    case "triage": "lightbulb"
    default: "exclamationmark.circle"
    }
  }
}

/// `GET /v1/admin/attention`. `total` (the sum of the counts) is the badge on Overview; `unreadMessages` is the inbox's.
struct WorkspaceAttention: Decodable, Sendable {
  let unreadMessages, total: Int
  let items: [AttentionItem]
  static let empty = WorkspaceAttention(unreadMessages: 0, total: 0, items: [])
}
