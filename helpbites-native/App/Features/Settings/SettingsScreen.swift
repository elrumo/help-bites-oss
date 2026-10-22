import SwiftUI

/// The Settings tab: who's signed in, the web sidebar's settings pages, the
/// theme, the server this app talks to, and sign out.
struct SettingsScreen: View {
  @Environment(SessionStore.self) private var session
  @AppStorage("hb-theme") private var theme: ThemePreference = .system
  @State private var endpoint = ""
  @State private var confirmSignOut = false
  @State private var newWorkspaceOpen = false
  @State private var joinOpen = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        NavigationLink(value: AppRoute.profile) {
          HStack(spacing: 12) {
            Avatar(name: displayName, size: 40)
            VStack(alignment: .leading, spacing: 2) {
              Text(displayName).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
              Text(session.agent?.email.isEmpty == false ? session.agent!.email : "@\(session.agent?.username ?? "")").font(.lnMeta).foregroundStyle(Theme.textMuted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)

        VStack(alignment: .leading, spacing: 8) {
          SectionLabel("Workspace")
          Menu {
            ForEach(session.workspaces) { workspace in
              Button { Task { await session.switchWorkspace(workspace.id) } } label: {
                if workspace.id == session.workspace?.id { Label(workspace.name, systemImage: "checkmark") } else { Text(workspace.name) }
              }
            }
            Divider()
            Button { newWorkspaceOpen = true } label: { Label("New workspace…", systemImage: "plus") }
            Button { joinOpen = true } label: { Label("Join with an invitation…", systemImage: "envelope.open") }
          } label: {
            HStack(spacing: 10) {
              Image(systemName: "building.2").font(.system(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 20)
              Text(session.workspace?.name ?? String(localized: "Workspace")).font(.lnRow).foregroundStyle(Theme.text)
              Spacer(minLength: 0)
              Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: Metrics.rowHeight)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
          }
          .buttonStyle(.plain)
        }

        Card {
          link(.workspace, "Workspace settings", "building.2")
          if session.plan?.unlimited == false { link(.usage, "Plan & usage", "gauge") }
          link(.team, "Team", "person.2")
          link(.ai, "AI", "sparkles")
          link(.connections, "Connections", "powerplug")
          if session.canManage { link(.apiKeys, "API keys", "key") }
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
    .sheet(isPresented: $newWorkspaceOpen) { NewWorkspaceSheet() }
    .sheet(isPresented: $joinOpen) { AcceptInvitationSheet() }
  }

  private func link(_ route: AppRoute, _ title: LocalizedStringKey, _ systemImage: String, divider: Bool = true) -> some View {
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
    return name.isEmpty ? session.agent?.username ?? String(localized: "You") : name
  }
}
