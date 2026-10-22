import SwiftUI

/// The tracker projects a project reports to: rename (the pill label), copy
/// the DSN and alert webhook, stop reporting (web: ManageErrorProjectsModal.vue).
struct ManageErrorLinksSheet: View {
  let projectId: String
  let links: [ProjectsAdminProject.ErrorLink]
  var onChanged: (ProjectsAdminProject) -> Void = { _ in }
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var servers: [TrackerServer] = []
  @State private var labels: [String: String] = [:]
  @State private var busy = ""
  @State private var removing: ProjectsAdminProject.ErrorLink?
  @State private var copied = ""
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("The GlitchTip and Bugsink projects this project reports to.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          if links.isEmpty { Text("Nothing is connected.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
          ForEach(links) { card($0) }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Tracker projects")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .confirmationDialog("Stop reporting to this tracker project?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { link in
        Button("Remove \(link.label)", role: .destructive) { Task { await remove(link) } }
      } message: { link in
        Text("The project in \(link.providerName) and past conversations stay.")
      }
    }
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 440)
    #else
    .presentationDetents([.medium, .large])
    #endif
    .task {
      labels = Dictionary(links.map { ($0.id, $0.label) }, uniquingKeysWith: { first, _ in first })
      if let response: TrackerServersResponse = try? await session.get("/v1/admin/errors/servers") { servers = response.servers }
    }
  }

  private func card(_ link: ProjectsAdminProject.ErrorLink) -> some View {
    let label = labels[link.id] ?? link.label
    return VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        TextField("Name shown for \(link.name)", text: Binding(get: { label }, set: { labels[link.id] = $0 })).textFieldStyle(.linear)
          .onSubmit { Task { await rename(link) } }
        Button { Task { await rename(link) } } label: {
          if busy == link.id { ProgressView() } else { Text("Save") }
        }
        .buttonStyle(.lnSecondaryCompact)
        .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || label.trimmingCharacters(in: .whitespaces) == link.label || !busy.isEmpty)
      }
      VStack(alignment: .leading, spacing: 8) {
        row("Tracker", "\(link.providerName) · \(serverName(link))")
        row("Project name", link.name)
        if !link.team.isEmpty { row("Team", link.team) }
        copyRow("DSN", link.dsn, id: "\(link.id):dsn", copy: "Copy DSN")
        if !link.alertWebhookUrl.isEmpty { copyRow("Alert webhook", link.alertWebhookUrl, id: "\(link.id):hook", copy: "Copy alert webhook") }
        if let url = URL(string: link.url), !link.url.isEmpty {
          Button { openURL(url) } label: { Label("Open in \(link.providerName)", systemImage: "arrow.up.right") }.buttonStyle(.lnGhost)
        }
      }
      Rectangle().fill(Theme.border).frame(height: 0.5)
      HStack(alignment: .center, spacing: 10) {
        Text("Tracker, project name and team are fixed; to change them, remove this and connect again.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        Spacer(minLength: 0)
        Button("Remove…", role: .destructive) { removing = link }.buttonStyle(.lnGhost).disabled(!busy.isEmpty)
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func serverName(_ link: ProjectsAdminProject.ErrorLink) -> String {
    servers.first { $0.id == link.serverId }?.name ?? (link.serverId.isEmpty ? link.providerName : String(localized: "Removed server"))
  }

  private func row(_ label: LocalizedStringKey, _ value: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text(label).font(.lnMeta).foregroundStyle(Theme.textMuted).frame(width: 100, alignment: .leading)
      Text(value).font(.lnMeta).foregroundStyle(Theme.text).textSelection(.enabled)
      Spacer(minLength: 0)
    }
  }

  private func copyRow(_ label: LocalizedStringKey, _ value: String, id: String, copy: LocalizedStringKey) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text(label).font(.lnMeta).foregroundStyle(Theme.textMuted).frame(width: 100, alignment: .leading)
      Text(value).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radiusSmall))
      IconButton(systemImage: copied == id ? "checkmark" : "doc.on.doc", label: copy) {
        Clipboard.copy(value)
        copied = id
        Task { try? await Task.sleep(for: .seconds(1.5)); if copied == id { copied = "" } }
      }
    }
  }

  // MARK: Requests

  private func rename(_ link: ProjectsAdminProject.ErrorLink) async {
    struct Input: Encodable, Sendable { let project, label: String }
    busy = link.id; error = ""
    defer { busy = "" }
    do {
      let saved: ProjectsAdminProject.Saved = try await session.send("/v1/admin/errors/links/\(link.id)", method: "PUT", body: Input(project: projectId, label: (labels[link.id] ?? link.label).trimmingCharacters(in: .whitespaces)))
      workspace.replace(saved.shared)
      onChanged(saved.full)
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ link: ProjectsAdminProject.ErrorLink) async {
    busy = link.id; error = ""
    defer { busy = "" }
    do {
      let saved: ProjectsAdminProject.Saved = try await session.send("/v1/admin/errors/links/\(link.id)?project=\(projectId)", method: "DELETE")
      workspace.replace(saved.shared)
      onChanged(saved.full)
    } catch { self.error = error.localizedDescription }
  }
}
