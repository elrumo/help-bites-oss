import Foundation

// The email library's DTOs as the admin API serializes them (server/utils/emails.ts).
// `updatedAt` is epoch milliseconds here, not an ISO string. Documents stay
// free-form JSON: the server owns their shape, the panel only renders them.

struct EmailVariable: Codable, Equatable, Sendable {
  let key: String
  var label: String?
  var defaultValue: String?
}

struct EmailMasterSummary: Decodable, Equatable, Sendable {
  let id: String
  let name: String
  let document: JSONValue?
  let variables: [EmailVariable]
  let updatedAt: Double
}

struct EmailTemplateItem: Decodable, Identifiable, Equatable, Sendable {
  let id: String
  let projectId: String?
  let masterId: String?
  var folderId: String?
  var key: String
  var name: String
  var document: JSONValue?
  var variables: [EmailVariable]
  var variableValues: [String: String]
  var shareMode: String?
  var shareToken: String?
  /// When the share link stops working (epoch ms); nil when it has no date, which the server treats as expired.
  var shareExpiresAt: Double?
  /// The last time someone edited through the link.
  var lastSharedEdit: SharedEdit?
  let updatedAt: Double
  var master: EmailMasterSummary?
  /// The editor session that saved last; an editor ignores live updates of its own saves.
  var lastActorId: String?

  struct SharedEdit: Decodable, Equatable, Sendable { let at: String?; let ip: String? }

  var isLinked: Bool { masterId != nil }
  /// A project's link goes by its master's name.
  var title: String { master.map(\.name).flatMap { $0.isEmpty ? nil : $0 } ?? name }
  /// The panel shows the later of the row's and its master's saves.
  var updated: Double { max(updatedAt, master?.updatedAt ?? 0) }
}

struct EmailFolderItem: Decodable, Identifiable, Equatable, Sendable {
  let id: String
  let parentId: String?
  var name: String
}

/// The slice of a project an email can see: `{{project.*}}` and the accent on buttons.
struct EmailBrand: Decodable, Sendable {
  let id: String
  let name: String
  let brandLogoUrl: String?
  let siteUrl: String?
  let theme: ProjectTheme?
  /// The postal address marketing email carries (`{{project.address}}`).
  let marketing: Marketing?
  struct Marketing: Decodable, Sendable { let postalAddress: String? }
}

struct EmailTemplateList: Decodable, Sendable { let templates: [EmailTemplateItem]; let usage: [String: Int]? }
struct EmailFolderList: Decodable, Sendable { let folders: [EmailFolderItem] }
struct EmailTemplateResponse: Decodable, Sendable { let template: EmailTemplateItem }
struct EmailFolderResponse: Decodable, Sendable { let folder: EmailFolderItem }
struct EmailShareResponse: Decodable, Sendable { let mode: String; let token: String?; let expiresAt: Double? }
struct EmailBrandList: Decodable, Sendable { let projects: [EmailBrand] }

/// What the full-screen email editor opens.
struct EmailEditorTarget: Identifiable, Equatable {
  let id: String
  let name: String
}

/// The starter catalog's display data (shared/email/templates.ts). The server
/// owns the documents: creating sends only `starterId`.
struct EmailStarter: Identifiable, Sendable {
  let id, name, type, style, systemImage, accent, description, background, surface: String

  static let all: [EmailStarter] = [
    EmailStarter(id: "launch-bold", name: "Product launch", type: "Launch", style: "Bold", systemImage: "paperplane", accent: "#2563eb", description: "Hero, feature columns, and one direct call to action.", background: "#eef2ff", surface: "#ffffff"),
    EmailStarter(id: "newsletter-editorial", name: "Editorial digest", type: "Newsletter", style: "Editorial", systemImage: "newspaper", accent: "#0f766e", description: "A calm issue layout with lead story, links, and notes.", background: "#f5f7f4", surface: "#ffffff"),
    EmailStarter(id: "promotion-minimal", name: "Flash sale", type: "Promotion", style: "Minimal", systemImage: "percent", accent: "#dc2626", description: "Offer-first copy with a coupon block and compact footer.", background: "#fafafa", surface: "#ffffff"),
    EmailStarter(id: "welcome-soft", name: "Warm welcome", type: "Welcome", style: "Soft", systemImage: "hand.wave", accent: "#7c3aed", description: "Friendly onboarding with next steps and a helpful CTA.", background: "#f6f2ff", surface: "#ffffff"),
    EmailStarter(id: "event-dark", name: "Event invite", type: "Event", style: "Dark", systemImage: "calendar", accent: "#f59e0b", description: "High-contrast invitation with date, details, and RSVP.", background: "#111827", surface: "#1f2937"),
    EmailStarter(id: "transactional-utility", name: "Account update", type: "Transactional", style: "Utility", systemImage: "checkmark.shield", accent: "#0891b2", description: "Clear system message with status details and support link.", background: "#ecfeff", surface: "#ffffff")
  ]
}

// MARK: - Sections

/// The email page's sections (EmailTabs.vue): templates (masters on the
/// global page), the component library, the log of everything sent, and the
/// suppressed addresses.
enum EmailTab: String, CaseIterable, Identifiable, Hashable, Sendable {
  case templates, components, log, suppressed
  var id: String { rawValue }
}

// MARK: - Sending settings

/// How this server sends email (GET /v1/admin/email-settings). Every field is
/// optional on the wire; a missing one reads as unset.
struct EmailSettings: Codable, Equatable, Sendable {
  struct Webhook: Codable, Equatable, Sendable {
    var configured: Bool
    var url: String

