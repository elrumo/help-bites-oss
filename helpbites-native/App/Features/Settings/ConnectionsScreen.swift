import SwiftUI

/// The outside accounts the workspace reads from (web: Settings → Connections):
/// GitHub, Stripe, Telegram and error-tracking servers. Everyone sees the state;
/// connecting and disconnecting is for owners and admins (`projects.manage`).
struct ConnectionsScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 36) {
        if !session.canManage {
          Text("Only admins and owners can connect or disconnect accounts.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        }
        GithubSection()
        StripeSection()
        TelegramSection()
        ErrorServersSection()
      }
      .settingsColumn(720)
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen("Connections")
    .task(id: session.workspace?.id) { if workspace.projects.isEmpty { await workspace.loadProjects() } }
  }
}

// MARK: - Shared pieces

/// Each project's connection state, fetched side by side. A role that may not see a
/// project's connection gets a 403 for it, which just leaves it out ("Not connected").
@MainActor func loadPerProject<Value: Decodable & Sendable>(_ path: String, projects: [Project], session: SessionStore) async -> [String: Value] {
  await withTaskGroup(of: (String, Value?).self) { group in
    for project in projects {
      group.addTask { (project.id, try? await session.get(path, query: ["project": project.id])) }
    }
    var result: [String: Value] = [:]
    for await (id, value) in group { if let value { result[id] = value } }
    return result
  }
}

/// A project line inside a connection section: tile, name, a status line, then the controls.
struct ProjectConnectionRow<Trailing: View, Form: View>: View {
  let project: Project
  let status: Text
  @ViewBuilder var trailing: () -> Trailing
  @ViewBuilder var form: () -> Form
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl, size: 22)
        VStack(alignment: .leading, spacing: 2) {
          Text(project.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          status.font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2)
        }
        Spacer(minLength: 8)
        trailing()
      }
      .frame(minHeight: 32)
      form()
    }
    .padding(.horizontal, 14).padding(.vertical, 8)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }
}

/// A password-style field and the Cancel / Connect buttons under a project row.
struct ConnectForm<Fields: View>: View {
  let actionLabel: String
  let saving: Bool
  let canSubmit: Bool
  let onSubmit: () -> Void
  let onCancel: () -> Void
  @ViewBuilder var fields: () -> Fields
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      fields()
      HStack(spacing: 8) {
        Spacer(minLength: 0)
        Button("Cancel", action: onCancel).buttonStyle(.lnGhost)
        Button(action: onSubmit) { if saving { ProgressView() } else { Text(actionLabel) } }.buttonStyle(.lnPrimaryCompact).disabled(!canSubmit || saving)
      }
    }
    .padding(.top, 10)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: Hairline.width) }
    .padding(.top, 8)
  }
}

private struct ProjectsEmpty: View {
  let systemImage: String
  let text: String
  var body: some View { DashedEmptyState(systemImage: systemImage, title: "No projects yet", message: text) }
}

// MARK: - Stripe

private struct StripeSection: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var states: [String: StripeState] = [:]
  @State private var ready = true
  @State private var loading = true
  @State private var adding = ""
  @State private var key = ""
  @State private var saving = false
  @State private var error = ""
  @State private var disconnecting: Project?

  var body: some View {
    SettingsSection("Stripe", systemImage: "dollarsign.circle") {
      VStack(alignment: .leading, spacing: 12) {
        Text("Connect a Stripe account to each project that sells something. HelpBites only reads: revenue shows up under the project's Revenue tab, and each person's payments appear on their contact.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if !ready { ErrorText(message: "Set HELPBITES_SECRET on the server first: Stripe keys are stored sealed with it.") }
        if loading && workspace.projects.isEmpty == false && states.isEmpty {
          SkeletonRows(count: 2).padding(-Metrics.gutter)
        } else if workspace.projects.isEmpty {
          ProjectsEmpty(systemImage: "dollarsign.circle", text: "Stripe connects to a project.")
        } else {
          ForEach(workspace.projects) { project in row(project) }
        }
        ErrorText(message: error)
      }
    }
    .task(id: workspace.projects.map(\.id)) {
      guard !workspace.projects.isEmpty else { loading = false; return }
      let loaded: [String: StripeState] = await loadPerProject("/v1/admin/stripe", projects: workspace.projects, session: session)
      states = loaded
      if let any = loaded.values.first { ready = any.ready }
      loading = false
    }
    .confirmationDialog("Disconnect Stripe from \(disconnecting?.name ?? "")? The key and the payments synced from Stripe are forgotten. Contacts keep their Stripe attributes.", isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }), titleVisibility: .visible, presenting: disconnecting) { project in
      Button("Disconnect", role: .destructive) { Task { await disconnect(project) } }
    }
  }

  private func row(_ project: Project) -> some View {
    let connection = states[project.id]?.connection
    var status = Text("Not connected")
    if let connection, connection.connected {
      var line = "\(connection.accountName.isEmpty ? "Stripe" : connection.accountName) · \(connection.livemode ? "Live" : "Test mode")"
      if !connection.lastError.isEmpty { line += " · last sync failed" }
      else if let run = connection.lastRunAt { line += " · synced \(Money.logTime(run))" }
      status = Text(line)
    }
    return ProjectConnectionRow(project: project, status: status) {
      if connection?.connected == true {
        Button("Revenue") { workspace.go(.project(project.id, .revenue)) }.buttonStyle(.lnGhost)
        if session.canManage { IconButton(systemImage: "bolt.slash", label: "Disconnect Stripe from \(project.name)") { disconnecting = project } }
      } else if session.canManage && adding != project.id {
        Button { adding = project.id; key = "" } label: { Label("Connect", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact).disabled(!ready)
      }
    } form: {
      if adding == project.id {
        ConnectForm(actionLabel: "Connect Stripe", saving: saving, canSubmit: !key.trimmingCharacters(in: .whitespaces).isEmpty, onSubmit: { Task { await connect(project) } }, onCancel: { adding = "" }) {
          LabeledField(label: "Restricted API key", hint: "Stripe → Developers → API keys → Create restricted key, with read access to Charges, Customers, Subscriptions and Products.") {
            SecureField("rk_live_…", text: $key).textFieldStyle(.linear).autocorrectionDisabled()
          }
        }
      }
    }
  }

  private func connect(_ project: Project) async {
    struct Input: Encodable, Sendable { let project, apiKey: String }
    struct Output: Decodable, Sendable { let connection: StripeConnection }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/stripe/connect", body: Input(project: project.id, apiKey: key.trimmingCharacters(in: .whitespaces)))
      states[project.id] = StripeState(connection: output.connection, ready: true)
      adding = ""; key = ""
    } catch { self.error = error.localizedDescription }
  }

  private func disconnect(_ project: Project) async {
    error = ""
    do {
      try await session.delete("/v1/admin/stripe?project=\(project.id)")
      if let state: StripeState = try? await session.get("/v1/admin/stripe", query: ["project": project.id]) { states[project.id] = state }
    } catch { self.error = error.localizedDescription }
  }
}

