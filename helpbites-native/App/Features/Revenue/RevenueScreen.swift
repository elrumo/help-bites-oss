import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct RevenueScreen: View {
  let projectId: String
  var body: some View {
    ScrollView { EmptyState(systemImage: "dollarsign.circle", title: "Revenue", message: "Coming soon.") }
      .projectScreen(projectId, "Revenue")
  }
}
