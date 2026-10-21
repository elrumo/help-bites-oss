import SwiftUI

/// The signed-in app, navigated the way each platform does: tabs along the bottom
/// on iPhone, tabs that open into a sidebar on iPad, a sidebar on Mac. The sidebar
/// also lists every project's sections, as the web panel's does. The screens keep
/// the web's look; only the way between them is native.
struct AppShell: View {
  @State private var workspace: Workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.scenePhase) private var scenePhase

  init(session: SessionStore) {
    _workspace = State(initialValue: Workspace(session: session))
  }

  @ViewBuilder private var shell: some View {
    #if os(macOS)
    MacShell()
    #else
    TabView(selection: $workspace.tab) {
      Tab("Overview", systemImage: "house", value: AppTab.overview) {
        NavigationStack { OverviewScreen().routes() }
      }

      Tab("Inbox", systemImage: "tray", value: AppTab.inbox) {
        NavigationStack { InboxScreen() }
      }
      .badge(workspace.inbox.totalUnread)

      Tab("Projects", systemImage: "square.stack", value: AppTab.projects) {
        NavigationStack(path: $workspace.projectsPath) { ProjectsScreen().routes() }
      }

      Tab("Templates", systemImage: "envelope", value: AppTab.templates) {
        NavigationStack(path: $workspace.templatesPath) { EmailLibraryScreen(projectId: nil).routes() }
      }

      // Only beside a sidebar: a tab bar would list every section as a tab of its own.
      if workspace.sidebar {
        ForEach(workspace.projects) { project in projectSection(project) }
      }

      Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
        NavigationStack(path: $workspace.settingsPath) { SettingsScreen().routes() }
      }
    }
    .tabViewStyle(.sidebarAdaptable)
    .tint(Theme.accent)
    #endif
  }

  var body: some View {
    shell
    .environment(workspace)
    .focusedSceneValue(\.workspace, workspace)
    .sheet(isPresented: $workspace.paletteOpen) { CommandPalette().environment(workspace) }
    .sheet(isPresented: $workspace.newProjectOpen) { NewProjectSheet().environment(workspace) }
    .onChange(of: sizeClass, initial: true) { _, size in
      workspace.sidebar = !Platform.isPhone && size == .regular
      // Narrowed to a tab bar (iPad split view): a section tab exists only in the sidebar.
      if !workspace.sidebar, case .section(let id, let section) = workspace.tab { workspace.go(.project(id, section)) }
    }
    .task {
      async let projects: Void = workspace.loadProjects()
      async let inbox: Void = workspace.inbox.start()
      _ = await (projects, inbox)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await workspace.inbox.start() } } else { workspace.inbox.stop() }
    }
    .onChange(of: PushRegistration.shared.pendingConversationID) { _, id in
      guard !id.isEmpty else { return }
      workspace.go(.inbox)
      Task { await workspace.inbox.select(id); PushRegistration.shared.pendingConversationID = "" }
    }
  }

  /// A project and its sections in the sidebar, closed until opened as on the web
  /// (the OS keeps sections open before iOS 27).
  @TabContentBuilder<AppTab> private func projectSection(_ project: Project) -> some TabContent<AppTab> {
    let section = TabSection {
      ForEach(ProjectSection.allCases) { section in
        Tab(section.label, systemImage: section.systemImage, value: AppTab.section(project.id, section)) {
          NavigationStack { RouteView(route: .project(project.id, section)).routes() }
        }
        .tabPlacement(.sidebarOnly)
      }
    } header: {
      HStack(spacing: 8) {
        ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl)
        Text(project.name)
      }
    }
    #if os(iOS)
    if #available(iOS 27, *) { section.defaultSectionExpansion(.collapsed) } else { section }
    #else
    section
    #endif
  }
}

