import SwiftUI
import UniformTypeIdentifiers

/// Moving data to another HelpBites (web: components/settings/Transfer.vue). Download a workspace, or with
/// `projectId` one project, as a file another instance can import; import a file; or pull straight from another
/// instance, which runs in the background on the server. Docs: docs/TRANSFER.md.
struct TransferSection: View {
  var projectId: String? = nil
  @Environment(SessionStore.self) private var session
  @State private var transfers: [TransferRecord] = []
  @State private var downloading = false
  @State private var exported: URL?
  @State private var uploading = false
  @State private var picking = false
  @State private var connecting = false
  @State private var error = ""
  @State private var notice = ""

  private var busy: Bool { transfers.contains { $0.status == "queued" || $0.status == "running" } }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel(projectId == nil ? "Move to another HelpBites" : "Move this project")
      Card {
        CardRow(divider: projectId == nil) {
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
              Text(projectId == nil ? String(localized: "Download everything, ready to import elsewhere") : String(localized: "Download this project, ready to import elsewhere")).font(.lnRow).foregroundStyle(Theme.textHighlighted)
              Text("Conversations, contacts, knowledge, email, changelog and settings as one file another HelpBites can import. Passwords, API keys, Stripe and GitHub connections and uploaded files stay behind.").font(.lnCaption).foregroundStyle(Theme.textMuted)
            }
            Spacer(minLength: 8)
            if let exported {
              ShareLink(item: exported) { Label("Save", systemImage: "square.and.arrow.up") }.buttonStyle(.lnSecondaryCompact)
            } else {
              Button { Task { await download() } } label: { if downloading { ProgressView() } else { Label("Download", systemImage: "square.and.arrow.down") } }
                .buttonStyle(.lnSecondaryCompact).disabled(downloading)
            }
          }
        }
        if projectId == nil {
          CardRow(divider: false) {
            VStack(alignment: .leading, spacing: 10) {
              VStack(alignment: .leading, spacing: 3) {
                Text("Import into this workspace").font(.lnRow).foregroundStyle(Theme.textHighlighted)
                Text("From a file, or straight from another HelpBites (self-hosted or cloud). Everything comes in as new projects; nothing here is overwritten and nothing is changed on the other side.").font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
              HStack(spacing: 8) {
                Button { picking = true } label: { if uploading { ProgressView() } else { Label("From a file", systemImage: "square.and.arrow.up") } }
                  .buttonStyle(.lnSecondaryCompact).disabled(busy || uploading)
                Button { connecting = true } label: { Label("From another HelpBites", systemImage: "icloud.and.arrow.down") }
                  .buttonStyle(.lnSecondaryCompact).disabled(busy)
              }
            }
          }
        }
      }
      ErrorText(message: error)
      SuccessText(message: notice)
      if projectId == nil {
        ForEach(transfers) { record in TransferRow(record: record) }
      }
    }
    .task(id: session.workspace?.id) { if projectId == nil { await load() } }
    // Follow a running import until it ends.
    .task(id: busy) { while busy && !Task.isCancelled { try? await Task.sleep(for: .seconds(3)); await load() } }
    .fileImporter(isPresented: $picking, allowedContentTypes: [.data]) { result in Task { await upload(result) } }
    .sheet(isPresented: $connecting) { TransferConnectSheet { notice = String(localized: "Import started"); await load() } }
  }

  private func load() async {
    struct Output: Decodable, Sendable { let transfers: [TransferRecord] }
    if let output: Output = try? await session.get("/v1/admin/transfers") { transfers = output.transfers }
  }

  private func download() async {
    downloading = true; error = ""
    defer { downloading = false }
    do {
      let data = try await session.download("/v1/admin/transfers/export" + (projectId.map { "?project=\($0)" } ?? ""))
      let url = FileManager.default.temporaryDirectory.appending(path: "helpbites-\(projectId == nil ? "workspace" : "project").jsonl.gz")
      try data.write(to: url)
      exported = url
    } catch { self.error = error.localizedDescription }
  }

  private func upload(_ result: Result<URL, Error>) async {
    struct Output: Decodable, Sendable { let id: String }
    guard case .success(let url) = result else { return }
    uploading = true; error = ""; notice = ""
    defer { uploading = false }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      let _: Output = try await session.uploadRaw("/v1/admin/transfers/upload", file: try Data(contentsOf: url))
      notice = String(localized: "Import started")
      await load()
    } catch { self.error = error.localizedDescription }
  }
}

