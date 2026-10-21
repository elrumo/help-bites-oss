import PhotosUI
import SwiftUI

private func blogDate(_ raw: String?) -> Date? {
  guard let raw, !raw.isEmpty else { return nil }
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
}

private func blogISO(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}

/// The fields of the post editor. `patch(against:)` is what changed, as the API's PATCH takes it.
struct BlogPostDraft: Equatable {
  var title = "", body = "", slug = "", excerpt = "", coverImageUrl = "", tags = "", authorName = ""
  /// draft or published.
  var status = "draft"
  /// When it goes (or went) public; nil publishes now.
  var publishedAt: Date?
  var commentsOpen = true

  init() {}
  init(post: BlogPost?) {
    guard let post else { return }
    title = post.title
    body = post.body
    slug = post.slug
    excerpt = post.excerptWritten ? post.excerpt : ""
    coverImageUrl = post.coverImageUrl
    tags = post.tags.joined(separator: ", ")
    authorName = post.authorName
    status = post.status
    publishedAt = blogDate(post.publishedAt)
    commentsOpen = post.commentsOpen
  }

  var tagList: [String] {
    tags.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  func patch(against post: BlogPost) -> [String: JSONValue] {
    var out: [String: JSONValue] = [:]
    let saved = BlogPostDraft(post: post)
    func text(_ key: String, _ value: String, _ old: String, empty: JSONValue? = nil) {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed != old { out[key] = trimmed.isEmpty ? (empty ?? .string("")) : .string(trimmed) }
    }
    if !title.trimmingCharacters(in: .whitespaces).isEmpty { text("title", title, saved.title) }
    if body != saved.body { out["body"] = .string(body) }
    if !slug.trimmingCharacters(in: .whitespaces).isEmpty { text("slug", slug, saved.slug) }
    text("excerpt", excerpt, saved.excerpt, empty: .null)
    text("coverImageUrl", coverImageUrl, saved.coverImageUrl, empty: .null)
    text("authorName", authorName, saved.authorName)
    if tagList != saved.tagList { out["tags"] = .array(tagList.map { .string($0) }) }
    if status != saved.status { out["status"] = .string(status) }
    if commentsOpen != saved.commentsOpen { out["commentsOpen"] = .bool(commentsOpen) }
    switch (publishedAt, saved.publishedAt) {
    case (nil, nil): break
    case (let date?, let old?) where abs(date.timeIntervalSince(old)) < 1: break
    case (let date?, _): out["publishedAt"] = .string(blogISO(date))
    case (nil, _): out["publishedAt"] = .null
    }
    return out
  }

  /// A new post's whole body.
  func createBody() -> [String: JSONValue] {
    var out: [String: JSONValue] = [
      "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
      "body": .string(body),
      "tags": .array(tagList.map { .string($0) }),
      "status": .string(status),
      "commentsOpen": .bool(commentsOpen)
    ]
    for (key, value) in [("slug", slug), ("excerpt", excerpt), ("coverImageUrl", coverImageUrl), ("authorName", authorName)] {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { out[key] = .string(trimmed) }
    }
    if let publishedAt { out["publishedAt"] = .string(blogISO(publishedAt)) }
    return out
  }
}

/// One post (web: pages/projects/[id]/blog/[postId].vue). The web edits it in a
/// rich editor; here the same Markdown is edited as text, with a preview.
struct BlogPostEditor: View {
  let store: BlogStore
  @State private var postId: String?
  @State private var draft: BlogPostDraft
  @State private var filled: Bool
  @State private var previewing = false
  @State private var saving = false
  @State private var justSaved = false
  @State private var uploading = ""
  @State private var bodyPhoto: PhotosPickerItem?
  @State private var coverPhoto: PhotosPickerItem?
  @State private var confirmDelete = false
  @State private var confirmClose = false
  @State private var newsletter = false
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass

  init(store: BlogStore, postId: String?) {
    self.store = store
    _postId = State(initialValue: postId)
    _draft = State(initialValue: BlogPostDraft())
    // The list has no bodies: an existing post is filled once its full copy loads.
    _filled = State(initialValue: postId == nil)
  }

  private var current: BlogPost? { postId.flatMap { store.post($0) } }
  private var dirty: Bool { current.map { !draft.patch(against: $0).isEmpty } ?? !draft.title.isEmpty }
  private var canSave: Bool { !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving && dirty && filled }
  private var scheduled: Bool { draft.status == "published" && (draft.publishedAt.map { $0 > Date() } ?? false) }