/// Which screen a route shows. Each lives in its feature folder.
struct RouteView: View {
  let route: AppRoute
  var body: some View {
    switch route {
    case .overview: OverviewScreen()
    case .inbox: InboxScreen()
    case .emailTemplates: EmailLibraryScreen(projectId: nil)
    case .emailLog: EmailLibraryScreen(projectId: nil, initialTab: .log)
    case .knowledge: KnowledgeScreen(projectId: nil)
    case .projects: ProjectsScreen()
    case .project(let id, nil): ProjectScreen(projectId: id)
    case .project(let id, let section?):
      switch section {
      case .overview: ProjectOverviewScreen(projectId: id)
      case .revenue: RevenueScreen(projectId: id)
      case .changelog: ChangelogScreen(projectId: id)
      case .onboarding: OnboardingScreen(projectId: id)
      case .legal: LegalScreen(projectId: id)
      case .brand: BrandScreen(projectId: id)
      case .settings: ProjectSettingsScreen(projectId: id)
      case .conversations: ProjectConversationsScreen(projectId: id)
      case .contacts: ContactsScreen(projectId: id)
      case .forms: LeadFormsScreen(projectId: id)
      case .knowledge: KnowledgeScreen(projectId: id)
      case .assistants: AssistantsScreen(projectId: id)
      case .tickets: TicketTypesScreen(projectId: id)
      case .feedback: FeedbackScreen(projectId: id)
      case .board: BoardScreen(projectId: id)
      case .email: EmailLibraryScreen(projectId: id, initialTab: .log)
      case .campaigns: CampaignsScreen(projectId: id)
      case .flags: FlagsScreen(projectId: id)
      case .errors: ErrorsScreen(projectId: id)
      case .dev: ProjectDevScreen(projectId: id)
      }
    case .apiKeys: APIKeysScreen()
    case .developer: DeveloperScreen()
    case .team: TeamScreen()
    case .account: SettingsScreen()
    case .profile: ProfileScreen()
    case .workspace: WorkspaceScreen()
    case .usage: UsageScreen()
    case .ai: AIScreen()
    case .connections: ConnectionsScreen()
    case .legalDocument(let projectId, let documentId): LegalDocumentScreen(projectId: projectId, documentId: documentId)
    case .onboardingFlow(let projectId, let flowId): OnboardingFlowScreen(projectId: projectId, flowId: flowId)
    case .leadForm(let projectId, let formId): LeadFormScreen(projectId: projectId, formId: formId)
    }
  }
}

extension View {
  /// Lets a tab's stack push routes: Projects › project › section, Settings › Team.
  /// `.id` gives each route fresh state, so one project's screen never shows another's.
  func routes() -> some View {
    navigationDestination(for: AppRoute.self) { RouteView(route: $0).id($0) }
  }
}

// MARK: - Menu bar

extension FocusedValues {
  /// The window's workspace, for the menu bar.
  @Entry var workspace: Workspace?
}

/// The Mac menu bar (and iPad's ⌘ menu), with the web panel's shortcuts.
struct AppCommands: Commands {
  @FocusedValue(\.workspace) private var workspace

  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      Group {
        Button("New Conversation") { workspace?.go(.inbox); workspace?.composeOpen = true }.keyboardShortcut("n")
        Button("New Project") { workspace?.newProjectOpen = true }.keyboardShortcut("n", modifiers: [.command, .shift])
      }
      .disabled(workspace == nil)
    }
    CommandGroup(replacing: .appSettings) {
      Button("Settings…") { workspace?.go(.account) }.keyboardShortcut(",").disabled(workspace == nil)
    }
    CommandMenu("Go") {
      Group {
        Button("Overview") { workspace?.go(.overview) }.keyboardShortcut("0")
        Button("Inbox") { workspace?.go(.inbox) }.keyboardShortcut("1")
        Button("Projects") { workspace?.go(.projects) }.keyboardShortcut("2")
        Button("Email Templates") { workspace?.go(.emailTemplates) }.keyboardShortcut("3")
        Divider()
        Button("Jump To…") { workspace?.paletteOpen = true }.keyboardShortcut("k")
      }
      .disabled(workspace == nil)
    }
  }
}

