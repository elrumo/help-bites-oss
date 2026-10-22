import SwiftUI

/// Pick one of the workspace's GlitchTip / Bugsink servers and connect the
/// project to it; connecting again adds another tracker project
/// (web: ConnectErrorTrackingModal.vue).
struct ConnectErrorTrackingSheet: View {
  let projectId: String
  var projectName = ""
  /// Tracker projects it already reports to.
  var existing: [ProjectsAdminProject.ErrorLink] = []
  var onConnected: (ProjectsAdminProject) -> Void = { _ in }
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var servers: [TrackerServer] = []
  @State private var providers: [TrackerProvider] = []
  @State private var selected = ""
  @State private var name = ""
  @State private var teams: [String] = []
  @State private var team = ""
  @State private var adding = false
  @State private var loading = true
  @State private var connecting = false
  @State private var error = ""
  /// Set once a Bugsink project is connected: its alert webhook still has to be added by hand.
  @State private var connected: ProjectsAdminProject.ErrorLink?
  @State private var form = ErrorServerForm()

  private static var blurbs: [String: String] {
    [
      "glitchtip": String(localized: "Creates the project, DSN and an inbox alert automatically."),
      "bugsink": String(localized: "Creates the project and DSN; you paste one alert webhook into Bugsink.")
    ]
  }