  var body: some View {
    NavigationStack {
      ScrollView {
        if filled {
          VStack(alignment: .leading, spacing: 20) {
            form
            if let current {
              newsletterSection(current)
              Button(role: .destructive) { confirmDelete = true } label: { Label("Delete post", systemImage: "trash") }
                .buttonStyle(.lnGhost).tint(Theme.error)
            }
            ErrorText(message: error)
          }
          .frame(maxWidth: 680, alignment: .leading)
          .padding(20)
          .frame(maxWidth: .infinity)
        } else if !error.isEmpty {
          EmptyState(systemImage: "newspaper", title: "Post not found", message: error)
        } else {
          SkeletonRows(count: 5)
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(postId == nil ? "New post" : "Post")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { if dirty { confirmClose = true } else { dismiss() } } }
        if let current, current.live, let url = URL(string: current.url) {
          ToolbarItem(placement: .primaryAction) {
            Button { openURL(url) } label: { Label("View the post", systemImage: "safari") }
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(justSaved ? "Saved" : postId == nil ? "Create" : "Save") { Task { await save() } }.disabled(!canSave)
        }
      }
      .confirmationDialog("Discard your changes?", isPresented: $confirmClose, titleVisibility: .visible) {
        Button("Save and close") { Task { if await save() { dismiss() } } }
        Button("Discard", role: .destructive) { dismiss() }
      }
      .confirmationDialog("Delete this post?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete post", role: .destructive) { Task { await deletePost() } }
      } message: {
        Text("Its comments and reactions go with it. A newsletter it went out as stays under Campaigns.")
      }
      .sheet(isPresented: $newsletter) {
        if let current { BlogNewsletterSheet(store: store, post: current) }
      }
      .task { await fill() }
      .onChange(of: bodyPhoto) { _, item in Task { await upload(item, into: \.body) } }
      .onChange(of: coverPhoto) { _, item in Task { await upload(item, into: \.coverImageUrl) } }
    }
    .presentationDetents([.large])
    .changelogSheetSize()
  }

  // MARK: Form

  @ViewBuilder private var form: some View {
    if let current {
      HStack(spacing: 6) {
        BlogChip(text: current.state.label, tint: current.state.tint)
        Text("\(current.readingMinutes) min read · \(current.commentCount) \(current.commentCount == 1 ? "comment" : "comments")")
          .font(.lnMeta).foregroundStyle(Theme.textMuted)
        ForEach(current.reactions, id: \.key) { Text("\($0.emoji) \($0.count)").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      }
    } else {
      Text("A draft until you publish it").font(.lnMeta).foregroundStyle(Theme.textMuted)
    }

    LabeledField(label: "Title") {
      TextField("Post title", text: $draft.title)
        .textFieldStyle(.linear)
        .onChange(of: draft.title) { _, value in if value.count > BlogLimits.title { draft.title = String(value.prefix(BlogLimits.title)) } }
    }

    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Text").font(.lnMetaMedium).foregroundStyle(Theme.textToned)
        Spacer(minLength: 0)
        PhotosPicker(selection: $bodyPhoto, matching: .images, preferredItemEncoding: .compatible) {
          if uploading == "body" { ProgressView().controlSize(.small) } else { Label("Image", systemImage: "photo.badge.plus") }
        }
        .buttonStyle(.lnGhost)
        .disabled(!uploading.isEmpty)
        Picker("View", selection: $previewing) {
          Text("Edit").tag(false)
          Text("Preview").tag(true)
        }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 180)
      }
      if previewing {
        KnowledgeMarkdown(text: draft.body)
          .frame(maxWidth: .infinity, minHeight: 280, alignment: .topLeading)
          .padding(12)
          .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      } else {
        LinearTextEditor(text: $draft.body, placeholder: "Write in Markdown: ## for a heading, **bold**, - for a list", minHeight: 280)
      }
      Text("Markdown, the same as the web's editor saves. An image goes in where the text ends.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }

    if sizeClass == .regular {
      HStack(alignment: .top, spacing: 12) { publishing }
    } else {
      publishing
    }

    LabeledField(label: "Address", hint: "The end of the post's link") {
      TextField(BlogSlug.from(draft.title).isEmpty ? "my-post" : BlogSlug.from(draft.title), text: $draft.slug)
        .textFieldStyle(.linear).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
        .onSubmit { draft.slug = BlogSlug.from(draft.slug) }
    }
    LabeledField(label: "Excerpt", hint: "For the list, the feed and link previews; taken from the text when empty") {
      TextField(current.map { $0.excerptWritten ? "" : $0.excerpt } ?? "Taken from the text", text: $draft.excerpt, axis: .vertical)
        .textFieldStyle(.linear).lineLimit(2...6)
        .onChange(of: draft.excerpt) { _, value in if value.count > BlogLimits.excerpt { draft.excerpt = String(value.prefix(BlogLimits.excerpt)) } }
    }
    cover
    LabeledField(label: "Tags", hint: "Up to \(BlogLimits.tags), comma-separated; readers can filter by them") {
      TextField("Engineering, Releases", text: $draft.tags).textFieldStyle(.linear).autocorrectionDisabled()
    }
    LabeledField(label: "Author") {
      TextField("", text: $draft.authorName).textFieldStyle(.linear)
    }
    Card {
      CardRow(divider: false) {
        FeedbackToggleRow(
          title: "Comments on this post",
          detail: store.settings.comments ? "Close the thread to stop new comments; the old ones stay." : "Comments are off for the whole blog (Settings).",
          isOn: $draft.commentsOpen
        )
      }
    }
  }

