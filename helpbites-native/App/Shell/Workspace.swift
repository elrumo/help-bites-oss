import Foundation
import Observation

/// Where the panel can go, mirroring the web's pages. A project with no section
/// is its page of sections, the step between Projects and a section on iPhone.
enum AppRoute: Hashable {
  case inbox
  case emailTemplates
  /// The email log across every project (web: /emails?view=log).
  case emailLog
  /// Knowledge models across every project (web: /knowledge).
  case knowledge
  case projects
  case project(String, ProjectSection?)
  case apiKeys
  case developer
  case team
  case account
  /// Your profile: name, email, password.
  case profile
  /// The workspace: name, export, delete.
  case workspace
  /// Plan and usage against the plan's limits.
  case usage
  /// The workspace's AI provider and keys.
  case ai
  /// Stripe, Telegram, GitHub and error-tracking servers.
  case connections
  /// One legal document (project id, document id).
  case legalDocument(String, String)
}

/// The tab bar's tabs (iPhone), which become the sidebar on iPad and Mac. The
/// sidebar also holds every project's sections, as the web's does.
enum AppTab: Hashable {
  case inbox, projects, templates, settings
  case section(String, ProjectSection)
}

/// A project's sections, nested under it in the sidebar like a Linear team's.
enum ProjectSection: String, CaseIterable, Identifiable, Hashable {
  case overview, conversations, contacts, revenue, knowledge, assistants, tickets, feedback, board, changelog, legal, email, campaigns, flags, errors, dev, settings
  var id: String { rawValue }
  var label: String {
    switch self {
    case .overview: "Overview"
    case .conversations: "Conversations"
    case .contacts: "Contacts"
    case .revenue: "Revenue"
    case .knowledge: "Knowledge base"
    case .assistants: "Assistants"
    case .tickets: "Tickets"
    case .feedback: "Feedback"
    case .board: "Board"
    case .changelog: "Changelog"
    case .legal: "Legal"
    case .email: "Email"
    case .campaigns: "Campaigns"
    case .flags: "Flags"
    case .errors: "Errors"
    case .dev: "Dev"
    case .settings: "Settings"
    }
  }
  var systemImage: String {
    switch self {
    case .overview: "square.grid.2x2"
    case .conversations: "tray"
    case .contacts: "person.2"
    case .knowledge: "book"
    case .assistants: "sparkles"
    case .tickets: "ticket"
    case .feedback: "lightbulb"
    case .board: "rectangle.split.3x1"
    case .email: "envelope"
    case .campaigns: "megaphone"
    case .revenue: "dollarsign.circle"
    case .changelog: "scroll"
    case .legal: "scale.3d"
    case .settings: "gearshape"
    case .flags: "switch.2"
    case .errors: "ladybug"
    case .dev: "chevron.left.forwardslash.chevron.right"
    }
  }
}

/// App-wide state the shell and every screen share: the projects, the inbox,
/// where we are, and the flags that open the shell's sheets.
@MainActor @Observable final class Workspace {
  let session: SessionStore
  let inbox: InboxStore
  var projects: [Project] = []
  var tab: AppTab = .inbox
  var projectsPath: [AppRoute] = []
  var templatesPath: [AppRoute] = []
  var settingsPath: [AppRoute] = []
  /// The Mac window's sidebar selection and the pages pushed onto its detail.
  var macSelection: AppRoute = .inbox
  var macPath: [AppRoute] = []
  /// iPad at full width and Mac show the sidebar, where a project's section is a tab of its own.
  var sidebar = false
  /// Opens the new-conversation sheet (sidebar compose, or ⌘N).
  var composeOpen = false
  /// Opens the ⌘K palette.
  var paletteOpen = false
  var newProjectOpen = false
  /// A new project's secret, shown once on its Dev page (the web passes it as ?secret=).
  var newProjectSecrets: [String: String] = [:]

  init(session: SessionStore) {
    self.session = session
    self.inbox = InboxStore(session: session)
    projects = SnapshotCache.load([Project].self, "projects") ?? []
  }

  func project(_ id: String) -> Project? { projects.first { $0.id == id } }

  func loadProjects() async {
    struct Response: Decodable, Sendable { let projects: [Project] }
    do {
      let response: Response = try await session.get("/v1/admin/projects")
      projects = response.projects
      SnapshotCache.save(response.projects, "projects")
    } catch {}
  }

  /// Replace one project after a save, so every screen sees the new values.
  func replace(_ project: Project) {
    if let index = projects.firstIndex(where: { $0.id == project.id }) { projects[index] = project }
    else { projects.append(project) }
  }

  /// Jump anywhere (palette, menu bar, links between screens): pick the tab and
  /// lay out its stack, so Back always leads to the parent page.
  func go(_ route: AppRoute) {
    #if os(macOS)
    macGo(route)
    return
    #else
    switch route {
    case .inbox: tab = .inbox
    case .emailTemplates: tab = .templates; templatesPath = []
    case .emailLog: tab = .templates; templatesPath = [.emailLog]
    case .knowledge: tab = .projects; projectsPath = [.knowledge]
    case .projects: tab = .projects; projectsPath = []
    case .project(let id, let section):
      if sidebar, let section { tab = .section(id, section); return }
      tab = .projects
      projectsPath = [.project(id, nil)] + (section.map { [.project(id, $0)] } ?? [])
    case .account: tab = .settings; settingsPath = []
    case .apiKeys, .developer, .team, .profile, .workspace, .usage, .ai, .connections: tab = .settings; settingsPath = [route]
    case .legalDocument(let id, _): go(.project(id, .legal)); if sidebar { /* the section's own stack pushes the document */ } else { projectsPath.append(route) }
    }
    #endif
  }

  /// The Mac sidebar: the route's root page is the selection, anything deeper is pushed on its stack.
  func macGo(_ route: AppRoute) {
    switch route {
    case .apiKeys, .developer, .team, .profile, .workspace, .usage, .ai, .connections:
      macSelection = route == .developer ? .developer : .account
      macPath = route == .developer ? [] : [route]
    case .legalDocument(let id, _):
      macSelection = .project(id, .legal)
      macPath = [route]
    default:
      macSelection = route
      macPath = []
    }
  }
}
