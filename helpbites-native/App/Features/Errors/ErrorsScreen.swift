import SwiftUI

/// One issue from the project's error tracker (`GET /v1/admin/errors`). GlitchTip
/// sends `count` as a string and Bugsink as a number, so it decodes either.
struct ErrorIssue: Decodable, Identifiable, Sendable {
  let id, title: String
  let culprit, level, url, conversationId: String?
  let count: Int?

  enum CodingKeys: String, CodingKey { case id, title, culprit, level, url, conversationId, count }
  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    title = (try? container.decode(String.self, forKey: .title)) ?? "Untitled error"
    culprit = try? container.decode(String.self, forKey: .culprit)
    level = try? container.decode(String.self, forKey: .level)
    url = try? container.decode(String.self, forKey: .url)
    conversationId = try? container.decode(String.self, forKey: .conversationId)
    count = (try? container.decode(Int.self, forKey: .count)) ?? (try? container.decode(String.self, forKey: .count)).flatMap { Int($0) }
  }

  var isSevere: Bool { level == "error" || level == "fatal" }
}

struct ErrorIssuePage: Decodable, Sendable { let issues: [ErrorIssue]; let next: String? }

/// A project's errors from GlitchTip or Bugsink (web: projects/[id]/errors.vue):
/// filter by status, search, change an issue's status, jump to its conversation.
struct ErrorsScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @State private var issues: [ErrorIssue] = []
  @State private var status = "unresolved"
  @State private var search = ""
  @State private var next = ""
  @State private var loading = true
  @State private var error = ""
  @State private var connectOpen = false

  private static let statuses = [("unresolved", "Unresolved"), ("resolved", "Resolved"), ("ignored", "Ignored")]

  private var project: Project? { workspace.project(projectId) }
  private var errors: ProjectErrors? { project?.errors }

  var body: some View {
    Group {
      if errors?.connected != true {
        EmptyState(systemImage: "ladybug", title: "Error tracking isn't connected", message: "Connect GlitchTip or Bugsink to turn new errors into inbox conversations.") {
          Button("Connect error tracking") { connectOpen = true }.buttonStyle(.lnPrimary)
        }
        .frame(maxHeight: .infinity)
      } else {
        List {
          filters.linearRow()
          if let webhook = errors?.alertWebhookUrl, !webhook.isEmpty {
            webhookNotice(webhook).linearRow()
          }
          if !error.isEmpty { ErrorText(message: error).linearRow() }
          if loading && issues.isEmpty {
            SkeletonRows(count: 4).linearRow()
          } else if issues.isEmpty {
            Text("No errors found.").font(.lnMeta).foregroundStyle(Theme.textMuted)
              .frame(maxWidth: .infinity).padding(.vertical, 32).linearRow()
          }
          ForEach(issues) { issue in row(issue).linearRow() }
          if !next.isEmpty {
            Button("Load more") { Task { await load(cursor: next) } }.buttonStyle(.lnSecondaryCompact).linearRow()
          }
        }
        .linearList()
        .refreshable { await load() }
      }
    }
    .projectScreen(projectId, "Errors")
    .toolbar {
      if errors?.connected == true {
        ToolbarItem(placement: .primaryAction) {
          Button { Task { await load() } } label: { Label("Refresh errors", systemImage: "arrow.clockwise") }
        }
      }
    }
    .task(id: status) { await load() }
    .sheet(isPresented: $connectOpen) {
      ConnectErrorTrackingSheet(projectId: projectId) { _ in Task { await load() } }
    }
  }

  private var filters: some View {
    HStack(spacing: 8) {
      Picker("Status", selection: $status) {
        ForEach(Self.statuses, id: \.0) { Text($0.1).tag($0.0) }
      }
      .pickerStyle(.menu)
      .tint(Theme.text)
      SearchField(text: $search, prompt: "Search errors") { Task { await load() } }
    }
    .padding(.vertical, 4)
  }

  private func webhookNotice(_ url: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "point.3.connected.trianglepath.dotted").foregroundStyle(Theme.textMuted)
      VStack(alignment: .leading, spacing: 4) {
        Text("Send Bugsink alerts to the inbox").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        Text("In Bugsink, open this project's alerts, click Add, set Kind to Custom and use this Webhook url:").font(.lnCaption).foregroundStyle(Theme.textMuted)
        CodeBlock(code: url)
      }
    }
    .padding(12)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private func row(_ issue: ErrorIssue) -> some View {
    HStack(spacing: 12) {
      Image(systemName: "ladybug").font(.system(size: 13)).foregroundStyle(issue.isSevere ? Theme.error : Theme.warning)
      VStack(alignment: .leading, spacing: 2) {
        Text(issue.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Text("\(issue.culprit?.isEmpty == false ? issue.culprit! : "Unknown location") · \(issue.count ?? 1) events")
          .font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 8)
      if let conversationId = issue.conversationId, !conversationId.isEmpty {
        Button("Conversation") { openConversation(conversationId) }.buttonStyle(.lnGhost)
      }
      Menu {
        if let raw = issue.url, let url = URL(string: raw) {
          Button { openURL(url) } label: { Label("Open in \(errors?.providerName ?? "tracker")", systemImage: "arrow.up.right") }
          Divider()
        }
        Button("Open") { Task { await update(issue, "open") } }
        Button("Resolve") { Task { await update(issue, "resolved") } }
        Button("Ignore") { Task { await update(issue, "closed") } }
      } label: {
        Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
      }
      .accessibilityLabel("Change status")
    }
    .frame(minHeight: Metrics.rowHeight)
    .padding(.vertical, 4)
  }

  /// The web links to `/inbox?c=<conversation>`.
  private func openConversation(_ id: String) {
    workspace.inbox.projectFilter = projectId
    workspace.go(.inbox)
    Task { await workspace.inbox.select(id) }
  }

  private func load(cursor: String = "") async {
    guard errors?.connected == true else { loading = false; return }
    loading = true
    defer { loading = false }
    do {
      var query = ["project": projectId, "status": status]
      if !search.isEmpty { query["q"] = search }
      if !cursor.isEmpty { query["cursor"] = cursor }
      let page: ErrorIssuePage = try await session.get("/v1/admin/errors", query: query)
      issues = cursor.isEmpty ? page.issues : issues + page.issues
      next = page.next ?? ""
      error = ""
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }

  private func update(_ issue: ErrorIssue, _ value: String) async {
    struct Input: Encodable, Sendable { let project, status: String }
    struct Output: Decodable, Sendable {}
    do {
      let _: Output = try await session.send("/v1/admin/errors/\(issue.id)", method: "PUT", body: Input(project: projectId, status: value))
      await load()
    } catch { self.error = error.localizedDescription }
  }
}

/// Pick a Sentry-compatible tracker and connect the project to it (web: ConnectErrorTrackingModal.vue).
struct ConnectErrorTrackingSheet: View {
  let projectId: String
  var onConnected: (ProjectsAdminProject) -> Void = { _ in }
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var providers: [Provider] = []
  @State private var selected = ""
  @State private var loading = true
  @State private var connecting = false
  @State private var error = ""
  /// Set once Bugsink is connected: its alert webhook still has to be added by hand.
  @State private var webhook: (name: String, provider: String, url: String)?

  struct Provider: Decodable, Identifiable, Sendable {
    let id, name: String
    let configured: Bool
    let missing: [String]?
  }

  private static let blurbs = [
    "glitchtip": "Creates the project, DSN and an inbox alert automatically.",
    "bugsink": "Creates the project and DSN; you paste one alert webhook into Bugsink."
  ]

  private var current: Provider? { providers.first { $0.id == selected } }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let webhook {
            Text("Connected to \(webhook.provider). One step left: Bugsink can't add alert destinations through its API, so add this webhook by hand.").font(.lnCallout).foregroundStyle(Theme.text)
            VStack(alignment: .leading, spacing: 4) {
              Text("1. In Bugsink, open Projects and click the alerts (megaphone) icon next to \(webhook.name).")
              Text("2. Click Add, set Kind to Custom and paste this as the Webhook url.")
            }
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
            CodeBlock(code: webhook.url)
          } else {
            Text("Pick the Sentry-compatible tracker this project reports to. HelpBites creates the project there and turns new errors into inbox conversations.")
              .font(.lnMeta).foregroundStyle(Theme.textMuted)
            if loading {
              Text("Checking which trackers this server is set up for…").font(.lnMeta).foregroundStyle(Theme.textMuted)
            } else {
              VStack(spacing: 8) { ForEach(providers) { option($0) } }
            }
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Connect error tracking")
      .toolbar {
        if webhook != nil {
          ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        } else {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button(current.map { "Connect \($0.name)" } ?? "Connect") { Task { await connect() } }
              .disabled(current?.configured != true || connecting)
          }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .task { await loadProviders() }
  }

  private func option(_ provider: Provider) -> some View {
    let isSelected = selected == provider.id
    return Button { selected = provider.id } label: {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
          .foregroundStyle(isSelected ? Theme.accent : Theme.textDimmed)
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 8) {
            Text(provider.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
            Tag(text: provider.configured ? "Ready" : "Not set up", tint: provider.configured ? Theme.success : nil)
          }
          if let blurb = Self.blurbs[provider.id] { Text(blurb).font(.lnCaption).foregroundStyle(Theme.textMuted) }
          if !provider.configured, let missing = provider.missing, !missing.isEmpty {
            Text("Set \(missing.joined(separator: ", ")) on the server and restart. See docs/ERRORS.md.")
              .font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
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

  private func loadProviders() async {
    struct Response: Decodable, Sendable { let providers: [Provider] }
    loading = true
    defer { loading = false }
    do {
      let response: Response = try await session.get("/v1/admin/errors/providers")
      providers = response.providers
      selected = (providers.first { $0.configured } ?? providers.first)?.id ?? ""
    } catch { self.error = error.localizedDescription }
  }

  private func connect() async {
    struct Input: Encodable, Sendable { let project, provider: String }
    struct Output: Decodable, Sendable { let project: ProjectsAdminProject; let shared: Project
      enum CodingKeys: CodingKey { case project }
      init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        project = try container.decode(ProjectsAdminProject.self, forKey: .project)
        shared = try container.decode(Project.self, forKey: .project)
      }
    }
    connecting = true; error = ""
    defer { connecting = false }
    do {
      let output: Output = try await session.send("/v1/admin/errors/connect", body: Input(project: projectId, provider: selected))
      workspace.replace(output.shared)
      onConnected(output.project)
      if let url = output.project.errors?.alertWebhookUrl, !url.isEmpty {
        webhook = (output.project.name, output.project.errors?.providerName ?? "Bugsink", url)
      } else {
        dismiss()
      }
    } catch { self.error = error.localizedDescription }
  }
}