  @ViewBuilder private var publishing: some View {
    LabeledField(label: "Status") {
      FeedbackSelect(options: [FeedbackOption(value: "draft", label: "Draft", color: "neutral"), FeedbackOption(value: "published", label: "Published", color: "success")], selection: $draft.status)
    }
    LabeledField(label: draft.status == "published" ? "Published on" : "Publish on", hint: scheduled ? "Scheduled: goes live on its own" : "Empty publishes it now; a later date schedules it") {
      HStack(spacing: 4) {
        if let date = draft.publishedAt {
          DatePicker("Date", selection: Binding(get: { date }, set: { draft.publishedAt = $0 }), displayedComponents: [.date, .hourAndMinute]).labelsHidden()
          Button { draft.publishedAt = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDimmed) }
            .buttonStyle(.plain).accessibilityLabel("Clear the date")
        } else {
          Button { draft.publishedAt = Date() } label: { Label("Set a date", systemImage: "calendar") }.buttonStyle(.lnSecondaryCompact)
        }
        Spacer(minLength: 0)
      }
      .frame(minHeight: 40)
    }
  }

  private var cover: some View {
    LabeledField(label: "Cover image") {
      VStack(alignment: .leading, spacing: 8) {
        if let url = URL(string: draft.coverImageUrl), draft.coverImageUrl.lowercased().hasPrefix("http") {
          CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
            .frame(maxWidth: .infinity).frame(height: 160).clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
            .accessibilityHidden(true)
        }
        HStack(spacing: 8) {
          TextField("https://", text: $draft.coverImageUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
          PhotosPicker(selection: $coverPhoto, matching: .images, preferredItemEncoding: .compatible) {
            if uploading == "cover" { ProgressView().controlSize(.small) } else { Label("Upload", systemImage: "square.and.arrow.up") }
          }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(!uploading.isEmpty)
        }
      }
    }
  }

  @ViewBuilder private func newsletterSection(_ post: BlogPost) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Newsletter", systemImage: "envelope").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      if let sent = post.newsletter, sent.status != "draft", sent.status != "canceled" {
        Text("Went out as a campaign (\(sent.status)). Its numbers are under Campaigns.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      } else {
        Text(post.live ? "Email this post to your subscribers, as a campaign." : "Publish the post first: the email links to it.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        Button { newsletter = true } label: { Label("Send as newsletter", systemImage: "paperplane") }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(!post.canSendNewsletter || dirty)
        if dirty && post.canSendNewsletter { Text("Save your changes first.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  // MARK: Actions

  private func fill() async {
    await store.ensureLoaded()
    guard !filled, let postId else { return }
    do {
      draft = BlogPostDraft(post: try await store.full(postId))
      filled = true
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }

  @discardableResult private func save() async -> Bool {
    saving = true
    defer { saving = false }
    error = ""
    do {
      if let current {
        let patch = draft.patch(against: current)
        if !patch.isEmpty { draft = BlogPostDraft(post: try await store.update(current.id, patch)) }
      } else {
        let post = try await store.create(draft.createBody())
        postId = post.id
        draft = BlogPostDraft(post: post)
      }
      justSaved = true
      Task {
        try? await Task.sleep(for: .seconds(1.5))
        justSaved = false
      }
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  private func deletePost() async {
    guard let current else { return }
    do {
      try await store.delete(current.id)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// A photo goes to the project's storage: into the text as Markdown, or as the cover.
  private func upload(_ item: PhotosPickerItem?, into field: WritableKeyPath<BlogPostDraft, String>) async {
    guard let item else { return }
    uploading = field == \BlogPostDraft.body ? "body" : "cover"
    defer {
      uploading = ""
      bodyPhoto = nil
      coverPhoto = nil
    }
    do {
      guard let data = try await item.loadTransferable(type: Data.self) else { throw APIError.server("Could not read that photo.") }
      let url = try await store.uploadImage(data)
      if field == \BlogPostDraft.body {
        let gap = draft.body.isEmpty || draft.body.hasSuffix("\n\n") ? "" : draft.body.hasSuffix("\n") ? "\n" : "\n\n"
        draft.body += "\(gap)![](\(url))\n"
      } else {
        draft.coverImageUrl = url
      }
    } catch {
      self.error = error.localizedDescription
    }
  }
}