// MARK: - ⌘K

/// Jump to any page or project section, like the web panel's palette.
struct CommandPalette: View {
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @FocusState private var focused: Bool

  private struct Entry: Identifiable { let id: String; let title: String; let detail: String?; let systemImage: String; let route: AppRoute }

  private var entries: [Entry] {
    var all: [Entry] = [
      Entry(id: "overview", title: "Overview", detail: nil, systemImage: "house", route: .overview),
      Entry(id: "inbox", title: "Inbox", detail: nil, systemImage: "tray", route: .inbox),
      Entry(id: "emails", title: "Email templates", detail: nil, systemImage: "envelope", route: .emailTemplates),
      Entry(id: "email-log", title: "Email log", detail: nil, systemImage: "list.bullet.rectangle", route: .emailLog),
      Entry(id: "knowledge", title: "Knowledge", detail: nil, systemImage: "book", route: .knowledge),
      Entry(id: "projects", title: "Projects", detail: nil, systemImage: "square.stack", route: .projects),
      Entry(id: "keys", title: "API keys", detail: nil, systemImage: "key", route: .apiKeys),
      Entry(id: "team", title: "Team", detail: nil, systemImage: "person.2", route: .team),
      Entry(id: "developer", title: "Developer", detail: nil, systemImage: "chevron.left.forwardslash.chevron.right", route: .developer),
      Entry(id: "account", title: "Account", detail: nil, systemImage: "person.crop.circle", route: .account)
    ]
    for project in workspace.projects {
      for section in ProjectSection.allCases {
        all.append(Entry(id: "\(project.id)-\(section.rawValue)", title: section == .overview ? project.name : "\(project.name) › \(section.label)", detail: section == .overview ? project.siteUrl : nil, systemImage: section.systemImage, route: .project(project.id, section)))
      }
    }
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return needle.isEmpty ? all : all.filter { $0.title.lowercased().contains(needle) }
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        SearchField(text: $query, prompt: "Go to a page or project…").focused($focused).padding(12)
        Rectangle().fill(Theme.border).frame(height: 1)
        if query.trimmingCharacters(in: .whitespaces).count >= 2 { GlobalSearchResults(query: query) { dismiss() } }
        List(entries) { entry in
          Button {
            workspace.go(entry.route)
            dismiss()
          } label: {
            HStack(spacing: 10) {
              Image(systemName: entry.systemImage).font(.system(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 20)
              Text(entry.title).font(.lnRow).foregroundStyle(Theme.textHighlighted)
              if let detail = entry.detail, !detail.isEmpty { Text(detail).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1) }
              Spacer(minLength: 0)
            }
            .frame(height: 40)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .linearRow()
        }
        .linearList()
      }
      .panelScreen("Go to")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .onAppear { focused = true }
    }
    .presentationDetents([.medium, .large])
  }
}

// MARK: - New project

struct NewProjectSheet: View {
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var siteURL = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Name it after the app. You can set everything else afterwards.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
          LabeledField(label: "Site URL", hint: "Where the widget will live; used in email links") {
            TextField("https://app.example.com", text: $siteURL).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("New project")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
        }
      }
    }
    .presentationDetents([.medium])
  }

  private func create() async {
    struct Input: Encodable, Sendable { let name, siteUrl: String; let allowedOrigins: [String] }
    struct Output: Decodable, Sendable { let project: Project; let secret: String? }
    saving = true; error = ""
    defer { saving = false }
    do {
      let site = siteURL.trimmingCharacters(in: .whitespaces)
      let output: Output = try await workspace.session.send("/v1/admin/projects", body: Input(name: name, siteUrl: site, allowedOrigins: site.isEmpty ? [] : [site]))
      workspace.replace(output.project)
      if let secret = output.secret { workspace.newProjectSecrets[output.project.id] = secret }
      workspace.go(.project(output.project.id, .dev))
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
