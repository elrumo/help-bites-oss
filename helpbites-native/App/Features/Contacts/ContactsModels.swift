import SwiftUI

// The CRM's shapes, mirroring the server's serializers (server/utils/contacts.ts,
// contactSources.ts; shared/contacts.ts, shared/segments.ts).

struct ContactConsent: Codable, Equatable, Sendable {
  let source, at: String
  let ip, formUrl, confirmedAt: String?
}

/// How a contact first got here (`ContactOrigin`): `id` is the lead form or the sync source, when there is one.
struct ContactOrigin: Codable, Equatable, Sendable {
  let type, id: String
  let at: String?
}

/// `CONTACT_ORIGIN_TYPES` from shared/contacts.ts with the web's labels (contacts.origin.* in i18n/locales/en.json).
enum ContactOriginKind: String, CaseIterable, Identifiable {
  case app, leadForm = "lead_form", signup, csvImport = "import", sync, stripe, api, panel, feedback
  var id: String { rawValue }
  var label: String {
    switch self {
    case .app: String(localized: "App user")
    case .leadForm: String(localized: "Lead form")
    case .signup: String(localized: "Newsletter sign-up")
    case .csvImport: String(localized: "CSV import")
    case .sync: String(localized: "Database sync")
    case .stripe: String(localized: "Stripe")
    case .api: String(localized: "API")
    case .panel: String(localized: "Added by hand")
    case .feedback: String(localized: "Feedback import")
    }
  }
  var systemImage: String {
    switch self {
    case .app: "iphone"
    case .leadForm: "list.bullet.clipboard"
    case .signup: "envelope.badge"
    case .csvImport: "square.and.arrow.down"
    case .sync: "cylinder.split.1x2"
    case .stripe: "creditcard"
    case .api: "chevron.left.forwardslash.chevron.right"
    case .panel: "person.badge.plus"
    case .feedback: "lightbulb"
    }
  }
  static func label(_ origin: ContactOrigin?, names: [String: String] = [:]) -> String {
    guard let origin, let kind = ContactOriginKind(rawValue: origin.type) else { return "" }
    if let name = names[origin.id], !origin.id.isEmpty { return "\(kind.label) · \(name)" }
    return kind.label
  }
}

struct Contact: Codable, Identifiable, Equatable, Sendable {
  let id, externalId, email, name, username, avatarUrl, subscription: String
  /// The language to write to them in ("es", "pt-BR"); nil or blank until known, and absent on servers from before it.
  let language: String?
  let attributes: [String: JSONValue]
  let tags, unsubscribedTopics, sources: [String]
  let consent: ContactConsent?
  /// Optional for servers from before origins were kept.
  let origin: ContactOrigin?
  let leadForms: [String]?
  let feedbackEmails: Bool
  let lastSeenAt, createdAt, updatedAt: String?

  var displayName: String { !name.isEmpty ? name : !email.isEmpty ? email : !externalId.isEmpty ? externalId : String(localized: "Unnamed") }
}

/// GET /v1/contacts.
struct ContactPage: Decodable, Sendable { let contacts: [Contact]; let nextCursor: String? }

/// What a subscription status means, as the web's SUBSCRIPTION_STATUS (app/utils/contactStatus.ts).
enum SubscriptionStatus: String, CaseIterable, Identifiable {
  case subscribed, pending, unsubscribed, none
  var id: String { rawValue }
  var label: String {
    switch self { case .subscribed: String(localized: "Subscribed"); case .pending: String(localized: "Pending"); case .unsubscribed: String(localized: "Unsubscribed"); case .none: String(localized: "Not subscribed") }
  }
  var hint: String {
    switch self {
    case .subscribed: String(localized: "Gets marketing email")
    case .pending: String(localized: "Signed up; has not confirmed yet")
    case .unsubscribed: String(localized: "Asked for no more marketing email")
    case .none: String(localized: "Transactional email only")
    }
  }
  var tint: Color? {
    switch self { case .subscribed: Theme.success; case .pending: Theme.warning; case .unsubscribed: Theme.error; case .none: nil }
  }
  static func of(_ raw: String) -> SubscriptionStatus { SubscriptionStatus(rawValue: raw) ?? .none }
}

struct SegmentRule: Codable, Equatable, Sendable, Identifiable {
  var field, op: String
  var value: JSONValue?
  /// Local only (rows in the builder); not sent.
  var id = UUID()
  enum CodingKeys: String, CodingKey { case field, op, value }
}
struct SegmentFilter: Codable, Equatable, Sendable {
  var match: String
  var rules: [SegmentRule]
  static let empty = SegmentFilter(match: "all", rules: [])
}
struct ContactSegment: Codable, Identifiable, Equatable, Sendable {
  let id, projectId, name: String
  let filter: SegmentFilter
  /// Made for a lead form (its leads, or every lead); optional for older servers.
  let auto: Bool?
}

