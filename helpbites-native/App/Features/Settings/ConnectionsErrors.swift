import SwiftUI

/// A GlitchTip or Bugsink server every project in the workspace can report to
/// (`GET /v1/admin/errors/servers`). Tokens are never returned, only `hasToken`.
struct ErrorServer: Decodable, Identifiable, Equatable, Sendable {
  let id, provider, providerName, name, url: String
  let apiUrl, org: String?
  let hasToken, builtIn: Bool
}

struct ErrorProvider: Decodable, Identifiable, Equatable, Sendable {
  let id, name: String
  let required: [String]
  let manualAlerts: Bool?
}

private struct ErrorServersState: Decodable, Sendable {
  let servers: [ErrorServer]
  let providers: [ErrorProvider]
}

/// Error-tracking servers (web: `ErrorServers.vue` + `ErrorServerForm.vue`).
struct ErrorServersSection: View {
  @Environment(SessionStore.self) private var session
  @State private var servers: [ErrorServer] = []
  @State private var providers: [ErrorProvider] = []
  @State private var loading = true
  @State private var error = ""
  @State private var form: FormTarget?
  @State private var removing: ErrorServer?

  private struct FormTarget: Identifiable { let id: String; let server: ErrorServer? }

  var body: some View {
    SettingsSection(title: "Error tracking", systemImage: "ladybug", trailing: {
      if session.canManage {
        Button { form = FormTarget(id: "new", server: nil) } label: { Label("Add server", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact)
      }
    }) {
      VStack(alignment: .leading, spacing: 12) {
        Text("GlitchTip and Bugsink servers every project in this workspace can report to. A project picks one when you connect error tracking.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if loading {
          SkeletonRows(count: 2).padding(-Metrics.gutter)
        } else if servers.isEmpty {
          DashedEmptyState(systemImage: "ladybug", title: "No error tracking servers", message: "Add the URL and API token of your GlitchTip or Bugsink.")
        } else {
          ForEach(servers) { server in
            HStack(spacing: 12) {
              Image(systemName: "ladybug").font(.app(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 20)
              VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) { Text(server.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1); Tag(text: server.providerName) }
                Text(server.builtIn ? String(localized: "Set in this server's environment") : server.url).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
              }
              Spacer(minLength: 8)
              if !server.builtIn && session.canManage {
                IconButton(systemImage: "pencil", label: "Edit \(server.name)") { form = FormTarget(id: server.id, server: server) }
                IconButton(systemImage: "trash", label: "Remove \(server.name)") { removing = server }
              }
            }
            .padding(.horizontal, 14).padding(.vertical, 8).frame(minHeight: Metrics.scaled(48))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
          }
        }
        ErrorText(message: error)
      }
    }
    .task { await load() }
    .confirmationDialog("Remove \(removing?.name ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { server in
      Button("Remove", role: .destructive) { Task { await remove(server) } }
    }
    .sheet(item: $form) { target in
      ErrorServerSheet(providers: providers, server: target.server) { servers = $0 }
    }
  }

  private func load() async {
    do {
      let state: ErrorServersState = try await session.get("/v1/admin/errors/servers")
      servers = state.servers; providers = state.providers; error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func remove(_ server: ErrorServer) async {
    struct Output: Decodable, Sendable { let servers: [ErrorServer] }
    error = ""
    do { servers = (try await session.send("/v1/admin/errors/servers/\(server.id)", method: "DELETE") as Output).servers }
    catch { self.error = error.localizedDescription }
  }
}

private struct ErrorServerSheet: View {
  let providers: [ErrorProvider]
  let server: ErrorServer?
  var onSaved: ([ErrorServer]) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var provider = ""
  @State private var name = ""
  @State private var url = ""
  @State private var org = ""
  @State private var token = ""
  @State private var apiUrl = ""
  @State private var saving = false
  @State private var error = ""

  private var current: ErrorProvider? { providers.first { $0.id == provider } }
  private var tokenHelp: String {
    switch provider {
    case "glitchtip": String(localized: "From /profile/auth-tokens, with org:read, team:write, project:admin and event:write.")
    case "bugsink": String(localized: "From Tokens in Bugsink, or bugsink-manage create_auth_token.")
    default: ""
    }
  }
  private var valid: Bool {
    !url.trimmingCharacters(in: .whitespaces).isEmpty && (server?.hasToken == true || !token.isEmpty) && (current?.required.contains("org") != true || !org.trimmingCharacters(in: .whitespaces).isEmpty)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if server == nil {
            LabeledField(label: "Tracker") { MenuPicker(selection: $provider, options: providers.map { PickerOption(value: $0.id, label: $0.name) }, title: "Tracker") }
          }
          LabeledField(label: "Name", hint: "Optional") { TextField("Production errors", text: $name).textFieldStyle(.linear) }
          LabeledField(label: "URL", hint: "The address people open, also used in DSNs.") {
            TextField("https://\(provider).example.com", text: $url).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          if current?.required.contains("org") == true {
            LabeledField(label: "Organisation slug") { TextField("", text: $org).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled() }
          }
          LabeledField(label: "API token", hint: tokenHelp) {
            SecureField(server?.hasToken == true ? String(localized: "Saved; leave blank to keep") : "", text: $token).textFieldStyle(.linear).autocorrectionDisabled()
          }
          LabeledField(label: "API URL", hint: "Optional. Only when HelpBites reaches the tracker at another address, such as http://sb-\(provider):8000 in Compose.") {
            TextField("", text: $apiUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(server == nil ? String(localized: "Add server") : String(localized: "Edit server"))
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else { Button(server == nil ? String(localized: "Add server") : String(localized: "Save")) { Task { await save() } }.disabled(!valid) }
        }
      }
    }
    .presentationDetents([.large])
    .onAppear {
      provider = server?.provider ?? providers.first?.id ?? "glitchtip"
      name = server?.name ?? ""; url = server?.url ?? ""; org = server?.org ?? ""; apiUrl = server?.apiUrl ?? ""
    }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let provider, name, url, org, token, apiUrl: String }
    struct Output: Decodable, Sendable { let servers: [ErrorServer] }
    saving = true; error = ""
    defer { saving = false }
    let body = Input(provider: provider, name: name.trimmingCharacters(in: .whitespaces), url: url.trimmingCharacters(in: .whitespaces), org: org.trimmingCharacters(in: .whitespaces), token: token.trimmingCharacters(in: .whitespaces), apiUrl: apiUrl.trimmingCharacters(in: .whitespaces))
    do {
      let output: Output = try await session.send(server.map { "/v1/admin/errors/servers/\($0.id)" } ?? "/v1/admin/errors/servers", method: server == nil ? "POST" : "PUT", body: body)
      onSaved(output.servers)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
