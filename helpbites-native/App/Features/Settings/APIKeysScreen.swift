import SwiftUI

/// Admin API keys (pages/api-keys.vue): one per script or service, shown once
/// on creation, renamed or revoked one at a time.
struct APIKeysScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var scope = Scope.all
  @State private var picked: Set<String> = []
  @State private var expiry = 90
  @State private var keys: [APIKey] = []
  @State private var loading = true
  @State private var newName = ""
  @State private var creating = false
  @State private var error = ""
  @State private var created: CreatedKey?
  @State private var copied = false
  @State private var copiedAddress = false
  @State private var editingId = ""
  @State private var editingName = ""
  @State private var revoking: APIKey?

  private var mcpAddress: String { session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/mcp" }

  private enum Scope { case all, projects }
  private struct APIKey: Decodable, Identifiable, Sendable {
    let id, name, prefix: String
    let createdAt, expiresAt, lastUsedAt: String?
    /// nil: every project and the workspace itself.
    let projectIds: [String]?
  }
  /// `expiresInDays: null` is a key that never expires, so nil has to be written, not left out.
  private struct NewKey: Encodable, Sendable {
    let name: String
    let projectIds: [String]?
    let expiresInDays: Int?
    private enum Keys: String, CodingKey { case name, projectIds, expiresInDays }
    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: Keys.self)
      try container.encode(name, forKey: .name)
      try container.encodeIfPresent(projectIds, forKey: .projectIds)
      if let expiresInDays { try container.encode(expiresInDays, forKey: .expiresInDays) } else { try container.encodeNil(forKey: .expiresInDays) }
    }
  }
  private struct CreatedKey: Identifiable { let id = UUID(); let key: String }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Admin API keys").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text((try? AttributedString(markdown: "A key acts as you, in this workspace only: it can do what you can here, through `/v1/admin`. Keep keys on your servers.")) ?? "")
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)
        }

        // The same address the panel shows (components/settings/ApiKeys.vue): paste it into an assistant's connectors.
        VStack(alignment: .leading, spacing: 10) {
          Label("Connect an AI assistant", systemImage: "bolt.horizontal").font(.lnRow).foregroundStyle(Theme.textHighlighted)
          Text("Let Claude, ChatGPT or Cursor work in this workspace as you. Add this address to the assistant's connectors and sign in, or give it one of the keys below.")
            .font(.lnCaption)
            .foregroundStyle(Theme.textMuted)
          HStack(spacing: 8) {
            Text(mcpAddress)
              .font(.lnMono)
              .foregroundStyle(Theme.textHighlighted)
              .textSelection(.enabled)
              .lineLimit(1)
              .truncationMode(.middle)
              .padding(10)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
              .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
              .accessibilityLabel("MCP server address")
            Button {
              Clipboard.copy(mcpAddress)
              copiedAddress = true
            } label: { Label(copiedAddress ? "Copied" : "Copy", systemImage: copiedAddress ? "checkmark" : "doc.on.clipboard") }
              .buttonStyle(.lnGhost)
          }
        }
        .padding(16)
        .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))

        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            TextField("Name it after where it runs, like “Production automation”", text: $newName)
              .textFieldStyle(.linear)
              .submitLabel(.done)
              .onSubmit { Task { await create() } }
              .onChange(of: newName) { _, value in if value.count > 80 { newName = String(value.prefix(80)) } }
              .accessibilityLabel("New key name")
            Button { Task { await create() } } label: {
              if creating { ProgressView() } else { Label("Create key", systemImage: "plus") }
            }
            .buttonStyle(.lnPrimaryCompact)
            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || creating || (scope == .projects && picked.isEmpty))
          }
          LabeledField(label: "Access") {
            MenuPicker(selection: $scope, options: [PickerOption(value: .all, label: "All projects and the main account"), PickerOption(value: .projects, label: "Only specific projects")], title: "Access")
          }
          if scope == .projects {
            VStack(alignment: .leading, spacing: 6) {
              ForEach(workspace.projects) { project in
                Toggle(project.name, isOn: Binding(get: { picked.contains(project.id) }, set: { if $0 { picked.insert(project.id) } else { picked.remove(project.id) } }))
                  .font(.lnCallout).toggleStyle(.switch)
              }
              Text("Just what happens inside the projects you pick. No access to the main account.").font(.lnCaption).foregroundStyle(Theme.textMuted)
            }
          }
          LabeledField(label: "Expires") {
            MenuPicker(selection: $expiry, options: [PickerOption(value: 30, label: "In 30 days"), PickerOption(value: 90, label: "In 90 days"), PickerOption(value: 365, label: "In a year"), PickerOption(value: 0, label: "Never")], title: "Expires")
          }
          ErrorText(message: error)
        }

        if loading {
          SkeletonRows(count: 2).padding(-Metrics.gutter)
        } else if keys.isEmpty {
          EmptyState(systemImage: "key", title: "No API keys yet", message: "Create one for each script or service that calls the admin API, so you can revoke them one at a time.")
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
          Card {
            ForEach(keys) { key in
              CardRow(divider: key.id != keys.last?.id) { row(key) }
            }
          }
        }
      }
      .frame(maxWidth: 640, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .panelScreen("API keys")
    .task {
      if workspace.projects.isEmpty { await workspace.loadProjects() }
      await load()
    }
    .confirmationDialog("Revoke \(revoking?.name ?? "")? This cannot be undone.", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible, presenting: revoking) { key in
      Button("Revoke", role: .destructive) { Task { await revoke(key) } }
    }
    .sheet(item: $created) { created in
      NavigationStack {
        VStack(alignment: .leading, spacing: 16) {
          Text("It won't be shown again. Store it where the service that uses it can read it.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          Text(created.key)
            .font(.lnMono)
            .foregroundStyle(Theme.textHighlighted)
            .textSelection(.enabled)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
            .accessibilityLabel("New API key")
          Button {
            Clipboard.copy(created.key)
            copied = true
          } label: { Label(copied ? "Copied" : "Copy key", systemImage: copied ? "checkmark" : "doc.on.clipboard") }
            .buttonStyle(.lnPrimary)
          Spacer(minLength: 0)
        }
        .padding(20)
        .panelScreen("Copy this key now")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { self.created = nil } } }
      }
      .presentationDetents([.medium])
    }
  }

  @ViewBuilder private func row(_ key: APIKey) -> some View {
    if editingId == key.id {
      HStack(spacing: 8) {
        TextField("API key name", text: $editingName).textFieldStyle(.linear).submitLabel(.done).onSubmit { Task { await rename(key.id) } }
        Button("Save") { Task { await rename(key.id) } }.buttonStyle(.lnPrimaryCompact)
        Button("Cancel") { editingId = "" }.buttonStyle(.lnGhost)
      }
    } else {
      HStack(spacing: 12) {
        Image(systemName: "key").font(.system(size: 14)).foregroundStyle(Theme.textMuted)
        VStack(alignment: .leading, spacing: 2) {
          Text(key.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text("\(key.prefix)…").font(.lnMono).foregroundStyle(Theme.textMuted)
          Text([scopeLabel(key), expiryLabel(key)].joined(separator: " · ")).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2)
        }
        Spacer(minLength: 8)
        if sizeClass == .regular, let createdAt = key.createdAt {
          Text("Created \(DateText.day(createdAt))").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        IconButton(systemImage: "pencil", label: "Rename") {
          editingId = key.id
          editingName = key.name
        }
        IconButton(systemImage: "trash", label: "Revoke") { revoking = key }
      }
    }
  }

  private func scopeLabel(_ key: APIKey) -> String {
    guard let ids = key.projectIds else { return "All projects" }
    let names = ids.compactMap { workspace.project($0)?.name }
    return names.isEmpty ? "\(ids.count) project\(ids.count == 1 ? "" : "s")" : names.joined(separator: ", ")
  }

  private func expiryLabel(_ key: APIKey) -> String {
    var text = "Never expires"
    if let raw = key.expiresAt, let date = DateText.date(raw) { text = date <= Date() ? "Expired \(DateText.day(raw))" : "Expires \(DateText.day(raw))" }
    if let used = key.lastUsedAt { text += " · used \(DateText.day(used))" }
    return text
  }

  private func load() async {
    struct Response: Decodable, Sendable { let keys: [APIKey] }
    do {
      let response: Response = try await session.get("/v1/admin/api-keys")
      keys = response.keys
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }

  private func create() async {
    struct Response: Decodable, Sendable { let apiKey: APIKey; let key: String }
    guard !newName.trimmingCharacters(in: .whitespaces).isEmpty, !creating else { return }
    creating = true
    error = ""
    defer { creating = false }
    do {
      let ids = scope == .projects ? workspace.projects.map(\.id).filter(picked.contains) : nil
      let response: Response = try await session.send("/v1/admin/api-keys", body: NewKey(name: newName.trimmingCharacters(in: .whitespaces), projectIds: ids, expiresInDays: expiry == 0 ? nil : expiry))
      keys.insert(response.apiKey, at: 0)
      newName = ""
      scope = .all
      picked = []
      copied = false
      created = CreatedKey(key: response.key)
    } catch { self.error = error.localizedDescription }
  }

  private func rename(_ id: String) async {
    struct Response: Decodable, Sendable { let apiKey: APIKey }
    do {
      let response: Response = try await session.send("/v1/admin/api-keys/\(id)", method: "PATCH", body: ["name": editingName])
      keys = keys.map { $0.id == id ? response.apiKey : $0 }
      editingId = ""
    } catch { self.error = error.localizedDescription }
  }

  private func revoke(_ key: APIKey) async {
    do {
      try await session.delete("/v1/admin/api-keys/\(key.id)")
      keys.removeAll { $0.id == key.id }
    } catch { self.error = error.localizedDescription }
  }
}
