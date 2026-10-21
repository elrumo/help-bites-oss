import SwiftUI
import UniformTypeIdentifiers

// The changelog's side sheets: a release, the project's options, writing entries
// from commits, subscribers and email, and importing from another system.

/// Chrome shared by the sheets: a navigation bar with Close, centred content on wide screens.
private struct ChangelogSheetFrame<Content: View, Trailing: View>: View {
  let title: String
  @ViewBuilder let content: () -> Content
  @ViewBuilder let trailing: () -> Trailing
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18, content: content)
          .frame(maxWidth: 560, alignment: .leading)
          .padding(20)
          .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { trailing() }
      }
    }
    .presentationDetents([.large])
    .changelogSheetSize()
  }
}

private func hint(_ text: String) -> some View {
  Text(text).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
}

// MARK: - Release

struct ChangelogReleaseSheet: View {
  let store: ChangelogStore
  let releaseId: String?
  @State private var version: String
  @State private var title: String
  @State private var summary: String
  @State private var saving = false
  @State private var confirmDelete = false
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss

  init(store: ChangelogStore, releaseId: String?) {
    self.store = store
    self.releaseId = releaseId
    let release = releaseId.flatMap { store.release($0) }
    _version = State(initialValue: release?.version ?? "")
    _title = State(initialValue: release?.title ?? "")
    _summary = State(initialValue: release?.summary ?? "")
  }

  private var release: ChangelogRelease? { releaseId.flatMap { store.release($0) } }

  var body: some View {
    ChangelogSheetFrame(title: release.map { "Release \($0.version)" } ?? "New release") {
      hint("A version that groups entries. Nothing in it is public until the release is.")
      LabeledField(label: "Version", hint: "Free text: 2.4, 2026.10…") {
        TextField("2.4", text: $version).textFieldStyle(.linear)
          .onChange(of: version) { _, value in if value.count > 60 { version = String(value.prefix(60)) } }
      }
      LabeledField(label: "Title", hint: "Optional headline") { TextField("The autumn release", text: $title).textFieldStyle(.linear) }
      LabeledField(label: "Summary", hint: "Optional intro, Markdown") { LinearTextEditor(text: $summary, minHeight: 90) }
      ErrorText(message: error)
      if release != nil {
        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete release", systemImage: "trash") }.buttonStyle(.lnGhost).tint(Theme.error)
      }
    } trailing: {
      Button(release == nil ? "Create release" : "Save") { Task { await save() } }
        .disabled(version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
    }
    .confirmationDialog("Delete this release?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete release", role: .destructive) { Task { await delete() } }
    } message: {
      Text("Its entries stay, as entries of no release.")
    }
  }

