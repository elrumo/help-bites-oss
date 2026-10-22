import SwiftUI

/// One campaign (web: campaigns/[campaignId].vue): what it sends, to whom, when, and once it
/// goes, how it did. Drafts and scheduled campaigns autosave 800 ms after the last edit.
struct CampaignDetailSheet: View {
  let projectId: String
  @State var campaign: Campaign
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var audienceCount: Int?
  @State private var problems: [String] = []
  @State private var error = ""
  @State private var busy = false
  @State private var scheduleOpen = false
  @State private var scheduleAt = Date().addingTimeInterval(3600)
  @State private var testOpen = false
  @State private var testTo = ""
  @State private var testMessage = ""
  @State private var testFailed = false
  @State private var confirmSend = false
  @State private var confirmDelete = false
  @State private var confirmCancel = false

  // The editable form; the campaign is the last thing the server returned.
  @State private var name = ""
  @State private var template = ""
  @State private var subject = ""
  @State private var segment = ""
  @State private var topic = ""
  @State private var testMode = false
  @State private var formLoaded = false

  @State private var templates: [MarketingTemplate] = []
  @State private var segments: [ContactSegment] = []
  @State private var topics: [MarketingTopic] = []

  private var editable: Bool { campaign.editable }
  private var formKey: String { [name, template, subject, segment, topic, String(testMode)].joined(separator: "\u{1f}") }
  private var dirty: Bool {
    name != campaign.name || template != campaign.template || subject != campaign.subject
      || segment != campaign.audience.segment || topic != campaign.audience.topic || testMode != campaign.testMode
  }

  var body: some View {
    NavigationStack {
      Form {
        if !campaign.lastError.isEmpty { Section { Text(campaign.lastError).font(.lnMeta).foregroundStyle(Theme.error) } }
        if editable && !problems.isEmpty {
          Section("Before it can go") { ForEach(problems, id: \.self) { Label($0, systemImage: "exclamationmark.shield").font(.lnMeta).foregroundStyle(Theme.warning) } }
        }
        if campaign.status == "scheduled", let at = campaign.scheduledAt, let date = DateText.date(at) {
          Section { Text("Goes out \(date.formatted(date: .abbreviated, time: .shortened)).").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        }
        if campaign.startedAt != nil { statsSection }

        Section {
          TextField("Name", text: $name)
          Picker("Template", selection: $template) {
            Text("Pick a template").tag("")
            ForEach(templates) { Text($0.title).tag($0.ref) }
            if !template.isEmpty, !templates.contains(where: { $0.ref == template }) { Text(campaign.templateName.isEmpty ? template : campaign.templateName).tag(template) }
          }
          TextField("Subject (optional; overrides the template's)", text: $subject)
          Picker("Audience", selection: $segment) {
            Text("All subscribers").tag("")
            ForEach(segments) { Text($0.name).tag($0.id) }
          }
          Picker("Topic", selection: $topic) {
            Text("Any topic").tag("")
            ForEach(topics) { Text($0.name).tag($0.key) }
          }
          .disabled(topics.isEmpty)
          Toggle("Test mode", isOn: $testMode)
        } header: {
          Text("Campaign")
        } footer: {
          VStack(alignment: .leading, spacing: 4) {
            if let count = audienceCount { Text("\(count.formatted()) subscribed \(count == 1 ? String(localized: "contact") : String(localized: "contacts")) would get it now.") }
            Text("Its design is frozen when sending starts. Test mode: Mailgun accepts and logs every message but delivers none.")
            if !editable { Text("A \(CampaignStatusStyle.label(campaign.status).lowercased()) campaign can no longer be edited.") }
          }
        }
        .disabled(!editable)

        Section {
          if !template.isEmpty {
            NavigationLink { CampaignPreviewView(projectId: projectId, template: template, subject: subject) } label: { Label("Preview", systemImage: "eye") }
          }
          if campaign.startedAt != nil {
            NavigationLink { CampaignRecipientsView(projectId: projectId, campaign: campaign) } label: { Label("See every recipient", systemImage: "list.bullet") }
          }
        }

        actions
      }
      .formStyle(.grouped)
      .navigationTitle(campaign.name.isEmpty ? String(localized: "Campaign") : campaign.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .primaryAction) {
          HStack(spacing: 8) {
            Tag(text: CampaignStatusStyle.label(campaign.status), tint: CampaignStatusStyle.tint(campaign.status))
            if campaign.status != "sending" {
              Button(role: .destructive) { confirmDelete = true } label: { Image(systemName: "trash") }.accessibilityLabel("Delete campaign")
            }
          }
        }
      }
      .sheet(isPresented: $scheduleOpen) { scheduleSheet }
      .sheet(isPresented: $testOpen) { testSheet }
      .confirmationDialog("Send “\(name)” to \(audienceCount?.formatted() ?? String(localized: "everyone in the audience")) now?\(testMode ? String(localized: " (Test mode: nothing is delivered.)") : "")", isPresented: $confirmSend, titleVisibility: .visible) {
        Button("Send now") { Task { await move("sending") } }
      }
      .confirmationDialog("Delete this campaign? The email log keeps what was sent.", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete campaign", role: .destructive) { Task { await remove() } }
      }
      .confirmationDialog("Cancel this campaign?", isPresented: $confirmCancel, titleVisibility: .visible) {
        Button("Cancel campaign", role: .destructive) { Task { await move("canceled") } }
        Button("Keep it", role: .cancel) {}
      } message: { Text("Nothing more is sent. This can't be undone.") }
    }
    #if os(macOS)
    .frame(minWidth: 560, minHeight: 640)
    #endif
    .task {
      load(campaign)
      await reload()
      async let t = MarketingTemplate.load(projectId, session: session)
      async let s: [ContactSegment] = (try? await session.get("/v1/segments", query: ["project": projectId]) as SegmentsResponse)?.segments ?? []
      async let p = try? await MarketingProject.load(projectId, session: session)
      let (loadedTemplates, loadedSegments, project) = await (t, s, p)
      templates = loadedTemplates; segments = loadedSegments; topics = project?.marketing?.topics ?? []
    }
    // Numbers move while it sends, and for days after as opens come in.
    .task(id: campaign.status) {
      while campaign.status == "sending" || campaign.status == "scheduled", !Task.isCancelled {
        try? await Task.sleep(for: .seconds(5))
        if !busy { await reload() }
      }
    }
    // Autosave: only what you changed, not what a reload put back.
    .task(id: formKey) {
      guard formLoaded, editable, dirty else { return }
      try? await Task.sleep(for: .milliseconds(800))
      guard !Task.isCancelled else { return }
      _ = await save()
    }
  }

