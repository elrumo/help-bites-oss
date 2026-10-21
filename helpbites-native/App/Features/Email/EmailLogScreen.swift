import SwiftUI

/// Everything that was sent (EmailLogView.vue): one row per recipient, newest
/// first, for one project or (with `projectId` nil) all of them. API sends,
/// tests, conversation and feedback notifications all land here. A row opens
/// the full entry. Shown as the Log tab of `EmailLibraryScreen`.
struct EmailLogScreen: View {
  let projectId: String?
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace

  @State private var logs: [EmailLogEntry] = []
  @State private var stats: EmailLogStats?
  @State private var settings: EmailSettings?
  @State private var nextBefore: String?
  @State private var loading = true
  @State private var loadingMore = false
  @State private var error = ""

  @State private var search = ""
  @State private var status = ""
  @State private var source = ""
  @State private var template = ""
  @State private var batch: String
  @State private var opened: EmailLogEntry?
  @State private var previewing: EmailLogEntry?

  /// `batch` lists one send's recipients (a campaign links here with its `cm_` id).
  init(projectId: String?, batch: String = "") {
    self.projectId = projectId
    _batch = State(initialValue: batch)
  }

  private struct Filters: Equatable {
    var to = "", status = "", source = "", template = "", batch = ""
    var isEmpty: Bool { to.isEmpty && status.isEmpty && source.isEmpty && template.isEmpty && batch.isEmpty }
  }