/// One import, as `GET /v1/admin/transfers` lists it.
struct TransferRecord: Decodable, Identifiable, Sendable {
  let id: String
  let source: String
  let host: String
  let scope: String
  let status: String
  let progress: Progress?
  let summary: Summary?
  let error: String
  let createdAt: String?

  struct Progress: Decodable, Sendable { let className: String; let rows: [String: Int] }
  struct Summary: Decodable, Sendable {
    let rows: [String: Int]
    let skipped: [String: Skipped]
    let projects: [Imported]
    let notes: [String]
  }
  struct Skipped: Decodable, Sendable { let count: Int; let reason: String }
  struct Imported: Decodable, Sendable { let name: String; let publicKey: String; let keptKey: Bool }
}

private struct TransferRow: View {
  let record: TransferRecord

  private func total(_ rows: [String: Int]) -> Int { rows.values.reduce(0, +) }

  var body: some View {
    Card {
      CardRow(divider: false) {
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 6) {
            Image(systemName: record.status == "done" ? "checkmark.circle" : record.status == "failed" ? "exclamationmark.circle" : "arrow.triangle.2.circlepath")
              .foregroundStyle(record.status == "done" ? Theme.success : record.status == "failed" ? Theme.error : Theme.textMuted)
            Text(record.source == "file" ? String(localized: "A file") : record.host).font(.lnRow).foregroundStyle(Theme.textHighlighted)
            Text("\(record.scope == "project" ? String(localized: "One project") : String(localized: "Whole workspace")) · \(DateText.short(record.createdAt))").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          switch record.status {
          case "queued": caption("Waiting to start…")
          case "running":
            if let progress = record.progress { caption("Importing \(progress.className): \(total(progress.rows)) rows so far") } else { caption("Importing…") }
          case "failed": Text("\(record.error) Nothing was kept; fix it and start again.").font(.lnCaption).foregroundStyle(Theme.error)
          default:
            if let summary = record.summary {
              caption("Imported \(total(summary.rows)) rows into \(summary.projects.count) projects.")
              ForEach(summary.projects.filter { !$0.keptKey }, id: \.publicKey) { project in
                Text("\(project.name): its key was already used here, so it now has \(project.publicKey). Update the embed on your site.").font(.lnCaption).foregroundStyle(Theme.warning)
              }
              if !summary.projects.isEmpty { caption("Each project has a new secret (rotate it in the project's keys). Connections that hold credentials, such as Stripe, GitHub, Telegram, error trackers and webhook secrets, need setting up again.") }
              if summary.notes.contains("sequences") { caption("Sequences that were running are paused here. Turn them on when you are ready.") }
              ForEach(summary.skipped.sorted { $0.key < $1.key }, id: \.key) { name, skipped in
                caption("\(skipped.count) \(name) left out: \(skipped.reason)")
              }
            }
          }
        }
      }
    }
  }

  private func caption(_ text: LocalizedStringKey) -> some View { Text(text).font(.lnCaption).foregroundStyle(Theme.textMuted) }
}

/// Sign in to another HelpBites, pick what to import, start it (`POST /v1/admin/transfers/inspect`, then `/transfers`).
private struct TransferConnectSheet: View {
  var started: () async -> Void
  @Environment(\.dismiss) private var dismiss
  @Environment(SessionStore.self) private var session
  @State private var url = ""
  @State private var useKey = true
  @State private var apiKey = ""
  @State private var login = ""
  @State private var password = ""
  @State private var found: Found?
  @State private var workspaceId = ""
  @State private var projectId = ""
  @State private var working = false
  @State private var error = ""