  private struct SegmentsResponse: Decodable, Sendable { let segments: [ContactSegment] }

  // MARK: Sections

  private var statsSection: some View {
    let s = campaign.stats
    return Section("How it did") {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
        tile("Audience", s.audience.formatted())
        tile("Sent", s.sent.formatted())
        tile("Delivered", percent(s.delivered, s.sent))
        tile("Opened", percent(s.opened, s.delivered > 0 ? s.delivered : s.sent))
        tile("Clicked", percent(s.clicked, s.delivered > 0 ? s.delivered : s.sent))
        tile("Unsubscribed", s.unsubscribed.formatted())
        tile("Bounced", s.bounced.formatted())
        tile("Skipped", (s.suppressed + s.failed).formatted())
      }
      .padding(.vertical, 4)
      if campaign.status == "sending" { ProgressView(value: Double(min(s.sent + s.suppressed + s.failed, max(s.audience, 1))), total: Double(max(s.audience, 1))) }
    }
  }

  private func tile(_ label: LocalizedStringKey, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value).font(.system(size: 18, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted)
      Text(label).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  @ViewBuilder private var actions: some View {
    Section {
      ErrorText(message: error)
      switch campaign.status {
      case "draft":
        Button("Send test…") { openTest() }.disabled(template.isEmpty || busy)
        Button("Schedule…") { scheduleOpen = true }.disabled(!problems.isEmpty || dirty || busy)
        Button("Send now") { confirmSend = true }.disabled(!problems.isEmpty || dirty || busy)
      case "scheduled":
        Button("Send test…") { openTest() }.disabled(template.isEmpty || busy)
        Button("Send now") { confirmSend = true }.disabled(!problems.isEmpty || dirty || busy)
        Button("Unschedule") { Task { await move("draft") } }.disabled(busy)
      case "sending": Button("Pause") { Task { await move("paused") } }.disabled(busy)
      case "paused":
        Button("Send test…") { openTest() }.disabled(template.isEmpty || busy)
        Button("Resume") { Task { await move("sending") } }.disabled(busy)
      default: EmptyView()
      }
      if ["scheduled", "sending", "paused"].contains(campaign.status) {
        Button("Cancel campaign", role: .destructive) { confirmCancel = true }.disabled(busy)
      }
    }
  }

  private var scheduleSheet: some View {
    NavigationStack {
      Form {
        DatePicker("Send at", selection: $scheduleAt, in: Date()...)
        Text("It goes out at this time, to whoever is subscribed and in the audience then.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      .formStyle(.grouped)
      .navigationTitle("Schedule")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { scheduleOpen = false } }
        ToolbarItem(placement: .confirmationAction) { Button("Schedule") { Task { if await move("scheduled", at: scheduleAt) { scheduleOpen = false } } }.disabled(busy) }
      }
    }
    .presentationDetents([.medium])
    #if os(macOS)
    .frame(minWidth: 380, minHeight: 220)
    #endif
  }

  private var testSheet: some View {
    NavigationStack {
      Form {
        TextField("you@example.com", text: $testTo).inputHints(.emailAddress, capitalization: .never).autocorrectionDisabled()
        Text("Up to five addresses, separated by commas. A contact's own values fill in.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if !testMessage.isEmpty { Text(testMessage).font(.lnMeta).foregroundStyle(testFailed ? Theme.error : Theme.success) }
      }
      .formStyle(.grouped)
      .navigationTitle("Send a test")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { testOpen = false } }
        ToolbarItem(placement: .confirmationAction) { Button("Send test") { Task { await sendTest() } }.disabled(testTo.trimmingCharacters(in: .whitespaces).isEmpty || busy) }
      }
    }
    .presentationDetents([.medium])
    #if os(macOS)
    .frame(minWidth: 400, minHeight: 240)
    #endif
  }

  // MARK: Calls

  private func load(_ value: Campaign) {
    campaign = value
    name = value.name; template = value.template; subject = value.subject
    segment = value.audience.segment; topic = value.audience.topic; testMode = value.testMode
    formLoaded = true
  }

  /// Re-read the campaign. The form only follows when you have no unsaved edits.
  private func reload() async {
    struct Response: Decodable, Sendable { let campaign: Campaign; let audienceCount: Int?; let problems: [String] }
    do {
      let response: Response = try await session.get("/v1/campaigns/\(campaign.id)", query: ["project": projectId])
      if dirty { campaign = response.campaign } else { load(response.campaign) }
      audienceCount = response.audienceCount
      problems = response.problems
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private struct Patch: Encodable, Sendable {
    let project: String
    var name, template, subject: String?
    var audience: CampaignAudience?
    var testMode: Bool?
    var status: String?
    var scheduledAt: String?
  }
  private struct PatchOutput: Decodable, Sendable { let campaign: Campaign }

  private func save() async -> Bool {
    busy = true
    defer { busy = false }
    do {
      let output: PatchOutput = try await session.send("/v1/campaigns/\(campaign.id)", method: "PATCH", body: Patch(project: projectId, name: name, template: template, subject: subject, audience: CampaignAudience(segment: segment, topic: topic), testMode: testMode))
      campaign = output.campaign
      error = ""
      await reload()
      return true
    } catch { self.error = error.localizedDescription; return false }
  }

  @discardableResult
  private func move(_ status: String, at: Date? = nil) async -> Bool {
    busy = true
    defer { busy = false }
    do {
      let output: PatchOutput = try await session.send("/v1/campaigns/\(campaign.id)", method: "PATCH", body: Patch(project: projectId, status: status, scheduledAt: at.map { DateText.iso.string(from: $0) }))
      load(output.campaign)
      error = ""
      await reload()
      return true
    } catch { self.error = error.localizedDescription; return false }
  }

  private func openTest() {
    if testTo.isEmpty { testTo = session.agent?.email ?? "" }
    testMessage = ""; testFailed = false
    testOpen = true
  }

  private func sendTest() async {
    struct Input: Encodable, Sendable { let project: String; let to: [String] }
    struct Output: Decodable, Sendable { let sent: Int; let failed: [String] }
    busy = true
    defer { busy = false }
    do {
      let recipients = testTo.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "\n" }).map(String.init)
      let output: Output = try await session.send("/v1/campaigns/\(campaign.id)/test", body: Input(project: projectId, to: recipients))
      testFailed = !output.failed.isEmpty
      testMessage = output.failed.isEmpty ? String(localized: "Test sent to \(output.sent).") : String(localized: "Failed for \(output.failed.joined(separator: ", ")).")
    } catch { testFailed = true; testMessage = String(localized: "Failed: \(error.localizedDescription)") }
  }

  private func remove() async {
    do {
      try await session.delete("/v1/campaigns/\(campaign.id)?project=\(projectId)")
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

/// The send API's own render of the template, with sample links (web: the preview pane).
struct CampaignPreviewView: View {
  let projectId: String
  let template: String
  let subject: String
  @Environment(SessionStore.self) private var session
  @State private var html = ""
  @State private var failed = false

  var body: some View {
    Group {
      if !html.isEmpty { SandboxedWebView(html: html) }
      else if failed { EmptyState(systemImage: "eye.slash", title: "No preview", message: "The template could not be rendered here. Send yourself a test to see it.") }
      else { SkeletonRows(count: 5) }
    }
    .background(Theme.panel)
    .navigationTitle("Preview")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      struct Input: Encodable, Sendable { let project, template: String; let subject: String?; let variables: [String: String] }
      struct Output: Decodable, Sendable { let html: String }
      do {
        let output: Output = try await session.send("/v1/emails/render", body: Input(project: projectId, template: template, subject: subject.isEmpty ? nil : subject, variables: ["unsubscribeUrl": "#", "preferencesUrl": "#"]))
        html = output.html
      } catch { failed = true }
    }
  }
}

/// Every message the campaign sent (web: the email log filtered by the campaign's batch `cm_<id>`).
struct CampaignRecipientsView: View {
  let projectId: String
  let campaign: Campaign
  @Environment(SessionStore.self) private var session
  @State private var logs: [EmailLogEntry] = []
  @State private var nextBefore: String?
  @State private var loading = true
  @State private var loadingMore = false
  @State private var error = ""

  private struct Page: Decodable, Sendable { let logs: [EmailLogEntry]; let nextBefore: String? }

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      ForEach(logs) { entry in
        HStack(spacing: 10) {
          VStack(alignment: .leading, spacing: 2) {
            Text(entry.to ?? "").font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            if let failure = entry.error, !failure.isEmpty { Text(failure).font(.lnCaption).foregroundStyle(Theme.error).lineLimit(1) }
          }
          Spacer(minLength: 8)
          EmailStatusBadge(status: entry.status ?? "")
          Text(DateText.short(entry.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(minWidth: 28, alignment: .trailing)
        }
        .frame(minHeight: Metrics.rowHeight)
        .linearRow()
        .onAppear { if entry.id == logs.last?.id { Task { await more() } } }
      }
      if loadingMore { ProgressView().frame(maxWidth: .infinity).linearRow() }
    }
    .linearList()
    .overlay {
      if logs.isEmpty {
        if loading { SkeletonRows(count: 6).frame(maxHeight: .infinity, alignment: .top) }
        else { EmptyState(systemImage: "envelope", title: "No messages yet", message: "Recipients appear here as the campaign sends.") }
      }
    }
    .refreshable { await load() }
    .task { await load() }
    .panelScreen("Recipients")
  }

  private func query() -> [String: String] { ["project": projectId, "batch": "cm_\(campaign.id)", "limit": "50"] }

  private func load() async {
    do {
      let page: Page = try await session.get("/v1/admin/email-logs", query: query())
      logs = page.logs; nextBefore = page.nextBefore; error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func more() async {
    guard let before = nextBefore, !loadingMore else { return }
    loadingMore = true
    defer { loadingMore = false }
    var query = query()
    query["before"] = before
    do {
      let page: Page = try await session.get("/v1/admin/email-logs", query: query)
      let known = Set(logs.map(\.id))
      logs += page.logs.filter { !known.contains($0.id) }
      nextBefore = page.nextBefore
    } catch { self.error = error.localizedDescription }
  }
}
