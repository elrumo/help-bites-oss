import SwiftUI

/// Admin API keys (pages/api-keys.vue): one per script or service, shown once
/// on creation, renamed or revoked one at a time.
struct APIKeysScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var keys: [APIKey] = []
  @State private var loading = true
  @State private var newName = ""
  @State private var creating = false
  @State private var error = ""
  @State private var created: CreatedKey?
  @State private var copied = false
  @State private var editingId = ""
  @State private var editingName = ""
  @State private var revoking: APIKey?

  private struct APIKey: Decodable, Identifiable, Sendable { let id, name, prefix: String; let createdAt: String? }
  private struct CreatedKey: Identifiable { let id = UUID(); let key: String }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Admin API keys").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text((try? AttributedString(markdown: "A key can do everything this panel does, through `/v1/admin`. Keep keys on your servers.")) ?? "")
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)
        }

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
            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || creating)
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
    .task { await load() }
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
            UIPasteboard.general.string = created.key
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
      let response: Response = try await session.send("/v1/admin/api-keys", body: ["name": newName])
      keys.insert(response.apiKey, at: 0)
      newName = ""
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