// MARK: - Telegram

private struct TelegramState: Decodable, Sendable {
  struct Connection: Decodable, Sendable { let connected: Bool; let botName, chatName: String }
  var connection: Connection
  var ready: Bool
}

private struct TelegramSection: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var states: [String: TelegramState] = [:]
  @State private var ready = true
  @State private var loading = true
  @State private var adding = ""
  @State private var token = ""
  @State private var chatId = ""
  @State private var saving = false
  @State private var error = ""
  @State private var disconnecting: Project?

  var body: some View {
    SettingsSection("Telegram", systemImage: "paperplane") {
      VStack(alignment: .leading, spacing: 12) {
        Text("Connect a Telegram bot to each project to get its error alerts as messages, alongside email. HelpBites only sends.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if !ready { ErrorText(message: "Set HELPBITES_SECRET on the server first: bot tokens are stored sealed with it.") }
        if loading && workspace.projects.isEmpty == false && states.isEmpty {
          SkeletonRows(count: 2).padding(-Metrics.gutter)
        } else if workspace.projects.isEmpty {
          ProjectsEmpty(systemImage: "paperplane", text: "Telegram connects to a project.")
        } else {
          ForEach(workspace.projects) { project in row(project) }
        }
        ErrorText(message: error)
      }
    }
    .task(id: workspace.projects.map(\.id)) {
      guard !workspace.projects.isEmpty else { loading = false; return }
      let loaded: [String: TelegramState] = await loadPerProject("/v1/admin/telegram", projects: workspace.projects, session: session)
      states = loaded
      if let any = loaded.values.first { ready = any.ready }
      loading = false
    }
    .confirmationDialog("Disconnect Telegram from \(disconnecting?.name ?? "")? The bot token is forgotten and alerts stop going to the chat.", isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }), titleVisibility: .visible, presenting: disconnecting) { project in
      Button("Disconnect", role: .destructive) { Task { await disconnect(project) } }
    }
  }

  private func row(_ project: Project) -> some View {
    let connection = states[project.id]?.connection
    let connected = connection?.connected == true
    return ProjectConnectionRow(project: project, status: Text(connected ? "@\(connection!.botName) → \(connection!.chatName)" : "Not connected")) {
      if connected {
        if session.canManage { IconButton(systemImage: "bolt.slash", label: "Disconnect Telegram from \(project.name)") { disconnecting = project } }
      } else if session.canManage && adding != project.id {
        Button { adding = project.id; token = ""; chatId = "" } label: { Label("Connect", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact).disabled(!ready)
      }
    } form: {
      if adding == project.id {
        ConnectForm(actionLabel: "Connect Telegram", saving: saving, canSubmit: !token.trimmingCharacters(in: .whitespaces).isEmpty, onSubmit: { Task { await connect(project) } }, onCancel: { adding = "" }) {
          LabeledField(label: "Bot token", hint: "In Telegram, message @BotFather, send /newbot, and paste the token it gives you.") {
            SecureField("123456:ABC…", text: $token).textFieldStyle(.linear).autocorrectionDisabled()
          }
          LabeledField(label: "Chat id (optional)", hint: "Otherwise HelpBites uses the chat that wrote to the bot last: send your bot a message (or add it to a group) first.") {
            TextField("-1001234567890", text: $chatId).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
        }
      }
    }
  }

  private func connect(_ project: Project) async {
    struct Input: Encodable, Sendable { let project, botToken, chatId: String }
    struct Output: Decodable, Sendable { let connection: TelegramState.Connection }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/telegram/connect", body: Input(project: project.id, botToken: token.trimmingCharacters(in: .whitespaces), chatId: chatId.trimmingCharacters(in: .whitespaces)))
      states[project.id] = TelegramState(connection: output.connection, ready: true)
      adding = ""; token = ""; chatId = ""
    } catch { self.error = error.localizedDescription }
  }

  private func disconnect(_ project: Project) async {
    error = ""
    do {
      try await session.delete("/v1/admin/telegram?project=\(project.id)")
      if let state: TelegramState = try? await session.get("/v1/admin/telegram", query: ["project": project.id]) { states[project.id] = state }
    } catch { self.error = error.localizedDescription }
  }
}