/// Mirrors shared/segments.ts: which fields a rule can test and what it can ask of each.
enum SegmentSpec {
  /// `flag`: a yes/no question the server answers by looking at the person's other records.
  enum Kind { case text, enumeration, list, date, attribute, flag }
  static let attributePrefix = "attributes."
  static let fields: [(key: String, label: String, kind: Kind)] = [
    ("email", String(localized: "Email"), .text), ("name", String(localized: "Name"), .text), ("externalId", String(localized: "User id"), .text),
    ("subscription", String(localized: "Subscription"), .enumeration), ("tags", String(localized: "Tags"), .list),
    ("unsubscribedTopics", String(localized: "Opted-out topics"), .list), ("sources", String(localized: "Source"), .list),
    ("origin", String(localized: "Added via"), .enumeration), ("language", String(localized: "Language"), .text), ("leadForms", String(localized: "Lead form"), .list),
    ("stripePlan", String(localized: "Stripe plan"), .text), ("hasOpenConversation", String(localized: "Has an open conversation"), .flag),
    ("votedOnPost", String(localized: "Voted on a post"), .flag), ("hasErrors", String(localized: "Has errors"), .flag), ("finishedOnboarding", String(localized: "Finished onboarding"), .flag),
    ("createdAt", String(localized: "Added"), .date), ("lastSeenAt", String(localized: "Last seen"), .date), ("updatedAt", String(localized: "Updated"), .date)
  ]
  static func kind(_ field: String) -> Kind {
    if field.hasPrefix(attributePrefix) { return .attribute }
    return fields.first { $0.key == field }?.kind ?? .text
  }
  static func ops(_ kind: Kind) -> [String] {
    switch kind {
    case .text: ["is", "is_not", "contains", "starts_with", "exists", "not_exists"]
    case .enumeration: ["is", "is_not"]
    case .list: ["includes", "excludes", "exists", "not_exists"]
    case .date: ["before", "after", "within_days", "not_within_days", "exists", "not_exists"]
    case .attribute: ["is", "is_not", "contains", "starts_with", "gt", "lt", "before", "after", "exists", "not_exists"]
    case .flag: ["is"]
    }
  }
  static let opLabels: [String: String] = [
    "is": String(localized: "is"), "is_not": String(localized: "is not"), "contains": String(localized: "contains"), "starts_with": String(localized: "starts with"), "exists": String(localized: "is set"), "not_exists": String(localized: "is not set"),
    "gt": String(localized: "is more than"), "lt": String(localized: "is less than"), "before": String(localized: "is before"), "after": String(localized: "is after"),
    "within_days": String(localized: "in the last … days"), "not_within_days": String(localized: "not in the last … days"), "includes": String(localized: "includes"), "excludes": String(localized: "does not include")
  ]
  static func needsValue(_ op: String) -> Bool { op != "exists" && op != "not_exists" }
  static func isDays(_ op: String) -> Bool { op == "within_days" || op == "not_within_days" }
  static func isDate(_ op: String) -> Bool { op == "before" || op == "after" }
}

/// POST /v1/segments/preview.
struct SegmentPreview: Decodable, Sendable { let count: Int; let sample: [Contact] }

/// The mapping of a source's (or CSV file's) columns onto contact fields.
struct ContactMapping: Codable, Equatable, Sendable {
  var externalId, email, name, language, tags, subscribed: String?
  var attributes: [String: String]?
}

struct ContactSourceStats: Codable, Equatable, Sendable { let seen, created, updated, unchanged, failed, skipped: Int }
struct ContactSourceConfig: Codable, Equatable, Sendable {
  var serverUrl, appId, className, table, idField, idType, collection, updatedField: String?
  var mapping: ContactMapping?
  var consent: String?
  var everyMinutes: Int
}
struct ContactSourceKind: Decodable, Sendable, Identifiable, Hashable { let kind, label: String; var id: String { kind } }
struct ContactSource: Codable, Identifiable, Equatable, Sendable {
  let id, kind, name, status, lastError, position: String
  let enabled, hasSecret: Bool
  let config: ContactSourceConfig
  let stats: ContactSourceStats
  let lastRunAt, nextRunAt: String?

  var what: String { config.className ?? config.table ?? config.collection ?? "" }
  var schedule: String {
    switch config.everyMinutes { case 0: String(localized: "Manual"); case 60: String(localized: "Hourly"); case 1440: String(localized: "Daily"); case let m where m < 60: String(localized: "Every \(m) min"); case let m: String(localized: "Every \(m / 60) h") }
  }
}

/// One contact as the API takes it (import rows, "Add").
struct ContactInput: Encodable, Sendable {
  var externalId, email, name, language: String?
  var attributes: [String: JSONValue]?
  var tags: [String]?
  var subscription: String?
}

/// A CSV column name as an attribute key (app/utils/contactStatus.ts).
func attributeKey(for column: String) -> String {
  var key = column.trimmingCharacters(in: .whitespaces)
  key = key.replacingOccurrences(of: "[^A-Za-z0-9_]+", with: "_", options: .regularExpression)
  key = key.replacingOccurrences(of: "^_+|_+$", with: "", options: .regularExpression)
  let first = key.first.map { $0.isASCII && $0.isLetter } ?? false
  return String((first ? key : "c_\(key)").prefix(40))
}
