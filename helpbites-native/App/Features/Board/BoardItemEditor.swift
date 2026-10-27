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
  @State private var pickingItem = false
  @State private var newLabel = ""
  @State private var addingLabel = false
  /// Feedback chosen for an item that does not exist yet; linked when it is created.
  @State private var newPosts: [FeedbackPost] = []
  @State private var saving = false
  @State private var justSaved = false
  @State private var writingTitle = false
  /// Which title request counts: a newer one makes an older answer stale.
  @State private var titleRun = 0
  @State private var linking = false
  @State private var confirmDelete = false
  @State private var error = ""
  @State private var commentsExpanded = false
  @State private var commentsLoading = false
  @State private var commentsFailed = false
  @State private var commentsHasMore = false
  @State private var commentsOffset = 0
  @State private var comments: [BoardItemComment] = []
  @State private var commentDraft = ""
  @State private var commentAttachments: [ItemAttachment] = []
  @State private var replyTarget: BoardItemComment?
  @State private var commentPostFailed = false
  @State private var postingComment = false
  @State private var historyExpanded = false
  @State private var historyLoading = false
  @State private var historyFailed = false
  @State private var historyHasMore = false
  @State private var historyOffset = 0
  @State private var history: [BoardItemHistory] = []
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass

  init(store: BoardStore, itemId: String?) {
    self.store = store
    _itemId = State(initialValue: itemId)
    let defaultStatus = store.config?.defaultStatusKey ?? ""
    // A new item that was never created comes back as it was left.
    var restored = itemId == nil ? BoardItemDraft.stored(for: store.projectId) : nil
    if let status = restored?.status, store.config?.statuses.contains(where: { $0.key == status }) != true { restored?.status = defaultStatus }
    _draft = State(initialValue: restored ?? BoardItemDraft(item: itemId.flatMap { store.item($0) }, defaultStatus: defaultStatus))
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
            if let current {
              links(current)
              commentsSection(current)
              historySection(current)
            } else {
              newItemFeedback
            }
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
            .keyboardShortcut(.return, modifiers: .command)
            .disabled((draft.title.trimmed.isEmpty && (itemId != nil || draft.description.trimmed.isEmpty)) || saving || store.config == nil)
        }
      }
      .feedbackErrorAlert($error)
      .onChange(of: draft) { _, value in if itemId == nil { value.store(for: store.projectId) } }
      .confirmationDialog("Delete this item?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete item", role: .destructive) { Task { await deleteItem() } }
      } message: {
        Text("Its links go with it; the posts and conversations stay.")
      }
      .task { await load() }
      // A new item with no title gets one a second after the description stops changing.
      .task(id: draft.description) {
        guard itemId == nil, draft.title.trimmed.isEmpty, !draft.description.trimmed.isEmpty else { return }
        try? await Task.sleep(for: .seconds(BoardTitle.debounce))
        guard !Task.isCancelled else { return }
        await writeTitle()
      }
      .sheet(isPresented: $pickingPost) {
        FeedbackAttachSheet(session: store.session, projectId: store.projectId, exclude: Set((current?.feedbackPostIds ?? []) + newPosts.map(\.id))) { post in
          if itemId == nil { newPosts.append(post) } else { Task { await setLink("feedback", post.id, true) } }
        }
      }
      .sheet(isPresented: $pickingItem) {
        BoardItemPicker(store: store, exclude: Set((itemId.map { [$0] } ?? []) + (current?.relatedItemIds ?? []))) { other in
          Task { await setLink("item", other.id, true) }
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
        .padding(.trailing, draft.description.trimmed.isEmpty ? 0 : 34)
        .overlay(alignment: .trailing) { titleAccessory }
        .onChange(of: draft.title) { _, value in if value.count > BoardTitle.maxLength { draft.title = String(value.prefix(BoardTitle.maxLength)) } }
    }
    LabeledField(label: "Description", hint: "Markdown. Internal: the roadmap never shows it.") { LinearTextEditor(text: $draft.description, minHeight: 120) }

    if sizeClass == .regular {
      HStack(alignment: .top, spacing: 12) { pickers(config) }
    } else {
      pickers(config)
    }
    LabeledField(label: "Target date") { targetDate }
    labelPicker(config)
    AttachmentsSection(attachments: $draft.attachments, session: store.session, projectId: store.projectId)
    roadmap(config)
  }

  /// While the AI writes the title, a spinner; otherwise the button that writes it from the description.
  @ViewBuilder private var titleAccessory: some View {
    if !draft.description.trimmed.isEmpty {
      if writingTitle {
        ProgressView().controlSize(.small).frame(width: 32, height: 32).accessibilityLabel("Writing the title…")
      } else {
        Button { Task { await writeTitle(manual: true) } } label: {
          Image(systemName: "sparkles").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.accentText).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Write the title with AI")
      }
    }
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
      VStack(alignment: .leading, spacing: 8) {
        FlowLayout(spacing: 6) {
          ForEach(labels) { label in
            let on = draft.labels.contains(label.key)
            Pill(label: label.label, systemImage: on ? "checkmark" : nil, isActive: on) {
              if on { draft.labels.removeAll { $0 == label.key } } else { draft.labels.append(label.key) }
            }
          }
        }
        HStack(spacing: 8) {
          TextField("New label", text: $newLabel)
            .textFieldStyle(.linear)
            .submitLabel(.done)
            .onSubmit { Task { await addLabel() } }
          Button("Add label") { Task { await addLabel() } }
            .buttonStyle(GhostButtonStyle(tint: Theme.accentText))
            .disabled(newLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || addingLabel)
        }
      }
    }
  }

  /// A label typed here joins the board's labels and this item takes it; the item's own Save keeps it.
  private func addLabel() async {
    let label = String(newLabel.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
    guard !label.isEmpty else { return }
    addingLabel = true
    defer { addingLabel = false }
    do {
      try await store.addLabel(label)
      let key = FeedbackFormat.normalizeKey(label)
      if !draft.labels.contains(key) { draft.labels.append(key) }
      newLabel = ""
    } catch let failure {
      error = failure.localizedDescription
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
          Text("Related items").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("\(item.related?.count ?? 0)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
        if let related = item.related, !related.isEmpty {
          Card {
            ForEach(related) { other in
              CardRow(divider: other.id != related.last?.id) { relatedRow(other) }
            }
          }
        }
        Button { pickingItem = true } label: { Label("Relate to another item", systemImage: "rectangle.split.3x1") }
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

  private func historySection(_ item: BoardItem) -> some View {
    DisclosureGroup(isExpanded: $historyExpanded) {
      VStack(alignment: .leading, spacing: 12) {
        if historyLoading {
          ProgressView().frame(maxWidth: .infinity)
        } else if historyFailed {
          Text("Could not load edit history.").font(.lnMeta).foregroundStyle(Theme.error)
        } else if history.isEmpty {
          Text("No edit history recorded yet. Earlier edits were not tracked.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          ForEach(history) { entry in
            VStack(alignment: .leading, spacing: 6) {
              HStack(alignment: .firstTextBaseline) {
                Text("\(entry.action == "created" ? String(localized: "Created") : String(localized: "Updated")) · \(entry.actorName) \(historySource(entry.source))")
                  .font(.lnMeta).foregroundStyle(Theme.textHighlighted)
                Spacer(minLength: 4)
                Text(FeedbackFormat.timeAgo(entry.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
                  .help(historyTimestamp(entry.createdAt))
              }
              ForEach(entry.changes) { change in
                Text(change.field == "rank" ? String(localized: "Position changed") : "\(historyField(change.field)): \(historyValue(change.field, change.from)) → \(historyValue(change.field, change.to))")
                  .font(.lnCaption).foregroundStyle(Theme.textToned).fixedSize(horizontal: false, vertical: true)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        if historyHasMore && !historyLoading {
          Button("Load older changes") { Task { await loadHistory(itemId: item.id, reset: false) } }
            .buttonStyle(.lnSecondaryCompact)
        }
      }
      .padding(.top, 8)
    } label: {
      VStack(alignment: .leading, spacing: 4) {
        Text("Edit history").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        if let name = item.lastModifiedBy, !name.isEmpty {
          Text("Last modified \(FeedbackFormat.timeAgo(item.updatedAt)) by \(name) \(historySource(item.lastModifiedSource ?? "api"))")
            .font(.lnCaption).foregroundStyle(Theme.textMuted)
            .help(historyTimestamp(item.updatedAt))
        } else {
          Text("Last modified \(FeedbackFormat.timeAgo(item.updatedAt)); earlier edits were not tracked")
            .font(.lnCaption).foregroundStyle(Theme.textMuted)
            .help(historyTimestamp(item.updatedAt))
        }
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .onChange(of: historyExpanded) { _, expanded in
      if expanded { Task { await loadHistory(itemId: item.id, reset: true) } }
    }
  }

  private func commentsSection(_ item: BoardItem) -> some View {
    DisclosureGroup(isExpanded: $commentsExpanded) {
      VStack(alignment: .leading, spacing: 12) {
        if commentsLoading && comments.isEmpty {
          ProgressView().frame(maxWidth: .infinity)
        } else if commentsFailed && comments.isEmpty {
          Text("Could not load comments.").font(.lnMeta).foregroundStyle(Theme.error)
        } else if comments.isEmpty {
          Text("No comments yet.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          ForEach(comments) { comment in
            VStack(alignment: .leading, spacing: 5) {
              HStack(spacing: 6) {
                Text(comment.authorName).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
                Text(historySource(comment.source)).font(.lnCaption).foregroundStyle(Theme.textMuted)
                Spacer(minLength: 4)
                Text(FeedbackFormat.timeAgo(comment.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
                  .help(historyTimestamp(comment.createdAt))
              }
              Text(comment.body).font(.lnMeta).foregroundStyle(Theme.textToned).fixedSize(horizontal: false, vertical: true)
              ForEach(comment.attachments, id: \.url) { file in
                HStack(spacing: 8) {
                  if file.isImage, let url = URL(string: file.url) {
                    AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
                      .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: 6))
                  } else {
                    Image(systemName: "doc").frame(width: 36, height: 36).background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
                  }
                  if let url = URL(string: file.url) { Link(file.name, destination: url).lineLimit(1) } else { Text(file.name).lineLimit(1) }
                }
                .font(.lnMeta)
              }
              Button("Reply") { replyTarget = comment; commentDraft = "" }
                .buttonStyle(.lnGhost)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, comment.parentId == nil ? 0 : 14)
          }
        }
        if commentsHasMore && !commentsLoading {
          Button("Load more comments") { Task { await loadComments(itemId: item.id, reset: false) } }
            .buttonStyle(.lnSecondaryCompact)
        }
        if let replyTarget {
          HStack(spacing: 6) {
            Text("Replying to \(replyTarget.authorName)").font(.lnCaption).foregroundStyle(Theme.textMuted)
            Button("Cancel") { self.replyTarget = nil }.buttonStyle(.lnGhost)
          }
        }
        LinearTextEditor(text: $commentDraft, placeholder: "Write a comment…", minHeight: 64)
        AttachmentsSection(attachments: $commentAttachments, session: store.session, projectId: store.projectId)
        if commentPostFailed { Text("Could not save the comment.").font(.lnCaption).foregroundStyle(Theme.error) }
        HStack {
          Spacer(minLength: 0)
          Button(replyTarget == nil ? "Comment" : "Reply") { Task { await postComment(itemId: item.id) } }
            .buttonStyle(.lnSecondaryCompact)
            .disabled((commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && commentAttachments.isEmpty) || postingComment)
        }
      }
      .padding(.top, 8)
    } label: {
      HStack(spacing: 6) {
        Text("Comments").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("\(comments.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .onChange(of: commentsExpanded) { _, expanded in
      if expanded { Task { await loadComments(itemId: item.id, reset: true) } }
    }
  }

  private func loadComments(itemId: String, reset: Bool) async {
    guard !commentsLoading else { return }
    if reset { comments = []; commentsOffset = 0; commentsHasMore = false }
    commentsLoading = true
    commentsFailed = false
    defer { commentsLoading = false }
    do {
      let page = try await store.comments(itemId, offset: commentsOffset)
      guard self.itemId == itemId else { return }
      comments = reset ? page.comments : comments + page.comments
      commentsHasMore = page.hasMore
      commentsOffset = page.nextOffset ?? commentsOffset
    } catch {
      commentsFailed = true
    }
  }

  private func postComment(itemId: String) async {
    let body = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (!body.isEmpty || !commentAttachments.isEmpty), !postingComment else { return }
    postingComment = true
    commentPostFailed = false
    defer { postingComment = false }
    do {
      let target = replyTarget
      let rootId = target.map { $0.parentId ?? $0.id }
      let comment = try await store.comment(itemId, body: body, attachments: commentAttachments, parentId: rootId, replyToId: target?.id)
      comments.append(comment)
      commentDraft = ""
      commentAttachments = []
      replyTarget = nil
    } catch {
      commentPostFailed = true
    }
  }

  private func historySource(_ source: String) -> String {
    switch source {
    case "web": String(localized: "on web")
    case "app": String(localized: "on app")
    case "mcp": String(localized: "via MCP")
    default: String(localized: "via API")
    }
  }

  private func historyField(_ field: String) -> String {
    switch field {
    case "title": String(localized: "Title")
    case "description": String(localized: "Description")
    case "publicDescription": String(localized: "Public description")
    case "status": String(localized: "Column")
    case "rank": String(localized: "Position")
    case "priority": String(localized: "Priority")
    case "assignee": String(localized: "Assignee")
    case "labels": String(localized: "Labels")
    case "attachments": String(localized: "Files")
    case "targetDate": String(localized: "Target date")
    case "public": String(localized: "Roadmap visibility")
    case "feedbackPostIds": String(localized: "Feedback links")
    case "conversationIds": String(localized: "Conversation links")
    case "relatedItemIds": String(localized: "Related items")
    case "completedAt": String(localized: "Completed")
    case "errorRefs": String(localized: "Linked errors")
    case "errorKeys": String(localized: "Error references")
    default: field
    }
  }

  private func historyValue(_ value: JSONValue) -> String {
    switch value {
    case .string(let value): value.isEmpty ? "—" : value
    case .number(let value): value.formatted(.number)
    case .bool(let value): value ? String(localized: "On") : String(localized: "Off")
    case .null: "—"
    case .array(let values): values.map(historyValue).joined(separator: ", ")
    case .object(let fields): fields.keys.sorted().compactMap { key in fields[key].map { "\(key): \(historyValue($0))" } }.joined(separator: ", ")
    }
  }

  private func historyValue(_ field: String, _ value: JSONValue) -> String {
    if case .string(let key) = value {
      if field == "status", let status = store.config?.status(key) { return status.label }
      if field == "assignee", let agent = store.agent(key) { return agent.name }
    }
    if field == "labels", case .array(let values) = value {
      return values.map { value in
        guard case .string(let key) = value else { return historyValue(value) }
        return store.config?.label(key).label ?? key
      }.joined(separator: ", ")
    }
    return historyValue(value)
  }

  private func historyTimestamp(_ raw: String) -> String {
    DateText.date(raw)?.formatted(date: .abbreviated, time: .shortened) ?? raw
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

  private func relatedRow(_ other: BoardRelatedItem) -> some View {
    HStack(spacing: 8) {
      Text(other.number.map { "#\($0) \(other.title)" } ?? other.title).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 0)
      if let status = store.config?.status(other.status) {
        Text(status.label).font(.lnCaption).foregroundStyle(Theme.textToned)
      }
      Button { Task { await setLink("item", other.id, false) } } label: {
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textMuted).frame(width: 24, height: 24).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(linking)
      .accessibilityLabel("Unrelate \(other.title)")
    }
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

  private func loadHistory(itemId: String, reset: Bool) async {
    guard !historyLoading else { return }
    if reset {
      history = []
      historyOffset = 0
      historyHasMore = false
    }
    historyLoading = true
    historyFailed = false
    defer { historyLoading = false }
    do {
      let page = try await store.history(itemId, offset: historyOffset)
      guard self.itemId == itemId else { return }
      history = reset ? page.history : history + page.history
      historyHasMore = page.hasMore
      historyOffset = page.nextOffset ?? historyOffset
    } catch {
      historyFailed = true
    }
  }

  /// The AI reads the description and writes the title. `manual` is the AI button: it replaces a title and says
  /// why when it fails. Otherwise a title typed in the meantime stays.
  private func writeTitle(manual: Bool = false) async {
    let description = draft.description.trimmed
    guard !description.isEmpty else { return }
    titleRun += 1
    let run = titleRun
    writingTitle = true
    defer { if run == titleRun { writingTitle = false } }
    do {
      let title = try await store.suggestTitle(description)
      guard run == titleRun, manual || draft.title.trimmed.isEmpty else { return }
      draft.title = String(title.prefix(BoardTitle.maxLength))
    } catch {
      if manual, run == titleRun { self.error = error.localizedDescription }
    }
  }

  private func save() async {
    guard let config = store.config else { return }
    saving = true
    // Create with no title: the AI writes it now; with no AI, the description's first line stands in.
    if itemId == nil, draft.title.trimmed.isEmpty {
      await writeTitle()
      if draft.title.trimmed.isEmpty { draft.title = BoardTitle.fallback(draft.description) }
    }
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
      BoardItemDraft.forget(for: store.projectId)
      if historyExpanded { await loadHistory(itemId: item.id, reset: true) }
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
      // A related item is linked on the other side too, so the board is read again.
      if kind == "item" { await store.load() }
      if historyExpanded { await loadHistory(itemId: itemId, reset: true) }
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
private struct BoardItemDraft: Equatable, Codable {
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

  private static func key(_ projectId: String) -> String { "helpbites.board.draft.\(projectId)" }

  static func stored(for projectId: String) -> BoardItemDraft? {
    UserDefaults.standard.data(forKey: key(projectId)).flatMap { try? JSONDecoder().decode(BoardItemDraft.self, from: $0) }
  }

  static func forget(for projectId: String) { UserDefaults.standard.removeObject(forKey: key(projectId)) }

  /// Kept while it has content; an empty form forgets the draft.
  func store(for projectId: String) {
    let hasContent = !title.trimmed.isEmpty || !description.trimmed.isEmpty || !publicDescription.trimmed.isEmpty || !labels.isEmpty || !attachments.isEmpty
    if hasContent, let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.key(projectId)) } else { Self.forget(for: projectId) }
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

private extension String {
  var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
