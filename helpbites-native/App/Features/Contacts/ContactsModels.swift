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

struct SegmentRule: Codable, Equatable, Sendable { let field, op: String; let value: JSONValue? }
struct SegmentFilter: Codable, Equatable, Sendable { let match: String; let rules: [SegmentRule] }
struct ContactSegment: Codable, Identifiable, Equatable, Sendable {
  let id, projectId, name: String
  let filter: SegmentFilter
}

struct ContactSourceStats: Codable, Equatable, Sendable { let seen, created, updated, unchanged, failed, skipped: Int }
struct ContactSourceConfig: Codable, Equatable, Sendable {
  let className, table, collection, updatedField: String?
  let everyMinutes: Int
}
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
