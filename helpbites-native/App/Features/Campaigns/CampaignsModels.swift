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

struct SequenceTrigger: Codable, Equatable, Sendable { let type: String; let topic, event: String? }
struct SequenceStep: Codable, Equatable, Sendable, Identifiable { let id, template: String; let delayMinutes: Int; let subject: String? }
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

/// A project's newsletter topics, from its marketing settings.
struct MarketingTopic: Codable, Equatable, Sendable, Identifiable { let key, name: String; var id: String { key } }