  struct Named: Decodable, Identifiable, Hashable, Sendable { let id: String; let name: String }
  struct Found: Decodable, Sendable { let host: String; let workspace: Named; let workspaces: [Named]; let projects: [Named] }
  private struct Source: Encodable, Sendable { let url: String; let workspaceId: String; let apiKey: String?; let login: String?; let password: String? }
  private struct Start: Encodable, Sendable { let source: Source; let projectId: String }

  private var source: Source {
    Source(url: url.trimmingCharacters(in: .whitespaces), workspaceId: workspaceId, apiKey: useKey ? apiKey : nil, login: useKey ? nil : login, password: useKey ? nil : password)
  }
  private var ready: Bool { !url.isEmpty && (useKey ? !apiKey.isEmpty : !login.isEmpty && !password.isEmpty) }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Sign in to the other HelpBites with an owner or admin. We read it once, in the background, and sign out again.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Its address") {
            TextField("https://help.example.com", text: $url).textFieldStyle(.linear).autocorrectionDisabled().textInputAutocapitalization(.never).keyboardType(.URL).disabled(found != nil)
          }
          if let found {
            Text("Connected to \(found.host), workspace \(found.workspace.name).").font(.lnMeta).foregroundStyle(Theme.textHighlighted)
            if found.workspaces.count > 1 {
              LabeledField(label: "Workspace there") {
                Picker("", selection: $workspaceId) { ForEach(found.workspaces) { Text($0.name).tag($0.id) } }.pickerStyle(.menu)
                  .onChange(of: workspaceId) { _, _ in Task { await inspect() } }
              }
            }
            LabeledField(label: "What to import") {
              Picker("", selection: $projectId) {
                Text("Everything in the workspace").tag("")
                ForEach(found.projects) { Text($0.name).tag($0.id) }
              }.pickerStyle(.menu)
            }
            Text("It is created here as new projects, and keeps running over there until you switch your sites over.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          } else {
            Picker("", selection: $useKey) { Text("Admin API key").tag(true); Text("Username and password").tag(false) }.pickerStyle(.segmented)
            if useKey {
              LabeledField(label: "Admin API key", hint: "Made under API keys there") { SecureField("ak_…", text: $apiKey).textFieldStyle(.linear).autocorrectionDisabled().textInputAutocapitalization(.never) }
            } else {
              LabeledField(label: "Username or email") { TextField("", text: $login).textFieldStyle(.linear).autocorrectionDisabled().textInputAutocapitalization(.never) }
              LabeledField(label: "Password") { SecureField("", text: $password).textFieldStyle(.linear).textContentType(.password) }
            }
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Import from another HelpBites")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if working { ProgressView() } else if found == nil {
            Button("Connect") { Task { await inspect() } }.disabled(!ready)
          } else {
            Button("Start import") { Task { await start() } }
          }
        }
      }
    }
    .presentationDetents([.large])
  }

  private func inspect() async {
    working = true; error = ""
    defer { working = false }
    do {
      let result: Found = try await session.send("/v1/admin/transfers/inspect", body: source)
      found = result
      projectId = ""
      if workspaceId != result.workspace.id { workspaceId = result.workspace.id }
    } catch { self.error = error.localizedDescription }
  }

  private func start() async {
    struct Output: Decodable, Sendable { let id: String }
    working = true; error = ""
    defer { working = false }
    do {
      let _: Output = try await session.send("/v1/admin/transfers", body: Start(source: source, projectId: projectId))
      // The login stays on the server only until the import ends; none stays in this sheet.
      apiKey = ""; password = ""
      dismiss()
      await started()
    } catch { self.error = error.localizedDescription }
  }
}
