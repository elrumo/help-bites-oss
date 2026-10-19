import SwiftUI

// Marketing's shapes, mirroring shared/marketing.ts and server/utils/campaigns.ts.

struct CampaignStats: Codable, Equatable, Sendable {
  let audience, sent, failed, suppressed, delivered, opened, clicked, bounced, complained, unsubscribed: Int
}

struct CampaignAudience: Codable, Equatable, Sendable { let segment, topic: String }

struct Campaign: Codable, Identifiable, Equatable, Sendable {
  let id, projectId, name, status, template, templateName, subject, lastError: String
  let audience: CampaignAudience
  let testMode: Bool
  let stats: CampaignStats
  let scheduledAt, startedAt, finishedAt, createdAt, updatedAt: String?

  var editable: Bool { status == "draft" || status == "scheduled" }
}

enum CampaignStatusStyle {
  static func label(_ status: String) -> String {
    ["draft": "Draft", "scheduled": "Scheduled", "sending": "Sending", "paused": "Paused", "sent": "Sent", "canceled": "Canceled"][status] ?? status
  }
  static func tint(_ status: String) -> Color? {
    switch status { case "scheduled": Theme.info; case "sending": Theme.warning; case "sent": Theme.success; case "canceled": Theme.error; default: nil }
  }
}

func percent(_ part: Int, _ whole: Int) -> String {
  whole > 0 ? "\((Double(part) / Double(whole) * 1000).rounded() / 10)%" : "—"
}

struct SequenceTrigger: Codable, Equatable, Sendable { var type: String; var topic, event: String? }
struct SequenceStep: Codable, Equatable, Sendable, Identifiable { var id, template: String; var delayMinutes: Int; var subject: String? }
struct SequenceStats: Codable, Equatable, Sendable { let enrolled, completed, exited, active: Int }
struct EmailSequence: Codable, Identifiable, Equatable, Sendable {
  let id, name, status: String
  let trigger: SequenceTrigger
  let steps: [SequenceStep]
  let stats: SequenceStats

  var triggerText: String {
    switch trigger.type {
    case "subscribed": trigger.topic.map { "On sign-up to \($0)" } ?? "On sign-up"
    case "event": "On \(trigger.event ?? "an event")"
    default: "Manual"
    }
  }
}

/// A newsletter a contact can opt out of (shared/marketing.ts).
struct MarketingTopic: Codable, Equatable, Sendable, Identifiable {
  var key, name: String
  var description = ""
  var id: String { key }
  enum CodingKeys: String, CodingKey { case key, name, description }
  init(key: String, name: String, description: String = "") { self.key = key; self.name = name; self.description = description }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    key = try c.decode(String.self, forKey: .key)
    name = try c.decodeIfPresent(String.self, forKey: .name) ?? key
    description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
  }
}

/// A project's marketing settings (`project.marketing`).
struct MarketingConfig: Codable, Equatable, Sendable {
  var doubleOptIn = true
  var topics: [MarketingTopic] = []
  var postalAddress = ""
  var confirmRedirectUrl = ""
  var fromName = ""
  var fromEmail = ""
  var mailDomain = ""
  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    doubleOptIn = try c.decodeIfPresent(Bool.self, forKey: .doubleOptIn) ?? true
    topics = try c.decodeIfPresent([MarketingTopic].self, forKey: .topics) ?? []
    postalAddress = try c.decodeIfPresent(String.self, forKey: .postalAddress) ?? ""
    confirmRedirectUrl = try c.decodeIfPresent(String.self, forKey: .confirmRedirectUrl) ?? ""
    fromName = try c.decodeIfPresent(String.self, forKey: .fromName) ?? ""
    fromEmail = try c.decodeIfPresent(String.self, forKey: .fromEmail) ?? ""
    mailDomain = try c.decodeIfPresent(String.self, forKey: .mailDomain) ?? ""
  }
}

/// The slice of a project the marketing screens need, from `GET /admin/projects`.
struct MarketingProject: Decodable, Identifiable, Sendable {
  let id, publicKey, name: String
  let fromName: String?
  let marketing: MarketingConfig?
  let eventWebhookUrl: String?
  let hasEventWebhookSecret: Bool?

  static func load(_ projectId: String, session: SessionStore) async throws -> MarketingProject? {
    struct Response: Decodable, Sendable { let projects: [MarketingProject] }
    return (try await session.get("/v1/admin/projects") as Response).projects.first { $0.id == projectId }
  }
}

/// A template a campaign or sequence step can send: `key` (or id when it has none) is what the API takes.
struct MarketingTemplate: Decodable, Identifiable, Sendable, Hashable {
  struct Master: Decodable, Sendable, Hashable { let name: String }
  let id, name: String
  let key: String?
  let master: Master?
  var ref: String { (key?.isEmpty == false ? key : nil) ?? id }
  var title: String { master?.name ?? name }

  static func load(_ projectId: String, session: SessionStore) async -> [MarketingTemplate] {
    struct Response: Decodable, Sendable { let templates: [MarketingTemplate] }
    return ((try? await session.get("/v1/admin/emails", query: ["project": projectId]) as Response)?.templates) ?? []
  }
}
