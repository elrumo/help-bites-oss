import SwiftUI

/// One post, as the web's slide-over edits it: every field an admin sets, merging it
/// into another post, deleting it, and its thread, where the team replies, leaves
/// internal notes, and pins, hides or deletes comments.
struct FeedbackPostEditor: View {
  let store: FeedbackBoardStore
  @State private var postId: String?
  @State private var draft: FeedbackPostDraft
  @State private var mergeInto = ""
  @State private var commentDraft = ""
  @State private var internalNote = false
  @State private var savingPost = false
  @State private var justSaved = false
  @State private var merging = false
  @State private var commenting = false
  @State private var confirmDelete = false
  @State private var deletingComment: FeedbackComment?
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(Workspace.self) private var workspace

  init(store: FeedbackBoardStore, postId: String?) {
    self.store = store
    _postId = State(initialValue: postId)
    _draft = State(initialValue: FeedbackPostDraft(post: store.posts.first { $0.id == postId }, defaultStatus: store.config?.defaultStatusKey ?? ""))
  }

  private var current: FeedbackPost? { postId.flatMap { id in store.posts.first { $0.id == id } } }

  private var title: String {
    guard postId != nil else { return "New post" }
    return current?.number.map { "Post #\($0)" } ?? "Post"
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        if let config = store.config {
          VStack(alignment: .leading, spacing: 20) {
            form(config)
            if let current {
              boardLinks(current)
              thread(current)
            }
          }
          .frame(maxWidth: 640, alignment: .leading)
          .padding(20)
          .frame(maxWidth: .infinity)
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(justSaved ? "Saved" : postId == nil ? "Post" : "Save") { Task { await save() } }
            .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || savingPost)
        }
      }
      .feedbackErrorAlert($error)
      .confirmationDialog("Delete this post?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete post", role: .destructive) { Task { await deletePost() } }
      } message: {
        Text("Its votes, comments and followers go with it.")
      }
      .confirmationDialog(
        "Delete this comment?",
        isPresented: Binding(get: { deletingComment != nil }, set: { if !$0 { deletingComment = nil } }),
        titleVisibility: .visible,
        presenting: deletingComment
      ) { comment in
        Button("Delete comment", role: .destructive) { Task { await run { try await store.deleteComment(comment) } } }
      }
      .task(id: postId) { await load() }
      .onDisappear {
        if store.openPostId == postId {
          store.openPostId = nil
          store.comments = []
        }
      }
    }
    .presentationDetents([.large])
  }

  // MARK: Form

  @ViewBuilder private func form(_ config: FeedbackBoardConfig) -> some View {
    if let current { meta(current) } else { Text("Posted as the team").font(.lnMeta).foregroundStyle(Theme.textMuted) }

    LabeledField(label: "Title") {
      TextField("", text: $draft.title)
        .textFieldStyle(.linear)
        .onChange(of: draft.title) { _, value in if value.count > 200 { draft.title = String(value.prefix(200)) } }
    }
    LabeledField(label: "Text", hint: "Markdown or HTML") { LinearTextEditor(text: $draft.body, minHeight: 120) }

    if sizeClass == .regular {
      HStack(alignment: .top, spacing: 12) { pickers(config) }
    } else {
      pickers(config)
    }

    if !config.tags.isEmpty { tagPicker(config) }

    Card {
      CardRow { FeedbackToggleRow(title: "Featured", detail: "Highlight on roadmaps and landing pages", isOn: $draft.featured) }
      CardRow { FeedbackToggleRow(title: "On changelog", detail: "Once done", isOn: $draft.showOnChangelog) }
      CardRow { FeedbackToggleRow(title: "Hidden", detail: "Only admins see it", isOn: $draft.hidden) }
      CardRow(divider: false) { FeedbackToggleRow(title: "Locked", detail: "Only the team can vote, comment or react", isOn: $draft.locked) }
    }

    LabeledField(label: "Shipped in", hint: "A release or changelog entry") {
      TextField("v2.4", text: $draft.shippedIn).textFieldStyle(.linear).autocorrectionDisabled()
    }

    if let current {
      LabeledField(label: "Duplicate of", hint: current.duplicateOf.map { "#\($0.number.map(String.init) ?? "?") \($0.title)" } ?? "Merge into another post") {
        let target = mergeInto.trimmingCharacters(in: .whitespacesAndNewlines)
        HStack(spacing: 8) {
          TextField("#12", text: $mergeInto).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
          Button(current.duplicateOf != nil && target.isEmpty ? "Unlink" : "Merge") { Task { await merge() } }
            .buttonStyle(.lnSecondaryCompact)
            .disabled(merging || (target.isEmpty && current.duplicateOf == nil))
        }
      }
    }

    LabeledField(label: "Team note", hint: "Private to admins") { LinearTextEditor(text: $draft.adminNote, minHeight: 64) }

    VStack(alignment: .leading, spacing: 14) {
      SectionLabel("Changelog entry")
      LabeledField(label: "Title", hint: "Defaults to the post title") { TextField("", text: $draft.changelogTitle).textFieldStyle(.linear) }
      HStack(alignment: .top, spacing: 12) {
        LabeledField(label: "Icon") {
          TextField("Emoji or lucide:rocket", text: $draft.icon).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        LabeledField(label: "Shipped on") { shippedOn }
      }
      LabeledField(label: "Text", hint: "Markdown; defaults to the post text") { LinearTextEditor(text: $draft.changelogBody, minHeight: 72) }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))

    if let current, !(current.externalId ?? "").isEmpty || !(current.metadata ?? [:]).isEmpty {
      DisclosureGroup {
        CodeBlock(code: integrationJSON(current)).padding(.top, 8)
      } label: {
        Text("Integration data").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      .tint(Theme.textMuted)
    }

    HStack(spacing: 4) {
      if postId != nil {
        Button { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }.buttonStyle(GhostButtonStyle(tint: Theme.error))
      }
      if let current, let url = FeedbackFormat.postURL(config, current) {
        Link(destination: url) { Label("Open on site", systemImage: "arrow.up.right.square") }.buttonStyle(.lnGhost)
      }
    }
  }

  @ViewBuilder private func pickers(_ config: FeedbackBoardConfig) -> some View {
    let none = FeedbackOption(value: "", label: "None")
    LabeledField(label: "Status") {
      FeedbackSelect(options: config.statuses.map { FeedbackOption(value: $0.key, label: $0.label, color: $0.color) }, selection: $draft.status)
    }
    LabeledField(label: "Type") {
      FeedbackSelect(options: [none] + config.types.map { FeedbackOption(value: $0.key, label: $0.label) }, selection: $draft.type)
    }
    LabeledField(label: "Platform") {
      FeedbackSelect(options: [none] + config.platforms.map { FeedbackOption(value: $0.key, label: $0.label) }, selection: $draft.platform)
        .disabled(config.platforms.isEmpty)
    }
  }

  private func tagPicker(_ config: FeedbackBoardConfig) -> some View {
    // A tag the board no longer defines still shows while the post carries it, so it can be taken off.
    let tags = config.tags + draft.tags.filter { key in !config.tags.contains { $0.key == key } }.map { config.tag($0) }
    let full = draft.tags.count >= 4
    return LabeledField(label: "Tags", hint: "Up to 4") {
      FlowLayout(spacing: 6) {
        ForEach(tags) { tag in
          let on = draft.tags.contains(tag.key)
          Pill(label: tag.label, systemImage: on ? "checkmark" : nil, isActive: on) {
            if on { draft.tags.removeAll { $0 == tag.key } } else if !full { draft.tags.append(tag.key) }
          }
          .disabled(!on && full)
          .opacity(!on && full ? 0.4 : 1)
        }
      }
    }
  }

  @ViewBuilder private var shippedOn: some View {
    if let date = FeedbackFormat.date(day: draft.shippedOn) {
      HStack(spacing: 4) {
        DatePicker("Shipped on", selection: Binding(get: { date }, set: { draft.shippedOn = FeedbackFormat.day($0) }), displayedComponents: .date)
          .labelsHidden()
        Button { draft.shippedOn = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDimmed) }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear the date")
        Spacer(minLength: 0)
      }
      .frame(minHeight: 40)
    } else {
      Button { draft.shippedOn = FeedbackFormat.day(Date()) } label: {
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
      .accessibilityLabel("Set the shipped date")
    }
  }

  /// Votes, comments, when and by whom, with the author's email and external id.
  private func meta(_ post: FeedbackPost) -> some View {
    FlowLayout(spacing: 12) {
      HStack(spacing: 3) {
        Image(systemName: "chevron.up").font(.system(size: 10, weight: .bold))
        Text("\(post.voteCount) votes").fontWeight(.semibold)
      }
      .foregroundStyle(Theme.text)
      Text("\(post.commentCount) comments")
      Text("Posted \(FeedbackFormat.timeAgo(post.createdAt))")
      if let author = post.author {
        let name = author.isTeam ? "\(author.name.isEmpty ? "Team" : author.name) (team)" : author.name.isEmpty ? "a user" : author.name
        Text("by \(Text(name).fontWeight(.medium).foregroundStyle(Theme.text))")
        if let email = author.email, !email.isEmpty {
          if let url = URL(string: "mailto:\(email)") { Link(email, destination: url) } else { Text(email) }
        }
        if let externalId = author.externalId, !externalId.isEmpty { Text(externalId).font(.lnMono) }
      }
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.textMuted)
  }

  private func integrationJSON(_ post: FeedbackPost) -> String {
    struct Integration: Encodable { let externalId: String?; let metadata: [String: JSONValue]? }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(Integration(externalId: post.externalId, metadata: post.metadata)) else { return "" }
    return String(decoding: data, as: UTF8.self)
  }

  // MARK: Board

  /// The board items this post feeds, when the server has project boards.
  @ViewBuilder private func boardLinks(_ post: FeedbackPost) -> some View {
    if workspace.project(store.projectId)?.board != nil {
      VStack(alignment: .leading, spacing: 10) {
        Rectangle().fill(Theme.borderMuted).frame(height: 1).padding(.top, 12)
        Text("Board").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        BoardLinksSection(projectId: store.projectId, kind: "feedback", targetId: post.id, title: post.title, description: post.body)
          .padding(.horizontal, -8)
      }
    }
  }

  // MARK: Thread

  private func thread(_ post: FeedbackPost) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Rectangle().fill(Theme.borderMuted).frame(height: 1).padding(.top, 12)
      HStack(spacing: 6) {
        Text("Comments").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("\(store.comments.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
      if store.comments.isEmpty {
        Text("No comments yet.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      ForEach(store.comments) { comment in
        commentRow(comment, pinned: post.pinnedCommentId == comment.id)
      }
      composer
    }
  }

  private func commentRow(_ comment: FeedbackComment, pinned: Bool) -> some View {
    let team = comment.author?.isTeam == true
    let name = comment.author?.name ?? ""
    return HStack(alignment: .top, spacing: 10) {
      if team {
        Image(systemName: "checkmark.seal.fill")
          .font(.system(size: 13))
          .foregroundStyle(.white)
          .frame(width: 28, height: 28)
          .background(Theme.accent, in: Circle())
          .accessibilityHidden(true)
      } else {
        Avatar(name: name.isEmpty ? "?" : name, size: 28)
      }
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .top, spacing: 6) {
          FlowLayout(spacing: 6) {
            Text(name.isEmpty ? "User" : name).font(.lnCaptionMedium).foregroundStyle(Theme.textHighlighted)
            if team { chip("Team", foreground: Theme.accentText, background: Theme.accent.opacity(0.12)) }
            if let email = comment.author?.email, !email.isEmpty { Text(email).font(.lnCaption).foregroundStyle(Theme.textMuted) }
            Text(FeedbackFormat.timeAgo(comment.createdAt) + (comment.editedAt == nil ? "" : " · edited")).font(.lnCaption).foregroundStyle(Theme.textMuted)
            if comment.visibility != "public" { chip(comment.visibility.capitalized, foreground: Theme.textToned, background: Theme.elevated) }
            if pinned { Image(systemName: "pin.fill").font(.system(size: 11)).foregroundStyle(Theme.accentText).accessibilityLabel("Pinned") }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          commentMenu(comment, pinned: pinned)
        }
        Text(FeedbackFormat.attributed(comment.body))
          .font(.lnCallout)
          .foregroundStyle(Theme.text)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(comment.visibility == "internal" ? 8 : 0)
    .background(comment.visibility == "internal" ? Theme.warning.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .opacity(comment.visibility == "hidden" ? 0.5 : 1)
    .padding(.leading, comment.parentId == nil ? 0 : 38)
  }

  private func chip(_ text: String, foreground: Color, background: Color) -> some View {
    Text(text)
      .font(.system(size: 10, weight: .semibold))
      .foregroundStyle(foreground)
      .padding(.horizontal, 6)
      .frame(height: 16)
      .background(background, in: Capsule())
  }

  private func commentMenu(_ comment: FeedbackComment, pinned: Bool) -> some View {
    Menu {
      if comment.visibility == "public" && comment.parentId == nil {
        Button { Task { await run { try await store.togglePin(comment) } } } label: {
          Label(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin")
        }
      }
      if comment.visibility != "internal" {
        let hidden = comment.visibility == "hidden"
        Button { Task { await run { try await store.setVisibility(comment, hidden ? "public" : "hidden") } } } label: {
          Label(hidden ? "Show comment" : "Hide comment", systemImage: hidden ? "eye" : "eye.slash")
        }
      }
      Button(role: .destructive) { deletingComment = comment } label: { Label("Delete comment", systemImage: "trash") }
    } label: {
      Image(systemName: "ellipsis")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(Theme.textMuted)
        .frame(width: 28, height: 22)
        .contentShape(Rectangle())
    }
    .accessibilityLabel("Comment actions")
  }

  /// Reply as the team, or (lock on) leave a note only admins see; ⌘↩ sends.
  private var composer: some View {
    let empty = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .bottom, spacing: 8) {
        TextField(internalNote ? "Note for the team only…" : "Reply as the team…", text: $commentDraft, axis: .vertical)
          .lineLimit(1...6)
          .font(.lnBody)
          .padding(.horizontal, 12)
          .padding(.vertical, 10)
          .background(internalNote ? Theme.warning.opacity(0.06) : Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(internalNote ? Theme.warning.opacity(0.5) : Theme.border))
        Button { internalNote.toggle() } label: {
          Image(systemName: internalNote ? "lock.fill" : "lock")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(internalNote ? Theme.warning : Theme.textMuted)
            .frame(width: 36, height: 40)
            .background(internalNote ? Theme.warning.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Internal note")
        .accessibilityValue(internalNote ? "On" : "Off")
        Button(internalNote ? "Add note" : "Reply") { Task { await sendComment() } }
          .buttonStyle(.lnPrimaryCompact)
          .frame(height: 40)
          .disabled(empty || commenting)
          .keyboardShortcut(.return, modifiers: .command)
      }
      if internalNote {
        Text("Internal note: only admins see it, nobody is emailed").font(.lnCaption).foregroundStyle(Theme.warning)
      }
    }
  }

  // MARK: Actions

  private func load() async {
    guard let postId else { return }
    if store.openPostId != postId { store.comments = [] }
    store.openPostId = postId
    let before = draft
    do {
      let post = try await store.loadDetail(postId)
      // Fresh values, unless someone started editing while they loaded.
      if draft == before { draft = FeedbackPostDraft(post: post, defaultStatus: store.config?.defaultStatusKey ?? "") }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func save() async {
    guard let config = store.config else { return }
    savingPost = true
    do {
      let post = try await store.savePost(id: postId, input: draft.input(sendTags: !config.tags.isEmpty, editing: postId != nil))
      savingPost = false
      draft = FeedbackPostDraft(post: post, defaultStatus: config.defaultStatusKey)
      mergeInto = ""
      postId = post.id
      justSaved = true
      try? await Task.sleep(for: .seconds(1.6))
      justSaved = false
    } catch {
      savingPost = false
      self.error = error.localizedDescription
    }
  }

  private func deletePost() async {
    guard let postId else { return }
    do {
      try await store.deletePost(postId)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func merge() async {
    guard let postId else { return }
    var target = mergeInto.trimmingCharacters(in: .whitespacesAndNewlines)
    if target.hasPrefix("#") { target.removeFirst() }
    merging = true
    defer { merging = false }
    do {
      let post = try await store.merge(postId, into: target.isEmpty ? nil : target)
      draft = FeedbackPostDraft(post: post, defaultStatus: store.config?.defaultStatusKey ?? "")
      mergeInto = ""
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func sendComment() async {
    let body = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !body.isEmpty, let postId else { return }
    commenting = true
    defer { commenting = false }
    do {
      try await store.addComment(postId: postId, body: body, internalNote: internalNote)
      commentDraft = ""
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func run(_ action: () async throws -> Void) async {
    do { try await action() } catch { self.error = error.localizedDescription }
  }
}

/// The editor's fields, as the web's `editing` holds them.
private struct FeedbackPostDraft: Equatable {
  var title = "", body = "", status = "", type = "", platform = ""
  var tags: [String] = []
  var featured = false, showOnChangelog = false, hidden = false, locked = false
  var shippedIn = "", adminNote = "", changelogTitle = "", changelogBody = "", icon = ""
  /// "2026-10-02", like the web's date input; '' for none.
  var shippedOn = ""

  init(post: FeedbackPost?, defaultStatus: String) {
    guard let post else {
      status = defaultStatus
      return
    }
    title = post.title
    body = post.body
    status = post.status
    type = post.type
    platform = post.platform
    tags = post.tags
    featured = post.featured
    showOnChangelog = post.showOnChangelog
    hidden = post.hidden
    locked = post.locked
    shippedIn = post.shippedIn
    adminNote = post.adminNote ?? ""
    changelogTitle = post.changelogTitle
    changelogBody = post.changelogBody
    icon = post.icon
    shippedOn = String((post.completedAt ?? "").prefix(10))
  }

  /// The day goes as noon UTC, as on the web; editing without one clears it.
  func input(sendTags: Bool, editing: Bool) -> FeedbackPostInput {
    FeedbackPostInput(
      title: title, body: body, status: status, type: type, platform: platform,
      tags: sendTags ? tags : nil,
      featured: featured, showOnChangelog: showOnChangelog, hidden: hidden, locked: locked,
      shippedIn: shippedIn, adminNote: adminNote, changelogTitle: changelogTitle, changelogBody: changelogBody, icon: icon,
      completedAt: shippedOn.isEmpty ? (editing ? "" : nil) : "\(shippedOn)T12:00:00.000Z"
    )
  }
}
