import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct ConnectionsScreen: View {
  var body: some View {
    ScrollView { EmptyState(systemImage: "powerplug", title: "Connections", message: "Coming soon.") }
      .panelScreen("Connections")
  }
}
