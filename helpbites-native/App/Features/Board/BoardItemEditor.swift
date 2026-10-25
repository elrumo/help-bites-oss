import SwiftUI

/// One item, as the web's slide-over edits it: title and internal description,
/// status, priority, assignee, target date and labels, whether it goes on the
/// public roadmap (with the only text the roadmap shows), and the feedback posts
/// and conversations it answers. Opens from the board, the inbox and feedback posts.
struct BoardItemEditor: View {
  let store: BoardStore
  @State private var itemId: String?
  @State private var draft: BoardItemDraft
  @State private var pickingPost = false
  /// Feedback chosen for an item that does not exist yet; linked when it is created.
  @State private var newPosts: [FeedbackPost] = []
  @State private var saving = false
  @State private var justSaved = false
  @State private var linking = false
  @State private var confirmDelete = false
  @State private var error = ""
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass

  init(store: BoardStore, itemId: String?) {
    self.store = store
    _itemId = State(initialValue: itemId)
    _draft = State(initialValue: BoardItemDraft(item: itemId.flatMap { store.item($0) }, defaultStatus: store.config?.defaultStatusKey ?? ""))
  }

  private var current: BoardItem? { itemId.flatMap { store.item($0) } }

  private var title: String {
    guard itemId != nil else { return String(localized: "New item") }
    return current?.number.map { String(localized: "Item #\($0)") } ?? String(localized: "Item")
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        if let config = store.config {
          VStack(alignment: .leading, spacing: 20) {
            form(config)
            if let current { links(current) } else { newItemFeedback }
          }
          .frame(maxWidth: 640, alignment: .leading)
          .padding(20)
          .frame(maxWidth: .infinity)
        } else if !store.error.isEmpty {
          ErrorText(message: store.error).padding(20)
        } else {
          SkeletonRows(count: 4)
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(justSaved ? "Saved" : itemId == nil ? "Create" : "Save") { Task { await save() } }
            .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || store.config == nil)
        }
      }
      .feedbackErrorAlert($error)
      .confirmationDialog("Delete this item?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete item", role: .destructive) { Task { await deleteItem() } }
      } message: {
        Text("Its links go with it; the posts and conversations stay.")
      }
      .task { await load() }
      .sheet(isPresented: $pickingPost) {
        FeedbackAttachSheet(session: store.session, projectId: store.projectId, exclude: Set((current?.feedbackPostIds ?? []) + newPosts.map(\.id))) { post in
          if itemId == nil { newPosts.append(post) } else { Task { await setLink("feedback", post.id, true) } }
        }
      }
    }
    .presentationDetents([.large])
  }

  // MARK: Form

  @ViewBuilder private func form(_ config: BoardConfig) -> some View {
    if let current { meta(current, config) } else { Text("Private until you put it on the roadmap").font(.lnMeta).foregroundStyle(Theme.textMuted) }

    LabeledField(label: "Title") {
      TextField("", text: $draft.title)
        .textFieldStyle(.linear)
        .onChange(of: draft.title) { _, value in if value.count > 200 { draft.title = String(value.prefix(200)) } }
    }
    LabeledField(label: "Description", hint: "Markdown. Internal: the roadmap never shows it.") { LinearTextEditor(text: $draft.description, minHeight: 120) }

    if sizeClass == .regular {
      HStack(alignment: .top, spacing: 12) { pickers(config) }
    } else {
      pickers(config)
    }
    LabeledField(label: "Target date") { targetDate }
    if !config.labels.isEmpty { labelPicker(config) }
    AttachmentsSection(attachments: $draft.attachments, session: store.session, projectId: store.projectId)
    roadmap(config)
  }

  @ViewBuilder private func pickers(_ config: BoardConfig) -> some View {
    LabeledField(label: "Status") {
      FeedbackSelect(options: config.statuses.map { FeedbackOption(value: $0.key, label: $0.label, color: $0.color) }, selection: $draft.status)
    }
    LabeledField(label: "Priority") {
      FeedbackSelect(options: [FeedbackOption(value: "", label: String(localized: "No priority"))] + BoardFormat.priorities.map { FeedbackOption(value: $0, label: BoardFormat.priorityName($0)) }, selection: $draft.priority)
    }
    LabeledField(label: "Assignee") {
      FeedbackSelect(options: [FeedbackOption(value: "", label: String(localized: "Unassigned"))] + store.agents.map { FeedbackOption(value: $0.id, label: $0.inboxName) }, selection: $draft.assigneeId)
    }
  }

  @ViewBuilder private var targetDate: some View {
    if let date = FeedbackFormat.date(day: draft.targetDay) {
      HStack(spacing: 4) {
        DatePicker("Target date", selection: Binding(get: { date }, set: { draft.targetDay = FeedbackFormat.day($0) }), displayedComponents: .date)
          .labelsHidden()
        Button { draft.targetDay = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDimmed) }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear the date")
        Spacer(minLength: 0)
      }
      .frame(minHeight: 40)
    } else {
      Button { draft.targetDay = FeedbackFormat.day(Date()) } label: {
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
      .accessibilityLabel("Set a target date")
    }
  }

  private func labelPicker(_ config: BoardConfig) -> some View {
    // A label the board no longer defines still shows while the item carries it, so it can be taken off.
    let labels = config.labels + draft.labels.filter { key in !config.labels.contains { $0.key == key } }.map { config.label($0) }
    return LabeledField(label: "Labels") {
      FlowLayout(spacing: 6) {
        ForEach(labels) { label in
          let on = draft.labels.contains(label.key)
          Pill(label: label.label, systemImage: on ? "checkmark" : nil, isActive: on) {
            if on { draft.labels.removeAll { $0 == label.key } } else { draft.labels.append(label.key) }
          }
        }
      }
    }
  }

  private func roadmap(_ config: BoardConfig) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      FeedbackToggleRow(title: "On public roadmap", detail: "Shows once planned, in progress or done — with only the public description below.", isOn: $draft.isPublic)
      if draft.isPublic {
        LabeledField(label: "Public description", hint: "Markdown. What the roadmap shows; never the internal description.") {
          LinearTextEditor(text: $draft.publicDescription, placeholder: "What this means for your users", minHeight: 72)
        }
        if !store.roadmapReady {
          Text("The public roadmap is published through public feedback: turn it on, with its Roadmap view, under Feedback → Settings.")
            .font(.lnCaption).foregroundStyle(Theme.warning).fixedSize(horizontal: false, vertical: true)
        } else if !config.isOnRoadmap(draft.status) {
          Text("Not on the roadmap yet: \(config.status(draft.status)?.label ?? String(localized: "this status")) stays private.")
            .font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  /// Votes, when it was made and finished, and whether the roadmap shows it now.
  private func meta(_ item: BoardItem, _ config: BoardConfig) -> some View {
    FlowLayout(spacing: 12) {
      if !item.posts.isEmpty {
        HStack(spacing: 3) {
          Image(systemName: "chevron.up").font(.system(size: 10, weight: .bold))
          Text("\(item.voteCount) votes").fontWeight(.semibold)
        }
        .foregroundStyle(Theme.text)
      }
      Text("Created \(FeedbackFormat.timeAgo(item.createdAt))")
      if let done = item.completedAt { Text("Done \(DateText.day(done))") }
      if item.isPublic && store.roadmapReady && config.isOnRoadmap(item.status) {
        Label("On the roadmap", systemImage: "globe").foregroundStyle(Theme.accentText)
      }
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.textMuted)
  }

  // MARK: Links

  /// A new item can already take feedback: it is linked once the item exists.
  private var newItemFeedback: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text("Feedback").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("\(newPosts.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
      if !newPosts.isEmpty {
        Card {
          ForEach(newPosts) { post in
            CardRow(divider: post.id != newPosts.last?.id) {
              HStack(spacing: 10) {
                Text(post.number.map { "#\($0) \(post.title)" } ?? post.title).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 0)
                Button { newPosts.removeAll { $0.id == post.id } } label: {
                  Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textMuted).frame(width: 24, height: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(post.title)")
              }
            }
          }
        }
      }
      Button { pickingPost = true } label: { Label("Search feedback to attach", systemImage: "magnifyingglass") }
        .buttonStyle(.lnSecondaryCompact)
    }
  }

  private func links(_ item: BoardItem) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      Rectangle().fill(Theme.borderMuted).frame(height: 1).padding(.top, 12)

      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 6) {
          Text("Feedback").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("\(item.posts.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
          Spacer(minLength: 0)
          if !item.posts.isEmpty { Text("\(item.voteCount) votes").font(.lnCaptionMedium).monospacedDigit().foregroundStyle(Theme.textMuted) }
        }
        if !item.posts.isEmpty {
          Card {
            ForEach(item.posts) { post in
              CardRow(divider: post.id != item.posts.last?.id) { postRow(post) }
            }
          }
        }
        Button { pickingPost = true } label: { Label("Search feedback to attach", systemImage: "magnifyingglass") }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(linking)
      }

      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 6) {
          Text("Conversations").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("\(item.conversations.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
        if item.conversations.isEmpty {
          Text("Link conversations from the inbox: open one and use the Planning section in its details.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
        } else {
          Card {
            ForEach(item.conversations) { conversation in
              CardRow(divider: conversation.id != item.conversations.last?.id) { conversationRow(conversation) }
            }
          }
        }
      }

      if let errors = item.errorRefs, !errors.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 6) {
            Text("Filed from errors").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
            Text("\(errors.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
          }
          Card {
            ForEach(Array(errors.enumerated()), id: \.element.id) { index, ref in
              CardRow(divider: index < errors.count - 1) { errorRow(ref) }
            }
          }
        }
      }

      GithubRefsSection(projectId: store.projectId, kind: "board", targetId: item.id)

      VStack(alignment: .leading, spacing: 8) {
        Text("Changelog").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        ChangelogLinksSection(projectId: store.projectId, kind: "board", targetId: item.id, source: ["title": item.title, "publicDescription": item.publicDescription])
      }

      Button { confirmDelete = true } label: { Label("Delete item", systemImage: "trash") }.buttonStyle(GhostButtonStyle(tint: Theme.error))
    }
  }

  /// An error this item was filed from, with the way back to the tracker.
  private func errorRow(_ ref: BoardErrorRef) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "ladybug").font(.system(size: 12)).foregroundStyle(Theme.textMuted).frame(width: 16)
      Text(ref.title.isEmpty ? ref.issueId : ref.title).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 4)
      if let url = URL(string: ref.url), !ref.url.isEmpty {
        Button { openURL(url) } label: { Label("Open in \(ref.providerName)", systemImage: "arrow.up.right") }
          .buttonStyle(.lnGhost)
      }
    }
  }

  private func postRow(_ post: BoardLinkedPost) -> some View {
    HStack(spacing: 10) {
      HStack(spacing: 2) {
        Image(systemName: "chevron.up").font(.system(size: 9, weight: .bold))
        Text("\(post.voteCount)").monospacedDigit()
      }
      .font(.lnCaptionMedium)
      .foregroundStyle(Theme.textMuted)
      .frame(width: 40, alignment: .leading)
      postTitle(post).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 4)
      if post.hidden {
        Label("Hidden", systemImage: "eye.slash")
          .labelStyle(BoardCompactLabelStyle())
          .accessibilityLabel("Hidden: never on the roadmap, and its votes don't count")
      }
      FeedbackStatusBadge(status: feedbackStatus(post))
      Button { Task { await setLink("feedback", post.id, false) } } label: {
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textMuted).frame(width: 24, height: 24).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(linking)
      .accessibilityLabel("Unlink post")
    }
  }

  private func postTitle(_ post: BoardLinkedPost) -> Text {
    guard let number = post.number else { return Text(post.title) }
    return Text("\(Text("#\(number) ").foregroundStyle(Theme.textDimmed))\(post.title)")
  }

  /// The post's status as the feedback board defines it.
  private func feedbackStatus(_ post: BoardLinkedPost) -> FeedbackStatusDefinition {
    store.feedbackStatuses.first { $0.key == post.status }
      ?? FeedbackStatusDefinition(key: post.status, label: post.status.isEmpty ? String(localized: "Open") : post.status, category: post.statusCategory, color: "neutral")
  }

  private func conversationRow(_ conversation: BoardLinkedConversation) -> some View {
    HStack(spacing: 8) {
      Button { openConversation(conversation.id) } label: {
        HStack(spacing: 8) {
          Image(systemName: "text.bubble").font(.system(size: 12)).foregroundStyle(Theme.textMuted)
          Text(conversation.subject.isEmpty ? String(localized: "Conversation") : conversation.subject).foregroundStyle(Theme.text).lineLimit(1)
          if !conversation.endUserName.isEmpty { Text("· \(conversation.endUserName)").foregroundStyle(Theme.textMuted).lineLimit(1) }
          Spacer(minLength: 4)
          Text(conversation.status.capitalized).font(.lnCaption).foregroundStyle(Theme.textToned)
        }
        .font(.lnMeta)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityHint("Opens it in the inbox")
      Button { Task { await setLink("conversation", conversation.id, false) } } label: {
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textMuted).frame(width: 24, height: 24).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(linking)
      .accessibilityLabel("Unlink conversation")
    }
  }

  // MARK: Actions

  /// Opened from the inbox or a post, the store starts empty: load the board first.
  private func load() async {
    guard store.config == nil else { return }
    let before = draft
    await store.load()
    if draft == before { draft = BoardItemDraft(item: current, defaultStatus: store.config?.defaultStatusKey ?? "") }
    if itemId != nil, current == nil, store.error.isEmpty { error = String(localized: "That item no longer exists.") }
  }

  private func save() async {
    guard let config = store.config else { return }
    saving = true
    do {
      let item: BoardItem
      if let itemId {
        guard let current else { throw APIError.server(String(localized: "That item no longer exists.")) }
        let patch = draft.patch(against: current)
        if patch.isEmpty { item = current } else { item = try await store.update(itemId, patch) }
      } else {
        var fields = draft.fields
        if !newPosts.isEmpty { fields["feedbackPostIds"] = .array(newPosts.map { .string($0.id) }) }
        item = try await store.create(fields)
        newPosts = []
      }
      saving = false
      draft = BoardItemDraft(item: item, defaultStatus: config.defaultStatusKey)
      itemId = item.id
      justSaved = true
      try? await Task.sleep(for: .seconds(1.6))
      justSaved = false
    } catch {
      saving = false
      self.error = error.localizedDescription
    }
  }

  private func deleteItem() async {
    guard let itemId else { return }
    do {
      try await store.delete(itemId)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  @discardableResult
  private func setLink(_ kind: String, _ target: String, _ linked: Bool) async -> Bool {
    guard let itemId else { return false }
    linking = true
    defer { linking = false }
    do {
      _ = try await store.link(itemId, kind: kind, target: target, linked: linked)
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  private func openConversation(_ id: String) {
    let workspace = workspace
    dismiss()
    workspace.go(.inbox)
    Task { await workspace.inbox.select(id) }
  }
}

/// The editor's fields, as the web's draft holds them.
private struct BoardItemDraft: Equatable {
  var title = "", description = "", publicDescription = "", status = "", priority = "", assigneeId = ""
  var labels: [String] = []
  var attachments: [ItemAttachment] = []
  /// "2026-11-15", like a date input; '' for none.
  var targetDay = ""
  var isPublic = false

  init(item: BoardItem?, defaultStatus: String) {
    guard let item else {
      status = defaultStatus
      return
    }
    title = item.title
    description = item.description
    publicDescription = item.publicDescription
    status = item.status
    priority = item.priority
    assigneeId = item.assigneeId
    labels = item.labels
    attachments = item.attachments ?? []
    targetDay = item.targetDay
    isPublic = item.isPublic
  }

  /// A new item: everything set; what is empty is left to the server's defaults.
  var fields: [String: JSONValue] {
    var fields: [String: JSONValue] = [
      "title": .string(title),
      "description": .string(description),
      "publicDescription": .string(publicDescription),
      "labels": .array(labels.map(JSONValue.string)),
      "attachments": .array(attachments.map(\.asJSON)),
      "public": .bool(isPublic)
    ]
    if !status.isEmpty { fields["status"] = .string(status) }
    if !priority.isEmpty { fields["priority"] = .string(priority) }
    if !assigneeId.isEmpty { fields["assigneeId"] = .string(assigneeId) }
    if !targetDay.isEmpty { fields["targetDate"] = .string(targetDay) }
    return fields
  }

  /// Only what changed, so a label the board has dropped since never blocks a save.
  func patch(against item: BoardItem) -> [String: JSONValue] {
    let original = BoardItemDraft(item: item, defaultStatus: "")
    var patch: [String: JSONValue] = [:]
    if title != original.title { patch["title"] = .string(title) }
    if description != original.description { patch["description"] = .string(description) }
    if publicDescription != original.publicDescription { patch["publicDescription"] = .string(publicDescription) }
    if status != original.status { patch["status"] = .string(status) }
    if priority != original.priority { patch["priority"] = .string(priority) }
    if assigneeId != original.assigneeId { patch["assigneeId"] = .string(assigneeId) }
    if labels != original.labels { patch["labels"] = .array(labels.map(JSONValue.string)) }
    if attachments != original.attachments { patch["attachments"] = .array(attachments.map(\.asJSON)) }
    if targetDay != original.targetDay { patch["targetDate"] = targetDay.isEmpty ? .null : .string(targetDay) }
    if isPublic != original.isPublic { patch["public"] = .bool(isPublic) }
    return patch
  }
}

// MARK: - Picker

/// "Add to existing": every item on the board not linked yet, searchable by title or `#N`.
struct BoardItemPicker: View {
  let store: BoardStore
  let exclude: Set<String>
  let pick: (BoardItem) -> Void
  @State private var query = ""
  @Environment(\.dismiss) private var dismiss

  private var candidates: [BoardItem] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let number = Int(needle.hasPrefix("#") ? String(needle.dropFirst()) : needle)
    return store.items.sorted(by: boardOrder).filter { item in
      !exclude.contains(item.id) && (needle.isEmpty || (number != nil ? item.number == number : item.title.localizedStandardContains(needle)))
    }
  }

  var body: some View {
    NavigationStack {
      Group {
        if !store.error.isEmpty {
          ErrorText(message: store.error).padding(20).frame(maxHeight: .infinity, alignment: .top)
        } else if store.config == nil {
          SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
        } else if candidates.isEmpty {
          EmptyState(systemImage: "rectangle.split.3x1", title: query.isEmpty ? "No other items" : "Nothing matches", message: query.isEmpty ? "Every planning item is linked here already, or none exist yet." : nil)
            .frame(maxHeight: .infinity, alignment: .top)
        } else {
          List(candidates) { item in
            Button {
              pick(item)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                Circle().fill(FeedbackFormat.tint(store.config?.status(item.status)?.color ?? "neutral") ?? Theme.textDimmed).frame(width: 7, height: 7)
                if let number = item.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
                Text(item.title).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 0)
                if item.isPublic { Image(systemName: "globe").font(.system(size: 11)).foregroundStyle(Theme.textDimmed) }
              }
              .font(.lnMeta)
              .frame(minHeight: 36)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .linearRow()
          }
          .linearList()
        }
      }
      .searchable(text: $query, prompt: "Search items or #12")
      .panelScreen("Add to an item")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task { if store.config == nil { await store.load() } }
    }
    .presentationDetents([.medium, .large])
  }
}
