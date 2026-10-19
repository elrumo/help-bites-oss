import SwiftUI

/// Broadcasts and automated sequences (web: projects/[id]/campaigns). Settings
/// (topics, postal address, sign-up form) and sequence editing are on the web.
struct CampaignsScreen: View {
  let projectId: String
  @State private var tab = "campaigns"

  var body: some View {
    VStack(spacing: 0) {
      Picker("Section", selection: $tab) {
        Text("Campaigns").tag("campaigns")
        Text("Sequences").tag("sequences")
      }
      .pickerStyle(.segmented)
      .padding(.horizontal, Metrics.gutter).padding(.vertical, 8)
      if tab == "sequences" { SequencesList(projectId: projectId) } else { CampaignsList(projectId: projectId) }
    }
    .projectScreen(projectId, "Campaigns")
  }
}

private struct CampaignsList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var campaigns: [Campaign] = []
  @State private var loading = true
  @State private var error = ""
  @State private var open: Campaign?
  @State private var creating = false

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && campaigns.isEmpty { SkeletonRows(count: 4).linearRow() }
      else if campaigns.isEmpty {
        EmptyState(systemImage: "megaphone", title: "No campaigns yet", message: "Send a newsletter or an announcement to your subscribers — everyone, a segment, or one topic's readers.") {
          Button("New campaign") { creating = true }.buttonStyle(.lnPrimary)
        }
        .linearRow()
      }
      ForEach(campaigns) { campaign in
        Button { open = campaign } label: {
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              Text(campaign.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
              Text(campaign.templateName.isEmpty ? "No template" : campaign.templateName).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if campaign.stats.sent > 0 { Text("\(campaign.stats.sent) · \(percent(campaign.stats.opened, max(campaign.stats.delivered, campaign.stats.sent))) opened").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
            Tag(text: CampaignStatusStyle.label(campaign.status), tint: CampaignStatusStyle.tint(campaign.status))
          }
          .frame(minHeight: Metrics.rowHeight)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .linearRow()
      }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button { creating = true } label: { Label("New campaign", systemImage: "plus") } }
    }
    .sheet(item: $open, onDismiss: { Task { await load() } }) { CampaignDetailSheet(projectId: projectId, campaign: $0) }
    .sheet(isPresented: $creating, onDismiss: { Task { await load() } }) { NewCampaignSheet(projectId: projectId) }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let campaigns: [Campaign] }
    loading = true
    defer { loading = false }
    do {
      campaigns = (try await session.get("/v1/campaigns", query: ["project": projectId]) as Response).campaigns
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }
}

