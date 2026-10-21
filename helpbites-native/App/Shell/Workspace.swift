import Foundation
import Observation

/// Where the panel can go, mirroring the web's pages. A project with no section
/// is its page of sections, the step between Projects and a section on iPhone.
enum AppRoute: Hashable {
  /// Every project at once, the page the app opens on (web: /overview).
  case overview
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
  /// One onboarding flow (project id, flow id).
  case onboardingFlow(String, String)
  /// One page or other CMS entry (project id, entry id).
  case pageEntry(String, String)
  /// One lead form (project id, form id).
  case leadForm(String, String)
  /// One pricing table (project id, table id).
  case pricingTable(String, String)
}

/// The tab bar's tabs (iPhone), which become the sidebar on iPad and Mac. The
/// sidebar also holds every project's sections, as the web's does.
enum AppTab: Hashable {
  case overview, inbox, projects, templates, settings
  case section(String, ProjectSection)
}

/// The headings a project's sections sit under in the sidebar, as the web's do (shared/projectSections.ts).
enum SectionGroup: String, CaseIterable {
  case support, product, grow, site, build
  var label: String {
    switch self {
    case .support: "Support"
    case .product: "Product"
    case .grow: "Grow"
    case .site: "Site"
    case .build: "Build"
    }
  }
}

/// A project's sections, nested under it in the sidebar like a Linear team's. The cases run in
/// sidebar order.
enum ProjectSection: String, CaseIterable, Identifiable, Hashable {
  case overview, conversations, knowledge, assistants, tickets, feedback, board, changelog, onboarding, contacts, forms, email, revenue, pricing, pages, blog, legal, brand, errors, flags, dev, settings
  var id: String { rawValue }
  var label: String {
    switch self {
    case .overview: "Overview"
    case .conversations: "Conversations"
    case .contacts: "Contacts"
    case .forms: "Forms"
    case .revenue: "Revenue"
    case .pricing: "Pricing"
    case .knowledge: "Knowledge base"
    case .assistants: "Assistants"
    case .tickets: "Ticket types"
    case .feedback: "Feedback"
    case .board: "Planning"
    case .changelog: "Changelog"
    case .blog: "Blog"
    case .onboarding: "Onboarding"
    case .legal: "Legal"
    case .brand: "Brand"
    case .pages: "Pages"
    case .email: "Email"
    case .flags: "Flags"
    case .errors: "Errors"
    case .dev: "Install & API"
    case .settings: "Settings"
    }
  }
  var systemImage: String {
    switch self {
    case .overview: "square.grid.2x2"
    case .conversations: "tray"
    case .contacts: "person.2"
    case .forms: "list.bullet.clipboard"
    case .knowledge: "book"
    case .assistants: "sparkles"
    case .tickets: "ticket"
    case .feedback: "lightbulb"
    case .board: "rectangle.split.3x1"
    case .email: "envelope"
    case .revenue: "dollarsign.circle"
    case .pricing: "tag"
    case .changelog: "scroll"
    case .blog: "newspaper"
    case .onboarding: "rectangle.stack"
    case .legal: "scale.3d"
    case .brand: "paintpalette"
    case .pages: "doc.richtext"
    case .settings: "gearshape"
    case .flags: "switch.2"
    case .errors: "ladybug"
    case .dev: "chevron.left.forwardslash.chevron.right"
    }
  }
  /// Its heading in the sidebar; nil for Overview above the groups and Settings below them.
  var group: SectionGroup? {
    switch self {
    case .overview, .settings: nil
    case .conversations, .knowledge, .assistants, .tickets: .support
    case .feedback, .board, .changelog, .onboarding: .product
    case .contacts, .forms, .email, .revenue, .pricing: .grow
    case .pages, .blog, .legal, .brand: .site
    case .errors, .flags, .dev: .build
    }
  }
  /// The web's path for it (`/projects/:id/<path>`), which is also how `hiddenSections` names it.
  var path: String { self == .tickets ? "types" : rawValue }

  /// The section a web path opens (`email?view=settings`, `settings#github`, `types`); nil for a path that is not a section.
  static func fromWeb(_ path: String) -> ProjectSection? {
    let bare = String(path.prefix(while: { $0 != "?" && $0 != "#" }))
    if bare == "types" { return .tickets }
    return ProjectSection(rawValue: bare)
  }
}

/// One heading of a project's navigation and the sections under it.
struct SectionGroupEntry: Identifiable {
  let group: SectionGroup
  let sections: [ProjectSection]
  var id: SectionGroup { group }
}

