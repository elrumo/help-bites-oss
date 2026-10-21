#if os(macOS)
import SwiftUI

/// The Mac window: a sidebar on the canvas (Inbox, Email, each project's sections, the
/// workspace pages) beside the page it selects, like the web panel's layout. Pages push
/// onto the detail's own stack; picking another sidebar row starts a fresh one.
struct MacShell: View {
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @AppStorage("hb-sidebar-projects") private var openProjects = ""

  var body: some View {
    @Bindable var workspace = workspace
    NavigationSplitView {
      MacSidebar(openProjects: openedSet)
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
    } detail: {
      NavigationStack(path: $workspace.macPath) {
        RouteView(route: workspace.macSelection).id(workspace.macSelection).routes()
      }
    }
    .navigationSplitViewStyle(.balanced)
    .frame(minWidth: 900, minHeight: 600)
  }

  private var openedSet: Binding<Set<String>> {
    Binding(
      get: { Set(openProjects.split(separator: ",").map(String.init)) },
      set: { openProjects = $0.sorted().joined(separator: ",") }
    )
  }
}

private struct MacSidebar: View {
  @Binding var openProjects: Set<String>
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session

  var body: some View {
    @Bindable var workspace = workspace
    List(selection: Binding(get: { Optional(workspace.macSelection) }, set: { if let route = $0 { workspace.go(route) } })) {
      Label("Overview", systemImage: "house").tag(AppRoute.overview)
        .badge(workspace.attention.total)
      Label("Inbox", systemImage: "tray").tag(AppRoute.inbox)
        .badge(workspace.inbox.totalUnread)
      Label("Email", systemImage: "envelope").tag(AppRoute.emailTemplates)

      Section {
        ForEach(workspace.projects) { project in
          DisclosureGroup(isExpanded: expansion(project.id)) {
            sectionRows(project.id)
          } label: {
            HStack(spacing: 8) {
              ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl)
              Text(project.name).lineLimit(1)
            }
            .tag(AppRoute.project(project.id, nil))
          }
        }
        if workspace.projects.isEmpty {
          Button { workspace.newProjectOpen = true } label: { Label("Add a project", systemImage: "plus") }.buttonStyle(.plain).foregroundStyle(Theme.textMuted)
        }
      } header: {
        HStack {
          Text("Projects")
          Spacer()
          Button { workspace.newProjectOpen = true } label: { Image(systemName: "plus") }.buttonStyle(.plain).help("New project")
        }
      }

      Section("Workspace") {
        Label("Knowledge", systemImage: "book").tag(AppRoute.knowledge)
        Label("Developer", systemImage: "chevron.left.forwardslash.chevron.right").tag(AppRoute.developer)
        Label("Settings", systemImage: "gearshape").tag(AppRoute.account)
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .top, spacing: 0) { header }
    .tint(Theme.accent)
  }

  /// The workspace switcher, search and compose, as along the top of the web sidebar.
  private var header: some View {
    HStack(spacing: 6) {
      Menu {
        ForEach(session.workspaces) { item in
          Button { Task { await session.switchWorkspace(item.id) } } label: {
            if item.id == session.workspace?.id { Label(item.name, systemImage: "checkmark") } else { Text(item.name) }
          }
        }
        Divider()
        Button("Settings…") { workspace.go(.account) }
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "message.badge.filled.fill").font(.system(size: 11)).foregroundStyle(.white).frame(width: 20, height: 20).background(Theme.accent, in: RoundedRectangle(cornerRadius: 5))
          Text(session.workspace?.name ?? "HelpBites").font(.system(size: 13, weight: .semibold)).lineLimit(1)
          Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.textMuted)
        }
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
      Spacer(minLength: 0)
      Button { workspace.paletteOpen = true } label: { Image(systemName: "magnifyingglass") }.help("Jump to… (⌘K)")
      Button { workspace.go(.inbox); workspace.composeOpen = true } label: { Image(systemName: "square.and.pencil") }.help("New conversation (⌘N)")
    }
    .buttonStyle(.borderless)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }

  /// A project's sections as the web sidebar lays them out: Overview, each group under its small heading
  /// (an empty group is left out), then Settings. Sections the project hid are left out, except the one on screen.
  @ViewBuilder private func sectionRows(_ projectId: String) -> some View {
    let layout = workspace.layout(projectId, keeping: currentSection(projectId))
    sectionRow(projectId, .overview)
    ForEach(layout.groups) { entry in
      Text(entry.group.label)
        .font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
        .padding(.top, 6)
        .accessibilityAddTraits(.isHeader)
      ForEach(entry.sections) { section in sectionRow(projectId, section) }
    }
    sectionRow(projectId, .settings)
  }

  private func sectionRow(_ projectId: String, _ section: ProjectSection) -> some View {
    Label(section.label, systemImage: section.systemImage).tag(AppRoute.project(projectId, section))
  }

  /// The section of this project the window shows.
  private func currentSection(_ id: String) -> ProjectSection? {
    if case .project(let current, let section) = workspace.macSelection, current == id { return section }
    return nil
  }

  private func expansion(_ id: String) -> Binding<Bool> {
    Binding(
      get: { openProjects.contains(id) || isCurrent(id) },
      set: { if $0 { openProjects.insert(id) } else { openProjects.remove(id) } }
    )
  }

  private func isCurrent(_ id: String) -> Bool {
    if case .project(let current, _) = workspace.macSelection { return current == id }
    return false
  }
}
#endif
