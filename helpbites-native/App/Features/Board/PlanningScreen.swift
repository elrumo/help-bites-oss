import SwiftUI

/// The Planning shortcut: every project with a planning board, each opening its board. A project that has
/// not turned planning on, or hid its Planning section, is not listed.
struct PlanningScreen: View {
  @Environment(Workspace.self) private var workspace
  @State private var loading = true

  var body: some View {
    Group {
      if loading && workspace.projects.isEmpty {
        SkeletonRows(count: 3).frame(maxHeight: .infinity, alignment: .top)
      } else if workspace.planningProjects.isEmpty {
        EmptyState(systemImage: "rectangle.split.3x1", title: "No planning boards yet", message: "Turn on Planning in a project's Planning section and it shows up here.")
          .frame(maxHeight: .infinity)
      } else {
        List {
          ForEach(workspace.planningProjects) { project in
            NavigationLink(value: AppRoute.project(project.id, .board)) {
              HStack(spacing: 10) {
                ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl, size: 20)
                Text(project.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                Spacer(minLength: 0)
              }
              .frame(minHeight: Metrics.rowHeight)
              .contentShape(Rectangle())
            }
            .linearRow()
          }
        }
        .linearList()
        .refreshable { await workspace.loadProjects() }
      }
    }
    .panelScreen("Planning")
    .task {
      await workspace.loadProjects()
      loading = false
    }
  }
}
