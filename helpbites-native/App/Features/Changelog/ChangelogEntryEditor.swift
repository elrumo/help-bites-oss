import SwiftUI

/// The fields of the entry editor. `patch(against:)` is what changed, as the API's PATCH takes it.
struct ChangelogEntryDraft: Equatable {
  var title = "", summary = "", slug = "", area = "", body = ""
  var tag: ChangelogTag = .improved
  /// A release id; "" is none.
  var releaseId = ""
  /// draft, published or archived.
  var status = "draft"
  /// A calendar day (yyyy-MM-dd); "" is none.
  var day = ""

  init() {}
  init(entry: ChangelogEntry?) {
    guard let entry else { return }
    title = entry.title
    summary = entry.summary
    slug = entry.slug
    area = entry.area
    body = entry.body
    tag = entry.tag
    releaseId = entry.releaseId
    status = entry.status.rawValue
    day = entry.publishedAt.map { String($0.prefix(10)) } ?? ""
  }

  func patch(against entry: ChangelogEntry) -> [String: JSONValue] {
    var out: [String: JSONValue] = [:]
    func text(_ key: String, _ value: String, _ old: String) { if value.trimmingCharacters(in: .whitespacesAndNewlines) != old { out[key] = .string(value.trimmingCharacters(in: .whitespacesAndNewlines)) } }
    if !title.trimmingCharacters(in: .whitespaces).isEmpty { text("title", title, entry.title) }
    text("summary", summary, entry.summary)
    if !slug.trimmingCharacters(in: .whitespaces).isEmpty { text("slug", slug, entry.slug) }
    text("area", area.lowercased(), entry.area)
    text("body", body, entry.body)
    if tag != entry.tag { out["tag"] = .string(tag.rawValue) }
    if releaseId != entry.releaseId { out["releaseId"] = releaseId.isEmpty ? .null : .string(releaseId) }
    if status != entry.status.rawValue { out["status"] = .string(status) }
    if day != entry.publishedAt.map({ String($0.prefix(10)) }) ?? "" { out["publishedAt"] = changelogPublishedAt(day: day) }
    return out
  }
}

/// One entry, as the web's slide-over edits it: title and text, summary, slug, area,
/// type, release, status and date; the review of a draft; and what it was made from.
struct ChangelogEntryEditor: View {
  let store: ChangelogStore
  @State private var entryId: String?
  @State private var draft: ChangelogEntryDraft
  @State private var filled: Bool
  @State private var reviewNotes = ""
  @State private var linkKind = "feedback"
  @State private var linkRef = ""
  @State private var busy = ""
  @State private var saving = false
  @State private var justSaved = false
  @State private var confirmDelete = false
  @State private var confirmClose = false
  @State private var error = ""
  /// The board, loaded only when a linked item is opened.
  @State private var board: BoardStore?
  @State private var boardItem: BoardRoute?
  /// The conversations a public entry answers, for "Reply to N linked conversations".
  @State private var linkedConversations: ChangelogLinkedConversations?
  @State private var replying = false
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass

  private struct BoardRoute: Identifiable { let id: String }

  init(store: ChangelogStore, entryId: String?) {
    self.store = store
    _entryId = State(initialValue: entryId)
    let entry = entryId.flatMap { store.entry($0) }
    _draft = State(initialValue: ChangelogEntryDraft(entry: entry))
    _filled = State(initialValue: entryId == nil || entry != nil)
  }

  private var current: ChangelogEntry? { entryId.flatMap { store.entry($0) } }
  private var dirty: Bool { current.map { !draft.patch(against: $0).isEmpty } ?? !draft.title.isEmpty }
  private var canSave: Bool { !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving && dirty && filled }