/// One campaign: its numbers once it goes, and what can happen next.
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
  @State private var testTo = ""

  var body: some View {
    NavigationStack {
      Form {
        if !campaign.lastError.isEmpty { Section { Text(campaign.lastError).font(.lnMeta).foregroundStyle(Theme.error) } }
        if campaign.editable && !problems.isEmpty {
          Section("Before it can go") { ForEach(problems, id: \.self) { Text($0).font(.lnMeta).foregroundStyle(Theme.warning) } }
        }
        if campaign.startedAt != nil {
          Section("How it did") {
            let s = campaign.stats
            LabeledContent("Audience", value: "\(s.audience)")
            LabeledContent("Sent", value: "\(s.sent)")
            LabeledContent("Delivered", value: percent(s.delivered, s.sent))
            LabeledContent("Opened", value: percent(s.opened, max(s.delivered, s.sent)))
            LabeledContent("Clicked", value: percent(s.clicked, max(s.delivered, s.sent)))
            LabeledContent("Unsubscribed", value: "\(s.unsubscribed)")
            LabeledContent("Bounced", value: "\(s.bounced)")
            LabeledContent("Skipped", value: "\(s.suppressed + s.failed)")
            if campaign.status == "sending" { ProgressView(value: Double(s.sent + s.suppressed + s.failed), total: Double(max(s.audience, 1))) }
          }
        }
        Section {
          LabeledContent("Template", value: campaign.templateName.isEmpty ? "—" : campaign.templateName)
          if !campaign.subject.isEmpty { LabeledContent("Subject", value: campaign.subject) }
          if let count = audienceCount { LabeledContent("Would reach now", value: "\(count)") }
          if let at = campaign.scheduledAt, campaign.status == "scheduled" { LabeledContent("Goes out", value: DateText.day(at)) }
          if campaign.testMode { Text("Test mode: Mailgun logs every message but delivers none.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        } footer: { Text("Edit the content and audience on the web.") }

        if campaign.editable || campaign.status == "paused" {
          Section("Send a test") {
            TextField("you@example.com", text: $testTo).keyboardType(.emailAddress).textInputAutocapitalization(.never)
            Button("Send test") { Task { await test() } }.disabled(testTo.isEmpty || busy)
          }
        }
        Section {
          ErrorText(message: error)
          switch campaign.status {
          case "draft":
            Button("Send now") { Task { await move("sending") } }.disabled(!problems.isEmpty || busy)
            Button("Schedule…") { scheduleOpen = true }.disabled(!problems.isEmpty || busy)
          case "scheduled":
            Button("Send now") { Task { await move("sending") } }.disabled(busy)
            Button("Unschedule") { Task { await move("draft") } }.disabled(busy)
          case "sending": Button("Pause") { Task { await move("paused") } }.disabled(busy)
          case "paused": Button("Resume") { Task { await move("sending") } }.disabled(busy)
          default: EmptyView()
          }
          if ["scheduled", "sending", "paused"].contains(campaign.status) { Button("Cancel campaign", role: .destructive) { Task { await move("canceled") } } }
        }
      }
      .navigationTitle(campaign.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .sheet(isPresented: $scheduleOpen) {
        NavigationStack {
          Form { DatePicker("Send at", selection: $scheduleAt, in: Date()...) }
            .navigationTitle("Schedule")
            .toolbar {
              ToolbarItem(placement: .cancellationAction) { Button("Cancel") { scheduleOpen = false } }
              ToolbarItem(placement: .confirmationAction) { Button("Schedule") { Task { await move("scheduled", at: scheduleAt); scheduleOpen = false } } }
            }
        }
        .presentationDetents([.medium])
      }
    }
    .task { await load() }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let campaign: Campaign; let audienceCount: Int?; let problems: [String] }
    do {
      let response: Response = try await session.get("/v1/campaigns/\(campaign.id)", query: ["project": projectId])
      campaign = response.campaign
      audienceCount = response.audienceCount
      problems = response.problems
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private func move(_ status: String, at: Date? = nil) async {
    struct Input: Encodable, Sendable { let project, status: String; let scheduledAt: String? }
    struct Output: Decodable, Sendable { let campaign: Campaign }
    busy = true
    defer { busy = false }
    do {
      let output: Output = try await session.send("/v1/campaigns/\(campaign.id)", method: "PATCH", body: Input(project: projectId, status: status, scheduledAt: at.map { DateText.iso.string(from: $0) }))
      campaign = output.campaign
      error = ""
      await load()
    } catch { self.error = error.localizedDescription }
  }

  private func test() async {
    struct Input: Encodable, Sendable { let project: String; let to: [String] }
    struct Output: Decodable, Sendable { let sent: Int; let failed: [String] }
    busy = true
    defer { busy = false }
    do {
      let output: Output = try await session.send("/v1/campaigns/\(campaign.id)/test", body: Input(project: projectId, to: testTo.split(whereSeparator: { $0 == "," || $0 == " " }).map(String.init)))
      error = output.failed.isEmpty ? "" : "Failed for \(output.failed.joined(separator: ", "))"
    } catch { self.error = error.localizedDescription }
  }
}

/// A draft: name, template, audience. Scheduling and sending are on its detail.
struct NewCampaignSheet: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var template = ""
  @State private var segment = ""
  @State private var topic = ""
  @State private var templates: [(key: String, name: String)] = []
  @State private var segments: [ContactSegment] = []
  @State private var topics: [MarketingTopic] = []
  @State private var error = ""
  @State private var saving = false

  var body: some View {
    NavigationStack {
      Form {
        TextField("Name", text: $name)
        Picker("Template", selection: $template) {
          Text("Pick one").tag("")
          ForEach(templates, id: \.key) { Text($0.name).tag($0.key) }
        }
        Picker("Audience", selection: $segment) {
          Text("All subscribers").tag("")
          ForEach(segments) { Text($0.name).tag($0.id) }
        }
        if !topics.isEmpty {
          Picker("Topic", selection: $topic) {
            Text("Any topic").tag("")
            ForEach(topics) { Text($0.name).tag($0.key) }
          }
        }
        ErrorText(message: error)
      }
      .navigationTitle("New campaign")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Create") { Task { await create() } }.disabled(name.isEmpty || saving) }
      }
    }
    .task { await load() }
  }

  private func load() async {
    struct Templates: Decodable, Sendable {
      struct Row: Decodable, Sendable { let id, key, name: String; let master: Master?; struct Master: Decodable, Sendable { let name: String } }
      let templates: [Row]
    }
    struct Segments: Decodable, Sendable { let segments: [ContactSegment] }
    struct Projects: Decodable, Sendable {
      struct Row: Decodable, Sendable { let id: String; let marketing: Marketing?; struct Marketing: Decodable, Sendable { let topics: [MarketingTopic] } }
      let projects: [Row]
    }
    do {
      let t: Templates = try await session.get("/v1/admin/emails", query: ["project": projectId])
      templates = t.templates.map { (key: $0.key.isEmpty ? $0.id : $0.key, name: $0.master?.name ?? $0.name) }
      segments = (try await session.get("/v1/segments", query: ["project": projectId]) as Segments).segments
      topics = (try await session.get("/v1/admin/projects") as Projects).projects.first { $0.id == projectId }?.marketing?.topics ?? []
    } catch { self.error = error.localizedDescription }
  }

  private func create() async {
    struct Input: Encodable, Sendable { let project, name, template: String; let audience: CampaignAudience }
    struct Output: Decodable, Sendable { let campaign: Campaign }
    saving = true
    defer { saving = false }
    do {
      let _: Output = try await session.send("/v1/campaigns", body: Input(project: projectId, name: name, template: template, audience: CampaignAudience(segment: segment, topic: topic)))
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

private struct SequencesList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var sequences: [EmailSequence] = []
  @State private var loading = true
  @State private var error = ""

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && sequences.isEmpty { SkeletonRows(count: 3).linearRow() }
      else if sequences.isEmpty { EmptyState(systemImage: "point.3.connected.trianglepath.dotted", title: "No sequences yet", message: "Build one on the web: a welcome series for new subscribers, onboarding when a trial starts.").linearRow() }
      ForEach(sequences) { sequence in
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 2) {
            Text(sequence.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Text("\(sequence.triggerText) · \(sequence.steps.count) emails · \(sequence.stats.active) on it, \(sequence.stats.completed) finished").font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
          }
          Spacer(minLength: 8)
          if sequence.status == "active" {
            Button("Pause") { Task { await set(sequence, "paused") } }.buttonStyle(.lnSecondaryCompact)
          } else {
            Button("Activate") { Task { await set(sequence, "active") } }.buttonStyle(.lnPrimaryCompact)
          }
        }
        .frame(minHeight: Metrics.rowHeight)
        .linearRow()
      }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let sequences: [EmailSequence] }
    loading = true
    defer { loading = false }
    do {
      sequences = (try await session.get("/v1/sequences", query: ["project": projectId]) as Response).sequences
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private func set(_ sequence: EmailSequence, _ status: String) async {
    struct Input: Encodable, Sendable { let project, status: String }
    struct Output: Decodable, Sendable { let sequence: EmailSequence }
    do {
      let output: Output = try await session.send("/v1/sequences/\(sequence.id)", method: "PATCH", body: Input(project: projectId, status: status))
      sequences = sequences.map { $0.id == sequence.id ? output.sequence : $0 }
      error = ""
    } catch { self.error = error.localizedDescription }
  }
}
