import SwiftUI

/// A project page's bar: the web panel's breadcrumb (project tile, name, then
/// the page) in the navigation bar. The project crumb goes back to its
/// overview, like PageHeader.vue.
struct ProjectBreadcrumb: View {
  let projectId: String
  let title: LocalizedStringKey
  init(projectId: String, title: LocalizedStringKey) { self.projectId = projectId; self.title = title }
  @_disfavoredOverload init(projectId: String, title: String) { self.init(projectId: projectId, title: LocalizedStringKey(title)) }
  @Environment(Workspace.self) private var workspace

  var body: some View {
    HStack(spacing: 6) {
      if let project = workspace.project(projectId) {
        Button { workspace.go(.project(projectId, .overview)) } label: {
          HStack(spacing: 6) {
            ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl)
            Text(project.name).foregroundStyle(Theme.textMuted).lineLimit(1)
          }
        }
        .buttonStyle(.plain)
        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      Text(title).foregroundStyle(Theme.textHighlighted).lineLimit(1).layoutPriority(1)
    }
    .font(.lnMetaMedium)
  }
}

extension View {
  /// `panelScreen` plus the project breadcrumb, for each section of a project.
  func projectScreen(_ projectId: String, _ title: LocalizedStringKey) -> some View {
    panelScreen(title).toolbar {
      ToolbarItem(placement: .principal) { ProjectBreadcrumb(projectId: projectId, title: title) }
    }
  }

  @_disfavoredOverload func projectScreen(_ projectId: String, _ title: String) -> some View {
    projectScreen(projectId, LocalizedStringKey(title))
  }
}
