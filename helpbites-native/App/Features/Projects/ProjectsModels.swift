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