/// A project's sections laid out for navigation (web: `groupSections`): Overview above the groups, Settings below.
struct SectionLayout {
  let groups: [SectionGroupEntry]
  /// Everything in display order, for a flat list (the iPad sidebar, ⌘K).
  var all: [ProjectSection] {
    var list: [ProjectSection] = [.overview]
    for entry in groups { list += entry.sections }
    list.append(.settings)
    return list
  }
}

/// App-wide state the shell and every screen share: the projects, the inbox,
/// where we are, and the flags that open the shell's sheets.
@MainActor @Observable final class Workspace {
  let session: SessionStore
  let inbox: InboxStore
  var projects: [Project] = []
  var tab: AppTab = .overview
  var projectsPath: [AppRoute] = []
  var templatesPath: [AppRoute] = []
  var settingsPath: [AppRoute] = []
  /// The Mac window's sidebar selection and the pages pushed onto its detail.
  var macSelection: AppRoute = .overview
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
  /// What waits on you across the workspace: the Overview's list and the badge on its tab.
  private(set) var attention = WorkspaceAttention.empty
  private var attentionTask: Task<Void, Never>?

  init(session: SessionStore) {
    self.session = session
    self.inbox = InboxStore(session: session)
    projects = SnapshotCache.load([Project].self, "projects") ?? []
  }

  func project(_ id: String) -> Project? { projects.first { $0.id == id } }

  /// A project's sections laid out for navigation: Overview, each group's sections the project has not
  /// hidden (an empty group is left out), then Settings. `keeping` stays listed even when hidden, so the
  /// section on screen never drops out of the navigation beside it.
  func layout(_ projectId: String, keeping current: ProjectSection? = nil) -> SectionLayout {
    let hidden = Set(project(projectId)?.hiddenSections ?? [])
    var groups: [SectionGroupEntry] = []
    for group in SectionGroup.allCases {
      let sections = ProjectSection.allCases.filter { $0.group == group && (!hidden.contains($0.path) || $0 == current) }
      if !sections.isEmpty { groups.append(SectionGroupEntry(group: group, sections: sections)) }
    }
    return SectionLayout(groups: groups)
  }

  func loadProjects() async {
    struct Response: Decodable, Sendable { let projects: [Project] }
    do {
      let response: Response = try await session.get("/v1/admin/projects")
      projects = response.projects
      SnapshotCache.save(response.projects, "projects")
    } catch {}
  }

  /// `GET /v1/admin/attention`; the last list stays when a read fails.
  func loadAttention() async {
    guard !session.token.isEmpty else { return }
    if let loaded: WorkspaceAttention = try? await session.get("/v1/admin/attention") { attention = loaded }
  }

  /// Launch and every return to the foreground: read it, then again every minute until `stopAttention()`.
  func startAttention() {
    attentionTask?.cancel()
    attentionTask = Task { [weak self] in
      while !Task.isCancelled, self != nil {
        await self?.loadAttention()
        try? await Task.sleep(for: .seconds(60))
      }
    }
  }

  func stopAttention() { attentionTask?.cancel(); attentionTask = nil }

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
    case .overview: tab = .overview
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
    case .legalDocument(let id, _):
      if sidebar { tab = .section(id, .legal); return }
      go(.project(id, .legal)); projectsPath.append(route)
    case .onboardingFlow(let id, _):
      if sidebar { tab = .section(id, .onboarding); return }
      go(.project(id, .onboarding)); projectsPath.append(route)
    case .pageEntry(let id, _):
      if sidebar { tab = .section(id, .pages); return }
      go(.project(id, .pages)); projectsPath.append(route)
    case .leadForm(let id, _):
      if sidebar { tab = .section(id, .forms); return }
      go(.project(id, .forms)); projectsPath.append(route)
    case .pricingTable(let id, _):
      if sidebar { tab = .section(id, .pricing); return }
      go(.project(id, .pricing)); projectsPath.append(route)
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
    case .onboardingFlow(let id, _):
      macSelection = .project(id, .onboarding)
      macPath = [route]
    case .pageEntry(let id, _):
      macSelection = .project(id, .pages)
      macPath = [route]
    case .leadForm(let id, _):
      macSelection = .project(id, .forms)
      macPath = [route]
    case .pricingTable(let id, _):
      macSelection = .project(id, .pricing)
      macPath = [route]
    default:
      macSelection = route
      macPath = []
    }
  }
}
