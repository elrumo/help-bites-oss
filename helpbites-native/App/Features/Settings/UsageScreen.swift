import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct UsageScreen: View {
  var body: some View {
    ScrollView { EmptyState(systemImage: "gauge", title: "Plan & usage", message: "Coming soon.") }
      .panelScreen("Plan & usage")
  }
}