  private var filters: Filters {
    Filters(to: search.trimmingCharacters(in: .whitespacesAndNewlines), status: status, source: source, template: template, batch: batch)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      List {
        statsSection.linearRow()
        if !batch.isEmpty { batchBanner.linearRow() }
        if loading {
          SkeletonRows(count: 8).linearRow()
        } else if !error.isEmpty {
          ErrorText(message: error).padding(.vertical, 12).linearRow()
        } else if logs.isEmpty {
          EmptyState(
            systemImage: "clock.arrow.circlepath",
            title: filters.isEmpty ? "Nothing sent yet" : "Nothing matches",
            message: filters.isEmpty ? "Every email sent through the API, a test or a notification shows up here, one row per recipient." : "Try another filter."
          )
          .linearRow()
        } else {
          ForEach(logs) { row($0) }
          if nextBefore != nil {
            HStack {
              Spacer()
              if loadingMore { ProgressView() } else {
                Button("Load more") { Task { await loadMore() } }.buttonStyle(.lnSecondaryCompact)
              }
              Spacer()
            }
            .padding(.vertical, 12)
            .linearRow()
          }
        }
      }
      .linearList()
      .refreshable { await refresh() }
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        IconButton(systemImage: "arrow.clockwise", label: "Refresh") { Task { await refresh() } }
      }
    }
    .task {
      await loadStats()
      await loadSettings()
      if projectId == nil && workspace.projects.isEmpty { await workspace.loadProjects() }
    }
    // Filters reload after a pause, like the web's watchDebounced(…, 300).
    .task(id: filters) {
      if !loading { try? await Task.sleep(for: .milliseconds(300)) }
      guard !Task.isCancelled else { return }
      await load()
    }
    .sheet(item: $opened) { entry in
      EmailLogDetailSheet(entry: entry, showsProject: projectId == nil) { batchId in
        batch = batchId
        search = ""
        status = ""
        source = ""
        template = ""
        opened = nil
      }
    }
    .sheet(item: $previewing) { EmailLogPreviewSheet(entry: $0) }
  }

  // MARK: Layout

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      SearchField(text: $search, prompt: "Address")
        .textInputAutocapitalization(.never)
        .keyboardType(.emailAddress)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) { filterMenus }
      }
    }
    .padding(.horizontal, Metrics.gutter)
    .padding(.vertical, 10)
    .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
  }

  @ViewBuilder private var filterMenus: some View {
    Group {
      Menu {
        Picker("Status", selection: $status) {
          Text("Any status").tag("")
          ForEach(EmailStatusText.statuses, id: \.key) { item in Label(item.style.label, systemImage: item.style.systemImage).tag(item.key) }
        }
      } label: { filterLabel(status.isEmpty ? "Status" : EmailStatusText.style(status).label, active: !status.isEmpty) }
      Menu {
        Picker("Source", selection: $source) {
          Text("Any source").tag("")
          ForEach(EmailStatusText.sources, id: \.key) { item in Text(item.label).tag(item.key) }
        }
      } label: { filterLabel(source.isEmpty ? "Source" : EmailStatusText.source(source), active: !source.isEmpty) }
      if !templateKeys.isEmpty {
        Menu {
          Picker("Template", selection: $template) {
            Text("Any template").tag("")
            ForEach(templateKeys, id: \.self) { key in Text(key).tag(key) }
          }
        } label: { filterLabel(template.isEmpty ? "Template" : template, active: !template.isEmpty) }
      }
    }
  }

  /// The keys sent in the last 30 days, most used first; one picked from a link stays listed.
  private var templateKeys: [String] {
    var keys = (stats?.topTemplates ?? []).map(\.key)
    if !template.isEmpty && !keys.contains(template) { keys.append(template) }
    return keys
  }

  private func filterLabel(_ text: String, active: Bool) -> some View {
    HStack(spacing: 4) {
      Text(text).lineLimit(1)
      Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
    }
    .font(.lnMetaMedium)
    .foregroundStyle(active ? Theme.textHighlighted : Theme.textMuted)
    .padding(.horizontal, 10)
    .frame(height: 30)
    .background(active ? Theme.elevated : Color.clear, in: Capsule())
    .overlay(Capsule().strokeBorder(active ? Theme.borderAccented : Theme.border))
  }

  /// The last 30 days, and what's missing on the server.
  private var statsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
        if let stats {
          ForEach(tiles(stats), id: \.label) { tile in
            VStack(alignment: .leading, spacing: 4) {
              Text(tile.label).font(.lnCaption).foregroundStyle(Theme.textMuted)
              Text(EmailStatusText.compactCount(tile.value)).font(.system(size: 22, weight: .semibold)).foregroundStyle(Theme.textHighlighted).monospacedDigit()
              Text(tile.hint).font(.system(size: 11)).foregroundStyle(Theme.textDimmed).lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
          }
        } else {
          ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: Metrics.radiusLarge).fill(Theme.elevated).frame(height: 74) }
        }
      }
      // A project's own log leaves these to the setup strip above, as on the web.
      if projectId == nil, let settings, !settings.configured {
        EmailNotice(
          systemImage: "exclamationmark.triangle",
          title: "Email sending is not configured",
          message: "Set MAILGUN_API_KEY, MAILGUN_DOMAIN and MAILGUN_FROM_EMAIL on the server; until then sends fail with 503.",
          tone: .warning
        )
      } else if projectId == nil, let settings, !settings.webhook.configured {
        EmailNotice(
          systemImage: "point.3.connected.trianglepath.dotted",
          title: "Delivery status needs the Mailgun webhook",
          message: "Set MAILGUN_WEBHOOK_SIGNING_KEY and point Mailgun's webhooks at \(settings.webhook.url) to see deliveries, opens, bounces and spam reports here."
        )
      }
    }
    .padding(.vertical, 12)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Last 30 days")
  }

  private struct Tile { let label: String; let value: Int; let hint: String }

  private func tiles(_ stats: EmailLogStats) -> [Tile] {
    let byStatus = stats.byStatus ?? [:]
    func count(_ keys: String...) -> Int { keys.reduce(0) { $0 + (byStatus[$1] ?? 0) } }
    return [
      Tile(label: "Emails", value: stats.total ?? 0, hint: "Sent or attempted in the last 30 days"),
      Tile(label: "Delivered", value: count("delivered", "opened", "clicked", "unsubscribed", "complained"), hint: settings?.webhook.configured == true ? "Accepted by the receiving server" : "Needs the Mailgun webhook"),
      Tile(label: "Failed or bounced", value: count("failed", "bounced"), hint: "Refused by Mailgun or the receiving server"),
      Tile(label: "Not sent", value: count("suppressed"), hint: "Skipped: on the suppression list")
    ]
  }

  private var batchBanner: some View {
    HStack(spacing: 8) {
      Image(systemName: "square.stack.3d.up").font(.system(size: 13)).foregroundStyle(Theme.textMuted)
      Text("Recipients of one send").font(.lnMeta).foregroundStyle(Theme.textMuted)
      Text(batch).font(.lnMono).foregroundStyle(Theme.text).lineLimit(1).truncationMode(.middle)
      Spacer(minLength: 0)
      Button("Show everything") { batch = "" }.buttonStyle(.lnGhost)
    }
    .frame(minHeight: 36)
  }

  private func row(_ entry: EmailLogEntry) -> some View {
    HStack(spacing: 4) {
      rowButton(entry)
      if entry.hasContent == true {
        IconButton(systemImage: "eye", label: "Preview the email") { previewing = entry }
      }
    }
    .contextMenu {
      Button { opened = entry } label: { Label("Open", systemImage: "info.circle") }
      if entry.hasContent == true { Button { previewing = entry } label: { Label("Preview the email", systemImage: "eye") } }
      Button { Clipboard.copy(entry.recipient) } label: { Label("Copy address", systemImage: "doc.on.doc") }
    }
    .linearRow()
  }

  private func rowButton(_ entry: EmailLogEntry) -> some View {
    Button { opened = entry } label: {
      HStack(spacing: 10) {
        EmailStatusBadge(status: entry.statusKey).frame(width: 112, alignment: .leading)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(entry.recipient).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            if entry.testMode == true {
              Image(systemName: "flask").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Test mode")
            }
          }
          HStack(spacing: 4) {
            Text(entry.subject ?? "").lineLimit(1)
            if let key = entry.template?.key, !key.isEmpty {
              Text("· \(key)").font(.lnMono).lineLimit(1)
            } else if let name = entry.template?.name, !name.isEmpty {
              Text("· \(name)").lineLimit(1)
            }
          }
          .font(.lnMeta)
          .foregroundStyle(Theme.textMuted)
          HStack(spacing: 4) {
            if projectId == nil {
              Text(projectName(entry.projectId))
              Text("·")
            }
            Text(EmailStatusText.source(entry.source))
          }
          .font(.lnCaption)
          .foregroundStyle(Theme.textDimmed)
          .lineLimit(1)
        }
        Spacer(minLength: 4)
        Text(EmailStatusText.logTime(entry.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
      }
      .padding(.vertical, 6)
      .frame(minHeight: Metrics.rowHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityHint(EmailStatusText.style(entry.statusKey).hint)
  }

  private func projectName(_ id: String?) -> String {
    guard let id, !id.isEmpty else { return "HelpBites" }
    return workspace.project(id)?.name ?? "Project"
  }

  // MARK: Data

  private func query(before: String? = nil) -> [String: String] {
    var query: [String: String] = [:]
    let current = filters
    if let projectId { query["project"] = projectId }
    if !current.to.isEmpty { query["to"] = current.to }
    if !current.status.isEmpty { query["status"] = current.status }
    if !current.source.isEmpty { query["source"] = current.source }
    if !current.template.isEmpty { query["template"] = current.template }
    if !current.batch.isEmpty { query["batch"] = current.batch }
    if let before { query["before"] = before }
    return query
  }

  private func load() async {
    do {
      let response: EmailLogList = try await session.get("/v1/admin/email-logs", query: query())
      logs = response.logs
      nextBefore = response.nextBefore
      error = ""
    } catch {
      if Task.isCancelled { return }
      self.error = error.localizedDescription.isEmpty ? "Could not load the log" : error.localizedDescription
    }
    loading = false
  }

  private func loadMore() async {
    guard let before = nextBefore else { return }
    loadingMore = true
    defer { loadingMore = false }
    do {
      let response: EmailLogList = try await session.get("/v1/admin/email-logs", query: query(before: before))
      let known = Set(logs.map(\.id))
      logs.append(contentsOf: response.logs.filter { !known.contains($0.id) })
      nextBefore = response.nextBefore
    } catch { self.error = error.localizedDescription }
  }

  private func loadStats() async {
    var query = ["days": "30"]
    if let projectId { query["project"] = projectId }
    if let result: EmailLogStats = try? await session.get("/v1/admin/email-logs/stats", query: query) { stats = result }
  }

  private func loadSettings() async {
    if let result: EmailSettings = try? await session.get("/v1/admin/email-settings") { settings = result }
  }

  private func refresh() async {
    await load()
    await loadStats()
  }
}

// MARK: - One entry

/// The full entry: who, what, which template and values, the delivery
/// timeline from Mailgun's webhook, and the message when the project keeps content.
struct EmailLogDetailSheet: View {
  let showsProject: Bool
  var onShowBatch: @MainActor (String) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var detail: EmailLogEntry
  @State private var loaded = false
  @State private var showText = false
  @State private var confirmSuppress = false
  @State private var suppressing = false
  @State private var notice = ""
  @State private var error = ""
  @State private var copied = false
  @State private var editing: EmailEditorTarget?
  @State private var fullSize = false

  init(entry: EmailLogEntry, showsProject: Bool, onShowBatch: @escaping @MainActor (String) -> Void) {
    self.showsProject = showsProject
    self.onShowBatch = onShowBatch
    _detail = State(initialValue: entry)
  }

  private var style: EmailStatusStyle { EmailStatusText.style(detail.statusKey) }

  private func projectName(_ id: String?) -> String {
    guard let id, !id.isEmpty else { return "HelpBites" }
    return workspace.project(id)?.name ?? "Project"
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          VStack(alignment: .leading, spacing: 4) {
            Text(detail.subject?.isEmpty == false ? detail.subject! : "Email").font(.lnTitle).foregroundStyle(Theme.textHighlighted).textSelection(.enabled)
            Text("To \(detail.recipient) · \(EmailStatusText.fullDate(detail.createdAt))").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
          FlowLayout(spacing: 8) {
            EmailStatusBadge(status: detail.statusKey)
            if !style.hint.isEmpty { Text(style.hint).font(.lnMeta).foregroundStyle(Theme.textMuted) }
          }
          if let message = detail.error, !message.isEmpty {
            Text(message)
              .font(.lnMono)
              .foregroundStyle(Theme.error)
              .textSelection(.enabled)
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Theme.error.opacity(0.1), in: RoundedRectangle(cornerRadius: Metrics.radius))
          }
          facts
          if let values = detail.variables, !values.isEmpty { valuesSection(values) }
          timeline
          messageSection
          actions
          if !loaded { HStack { Spacer(); ProgressView(); Spacer() } }
        }
        .padding(20)
        .frame(maxWidth: 720, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Email")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .confirmationDialog(
        "Stop sending \(projectName(detail.projectId))'s email to \(detail.recipient)?",
        isPresented: $confirmSuppress,
        titleVisibility: .visible
      ) {
        Button("Stop emailing", role: .destructive) { Task { await suppress() } }
      }
      .fullScreenCover(item: $editing) { EmailEditorScreen(target: $0) }
      .sheet(isPresented: $fullSize) { EmailLogPreviewSheet(entry: detail) }
      .task { await loadDetail() }
    }
  }

  // MARK: Sections

  private var facts: some View {
    VStack(alignment: .leading, spacing: 8) {
      fact("To") { Text(detail.toName?.isEmpty == false ? "\(detail.toName!) <\(detail.recipient)>" : detail.recipient) }
      if let cc = detail.cc, !cc.isEmpty { fact("Cc") { Text(cc.joined(separator: ", ")) } }
      if let bcc = detail.bcc, !bcc.isEmpty { fact("Bcc") { Text(bcc.joined(separator: ", ")) } }
      fact("From") { Text(detail.from ?? "") }
      if let replyTo = detail.replyTo, !replyTo.isEmpty { fact("Reply-To") { Text(replyTo) } }
      fact("Template") { templateValue }
      if showsProject { fact("Project") { Text(projectName(detail.projectId)) } }
      fact("Sent by") {
        Text(sentBy)
      }
      if let scheduled = detail.scheduledAt, !scheduled.isEmpty { fact("Scheduled for") { Text(EmailStatusText.fullDate(scheduled)) } }
      if let tags = detail.tags, !tags.isEmpty {
        fact("Tags") { FlowLayout(spacing: 4) { ForEach(tags, id: \.self) { Tag(text: $0) } } }
      }
      if let metadata = detail.metadata, !metadata.isEmpty {
        fact("Metadata") {
          VStack(alignment: .leading, spacing: 2) {
            ForEach(metadata.keys.sorted(), id: \.self) { key in
              (Text(key).font(.lnMono).foregroundStyle(Theme.textMuted) + Text(" \(EmailStatusText.plain(metadata[key]))"))
            }
          }
        }
      }
      if let files = detail.attachments, !files.isEmpty {
        fact("Attachments") {
          VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(files.enumerated()), id: \.offset) { _, file in
              HStack(spacing: 6) {
                Image(systemName: "paperclip").font(.system(size: 11)).foregroundStyle(Theme.textMuted)
                Text(file.filename ?? "file")
                Text(EmailStatusText.kilobytes(file.size ?? 0) + (file.inline == true ? " · inline" : "")).font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
            }
          }
        }
      }
      if let headers = detail.headers, !headers.isEmpty { fact("Headers") { Text(headers.joined(separator: ", ")).font(.lnMono) } }
      if let batchId = detail.batchId, !batchId.isEmpty {
        fact("Send") {
          HStack(spacing: 8) {
            Text(batchId).font(.lnMono).lineLimit(1).truncationMode(.middle)
            Button("All recipients") { onShowBatch(batchId) }.buttonStyle(.lnGhost)
          }
        }
      }
      if let messageId = detail.messageId, !messageId.isEmpty { fact("Message id") { Text(messageId).font(.lnMono) } }
      if let key = detail.idempotencyKey, !key.isEmpty { fact("Idempotency key") { Text(key).font(.lnMono) } }
      if let ip = detail.ip, !ip.isEmpty {
        fact("Request") {
          Text(ip + ((detail.userAgent ?? "").isEmpty ? "" : " · \(detail.userAgent ?? "")")).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2)
        }
      }
    }
    .font(.lnMeta)
  }

  private var sentBy: String {
    var text = EmailStatusText.source(detail.source)
    if let name = detail.actor?.name, !name.isEmpty { text += " · \(name)" }
    if detail.testMode == true { text += " · Mailgun test mode" }
    return text
  }

  @ViewBuilder private var templateValue: some View {
    if let template = detail.template {
      let name = (template.name ?? "").isEmpty ? (template.key ?? "") : (template.name ?? "")
      HStack(spacing: 8) {
        if let id = template.id, !id.isEmpty {
          Button(name) { editing = EmailEditorTarget(id: id, name: name) }
            .buttonStyle(.plain)
            .underline(pattern: .dot)
            .foregroundStyle(Theme.textHighlighted)
        } else {
          Text(name)
        }
        if let key = template.key, !key.isEmpty { Text(key).font(.lnMono).foregroundStyle(Theme.textMuted) }
      }
    } else {
      Text(kindLabel).foregroundStyle(Theme.textMuted)
    }
  }

  private var kindLabel: String {
    switch detail.kind {
    case "html": "Custom HTML"
    case "document": "Block document"
    case "message": "Message layout"
    default: "—"
    }
  }

  private func fact<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text(label).foregroundStyle(Theme.textMuted).frame(width: 112, alignment: .leading)
      content()
        .foregroundStyle(Theme.text)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func valuesSection(_ values: [EmailLogValue]) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Values it was sent with")
      Card {
        ForEach(Array(values.enumerated()), id: \.offset) { index, item in
          CardRow(divider: index < values.count - 1) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
              Text(item.key).font(.lnMono).foregroundStyle(Theme.text).lineLimit(1).frame(width: 130, alignment: .leading)
              let value = EmailStatusText.plain(item.value)
              if value == "[redacted]" {
                Label("Not kept: links, codes and tokens stay out of the log", systemImage: "lock")
                  .font(.lnCaption)
                  .foregroundStyle(Theme.textDimmed)
              } else {
                Text(value).font(.lnCaption).foregroundStyle(Theme.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
              }
            }
          }
        }
      }
    }
  }

  private var timeline: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Timeline")
      timelineRow(
        systemImage: "paperplane",
        text: detail.statusKey == "failed" ? "Refused by Mailgun" : detail.statusKey == "suppressed" ? "Skipped" : "Handed to Mailgun",
        detail: "",
        at: detail.createdAt
      )
      ForEach(Array((detail.events ?? []).enumerated()), id: \.offset) { _, event in
        let type = event.type ?? ""
        let known = EmailStatusText.known(type)
        timelineRow(
          systemImage: known?.systemImage ?? "hourglass",
          text: known?.label ?? (type == "deferred" ? "Delayed, will retry" : type),
          detail: event.detail ?? "",
          at: event.at
        )
      }
    }
  }

  private func timelineRow(systemImage: String, text: String, detail: String, at: String?) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: systemImage).font(.system(size: 12)).foregroundStyle(Theme.textMuted).frame(width: 16)
      (Text(text).foregroundStyle(Theme.text) + Text(detail.isEmpty ? "" : " · \(detail)").foregroundStyle(Theme.textMuted))
        .frame(maxWidth: .infinity, alignment: .leading)
      Text(EmailStatusText.fullDate(at)).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .font(.lnMeta)
  }

  @ViewBuilder private var messageSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        SectionLabel("The message")
        if let html = detail.html, !html.isEmpty {
          Button(showText ? "HTML" : "Plain text") { showText.toggle() }.buttonStyle(.lnGhost)
          Button { fullSize = true } label: { Label("Full size", systemImage: "arrow.up.left.and.arrow.down.right") }.buttonStyle(.lnGhost)
        }
      }
      if let html = detail.html, !html.isEmpty {
        if showText {
          ScrollView {
            Text(detail.text ?? "")
              .font(.lnMono)
              .foregroundStyle(Theme.text)
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(12)
          }
          .frame(maxHeight: 384)
          .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
        } else {
          SandboxedWebView(html: html)
            .frame(height: 448)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
        }
      } else if loaded {
        Text((try? AttributedString(markdown: "This project doesn't keep message content. Turn on **Keep a copy of each email in the log** under Email → Settings to see future messages here.")) ?? AttributedString(""))
          .font(.lnCaption)
          .foregroundStyle(Theme.textMuted)
      }
    }
  }

  private var actions: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !notice.isEmpty { EmailNotice(systemImage: "envelope.badge.shield.half.filled", title: notice, tone: .success) }
      ErrorText(message: error)
      HStack(spacing: 8) {
        if detail.projectId?.isEmpty == false, detail.statusKey != "suppressed" {
          Button { confirmSuppress = true } label: {
            if suppressing { ProgressView() } else { Label("Stop emailing this address", systemImage: "envelope.badge.shield.half.filled") }
          }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(suppressing)
        }
        Button {
          Clipboard.copy(detail.id)
          copied = true
        } label: { Label(copied ? "Copied" : "Copy entry id", systemImage: copied ? "checkmark" : "doc.on.clipboard") }
          .buttonStyle(.lnGhost)
        Spacer(minLength: 0)
      }
    }
    .padding(.top, 16)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 0.5) }
  }

  // MARK: Actions

  private func loadDetail() async {
    do {
      let response: EmailLogResponse = try await session.get("/v1/admin/email-logs/\(detail.id)")
      detail = response.log
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription.isEmpty ? "Could not open this entry" : error.localizedDescription }
    }
    loaded = true
  }

  private func suppress() async {
    guard let projectId = detail.projectId, !projectId.isEmpty else { return }
    suppressing = true
    error = ""
    defer { suppressing = false }
    do {
      let _: EmailSuppressionAddResult = try await session.send("/v1/admin/email-suppressions", body: EmailSuppressionInput(project: projectId, emails: [detail.recipient], reason: "manual", detail: "Added from the email log"))
      notice = "\(detail.recipient) won't get this project's email"
    } catch { self.error = error.localizedDescription }
  }
}


// MARK: - The sent message, full size

/// The message as it went out (EmailLogView.vue's preview modal). A list row
/// has no body, so it's fetched on open; a project that doesn't keep content has none.
struct EmailLogPreviewSheet: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var entry: EmailLogEntry
  @State private var error = ""

  init(entry: EmailLogEntry) { _entry = State(initialValue: entry) }

  var body: some View {
    NavigationStack {
      Group {
        if let html = entry.html, !html.isEmpty {
          SandboxedWebView(html: html).background(Color.white)
        } else if !error.isEmpty {
          EmptyState(systemImage: "envelope", title: "Could not load the message", message: error).frame(maxHeight: .infinity)
        } else {
          ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .panelScreen(entry.subject?.isEmpty == false ? entry.subject! : "Email")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .task {
        guard entry.html?.isEmpty != false else { return }
        do {
          let response: EmailLogResponse = try await session.get("/v1/admin/email-logs/\(entry.id)")
          if response.log.html?.isEmpty == false { entry = response.log } else { error = "This message wasn't kept." }
        } catch { self.error = error.localizedDescription }
      }
    }
    #if os(macOS)
    .frame(minWidth: 640, minHeight: 640)
    #endif
  }
}
