import SwiftUI

// The CRM's shapes, mirroring the server's serializers (server/utils/contacts.ts,
// contactSources.ts; shared/contacts.ts, shared/segments.ts).

struct ContactConsent: Codable, Equatable, Sendable {
  let source, at: String
  let ip, formUrl, confirmedAt: String?
}

struct Contact: Codable, Identifiable, Equatable, Sendable {
  let id, externalId, email, name, username, avatarUrl, subscription: String
  let attributes: [String: JSONValue]
  let tags, unsubscribedTopics, sources: [String]
  let consent: ContactConsent?
  let feedbackEmails: Bool
  let lastSeenAt, createdAt, updatedAt: String?

  var displayName: String { !name.isEmpty ? name : !email.isEmpty ? email : !externalId.isEmpty ? externalId : "Unnamed" }
}

struct ContactPage: Decodable, Sendable { let contacts: [Contact]; let nextCursor: String? }

/// What a subscription status means, as the web's SUBSCRIPTION_STATUS (app/utils/contactStatus.ts).
enum SubscriptionStatus: String, CaseIterable, Identifiable {
  case subscribed, pending, unsubscribed, none
  var id: String { rawValue }
  var label: String {
    switch self { case .subscribed: "Subscribed"; case .pending: "Pending"; case .unsubscribed: "Unsubscribed"; case .none: "Not subscribed" }
  }
  var hint: String {
    switch self {
    case .subscribed: "Gets marketing email"
    case .pending: "Signed up; has not confirmed yet"
    case .unsubscribed: "Asked for no more marketing email"
    case .none: "Transactional email only"
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
}

/// Mirrors shared/segments.ts: which fields a rule can test and what it can ask of each.
enum SegmentSpec {
  enum Kind { case text, enumeration, list, date, attribute }
  static let attributePrefix = "attributes."
  static let fields: [(key: String, label: String, kind: Kind)] = [
    ("email", "Email", .text), ("name", "Name", .text), ("externalId", "User id", .text),
    ("subscription", "Subscription", .enumeration), ("tags", "Tags", .list),
    ("unsubscribedTopics", "Opted-out topics", .list), ("sources", "Source", .list),
    ("createdAt", "Added", .date), ("lastSeenAt", "Last seen", .date), ("updatedAt", "Updated", .date)
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
    }
  }
  static let opLabels: [String: String] = [
    "is": "is", "is_not": "is not", "contains": "contains", "starts_with": "starts with", "exists": "is set", "not_exists": "is not set",
    "gt": "is more than", "lt": "is less than", "before": "is before", "after": "is after",
    "within_days": "in the last … days", "not_within_days": "not in the last … days", "includes": "includes", "excludes": "does not include"
  ]
  static func needsValue(_ op: String) -> Bool { op != "exists" && op != "not_exists" }
  static func isDays(_ op: String) -> Bool { op == "within_days" || op == "not_within_days" }
  static func isDate(_ op: String) -> Bool { op == "before" || op == "after" }
}

/// POST /v1/segments/preview.
struct SegmentPreview: Decodable, Sendable { let count: Int; let sample: [Contact] }

/// The mapping of a source's (or CSV file's) columns onto contact fields.
struct ContactMapping: Codable, Equatable, Sendable {
  var externalId, email, name, tags, subscribed: String?
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
    switch config.everyMinutes { case 0: "Manual"; case 60: "Hourly"; case 1440: "Daily"; case let m where m < 60: "Every \(m) min"; case let m: "Every \(m / 60) h" }
  }
}

/// One contact as the API takes it (import rows, "Add").
struct ContactInput: Encodable, Sendable {
  var externalId, email, name: String?
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