  private var title: String {
    guard entryId != nil else { return String(localized: "New entry") }
    return current?.number.map { String(localized: "Entry #\($0)") } ?? String(localized: "Entry")
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        if filled {
          VStack(alignment: .leading, spacing: 20) {
            form
            if let current {
              notes(current)
              review(current)
              sources(current)
              replySection(current)
              Button(role: .destructive) { confirmDelete = true } label: { Label("Delete entry", systemImage: "trash") }
                .buttonStyle(.lnGhost).tint(Theme.error)
            }
            ErrorText(message: error)
          }
          .frame(maxWidth: 640, alignment: .leading)
          .padding(20)
          .frame(maxWidth: .infinity)
        } else if store.loaded {
          EmptyState(systemImage: "scroll", title: "Entry not found", message: "It may have been deleted.")
        } else {
          SkeletonRows(count: 4)
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { if dirty { confirmClose = true } else { dismiss() } } }
        ToolbarItem(placement: .confirmationAction) {
          Button(justSaved ? "Saved" : entryId == nil ? "Create draft" : "Save") { Task { await save() } }.disabled(!canSave)
        }
      }
      .confirmationDialog("Discard your changes?", isPresented: $confirmClose, titleVisibility: .visible) {
        Button("Save and close") { Task { if await save() { dismiss() } } }
        Button("Discard", role: .destructive) { dismiss() }
      }
      .confirmationDialog("Delete this entry?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete entry", role: .destructive) { Task { await deleteEntry() } }
      } message: {
        Text("Its links go with it; the posts, planning items and conversations stay.")
      }
      .task {
        await store.ensureLoaded()
        if !filled, let current { draft = ChangelogEntryDraft(entry: current); filled = true }
      }
      .task(id: replyKey) { await loadLinkedConversations() }
      .sheet(item: $boardItem) { route in
        if let board { BoardItemEditor(store: board, itemId: route.id) }
      }
      .sheet(isPresented: $replying) {
        if let entryId, let linkedConversations { ChangelogReplySheet(projectId: store.projectId, entryId: entryId, linked: linkedConversations) }
      }
    }
    .presentationDetents([.large])
    .changelogSheetSize()
  }

  // MARK: Form

  @ViewBuilder private var form: some View {
    if current == nil { Text("A draft until you publish it").font(.lnMeta).foregroundStyle(Theme.textMuted) }
    else if let current { Text(current.authorName.isEmpty ? "Created \(FeedbackFormat.timeAgo(current.createdAt))" : "Created \(FeedbackFormat.timeAgo(current.createdAt)) by \(current.authorName)").font(.lnMeta).foregroundStyle(Theme.textMuted) }

    LabeledField(label: "Title") {
      TextField("What changed", text: $draft.title)
        .textFieldStyle(.linear)
        .onChange(of: draft.title) { _, value in if value.count > 200 { draft.title = String(value.prefix(200)) } }
    }
    LabeledField(label: "Text", hint: current?.bodyFormat == "html" ? "Written as HTML. This text is public once published." : "Say it the way your users would. Markdown. This text is public once published.") {
      LinearTextEditor(text: $draft.body, placeholder: "What users will read", minHeight: 140)
    }
    LabeledField(label: "Summary", hint: "One line for list cards") {
      TextField("", text: $draft.summary).textFieldStyle(.linear)
        .onChange(of: draft.summary) { _, value in if value.count > 300 { draft.summary = String(value.prefix(300)) } }
    }

    if sizeClass == .regular {
      HStack(alignment: .top, spacing: 12) { pickers }
    } else {
      pickers
    }
    if current != nil { dateField }
  }

  @ViewBuilder private var pickers: some View {
    LabeledField(label: "Type") {
      FeedbackSelect(options: ChangelogTag.allCases.map { FeedbackOption(value: $0.rawValue, label: $0.label) }, selection: Binding(get: { draft.tag.rawValue }, set: { draft.tag = ChangelogTag(rawValue: $0) ?? .improved }))
    }
    LabeledField(label: "Release") {
      FeedbackSelect(options: [FeedbackOption(value: "", label: String(localized: "No release"))] + store.releases.map { FeedbackOption(value: $0.id, label: $0.pickerLabel) }, selection: $draft.releaseId)
    }
    LabeledField(label: "Status") {
      FeedbackSelect(
        options: [FeedbackOption(value: "draft", label: String(localized: "Draft"), color: "neutral"), FeedbackOption(value: "published", label: String(localized: "Published"), color: "success")]
          + (current?.status == .archived ? [FeedbackOption(value: "archived", label: String(localized: "Archived"))] : []),
        selection: $draft.status
      )
    }
    if let current, current.slug.isEmpty == false {
      LabeledField(label: "Slug", hint: "The entry's address") {
        TextField("slug", text: $draft.slug).textFieldStyle(.linear).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      }
    }
    LabeledField(label: "Area", hint: store.settings.areas.isEmpty ? "Optional: the part of the product" : nil) {
      if store.settings.areas.isEmpty {
        TextField("Area (optional)", text: $draft.area).textFieldStyle(.linear).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      } else {
        let areas = store.settings.areas + (draft.area.isEmpty || store.settings.areas.contains(draft.area) ? [] : [draft.area])
        FeedbackSelect(options: [FeedbackOption(value: "", label: String(localized: "No area"))] + areas.map { FeedbackOption(value: $0, label: $0) }, selection: $draft.area)
      }
    }
  }

  @ViewBuilder private var dateField: some View {
    LabeledField(label: "Date", hint: "Shown on the public changelog") {
      if let date = FeedbackFormat.date(day: draft.day) {
        HStack(spacing: 4) {
          DatePicker("Date", selection: Binding(get: { date }, set: { draft.day = FeedbackFormat.day($0) }), displayedComponents: .date).labelsHidden()
          Button { draft.day = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDimmed) }
            .buttonStyle(.plain).accessibilityLabel("Clear the date")
          Spacer(minLength: 0)
        }
        .frame(minHeight: 40)
      } else {
        Button { draft.day = FeedbackFormat.day(Date()) } label: {
          HStack {
            Text("No date").foregroundStyle(Theme.textDimmed)
            Spacer(minLength: 4)
            Image(systemName: "calendar").foregroundStyle(Theme.textMuted)
          }
          .font(.lnBody)
          .padding(.horizontal, 12)
          .frame(maxWidth: .infinity, minHeight: 40)
          .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Set a date")
      }
    }
  }

  // MARK: Notices and review

  @ViewBuilder private func notes(_ entry: ChangelogEntry) -> some View {
    if entry.aiGenerated {
      notice("sparkles", entry.commitShas.count == 1 ? "Written by AI from 1 git commit. Check it before it goes public; edit it freely." : "Written by AI from \(entry.commitShas.count) git commits. Check it before it goes public; edit it freely.")
    }
    if store.state(entry) == .waiting {
      notice("hourglass", "Not public yet: its release is still a draft. Publish the release and it goes out with it.")
    }
    if entry.commentCount > 0 {
      notice("bubble.left", entry.commentCount == 1 ? "1 comment from readers." : "\(entry.commentCount) comments from readers.")
    }
  }

  private func notice(_ symbol: String, _ text: LocalizedStringKey) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(Theme.accentText).padding(.top, 2)
      Text(text).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  @ViewBuilder private func review(_ entry: ChangelogEntry) -> some View {
    if entry.status == .draft, let status = entry.reviewStatus {
      VStack(alignment: .leading, spacing: 10) {
        (Text(status == .rejected ? "Sent back" : "Waiting for review").fontWeight(.medium).foregroundStyle(Theme.text)
          + Text(entry.reviewedBy.map { " · \($0)\(entry.reviewNotes.map { $0.isEmpty ? "" : ": \($0)" } ?? "")" } ?? "").foregroundStyle(Theme.textMuted))
          .font(.lnCaption)
        TextField("Notes (optional)", text: $reviewNotes).textFieldStyle(.linear)
        HStack(spacing: 8) {
          Spacer(minLength: 0)
          Button { Task { await decide(approve: false) } } label: { busyLabel("Reject", "reject") }.buttonStyle(.lnSecondaryCompact)
          Button { Task { await decide(approve: true) } } label: { busyLabel("Approve and publish", "approve") }.buttonStyle(.lnPrimaryCompact)
        }
        .disabled(!busy.isEmpty)
      }
      .padding(12)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    }
  }

  @ViewBuilder private func busyLabel(_ title: LocalizedStringKey, _ key: String) -> some View {
    if busy == key { ProgressView().controlSize(.mini) } else { Text(title) }
  }

  private func decide(approve: Bool) async {
    guard let id = entryId else { return }
    busy = approve ? "approve" : "reject"
    defer { busy = "" }
    error = ""
    guard await save() || !dirty else { return }
    do {
      let entry = try await store.review(id, approve: approve, notes: reviewNotes)
      draft = ChangelogEntryDraft(entry: entry)
      reviewNotes = ""
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: Sources

  @ViewBuilder private func sources(_ entry: ChangelogEntry) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text("Made from").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("\(entry.sources.count)").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      if !entry.sources.isEmpty {
        Card {
          ForEach(Array(entry.sources.enumerated()), id: \.element.key) { index, source in
            CardRow(divider: index < entry.sources.count - 1) { sourceRow(source, entry) }
          }
        }
      }
      HStack(spacing: 8) {
        Picker("Kind", selection: $linkKind) {
          Text("Feedback post").tag("feedback")
          Text("Planning item").tag("board")
        }
        .labelsHidden()
        .fixedSize()
        TextField("#12", text: $linkRef).textFieldStyle(.linear).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
          .onSubmit { Task { await addSource(entry) } }
        Button { Task { await addSource(entry) } } label: { busyLabel("Link", "link") }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(linkRef.trimmingCharacters(in: .whitespaces).isEmpty || !busy.isEmpty)
      }
      Text("Tickets and errors link from the inbox: open one and use its Changelog section. Nothing is copied from what you link.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private func sourceRow(_ source: ChangelogSource, _ entry: ChangelogEntry) -> some View {
    HStack(spacing: 8) {
      Image(systemName: source.symbol).font(.system(size: 12)).foregroundStyle(Theme.textMuted).frame(width: 16).accessibilityLabel(source.kindLabel)
      Button {
        if source.kind == "board" {
          if board == nil { board = BoardStore(projectId: store.projectId, workspace: workspace) }
          boardItem = BoardRoute(id: source.id)
        }
      } label: {
        HStack(spacing: 4) {
          if let number = source.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
          Text(source.label.isEmpty ? source.kindLabel : source.label).foregroundStyle(Theme.text).lineLimit(1)
          Spacer(minLength: 0)
        }
        .font(.lnMeta)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(source.kind != "board")
      ChangelogChip(text: source.done ? String(localized: "Done") : (source.status.isEmpty ? String(localized: "Open") : source.status), tint: source.done ? Theme.success : Theme.textToned)
      Button { Task { await setLink(entry, source.kind, source.id, false) } } label: {
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textDimmed).frame(width: 24, height: 24).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(!busy.isEmpty)
      .accessibilityLabel("Unlink \(source.label)")
    }
  }

  @discardableResult
  private func setLink(_ entry: ChangelogEntry, _ kind: String, _ target: String, _ on: Bool) async -> Bool {
    busy = on ? "link" : "unlink"
    defer { busy = "" }
    error = ""
    do {
      _ = try await store.link(entry.id, kind: kind, target: target, linked: on)
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  private func addSource(_ entry: ChangelogEntry) async {
    let value = linkRef.trimmingCharacters(in: .whitespacesAndNewlines)
    if !value.isEmpty, await setLink(entry, linkKind, value, true) { linkRef = "" }
  }

  // MARK: Reply to the people it answers

  /// Looked up again when the entry becomes public or its links change.
  private var replyKey: String {
    guard let current else { return "" }
    return "\(current.id)|\(store.state(current) == .live)|\(current.sources.count)"
  }

  private func loadLinkedConversations() async {
    guard let current, store.state(current) == .live else { linkedConversations = nil; return }
    do {
      let found: ChangelogLinkedConversations = try await workspace.session.get("/v1/admin/changelog/entries/\(current.id)/linked-conversations", query: ["project": store.projectId])
      linkedConversations = found
    } catch {
      // The editor works without it; the section just does not show.
      if case APIError.cancelled = error { return }
      linkedConversations = nil
    }
  }

  /// Only once the entry is public and answers somebody's conversation. Never sent on its own.
  @ViewBuilder private func replySection(_ entry: ChangelogEntry) -> some View {
    if store.state(entry) == .live, let linked = linkedConversations, linked.count > 0 {
      HStack(spacing: 10) {
        Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 14)).foregroundStyle(Theme.accentText)
        Text(linked.count == 1 ? "This entry answers 1 conversation. You can tell them it shipped." : "This entry answers \(linked.count) conversations. You can tell them it shipped.")
          .font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 4)
        Button { replying = true } label: { Label(linked.count == 1 ? "Reply to 1 linked conversation" : "Reply to \(linked.count) linked conversations", systemImage: "paperplane") }
          .buttonStyle(.lnSecondaryCompact)
      }
      .padding(12)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    }
  }

  // MARK: Writes

  /// Create the draft, or save what changed. True when there is nothing left unsaved.
  @discardableResult
  private func save() async -> Bool {
    guard !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
    saving = true
    defer { saving = false }
    error = ""
    do {
      if let current {
        let patch = draft.patch(against: current)
        if !patch.isEmpty {
          let entry = try await store.update(current.id, patch)
          draft = ChangelogEntryDraft(entry: entry)
        }
      } else {
        let entry = try await store.create([
          "title": .string(draft.title.trimmingCharacters(in: .whitespacesAndNewlines)),
          "summary": .string(draft.summary), "area": .string(draft.area.lowercased()), "body": .string(draft.body),
          "tag": .string(draft.tag.rawValue), "status": .string(draft.status),
          "releaseId": draft.releaseId.isEmpty ? .null : .string(draft.releaseId)
        ])
        entryId = entry.id
        draft = ChangelogEntryDraft(entry: entry)
      }
      justSaved = true
      Task { try? await Task.sleep(for: .seconds(1.5)); justSaved = false }
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  private func deleteEntry() async {
    guard let id = entryId else { return }
    do {
      try await store.delete(id)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

extension View {
  /// A sheet on the Mac sizes to its content; give the editors room to work in.
  func changelogSheetSize() -> some View {
    #if os(macOS)
    frame(minWidth: 560, idealWidth: 620, minHeight: 640, idealHeight: 720)
    #else
    self
    #endif
  }
}
