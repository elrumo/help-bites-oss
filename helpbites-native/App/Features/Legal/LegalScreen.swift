import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct LegalScreen: View {
  let projectId: String
  var body: some View {
    ScrollView { EmptyState(systemImage: "scale.3d", title: "Legal", message: "Coming soon.") }
      .projectScreen(projectId, "Legal")
  }
}
