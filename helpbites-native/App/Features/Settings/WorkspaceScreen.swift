import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct WorkspaceScreen: View {
  var body: some View {
    ScrollView { EmptyState(systemImage: "building.2", title: "Workspace", message: "Coming soon.") }
      .panelScreen("Workspace")
  }
}
