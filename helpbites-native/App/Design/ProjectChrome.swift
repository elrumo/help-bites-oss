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
        Image(systemName: "chevron.right").font(.app(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      Text(title).foregroundStyle(Theme.textHighlighted).lineLimit(1).layoutPriority(1)
    }
    .font(.lnMetaMedium)
  }
}

private struct ProjectHeader: ViewModifier {
  let projectId: String
  let title: LocalizedStringKey
  let detail: String?
  let warning: Bool
  @Environment(Workspace.self) private var workspace

  func body(content: Content) -> some View {
    #if os(macOS)
    let name = workspace.project(projectId)?.name ?? ""
    content.navigationSubtitle([name, detail ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
    #else
    content.toolbar {
      ToolbarItem(placement: .principal) {
        VStack(spacing: 1) {
          ProjectBreadcrumb(projectId: projectId, title: title)
          if let detail { Text(detail).font(.lnCaption).monospacedDigit().foregroundStyle(warning ? Theme.warning : Theme.textMuted) }
        }
      }
    }
    #endif
  }
}

extension View {
  /// `panelScreen` plus the project breadcrumb, for each section of a project.
  /// On the Mac the window's own title and subtitle say it instead (MacShell names the project).
  func projectScreen(_ projectId: String, _ title: LocalizedStringKey) -> some View {
    panelScreen(title).toolbar {
      #if os(iOS)
      ToolbarItem(placement: .principal) { ProjectBreadcrumb(projectId: projectId, title: title) }
      #endif
    }
  }

  /// A project page's bar with a count line under the breadcrumb ("243 items, 41 on the roadmap"). On the Mac,
  /// the window's title and subtitle carry them, the system's own place for both.
  func projectHeader(_ projectId: String, _ title: LocalizedStringKey, detail: String?, warning: Bool = false) -> some View {
    modifier(ProjectHeader(projectId: projectId, title: title, detail: detail, warning: warning))
  }

  @_disfavoredOverload func projectScreen(_ projectId: String, _ title: String) -> some View {
    projectScreen(projectId, LocalizedStringKey(title))
  }
}
