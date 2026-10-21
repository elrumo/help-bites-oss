import SwiftUI

/// The full admin project (`GET /v1/admin/projects` rows). The shared `Project`
/// carries only what the shell needs; the Dev and Flags screens edit the rest.
struct ProjectsAdminProject: Decodable, Sendable {
  let id, publicKey, name, siteUrl, inboxPath, fromName: String
  let allowedOrigins, notifyEmails: [String]
  let theme: ProjectTheme
  let allowAttachments: Bool
  // Newer settings: optional so an older server still loads the screen.
  let chatNotice, brandLogoUrl, assistantLogoUrl, iconUrl, actionWebhookUrl: String?
  let fromEmail, replyTo, mailDomain: String?
  let letUsersChooseType, allowOtherType, hasActionWebhookSecret, emailLogContent: Bool?
  let errors: ProjectErrors?
  /// Every tracker project it reports to (`errors` is the first); nil from an older server.
  let errorLinks: [ErrorLink]?
  /// Chat and feedback with only an email address; nil from an older server.
  let allowAnonymousUsers: Bool?
  let feedback: Feedback?
  let flags: [ProjectsFlag]?
  /// The project board's settings; nil from a server without boards.
  let board: BoardConfig?
  /// When the chat widget last loaded on a host page; nil until it ever has (or from an older server).
  let widgetSeenAt: String?
  /// When a signed identity token last arrived from the host's backend; nil until one has (or from an older server).
  let identitySeenAt: String?
  /// Web paths of the sections hidden from the sidebar; nil from an older server.
  let hiddenSections: [String]?

  /// `ErrorLinkView` (server/utils/errorTracking.ts): one tracker project of this project.
  struct ErrorLink: Decodable, Identifiable, Sendable, Equatable {
    let id, label, name, team, serverId, provider, providerName, dsn, url, alertWebhookUrl: String
  }

  /// What other screens need of the feedback board: whether it is on, offers a
  /// roadmap, and its statuses (a linked post's status badge).
  struct Feedback: Decodable, Sendable { let enabled: Bool?; let roadmap: Bool?; let statuses: [FeedbackStatusDefinition]? }

  /// There is no GET for one project; the panel reads the list and picks it.
  @MainActor static func load(_ id: String, session: SessionStore) async throws -> ProjectsAdminProject {
    struct Response: Decodable, Sendable { let projects: [ProjectsAdminProject] }
    let response: Response = try await session.get("/v1/admin/projects")
    guard let project = response.projects.first(where: { $0.id == id }) else { throw APIError.server("Project not found") }
    return project
  }

  /// `PATCH /v1/admin/projects/:id`, then hand the shell its slimmer copy.
  @MainActor static func save<Body: Encodable & Sendable>(_ id: String, _ body: Body, workspace: Workspace) async throws -> ProjectsAdminProject {
    let saved: Saved = try await workspace.session.send("/v1/admin/projects/\(id)", method: "PATCH", body: body)
    workspace.replace(saved.shared)
    return saved.full
  }

  /// One response decoded twice: the full row for the form, the shared one for `Workspace`.
  /// Any `{ project, … }` reply decodes as this (error-link routes, connect).
  struct Saved: Decodable, Sendable {
    let full: ProjectsAdminProject
    let shared: Project
    enum CodingKeys: CodingKey { case project }
    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      full = try container.decode(ProjectsAdminProject.self, forKey: .project)
      shared = try container.decode(Project.self, forKey: .project)
    }
  }
}

/// shared/flags.ts `FeatureFlag`; `state` and `fallback` are off | admins | on.
struct ProjectsFlag: Codable, Sendable, Equatable {
  var key, description, state, fallback: String
  var targets, allow: [String]
}

// MARK: - Setup

// shared/setup.ts and server/utils/setup.ts: a project's setup checklist, judged from what
// HelpBites has seen. Rows carry a `reason` code and a `value`; `setup.<key>.<reason>` in
// en.json words them, and `SetupItem.text` words them the same here.

