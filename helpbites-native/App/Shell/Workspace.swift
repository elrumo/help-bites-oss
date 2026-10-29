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
  /// The projects that have a planning board, each opening its board (the Planning shortcut).
  case planning
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
/// sidebar also holds every project's sections, as the web's does. Which of the first seven the bar shows
/// is the user's choice (`TabShortcut`).
enum AppTab: Hashable {
  case overview, inbox, projects, planning, knowledge, templates, settings
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

// The labels above stay plain literals (tests/projectSectionsNativeParity.test.ts reads them);
// screens that show them use these, which look the label up in the string catalog.
extension SectionGroup {
  var localizedLabel: String { String(localized: String.LocalizationValue(label)) }
}
extension ProjectSection {
  var localizedLabel: String { String(localized: String.LocalizationValue(label)) }
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
  var planningPath: [AppRoute] = []
  var knowledgePath: [AppRoute] = []
  var templatesPath: [AppRoute] = []
  var settingsPath: [AppRoute] = []
  /// The shortcuts on the tab bar, in order: the user's choice (Settings › Tab bar) or the default bar.
  private(set) var shortcuts = TabShortcut.saved()
  /// The Email tab a link asked for (`email?view=log`); the Email screen takes it when it appears.
  var pendingEmailTab: EmailTab?
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
  /// Opens the welcome tour: on a new account's first launch, and from Settings.
  var tourOpen = false
  /// A new project's secret, shown once on its Dev page (the web passes it as ?secret=).
  var newProjectSecrets: [String: String] = [:]
  /// What waits on you across the workspace: the Overview's list and the badge on its tab.
  private(set) var attention = WorkspaceAttention.empty
  private var attentionTask: Task<Void, Never>?

  init(session: SessionStore) {
    self.session = session
    self.inbox = InboxStore(session: session)
    projects = SnapshotCache.load([Project].self, "projects") ?? []
    tab = shortcuts.first?.tab ?? .settings
  }

  func project(_ id: String) -> Project? { projects.first { $0.id == id } }

  /// The projects the Planning shortcut lists: planning is on and the project did not hide its section.
  var planningProjects: [Project] {
    projects.filter { $0.board?.enabled == true && !($0.hiddenSections ?? []).contains(ProjectSection.board.path) }
  }

  /// Saves the tab bar the user arranged. When the tab on screen came off it, the first one left opens.
  func setShortcuts(_ list: [TabShortcut]) {
    shortcuts = TabShortcut.normalized(list)
    TabShortcut.save(shortcuts)
    if !onBar(tab) { tab = shortcuts.first?.tab ?? .settings }
  }

  /// Back to the default bar.
  func resetShortcuts() {
    TabShortcut.forget()
    shortcuts = TabShortcut.defaults
    if !onBar(tab) { tab = shortcuts.first?.tab ?? .settings }
  }

  /// Whether the tab bar has this tab. A project's section is a tab only beside a sidebar.
  private func onBar(_ tab: AppTab) -> Bool {
    if case .section = tab { return sidebar }
    return shortcuts.contains { $0.tab == tab }
  }

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

  /// Opens the section a web path names, on the tab its `?view=` picks (`email?view=settings`).
  func go(webPath path: String, project projectId: String) {
    let section = ProjectSection.fromWeb(path) ?? .dev
    if section == .email, let view = path.split(separator: "?").last?.split(separator: "&").first(where: { $0.hasPrefix("view=") }) {
      pendingEmailTab = EmailTab(rawValue: String(view.dropFirst(5)))
    }
    go(.project(projectId, section))
  }

  /// Jump anywhere (palette, menu bar, links between screens): pick the tab and
  /// lay out its stack, so Back always leads to the parent page.
  func go(_ route: AppRoute) {
    #if os(macOS)
    macGo(route)
    return
    #else
    switch route {
    case .overview: open(on: .overview, fallback: [.overview])
    case .inbox: open(on: .inbox, fallback: [.inbox])
    case .emailTemplates: open(on: .templates, fallback: [.emailTemplates])
    case .emailLog: open(on: .templates, pages: [.emailLog], fallback: [.emailLog])
    case .knowledge: open(on: .knowledge, fallback: [.knowledge])
    case .planning: open(on: .planning, fallback: [.planning])
    case .projects: open(on: .projects, fallback: [.projects])
    case .project(let id, let section):
      if sidebar, let section { tab = .section(id, section); return }
      let pages: [AppRoute] = [.project(id, nil)] + (section.map { [.project(id, $0)] } ?? [])
      open(on: .projects, pages: pages, fallback: [.projects] + pages)
    case .account: tab = .settings; settingsPath = []
    case .apiKeys, .developer, .team, .profile, .workspace, .usage, .ai, .connections: tab = .settings; settingsPath = [route]
    case .legalDocument(let id, _):
      if sidebar { tab = .section(id, .legal); return }
      go(.project(id, .legal)); push(route)
    case .onboardingFlow(let id, _):
      if sidebar { tab = .section(id, .onboarding); return }
      go(.project(id, .onboarding)); push(route)
    case .pageEntry(let id, _):
      if sidebar { tab = .section(id, .pages); return }
      go(.project(id, .pages)); push(route)
    case .leadForm(let id, _):
      if sidebar { tab = .section(id, .forms); return }
      go(.project(id, .forms)); push(route)
    case .pricingTable(let id, _):
      if sidebar { tab = .section(id, .pricing); return }
      go(.project(id, .pricing)); push(route)
    }
    #endif
  }

  /// Selects `home` and lays `pages` out on its stack. A tab the bar does not have cannot be selected, so
  /// `fallback` opens on the Projects tab instead, or on Settings (always on the bar) when Projects is off it too.
  private func open(on home: AppTab, pages: [AppRoute] = [], fallback: [AppRoute]) {
    if onBar(home) { tab = home; setPath(pages, on: home); return }
    let host: AppTab = onBar(.projects) ? .projects : .settings
    tab = host
    setPath(fallback, on: host)
  }

  /// The stack of a tab that has one; Overview and Inbox push nothing from here.
  private func setPath(_ pages: [AppRoute], on tab: AppTab) {
    switch tab {
    case .projects: projectsPath = pages
    case .planning: planningPath = pages
    case .knowledge: knowledgePath = pages
    case .templates: templatesPath = pages
    case .settings: settingsPath = pages
    case .overview, .inbox, .section: break
    }
  }

  /// One more page on the stack of the tab on screen.
  private func push(_ route: AppRoute) {
    switch tab {
    case .projects: projectsPath.append(route)
    case .planning: planningPath.append(route)
    case .knowledge: knowledgePath.append(route)
    case .templates: templatesPath.append(route)
    case .settings: settingsPath.append(route)
    case .overview, .inbox, .section: break
    }
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
