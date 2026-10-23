import SwiftUI

/// A project's errors from GlitchTip or Bugsink (web: projects/[id]/errors.vue):
/// filter by status, search and tracker project, open an error for its stack
/// trace and an AI fix, change its status, AI triage of everything open, alert
/// rules and the tracker projects behind it.
struct ErrorsScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @State private var admin: ProjectsAdminProject?
  @State private var issues: [ErrorIssue] = []
  @State private var status = "unresolved"
  @State private var search = ""
  @State private var linkFilter = ""
  @State private var next = ""
  @State private var loading = true
  @State private var error = ""
  @State private var connectOpen = false
  @State private var alertsOpen = false
  @State private var manageOpen = false
  @State private var overview: ErrorOverview?
  @State private var overviewError = ""
  @State private var analyzing = false
  @State private var copied = ""
  @State private var reportsOpen = false
  @State private var frequency = ErrorReportFrequency.off
  /// Answers can arrive out of order when pills are tapped quickly; only the latest counts.
  @State private var latest = 0

  private static var statuses: [(String, String)] { [("unresolved", String(localized: "Unresolved")), ("resolved", String(localized: "Resolved")), ("ignored", String(localized: "Ignored"))] }

  private var connected: Bool { workspace.project(projectId)?.errors?.connected == true }
  private var links: [ProjectsAdminProject.ErrorLink] { admin?.errorLinks ?? [] }
  private var alertLinks: [ProjectsAdminProject.ErrorLink] { links.filter { !$0.alertWebhookUrl.isEmpty && (linkFilter.isEmpty || $0.id == linkFilter) } }

  var body: some View {
    Group {
      if !connected {
        EmptyState(systemImage: "ladybug", title: "Error tracking isn't connected", message: "Connect GlitchTip or Bugsink to browse errors here, get alert emails and fix them with AI.") {
          Button("Connect error tracking") { connectOpen = true }.buttonStyle(.lnPrimary)
        }
        .frame(maxHeight: .infinity)
      } else {
        List {
          filters.linearRow()
          if links.count > 1 { pills.linearRow() }
          if overview != nil || !overviewError.isEmpty { overviewCard.linearRow() }
          if !links.isEmpty { dsnBlock.linearRow() }
          if !alertLinks.isEmpty { webhookBlock.linearRow() }
          if !error.isEmpty { ErrorText(message: error).linearRow() }
          if loading && issues.isEmpty {
            SkeletonRows(count: 4).linearRow()
          } else if issues.isEmpty && error.isEmpty {
            Text("No errors found.").font(.lnMeta).foregroundStyle(Theme.textMuted)
              .frame(maxWidth: .infinity).padding(.vertical, 32).linearRow()
          }
          ForEach(issues) { issue in
            ErrorIssueCard(issue: issue, projectId: projectId, showLink: links.count > 1) { value in Task { await update(issue, value) } }
              .linearRow()
          }
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
      if connected {
        ToolbarItemGroup(placement: .primaryAction) {
          Menu {
            Button { Task { await analyzeAll() } } label: { Label("Analyze now", systemImage: "wand.and.stars") }.disabled(analyzing)
            Button { reportsOpen = true } label: { Label("View all reports", systemImage: "clock.arrow.circlepath") }
            Divider()
            Picker("Run automatically", selection: Binding(get: { frequency }, set: { value in Task { await setFrequency(value) } })) {
              ForEach(ErrorReportFrequency.allCases, id: \.self) { Text($0.label).tag($0) }
            }
          } label: { Label("Analyze with AI", systemImage: "wand.and.stars") } primaryAction: { Task { await analyzeAll() } }
            .disabled(analyzing)
          Button { alertsOpen = true } label: { Label("Error alerts", systemImage: "bell") }
          Menu {
            Button { connectOpen = true } label: { Label("Connect another", systemImage: "plus") }
            Button { manageOpen = true } label: { Label("Manage tracker projects", systemImage: "gearshape") }
            Divider()
            Button { Task { await load() } } label: { Label("Refresh errors", systemImage: "arrow.clockwise") }
              .keyboardShortcut("r", modifiers: .command)
          } label: { Label("More", systemImage: "ellipsis") }
        }
      }
    }
    .task(id: connected) { if connected { await loadAdmin(); await loadSchedule() } }
    .sheet(isPresented: $reportsOpen) {
      ErrorReportsSheet(projectId: projectId) { overview = $0 }
    }
    .task(id: "\(status)|\(linkFilter)|\(connected)") { await load() }
    .sheet(isPresented: $connectOpen) {
      ConnectErrorTrackingSheet(projectId: projectId, projectName: workspace.project(projectId)?.name ?? "", existing: links) { connectedProject in
        admin = connectedProject
        Task { await load() }
      }
    }
    .sheet(isPresented: $alertsOpen) {
      ErrorAlertsSheet(projectId: projectId, links: links)
        #if os(iOS)
        .presentationDetents([.large])
        #endif
    }
    .sheet(isPresented: $manageOpen) {
      ManageErrorLinksSheet(projectId: projectId, links: links) { changed in
        admin = changed
        if !(changed.errorLinks ?? []).contains(where: { $0.id == linkFilter }) { linkFilter = "" }
      }
    }
  }

  // MARK: Pieces

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

  private var pills: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        Pill(label: "All", isActive: linkFilter.isEmpty) { linkFilter = "" }
        ForEach(links) { link in Pill(label: link.label, isActive: linkFilter == link.id) { linkFilter = link.id } }
      }
    }
    .accessibilityLabel("Filter by tracker project")
  }

  private var overviewCard: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !overviewError.isEmpty {
        ErrorText(message: overviewError)
      } else if let overview {
        ErrorMarkdown(text: overview.text)
        Text(overview.count == 1 ? "Based on 1 unresolved error: titles, locations and counts. Open an error to analyze its stack trace." : "Based on \(overview.count) unresolved errors: titles, locations and counts. Open an error to analyze its stack trace.")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
        if !overview.files.isEmpty {
          Text("Read code from: \(overview.files.joined(separator: ", "))").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        Button { Clipboard.copy(overview.text); copied = "overview"; Task { try? await Task.sleep(for: .seconds(1.5)); if copied == "overview" { copied = "" } } } label: { Label(copied == "overview" ? "Copied" : "Copy report", systemImage: copied == "overview" ? "checkmark" : "doc.on.doc") }
          .buttonStyle(.lnSecondaryCompact)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private var dsnBlock: some View {
    DisclosureGroup {
      VStack(alignment: .leading, spacing: 10) {
        ForEach(links) { link in
          VStack(alignment: .leading, spacing: 4) {
            if links.count > 1 { Text(link.label).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted) }
            HStack(alignment: .top, spacing: 6) {
              Text(link.dsn).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled)
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
              IconButton(systemImage: copied == link.id ? "checkmark" : "doc.on.doc", label: "Copy DSN") {
                Clipboard.copy(link.dsn)
                copied = link.id
                Task { try? await Task.sleep(for: .seconds(1.5)); if copied == link.id { copied = "" } }
              }
            }
          }
        }
        Text("Pass it to any Sentry SDK as dsn.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      .padding(.top, 8)
    } label: {
      Label(links.count > 1 ? "DSN to send errors from your app (\(links.count))" : "DSN to send errors from your app", systemImage: "key").font(.lnMetaMedium).foregroundStyle(Theme.text)
    }
    .tint(Theme.textMuted)
  }

  private var webhookBlock: some View {
    DisclosureGroup {
      VStack(alignment: .leading, spacing: 12) {
        ForEach(alertLinks) { link in
          VStack(alignment: .leading, spacing: 4) {
            Text(links.count > 1 ? link.label : String(localized: "Alert webhook")).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
            Text(ErrorsText.webhookSteps).font(.lnCaption).foregroundStyle(Theme.textMuted)
            CodeBlock(code: link.alertWebhookUrl)
          }
        }
      }
      .padding(.top, 8)
    } label: {
      Label(alertLinks.count > 1 ? "Check alert rules the moment Bugsink reports an error (\(alertLinks.count))" : "Check alert rules the moment Bugsink reports an error", systemImage: "point.3.connected.trianglepath.dotted").font(.lnMetaMedium).foregroundStyle(Theme.text)
    }
    .tint(Theme.textMuted)
  }

  // MARK: Requests

  private func loadAdmin() async {
    if let project = try? await ProjectsAdminProject.load(projectId, session: session) { admin = project }
  }

  private func load(cursor: String = "") async {
    guard connected else { loading = false; return }
    latest += 1
    let mine = latest
    error = ""
    if cursor.isEmpty { loading = true }
    do {
      var query = ["project": projectId, "status": status]
      if !search.isEmpty { query["q"] = search }
      if !cursor.isEmpty { query["cursor"] = cursor }
      if !linkFilter.isEmpty { query["link"] = linkFilter }
      let page: ErrorIssuePage = try await session.get("/v1/admin/errors", query: query)
      guard mine == latest else { return }
      issues = cursor.isEmpty ? page.issues : issues + page.issues
      next = page.next ?? ""
    } catch {
      if mine == latest, !Task.isCancelled {
        self.error = error.localizedDescription
        if cursor.isEmpty { issues = []; next = "" }
      }
    }
    if mine == latest { loading = false }
  }

  private func update(_ issue: ErrorIssue, _ value: String) async {
    struct Input: Encodable, Sendable { let project, status, link: String }
    struct Output: Decodable, Sendable {}
    do {
      let _: Output = try await session.send("/v1/admin/errors/\(issue.issueId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? issue.issueId)", method: "PUT", body: Input(project: projectId, status: value, link: issue.linkId))
      await load()
    } catch { self.error = error.localizedDescription }
  }

  private func loadSchedule() async {
    struct Loaded: Decodable, Sendable { let frequency: String }
    if let loaded: Loaded = try? await session.get("/v1/admin/errors/schedule", query: ["project": projectId]) { frequency = ErrorReportFrequency(rawValue: loaded.frequency) ?? .off }
  }

  private func setFrequency(_ value: ErrorReportFrequency) async {
    struct Input: Encodable, Sendable { let project: String; let frequency: String }
    struct Output: Decodable, Sendable {}
    let before = frequency
    frequency = value
    do {
      let _: Output = try await session.send("/v1/admin/errors/schedule", method: "PUT", body: Input(project: projectId, frequency: value.rawValue))
    } catch { frequency = before; overviewError = error.localizedDescription }
  }

  private func analyzeAll() async {
    struct Input: Encodable, Sendable { let project: String }
    analyzing = true; overviewError = ""
    defer { analyzing = false }
    do {
      overview = try await session.send("/v1/admin/errors/analyze", body: Input(project: projectId))
    } catch {
      overview = nil
      overviewError = error.localizedDescription
    }
  }
}
