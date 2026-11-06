import SwiftUI

/// Every connected app as a Linear table: tile and name, site, public key (web: projects/index.vue).
struct ProjectsScreen: View {
  @Environment(Workspace.self) private var workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var loading = true

  var body: some View {
    Group {
      if loading && workspace.projects.isEmpty {
        SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
      } else if workspace.projects.isEmpty {
        EmptyState(systemImage: "square.stack", title: "No projects yet", message: "Each app you connect is a project, with its own keys, look and notification addresses.") {
          Button { workspace.newProjectOpen = true } label: { Label("New project", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
        }
        .frame(maxHeight: .infinity)
      } else {
        List {
          if wide {
            columns(Text("Name"), Text("Site"), Text("Public key"))
              .font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
              .frame(height: Metrics.scaled(32))
              .linearRow()
          }
          ForEach(workspace.projects) { project in
            NavigationLink(value: AppRoute.project(project.id, nil)) { row(project) }
              .linearRow()
          }
        }
        .linearList()
        .refreshable { await workspace.loadProjects() }
      }
    }
    .panelScreen("Projects")
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button { workspace.paletteOpen = true } label: { Label("Jump to", systemImage: "magnifyingglass") }
        Button { workspace.newProjectOpen = true } label: { Label("New project", systemImage: "plus") }
      }
    }
    .task {
      await workspace.loadProjects()
      loading = false
    }
  }

  private var wide: Bool { sizeClass == .regular }

  @ViewBuilder private func row(_ project: Project) -> some View {
    let name = HStack(spacing: 10) {
      ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl, size: 20)
      Text(project.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
    }
    let site = Text(host(project.siteUrl) ?? String(localized: "No site URL")).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
    let key = Text(project.publicKey).font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1).truncationMode(.middle)
    Group {
      if wide {
        columns(name, site, key)
      } else {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 2) { name; site.padding(.leading, 30) }
          Spacer(minLength: 8)
          key.frame(maxWidth: 130, alignment: .trailing)
        }
        .padding(.vertical, 6)
      }
    }
    .frame(minHeight: Metrics.rowHeight)
    .contentShape(Rectangle())
  }

  /// The web table's grid: name, site, then a fixed 14rem key column.
  private func columns(_ name: some View, _ site: some View, _ key: some View) -> some View {
    HStack(spacing: 16) {
      name.frame(maxWidth: .infinity, alignment: .leading)
      site.frame(maxWidth: .infinity, alignment: .leading)
      key.frame(width: 224, alignment: .leading)
    }
  }

  private func host(_ url: String) -> String? {
    guard !url.isEmpty else { return nil }
    guard let parts = URLComponents(string: url), let host = parts.host else { return url }
    return parts.port.map { "\(host):\($0)" } ?? host
  }
}