    init(configured: Bool = false, url: String = "") {
      self.configured = configured
      self.url = url
    }
  }

  var configured: Bool
  var provider: String
  var domain: String
  var fromEmail: String
  var apiBaseUrl: String
  var webhook: Webhook
  var retentionDays: Int

  init(configured: Bool = false, provider: String = "", domain: String = "", fromEmail: String = "", apiBaseUrl: String = "", webhook: Webhook = Webhook(), retentionDays: Int = 0) {
    self.configured = configured
    self.provider = provider
    self.domain = domain
    self.fromEmail = fromEmail
    self.apiBaseUrl = apiBaseUrl
    self.webhook = webhook
    self.retentionDays = retentionDays
  }
}

extension EmailSettings.Webhook {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      configured: (try? c.decodeIfPresent(Bool.self, forKey: .configured)) ?? false,
      url: (try? c.decodeIfPresent(String.self, forKey: .url)) ?? ""
    )
  }
}

extension EmailSettings {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      configured: (try? c.decodeIfPresent(Bool.self, forKey: .configured)) ?? false,
      provider: (try? c.decodeIfPresent(String.self, forKey: .provider)) ?? "",
      domain: (try? c.decodeIfPresent(String.self, forKey: .domain)) ?? "",
      fromEmail: (try? c.decodeIfPresent(String.self, forKey: .fromEmail)) ?? "",
      apiBaseUrl: (try? c.decodeIfPresent(String.self, forKey: .apiBaseUrl)) ?? "",
      webhook: (try? c.decodeIfPresent(Webhook.self, forKey: .webhook)) ?? Webhook(),
      retentionDays: (try? c.decodeIfPresent(Int.self, forKey: .retentionDays)) ?? 0
    )
  }
}

// MARK: - Log (server/utils/emailLogs.ts)

struct EmailLogEvent: Decodable, Equatable, Sendable {
  let type: String?
  let at: String?
  let detail: String?
}

struct EmailLogTemplateRef: Decodable, Equatable, Sendable {
  let id: String?
  let key: String?
  let name: String?
}

struct EmailLogValue: Decodable, Equatable, Sendable {
  let key: String
  let value: JSONValue?
}

struct EmailLogAttachment: Decodable, Equatable, Sendable {
  let filename: String?
  let contentType: String?
  let size: Double?
  let inline: Bool?
}

struct EmailLogActor: Decodable, Equatable, Sendable {
  let type: String?
  let id: String?
  let name: String?
}

/// One recipient of one send. Lists leave out `html`/`text`; the detail route adds them.
struct EmailLogEntry: Decodable, Identifiable, Equatable, Sendable {
  let id: String
  let projectId: String?
  let batchId: String?
  let source: String?
  let kind: String?
  let template: EmailLogTemplateRef?
  let to: String?
  let toName: String?
  let cc: [String]?
  let bcc: [String]?
  let from: String?
  let replyTo: String?
  let subject: String?
  let status: String?
  let error: String?
  let messageId: String?
  let tags: [String]?
  let metadata: [String: JSONValue]?
  let variables: [EmailLogValue]?
  let attachments: [EmailLogAttachment]?
  let headers: [String]?
  let events: [EmailLogEvent]?
  let scheduledAt: String?
  let testMode: Bool?
  let idempotencyKey: String?
  let actor: EmailLogActor?
  let ip: String?
  let userAgent: String?
  let durationMs: Double?
  let hasContent: Bool?
  let html: String?
  let text: String?
  let createdAt: String?
  let updatedAt: String?

  var statusKey: String { status ?? "sent" }
  var recipient: String { to ?? "" }
}

struct EmailLogList: Decodable, Sendable { let logs: [EmailLogEntry]; let nextBefore: String? }
struct EmailLogResponse: Decodable, Sendable { let log: EmailLogEntry }

/// GET /v1/admin/email-logs/stats: only the totals the tiles read.
struct EmailLogStats: Decodable, Equatable, Sendable {
  let days: Int?
  let total: Int?
  let byStatus: [String: Int]?
  let bySource: [String: Int]?
  /// The most-sent send keys of the window, for the log's template filter.
  let topTemplates: [TopTemplate]?
  let truncated: Bool?

  struct TopTemplate: Decodable, Equatable, Sendable { let key: String; let name: String?; let count: Int? }
}

// MARK: - Suppressions

struct EmailSuppression: Decodable, Identifiable, Equatable, Sendable {
  let id: String
  let projectId: String?
  let email: String?
  let reason: String?
  let detail: String?
  let source: String?
  let createdAt: String?
}

struct EmailSuppressionList: Decodable, Sendable { let suppressions: [EmailSuppression]; let nextBefore: String? }
struct EmailSuppressionAddResult: Decodable, Sendable { let added: [EmailSuppression]?; let existing: Int? }

/// POST /v1/admin/email-suppressions.
struct EmailSuppressionInput: Encodable, Sendable {
  let project: String
  let emails: [String]
  let reason: String
  let detail: String
}

// MARK: - Test sends, import

/// What a send (or test send) did, per recipient (DeliverySummary).
struct EmailDeliverySummary: Decodable, Sendable {
  struct Result: Decodable, Sendable { let to: String?; let status: String?; let error: String? }
  let id: String?
  let sent: Int?
  let failed: [String]?
  let suppressed: [String]?
  let results: [Result]?
}

struct EmailImportSummary: Decodable, Sendable {
  struct Result: Decodable, Sendable { let key: String?; let action: String?; let error: String? }
  var created: Int?
  var updated: Int?
  var unchanged: Int?
  var skipped: Int?
  var failed: Int?
  var results: [Result]?
}
