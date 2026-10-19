import SwiftUI

/// The Settings tab: who's signed in, the web sidebar's settings pages, the
/// theme, the server this app talks to, and sign out.
struct SettingsScreen: View {
  @Environment(SessionStore.self) private var session
  @AppStorage("hb-theme") private var theme: ThemePreference = .system
  @State private var endpoint = ""
  @State private var confirmSignOut = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        HStack(spacing: 12) {
          Avatar(name: displayName, size: 40)
          VStack(alignment: .leading, spacing: 2) {
            Text(displayName).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
            Text(session.agent?.email.isEmpty == false ? session.agent!.email : "@\(session.agent?.username ?? "")").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
        }

        Card {
          link(.apiKeys, "API keys", "key")
          link(.team, "Team", "person.2")
          link(.developer, "Developer", "chevron.left.forwardslash.chevron.right", divider: false)
        }

        VStack(alignment: .leading, spacing: 8) {
          SectionLabel("Theme")
          Picker("Theme", selection: $theme) {
            ForEach(ThemePreference.allCases) { option in Text(option.label).tag(option) }
          }
          .pickerStyle(.segmented)
        }

        VStack(alignment: .leading, spacing: 8) {
          SectionLabel("Server")
          HStack(spacing: 8) {
            TextField("https://support.example.com", text: $endpoint).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Use") { Task { await session.setEndpoint(endpoint) } }
              .buttonStyle(.lnSecondaryCompact)
              .disabled(endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || endpoint == session.endpoint)
          }
          Text("Changing servers signs you out of this one.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }

        Button("Sign out", role: .destructive) { confirmSignOut = true }
          .buttonStyle(.lnSecondary)
          .confirmationDialog("Sign out of HelpBites?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
          }

        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
          Text("HelpBites \(version)").font(.lnCaption).foregroundStyle(Theme.textDimmed)
        }
      }
      .frame(maxWidth: 560, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .panelScreen("Settings")
    .onAppear { endpoint = session.endpoint }
  }

  private func link(_ route: AppRoute, _ title: String, _ systemImage: String, divider: Bool = true) -> some View {
    NavigationLink(value: route) {
      CardRow(divider: divider) {
        HStack(spacing: 10) {
          Image(systemName: systemImage).font(.system(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 20)
          Text(title).font(.lnRow).foregroundStyle(Theme.text)
          Spacer(minLength: 0)
          Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private var displayName: String {
    let name = session.agent?.name ?? ""
    return name.isEmpty ? session.agent?.username ?? "You" : name
  }
}