  private func save() async {
    saving = true
    defer { saving = false }
    error = ""
    do {
      try await store.saveRelease(id: releaseId, version: version.trimmingCharacters(in: .whitespacesAndNewlines), title: title, summary: summary)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete() async {
    guard let releaseId else { return }
    do {
      try await store.deleteRelease(releaseId)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: - Options

struct ChangelogSettingsSheet: View {
  let store: ChangelogStore
  @State private var settings: ChangelogSettings
  @State private var areas: String
  @State private var notifyEmails: String
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""

  init(store: ChangelogStore) {
    self.store = store
    _settings = State(initialValue: store.settings)
    _areas = State(initialValue: store.settings.areas.joined(separator: ", "))
    _notifyEmails = State(initialValue: store.settings.commentNotify.joined(separator: ", "))
  }

  var body: some View {
    ChangelogSheetFrame(title: "Changelog settings") {
      hint("How entries get started, and who can see and follow the changelog. Switches save as you change them.")
      Card {
        CardRow { toggle("Draft entries automatically", "A feedback post or planning item reaching a done status gets a draft entry, unless one already links it. Drafts are never published for you. Tickets and errors are always added by hand.", \.autoDraft) { ["autoDraft": .bool($0)] } }
        CardRow { toggle("Write entries from new commits", "A push to a connected repo's default branch has the AI draft entries from its new commits (only the messages are read). They wait for your review. Needs GitHub repos in Settings and the app's webhook.", \.onPush) { ["commitAi": .object(["onPush": .bool($0)])] } }
        if settings.onPush {
          CardRow { toggle("Publish them without review", "What a push drafts goes public immediately, with no one reading it first. Entries made with From commits are always drafts.", \.autoPublish) { ["commitAi": .object(["autoPublish": .bool($0)])] } }
        }
        CardRow { toggle("Comments", "Signed-in readers can comment on published entries. Your site sends their identity token; admins can hide or delete any comment.", \.comments) { ["comments": .bool($0)] } }
        CardRow { toggle("Email subscribers", "Readers can ask for an email when something ships (as it happens, or weekly on Monday). Needs CHANGELOG_LINK_SECRET or HELPBITES_SECRET (either 32+ characters) on the server, and ENABLE_CHANGELOG_NOTIFY=true for the scheduler to send.", \.notify) { ["notify": .bool($0)] } }
        CardRow(divider: false) { toggle("Public changelog", "Serve the changelog page, embed, JSON and RSS to everyone. Independent of Feedback, whose Changelog tab also needs this on.", \.enabled) { ["enabled": .bool($0)] } }
      }
      HStack {
        if saving { ProgressView().controlSize(.small) }
        Text(saving ? "Saving…" : saved ? "Saved" : "Saves as you change it").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      hint("Unless you turn on Public changelog, whether the changelog is public, and its page and RSS feed, follow Feedback's Changelog option.")

      SectionLabel("Addresses and emails")
      LabeledField(label: "Areas", hint: "Entries may name one of these (lowercase, comma-separated). Empty allows any.") {
        TextField("site, editor", text: $areas).textFieldStyle(.linear).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      }
      LabeledField(label: "Product name", hint: "In email subjects. The project's name when empty.") {
        TextField("", text: $settings.siteName).textFieldStyle(.linear)
      }
      LabeledField(label: "Entry page", hint: "Where an entry lives on your site; {siteUrl} and {slug} are filled in.") {
        TextField("{siteUrl}/changelog/{slug}", text: $settings.entryUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
      }
      LabeledField(label: "Changelog page", hint: "Linked from the emails.") {
        TextField("{siteUrl}/changelog", text: $settings.pageUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
      }
      LabeledField(label: "Told about comments", hint: "Up to 5 addresses, comma-separated. Never told about the team's own comments.") {
        TextField("you@example.com", text: $notifyEmails).textFieldStyle(.linear).inputHints(.emailAddress, capitalization: .never).autocorrectionDisabled()
      }

      SectionLabel("Email schedule")
      LabeledField(label: "Time zone", hint: "The weekly digest goes out on Monday in this zone (an IANA name).") {
        TextField("Europe/Madrid", text: $settings.timezone).textFieldStyle(.linear).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      }
      Stepper("Weekly digest at \(String(format: "%02d", settings.weeklyHour)):00", value: $settings.weeklyHour, in: 0...23).font(.lnBody)
      Stepper("Instant mail after \(settings.quietMinutes) min of quiet", value: $settings.quietMinutes, in: 1...1440, step: 5).font(.lnBody)
      Stepper("…and no later than \(settings.maxWaitMinutes) min", value: $settings.maxWaitMinutes, in: 1...1440, step: 5).font(.lnBody)
      Button { Task { await saveAdvanced() } } label: { Text("Save addresses and schedule") }.buttonStyle(.lnSecondary).disabled(saving)
      ErrorText(message: error)
    } trailing: {}
  }

  private func toggle(_ title: String, _ detail: String, _ keyPath: WritableKeyPath<ChangelogSettings, Bool>, _ patch: @escaping (Bool) -> [String: JSONValue]) -> some View {
    FeedbackToggleRow(title: title, detail: detail, isOn: Binding(
      get: { settings[keyPath: keyPath] },
      set: { on in
        settings[keyPath: keyPath] = on
        Task { await save(patch(on)) }
      }
    ))
  }

  private func list(_ text: String) -> [JSONValue] {
    text.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { .string($0.trimmingCharacters(in: .whitespaces).lowercased()) }.filter { $0 != .string("") }
  }

  private func saveAdvanced() async {
    var patch: [String: JSONValue] = [
      "areas": .array(list(areas)), "commentNotify": .array(list(notifyEmails)), "siteName": .string(settings.siteName),
      "digest": .object(["timezone": .string(settings.timezone), "weeklyHour": .number(Double(settings.weeklyHour)), "quietMinutes": .number(Double(settings.quietMinutes)), "maxWaitMinutes": .number(Double(settings.maxWaitMinutes))])
    ]
    if !settings.entryUrl.isEmpty { patch["entryUrl"] = .string(settings.entryUrl) }
    if !settings.pageUrl.isEmpty { patch["pageUrl"] = .string(settings.pageUrl) }
    await save(patch)
  }

  private func save(_ patch: [String: JSONValue]) async {
    saving = true
    saved = false
    error = ""
    defer { saving = false }
    do {
      try await store.saveSettings(patch)
      saved = true
    } catch {
      self.error = error.localizedDescription
      settings = store.settings
    }
  }
}

// MARK: - From commits

struct ChangelogGenerateSheet: View {
  let store: ChangelogStore
  @State private var recent = true
  @State private var count = 2
  @State private var unit = 7
  @State private var starting = false
  @State private var error = ""

  var body: some View {
    ChangelogSheetFrame(title: "Write from commits") {
      hint("The AI reads your commit messages and drafts entries. Nothing is published.")
      if let repos = store.repoNames, repos.isEmpty {
        Text("This project has no GitHub repos yet. Connect GitHub and pick its repos in the project's Settings.")
          .font(.lnMeta).foregroundStyle(Theme.textMuted)
          .padding(12).background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      } else if let repos = store.repoNames {
        hint("Repos: \(repos.joined(separator: ", "))")
      }
      LabeledField(label: "Commits to read") {
        FeedbackSelect(options: [FeedbackOption(value: "all", label: "All commits"), FeedbackOption(value: "recent", label: "Only recent commits")], selection: Binding(get: { recent ? "recent" : "all" }, set: { recent = $0 == "recent" }))
      }
      if recent {
        HStack(spacing: 10) {
          Stepper("\(count)", value: $count, in: 1...999).font(.lnBody).fixedSize()
          FeedbackSelect(options: [FeedbackOption(value: "1", label: count == 1 ? "day" : "days"), FeedbackOption(value: "7", label: count == 1 ? "week" : "weeks"), FeedbackOption(value: "30", label: count == 1 ? "month" : "months")], selection: Binding(get: { String(unit) }, set: { unit = Int($0) ?? 7 }))
        }
      }
      hint("Reads the newest 300 commits of the default branch of each repo. Commits already written up are skipped, and merge commits are ignored. Entries come back as drafts for you to review, merge and edit.")
      if let run = store.run {
        Group {
          if run.running {
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Writing drafts…") }
          } else if run.state == "done" {
            Text("Last run: \(run.created) \(run.created == 1 ? "draft" : "drafts") created, \(run.skipped) \(run.skipped == 1 ? "commit" : "commits") already covered\(run.truncated == true ? " (older commits were not read)" : "").")
          } else {
            Text("Last run failed: \(run.error ?? "unknown error")").foregroundStyle(Theme.error)
          }
        }
        .font(.lnMeta)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      }
      ErrorText(message: error)
    } trailing: {
      Button { Task { await generate() } } label: { Label("Generate drafts", systemImage: "sparkles") }
        .disabled(starting || store.run?.running == true || store.repoNames?.isEmpty != false)
    }
    .task {
      do { try await store.openGenerate() } catch { if case APIError.cancelled = error {} else { self.error = error.localizedDescription } }
    }
  }

  private func generate() async {
    starting = true
    defer { starting = false }
    error = ""
    do { try await store.generate(days: recent ? max(1, count) * unit : nil) } catch { self.error = error.localizedDescription }
  }
}

// MARK: - Subscribers and email

struct ChangelogSubscribersSheet: View {
  let store: ChangelogStore
  @State private var counts: ChangelogSubscribers?
  @State private var busy = ""
  @State private var results: [String: String] = [:]
  @State private var confirm: String?
  @State private var error = ""

  var body: some View {
    ChangelogSheetFrame(title: "Subscribers and email") {
      if !store.settings.notify {
        hint("Email subscribers is off. Turn it on in Settings to let readers ask for an email when something ships.")
      }
      if let counts {
        Card {
          CardRow { stat("Instant", counts.instant, "Active, emailed as things ship") }
          CardRow { stat("Weekly", counts.weekly, "Active, emailed on Monday") }
          CardRow { stat("Pending", counts.pending, "Have not confirmed their address yet") }
          CardRow(divider: false) { stat("Unsubscribed", counts.unsubscribed, "Never emailed again") }
        }
        hint("Counts only; addresses are never shown here.")
      } else if error.isEmpty {
        SkeletonRows(count: 3)
      }
      if store.settings.notify {
        SectionLabel("Send now")
        hint("The scheduler runs every five minutes when the server has ENABLE_CHANGELOG_NOTIFY=true. These run one beat by hand.")
        job("instant", "Instant sweep", "Entries published and gone quiet.")
        job("weekly", "Weekly digest", "If it is due and not already sent.")
      }
      ErrorText(message: error)
    } trailing: {}
    .confirmationDialog("Send this email now?", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { job in
      Button("Send now") { Task { await run(job, dryRun: false) } }
    } message: { _ in
      Text("Subscribers are emailed for real. Preview first to see who and what.")
    }
    .task {
      do { counts = try await store.subscribers() } catch { if case APIError.cancelled = error {} else { self.error = error.localizedDescription } }
    }
  }

  private func stat(_ title: String, _ value: Int, _ detail: String) -> some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.lnRow).foregroundStyle(Theme.textHighlighted)
        Text(detail).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      Spacer()
      Text("\(value)").font(.lnHeading).monospacedDigit().foregroundStyle(Theme.textHighlighted)
    }
  }

  private func job(_ key: String, _ title: String, _ detail: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.lnRow).foregroundStyle(Theme.textHighlighted)
      hint(detail)
      HStack(spacing: 8) {
        Button { Task { await run(key, dryRun: true) } } label: { Text(busy == "\(key)-dry" ? "Checking…" : "Preview") }.buttonStyle(.lnSecondaryCompact)
        Button { confirm = key } label: { Text(busy == key ? "Sending…" : "Send now") }.buttonStyle(.lnPrimaryCompact)
      }
      .disabled(!busy.isEmpty)
      if let text = results[key] { Text(text).font(.lnMeta).foregroundStyle(Theme.textToned) }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private func run(_ job: String, dryRun: Bool) async {
    busy = dryRun ? "\(job)-dry" : job
    defer { busy = "" }
    error = ""
    do {
      let result = try await store.notify(job: job, dryRun: dryRun)
      results[job] = result.summary(job: job, dryRun: dryRun)
      if !dryRun { counts = try? await store.subscribers() }
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: - Import

struct ChangelogImportSheet: View {
  let store: ChangelogStore
  @State private var kind: ChangelogStore.ImportKind = .entries
  @State private var picking = false
  @State private var importing = false
  @State private var summary: ChangelogStore.ImportSummary?
  @State private var error = ""

  private var detail: String {
    switch kind {
    case .entries: "Up to 100 per request (a longer list is sent in parts). Each entry: externalId (your id for it), title, body, tag, status, publishedAt, releaseVersion, slug… An entry whose externalId exists is updated, otherwise created. Nobody is emailed and nothing is linked."
    case .comments: "Each comment: externalId, entry (its externalId, slug or #N), body, status, authorId, authorName, authorIsStaff, postedAt. A comment whose externalId exists is updated, so re-running converges. Nobody is notified."
    case .subscriptions: "Each subscriber: externalId, email, frequency (instant or weekly), status, confirmedAt… Optionally \"runs\", the past sends, so the first weekly sweep does not repeat a week already mailed. Someone who unsubscribed here is never reactivated, and nobody is emailed."
    }
  }

  var body: some View {
    ChangelogSheetFrame(title: "Import") {
      hint("Bring a changelog over from another system. Choose a JSON file: a list, or an object holding the list under \"\(kind.rawValue)\".")
      Picker("What", selection: $kind) {
        ForEach(ChangelogStore.ImportKind.allCases) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .onChange(of: kind) { _, _ in summary = nil; error = "" }
      hint(detail)
      Button { picking = true } label: {
        if importing { HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Importing…") } } else { Label("Choose JSON file…", systemImage: "doc") }
      }
      .buttonStyle(.lnPrimary)
      .disabled(importing)
      if let summary {
        VStack(alignment: .leading, spacing: 6) {
          Label("\(summary.created) created, \(summary.updated) updated\(summary.failures.isEmpty ? "" : ", \(summary.failures.count) failed")", systemImage: summary.failures.isEmpty ? "checkmark.circle" : "exclamationmark.triangle")
            .font(.lnMetaMedium).foregroundStyle(summary.failures.isEmpty ? Theme.success : Theme.warning)
          ForEach(Array(summary.failures.prefix(20).enumerated()), id: \.offset) { _, failure in
            Text(failure).font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          if summary.failures.count > 20 { hint("…and \(summary.failures.count - 20) more.") }
        }
      }
      ErrorText(message: error)
    } trailing: {}
    .fileImporter(isPresented: $picking, allowedContentTypes: [.json]) { result in
      switch result {
      case .success(let url): Task { await run(url) }
      case .failure(let failure): error = failure.localizedDescription
      }
    }
  }

  private func run(_ url: URL) async {
    importing = true
    summary = nil
    error = ""
    defer { importing = false }
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    do {
      let data = try await Task.detached { try Data(contentsOf: url) }.value
      summary = try await store.importFile(data, kind: kind)
    } catch {
      self.error = error.localizedDescription
    }
  }
}
