import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct AIScreen: View {
  var body: some View {
    ScrollView { EmptyState(systemImage: "sparkles", title: "AI", message: "Coming soon.") }
      .panelScreen("AI")
  }
}