/// One row. `state` is done | todo | attention; `section` is the web section path that fixes it
/// (`email?view=settings`, `settings#github`); `isOptional` rows never read as a failure.
struct SetupItem: Decodable, Identifiable, Sendable {
  let key, state, reason, value, section: String
  let isOptional: Bool
  var id: String { key }
  enum CodingKeys: String, CodingKey {
    case key, state, reason, value, section
    case isOptional = "optional"
  }

  /// `setup.<key>.title`.
  var title: String {
    switch key {
    case "widget": "Chat widget on your site"
    case "identity": "Users identified"
    case "notified": "Someone is told about new chats"
    case "sender": "Email sender"
    case "assistant": "AI assistant ready"
    case "stripe": "Stripe"
    case "github": "GitHub"
    case "errors": "Error tracking"
    default: key
    }
  }

  /// `setup.<key>.<reason>`: a time value shows as a medium date and short time, and a numeric one picks the plural.
  @MainActor var text: String {
    let words: PluralText
    switch "\(key).\(reason)" {
    case "widget.seen": words = PluralText("Last loaded on your site {value}.")
    case "widget.noOrigins": words = PluralText("Allow your site's address, then add the script.")
    case "widget.waiting": words = PluralText("Waiting for the widget to load on your site.")
    case "identity.seen": words = PluralText("Your backend signed an identity token {value}.")
    case "identity.missing": words = PluralText("No signed identity token yet: your backend signs one per user so conversations are theirs.")
    case "identity.anonymous": words = PluralText("Nobody signed in with a token yet. Email-only sign-in is on, so this may be fine.")
    case "notified.email": words = PluralText("Emailed to {value} address", "Emailed to {value} addresses")
    case "notified.push": words = PluralText("Pushed to {value} device", "Pushed to {value} devices")
    case "notified.noMailer": words = PluralText("Addresses are set, but this server cannot send email yet.")
    case "notified.nobody": words = PluralText("Nobody is emailed or pushed when a customer writes.")
    case "sender.ready": words = PluralText("Mail goes out from {value}.")
    case "sender.default": words = PluralText("Mail goes out from the server's default address.")
    case "sender.missing": words = PluralText("No sender or no mail server yet: email cannot go out.")
    case "assistant.live": words = PluralText("{value} answers customers by itself.")
    case "assistant.notLive": words = PluralText("{value} is not answering yet: it needs a provider, knowledge, to be active and auto-reply on.")
    case "assistant.none": words = PluralText("No assistant yet. Humans answer everything until you add one.")
    case "stripe.synced": words = PluralText("Connected and synced.")
    case "stripe.waiting": words = PluralText("Connected; waiting for the first sync.")
    case "stripe.error": words = PluralText("The last sync failed: {value}")
    case "stripe.none": words = PluralText("Not connected: no revenue on the Overview.")
    case "github.linked": words = PluralText("{value} repository linked", "{value} repositories linked")
    case "github.none": words = PluralText("No repository linked: no drafts from commits.")
    case "errors.connected": words = PluralText("Reporting to {value}.")
    case "errors.none": words = PluralText("Not connected: errors never reach the inbox.")
    default: return value
    }
    var shown = value
    if value.range(of: #"^\d{4}-\d\d-\d\dT"#, options: .regularExpression) != nil, let date = DateText.date(value) {
      shown = date.formatted(date: .abbreviated, time: .shortened)
    }
    // vue-i18n picks the form by the value when it is a number; anything else reads as one.
    let isCount = !value.isEmpty && value.allSatisfy({ $0.isASCII && $0.isNumber })
    return words.text(isCount ? (Int(value) ?? 1) : 1, ["value": shown])
  }
}

/// `setup` of the project overview: the rows, and how many are done of how many.
struct ProjectSetup: Decodable, Sendable {
  let items: [SetupItem]
  let done, total: Int
}
