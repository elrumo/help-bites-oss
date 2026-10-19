import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct ProjectSettingsScreen: View {
  let projectId: String
  var body: some View {
    ScrollView { EmptyState(systemImage: "gearshape", title: "Settings", message: "Coming soon.") }
      .projectScreen(projectId, "Settings")
  }
}