  private var current: TrackerServer? { servers.first { $0.id == selected } }
  private var showForm: Bool { adding || (servers.isEmpty && !loading) }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let connected { webhookStep(connected) } else { picker }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Connect error tracking")
      .toolbar {
        if connected != nil {
          ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        } else {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button { Task { await connect() } } label: {
              if connecting { ProgressView() } else { Text(current.map { String(localized: "Connect \($0.provider == "bugsink" ? "Bugsink" : $0.providerName)") } ?? String(localized: "Connect")) }
            }
            .disabled(current == nil || adding || connecting || (!existing.isEmpty && name.trimmingCharacters(in: .whitespaces).isEmpty))
          }
        }
      }
    }
    #if os(macOS)
    .frame(minWidth: 480, minHeight: 520)
    #else
    .presentationDetents([.medium, .large])
    #endif
    .task { await loadServers() }
    .task(id: selected) { await loadTeams() }
  }

  // MARK: Steps

  @ViewBuilder private var picker: some View {
    Text(existing.isEmpty
      ? "Pick the GlitchTip or Bugsink server this project reports to. HelpBites creates the project there and turns new errors into inbox conversations."
      : "Add another GlitchTip or Bugsink project this project reports to. Its errors join the others, each tagged with its name.")
      .font(.lnMeta).foregroundStyle(Theme.textMuted)
    if loading {
      Text("Loading error tracking servers…").font(.lnMeta).foregroundStyle(Theme.textMuted)
    } else {
      if !servers.isEmpty {
        VStack(spacing: 8) { ForEach(servers) { option($0) } }
      }
      if let current, !adding {
        LabeledField(label: "Project name in \(current.providerName)", hint: existing.isEmpty ? "Created if it does not exist yet, or reused if it does." : "Already connected: \(existing.map(\.label).joined(separator: ", ")). A new name creates another project; an existing one in the team is reused.") {
          TextField(projectName, text: $name).textFieldStyle(.linear).autocorrectionDisabled()
        }
        if current.provider == "bugsink" && !teams.isEmpty {
          LabeledField(label: "Team", hint: "Pick a team you belong to so the project shows under Team Projects in Bugsink.") {
            Picker("Team", selection: $team) { ForEach(teams, id: \.self) { Text($0).tag($0) } }.labelsHidden().tint(Theme.text)
          }
        }
      }
      if showForm {
        serverForm
      } else {
        Button { adding = true } label: { Label("Add another server", systemImage: "plus") }.buttonStyle(.lnGhost)
      }
    }
  }

  private func webhookStep(_ link: ProjectsAdminProject.ErrorLink) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Connected to \(link.providerName). One step left: Bugsink can't add alert destinations through its API, so add this webhook by hand.").font(.lnCallout).foregroundStyle(Theme.text)
      VStack(alignment: .leading, spacing: 4) {
        Text("1. In Bugsink, open Projects, find \(link.label) (under Team Projects, or Other Projects if you aren't in its team) and click its alerts (megaphone) icon.")
        Text("2. Click Add, set Kind to Slack (HelpBites reads Slack-format alerts) and paste this as the Webhook url. Leave Discord and Mattermost alone.")
      }
      .font(.lnMeta).foregroundStyle(Theme.textMuted)
      CodeBlock(code: link.alertWebhookUrl)
    }
  }

  private func option(_ server: TrackerServer) -> some View {
    let isSelected = selected == server.id
    return Button { selected = server.id; adding = false } label: {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: isSelected ? "largecircle.fill.circle" : "circle").foregroundStyle(isSelected ? Theme.accent : Theme.textDimmed)
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 8) {
            Text(server.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Tag(text: server.providerName)
          }
          if let blurb = Self.blurbs[server.provider] { Text(blurb).font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
        Spacer(minLength: 0)
      }
      .padding(12)
      .background(isSelected ? Theme.accent.opacity(0.06) : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(isSelected ? Theme.accent : Theme.border))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }

  // MARK: Add a server (web: settings/ErrorServerForm.vue)

  private var serverForm: some View {
    VStack(alignment: .leading, spacing: 14) {
      LabeledField(label: "Tracker") {
        Picker("Tracker", selection: $form.provider) { ForEach(providers) { Text($0.name).tag($0.id) } }.labelsHidden().tint(Theme.text)
      }
      LabeledField(label: "Name", hint: "Optional") { TextField("Production errors", text: $form.name).textFieldStyle(.linear) }
      LabeledField(label: "URL", hint: "The address people open, also used in DSNs.") {
        TextField("https://\(form.provider).example.com", text: $form.url).textFieldStyle(.linear)
          .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      if providers.first(where: { $0.id == form.provider })?.required.contains("org") == true {
        LabeledField(label: "Organisation slug") { TextField("", text: $form.org).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled() }
      }
      LabeledField(label: "API token", hint: ErrorServerForm.tokenHelp[form.provider]) {
        SecureField("", text: $form.token).textFieldStyle(.linear)
      }
      LabeledField(label: "API URL", hint: "Optional. Only when HelpBites reaches the tracker at another address, such as http://sb-\(form.provider):8000 in Compose.") {
        TextField("", text: $form.apiUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      HStack(spacing: 8) {
        Spacer(minLength: 0)
        if !servers.isEmpty { Button("Cancel") { adding = false }.buttonStyle(.lnGhost) }
        Button { Task { await addServer() } } label: {
          if form.busy { ProgressView().tint(.white) } else { Text("Add server") }
        }
        .buttonStyle(.lnPrimaryCompact).disabled(form.busy || form.url.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  // MARK: Requests

  private func loadServers() async {
    loading = true
    name = existing.isEmpty ? projectName : ""
    defer { loading = false }
    do {
      let response: TrackerServersResponse = try await session.get("/v1/admin/errors/servers")
      servers = response.servers
      providers = response.providers
      selected = servers.first?.id ?? ""
      form.provider = providers.first?.id ?? "glitchtip"
    } catch { self.error = error.localizedDescription }
  }

  /// Bugsink only: the teams a new project can go under. A failure just means the default team is used.
  private func loadTeams() async {
    teams = []; team = ""
    guard let server = current, server.provider == "bugsink" else { return }
    struct Response: Decodable, Sendable { let `default`: String; let teams: [String] }
    let encoded = server.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? server.id
    guard let response: Response = try? await session.get("/v1/admin/errors/servers/\(encoded)/teams"), selected == server.id else { return }
    teams = response.teams
    team = response.default
  }

  private func addServer() async {
    struct Input: Encodable, Sendable { let provider, name, url, org, token, apiUrl: String }
    struct Output: Decodable, Sendable { let id: String; let servers: [TrackerServer] }
    form.busy = true; error = ""
    defer { form.busy = false }
    do {
      let output: Output = try await session.send("/v1/admin/errors/servers", body: Input(provider: form.provider, name: form.name, url: form.url.trimmingCharacters(in: .whitespaces), org: form.org, token: form.token, apiUrl: form.apiUrl.trimmingCharacters(in: .whitespaces)))
      servers = output.servers
      selected = output.id
      adding = false
      form = ErrorServerForm(provider: form.provider)
    } catch { self.error = error.localizedDescription }
  }

  private func connect() async {
    struct Input: Encodable, Sendable { let project, server, team, name: String }
    struct Reply: Decodable, Sendable {
      let saved: ProjectsAdminProject.Saved; let link: ProjectsAdminProject.ErrorLink
      enum CodingKeys: CodingKey { case link }
      init(from decoder: Decoder) throws {
        saved = try ProjectsAdminProject.Saved(from: decoder)
        link = try decoder.container(keyedBy: CodingKeys.self).decode(ProjectsAdminProject.ErrorLink.self, forKey: .link)
      }
    }
    connecting = true; error = ""
    defer { connecting = false }
    do {
      let reply: Reply = try await session.send("/v1/admin/errors/connect", body: Input(project: projectId, server: selected, team: team, name: name.trimmingCharacters(in: .whitespaces)))
      workspace.replace(reply.saved.shared)
      onConnected(reply.saved.full)
      if reply.link.alertWebhookUrl.isEmpty { dismiss() } else { connected = reply.link }
    } catch { self.error = error.localizedDescription }
  }
}

/// The add-server fields. A struct so it resets in one assignment.
private struct ErrorServerForm {
  var provider = "glitchtip", name = "", url = "", org = "", token = "", apiUrl = ""
  var busy = false

  static var tokenHelp: [String: String] {
    [
      "glitchtip": String(localized: "From /profile/auth-tokens, with org:read, team:write, project:admin and event:write."),
      "bugsink": String(localized: "From Tokens in Bugsink, or bugsink-manage create_auth_token.")
    ]
  }
}
