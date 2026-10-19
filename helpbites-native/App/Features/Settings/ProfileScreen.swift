import SwiftUI

/// Placeholder until the screen is built from its web counterpart.
struct ProfileScreen: View {
  var body: some View {
    ScrollView { EmptyState(systemImage: "person.crop.circle", title: "Profile", message: "Coming soon.") }
      .panelScreen("Profile")
  }
}
