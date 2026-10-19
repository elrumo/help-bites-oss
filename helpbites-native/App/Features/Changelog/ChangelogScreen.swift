import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct ChangelogScreen: View {
  let projectId: String
  var body: some View {
    ScrollView { EmptyState(systemImage: "scroll", title: "Changelog", message: "Coming soon.") }
      .projectScreen(projectId, "Changelog")
  }
}
