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

/// The fields of the post editor (web: utils/blogDraft.ts). `patch(against:)` is what changed, as the API's PATCH takes it.
struct BlogPostDraft: Equatable {
  /// post or page.
  var type = "post"
  var title = "", body = "", slug = "", excerpt = "", coverImageUrl = "", coverImageAlt = "", tags = "", authorName = ""
  /// markdown, or html for a post imported from Ghost: it stays HTML, never converted.
  var bodyFormat = "markdown"
  var featured = false
  /// public or members.
  var visibility = "public"
  /// draft or published.
  var status = "draft"
  /// When it goes (or went) public; nil publishes now.
  var publishedAt: Date?
  var commentsOpen = true
  /// What search engines and link previews show; empty falls back to the post's own.
  var metaTitle = "", metaDescription = "", ogImageUrl = "", canonicalUrl = ""

  init(type: String = "post") { self.type = type }
  init(post: BlogPost?) {
    guard let post else { return }
    type = post.type
    title = post.title
    body = post.body
    bodyFormat = post.bodyFormat
    slug = post.slug
    excerpt = post.excerptWritten ? post.excerpt : ""
    coverImageUrl = post.coverImageUrl
    coverImageAlt = post.coverImageAlt
    tags = post.tags.joined(separator: ", ")
    featured = post.featured
    visibility = post.visibility
    authorName = post.authorName
    status = post.status
    publishedAt = blogDate(post.publishedAt)
    commentsOpen = post.commentsOpen
    metaTitle = post.metaTitle
    metaDescription = post.metaDescription
    ogImageUrl = post.ogImageUrl
    canonicalUrl = post.canonicalUrl
  }

  var tagList: [String] {
    tags.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  /// The text fields trimmed and sent as null when emptied (web: CLEARABLE).
  private var clearable: [(String, String)] {
    [("coverImageUrl", coverImageUrl), ("coverImageAlt", coverImageAlt), ("metaTitle", metaTitle), ("metaDescription", metaDescription), ("ogImageUrl", ogImageUrl), ("canonicalUrl", canonicalUrl)]
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
    for ((key, value), (_, old)) in zip(clearable, saved.clearable) { text(key, value, old, empty: .null) }
    text("authorName", authorName, saved.authorName)
    if tagList != saved.tagList { out["tags"] = .array(tagList.map { .string($0) }) }
    if type != saved.type { out["type"] = .string(type) }
    if featured != saved.featured { out["featured"] = .bool(featured) }
    if visibility != saved.visibility { out["visibility"] = .string(visibility) }
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

  /// A new post's (or page's) whole body.
  func createBody() -> [String: JSONValue] {
    var out: [String: JSONValue] = [
      "type": .string(type),
      "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
      "body": .string(body),
      "bodyFormat": .string(bodyFormat),
      "tags": .array(tagList.map { .string($0) }),
      "featured": .bool(featured),
      "visibility": .string(visibility),
      "status": .string(status),
      "commentsOpen": .bool(commentsOpen)
    ]
    for (key, value) in [("slug", slug), ("excerpt", excerpt), ("authorName", authorName)] + clearable {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { out[key] = .string(trimmed) }
    }
    if let publishedAt { out["publishedAt"] = .string(blogISO(publishedAt)) }
    return out
  }
}

/// One post or page (web: pages/projects/[id]/blog/[postId].vue). The web edits it
/// in a rich editor; here the same Markdown is edited as text, with a preview. A
/// post imported from Ghost is HTML: it is edited as HTML text and stays HTML.
struct BlogPostEditor: View {
  let store: BlogStore
  @State private var postId: String?
  @State private var draft: BlogPostDraft
  @State private var filled: Bool
  @State private var previewing = false
  @State private var seoOpen = false
  @State private var saving = false
  @State private var justSaved = false
  @State private var uploading = ""
  @State private var bodyPhoto: PhotosPickerItem?
  @State private var coverPhoto: PhotosPickerItem?
  @State private var confirmDelete = false
  @State private var confirmClose = false
  @State private var newsletter = false
  @State private var aiOpen = false
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass

  init(store: BlogStore, postId: String?, kind: BlogKind = .post) {
    self.store = store
    _postId = State(initialValue: postId)
    _draft = State(initialValue: BlogPostDraft(type: kind.rawValue))
    // The list has no bodies: an existing post is filled once its full copy loads.
    _filled = State(initialValue: postId == nil)
  }

  private var current: BlogPost? { postId.flatMap { store.post($0) } }
  private var isPage: Bool { draft.type == "page" }
  private var isHTML: Bool { draft.bodyFormat == "html" }
  private var dirty: Bool { current.map { !draft.patch(against: $0).isEmpty } ?? !draft.title.isEmpty }
  private var hasTitle: Bool { !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  private var canSave: Bool { hasTitle && !saving && dirty && filled }
  private var willSchedule: Bool { draft.publishedAt.map { $0 > Date() } ?? false }
  private var scheduled: Bool { draft.status == "published" && willSchedule }

  var body: some View {
    NavigationStack {
      ScrollView {
        if filled {
          VStack(alignment: .leading, spacing: 20) {
            form
            if !isPage { newsletterSection(current) }
            if current != nil {
              Button(role: .destructive) { confirmDelete = true } label: { Label(isPage ? "Delete page" : "Delete post", systemImage: "trash") }
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
      .panelScreen(postId == nil ? (isPage ? "New page" : "New post") : (isPage ? "Page" : "Post"))
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { if dirty { confirmClose = true } else { dismiss() } } }
        if let current, current.live, let url = URL(string: current.url) {
          ToolbarItem(placement: .primaryAction) {
            Button { openURL(url) } label: { Label(current.isPage ? "View the page" : "View the post", systemImage: "safari") }
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
      .confirmationDialog(isPage ? "Delete this page?" : "Delete this post?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button(isPage ? "Delete page" : "Delete post", role: .destructive) { Task { await deletePost() } }
      } message: {
        Text("Its comments and reactions go with it. A newsletter it went out as stays under Email → Campaigns.")
      }
      .sheet(isPresented: $aiOpen) {
        BlogAiSheet(projectId: store.projectId, title: draft.title, bodyText: draft.body) { mode, result in applyAi(mode, result) }
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
        if current.isPage {
          Text("\(current.readingMinutes) min read").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          Text(current.commentCount == 1 ? String(localized: "\(current.readingMinutes) min read · 1 comment") : String(localized: "\(current.readingMinutes) min read · \(current.commentCount) comments"))
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          ForEach(current.reactions, id: \.key) { Text("\($0.emoji) \($0.count)").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
      }
    } else {
      Text("A draft until you publish it").font(.lnMeta).foregroundStyle(Theme.textMuted)
    }

    LabeledField(label: "Title") {
      TextField(isPage ? "Page title" : "Post title", text: $draft.title)
        .textFieldStyle(.linear)
        .onChange(of: draft.title) { _, value in if value.count > BlogLimits.title { draft.title = String(value.prefix(BlogLimits.title)) } }
    }

    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Text").font(.lnMetaMedium).foregroundStyle(Theme.textToned)
        Spacer(minLength: 0)
        if !isHTML {
          Button { aiOpen = true } label: { Label("Write with AI", systemImage: "sparkles") }.buttonStyle(.lnGhost)
        }
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
        if isHTML {
          SandboxedWebView(html: htmlPreview(draft.body))
            .frame(maxWidth: .infinity).frame(height: 360)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
        } else {
          KnowledgeMarkdown(text: draft.body)
            .frame(maxWidth: .infinity, minHeight: 280, alignment: .topLeading)
            .padding(12)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
        }
      } else if isHTML {
        LinearTextEditor(text: $draft.body, placeholder: "<p>HTML</p>", minHeight: 280, monospaced: true, onPasteImage: { data in Task { await paste(data) } })
      } else {
        LinearTextEditor(text: $draft.body, placeholder: String(localized: "Write in Markdown: ## for a heading, **bold**, - for a list"), minHeight: 280, onPasteImage: { data in Task { await paste(data) } })
      }
      Text(isHTML
        ? "HTML, as it came in from Ghost: it stays HTML (the web's editor edits it visually). An image goes in where the text ends."
        : "Markdown, the same as the web's editor saves. An image goes in where the text ends.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
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
    if !isPage { audience }
    LabeledField(label: "Excerpt", hint: "For the list, the feed and link previews; taken from the text when empty") {
      TextField(current.map { $0.excerptWritten ? "" : $0.excerpt } ?? String(localized: "Taken from the text"), text: $draft.excerpt, axis: .vertical)
        .textFieldStyle(.linear).lineLimit(2...6)
        .onChange(of: draft.excerpt) { _, value in if value.count > BlogLimits.excerpt { draft.excerpt = String(value.prefix(BlogLimits.excerpt)) } }
    }
    cover
    if !isPage {
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
    seo
  }

  @ViewBuilder private var publishing: some View {
    LabeledField(label: "Status") {
      FeedbackSelect(options: [FeedbackOption(value: "draft", label: String(localized: "Draft"), color: "neutral"), FeedbackOption(value: "published", label: String(localized: "Published"), color: "success")], selection: $draft.status)
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
      .frame(minHeight: Metrics.scaled(40))
    }
  }

  /// Featured and who reads it: posts only.
  @ViewBuilder private var audience: some View {
    Card {
      CardRow(divider: false) {
        FeedbackToggleRow(title: "Featured", detail: "Shown first: large on the magazine layout, marked on the others.", isOn: $draft.featured)
      }
    }
    LabeledField(
      label: "Who can read it",
      hint: draft.visibility == "members"
        ? "Everyone sees the title and excerpt; the rest is for readers signed in with your app or with their email. The feed carries only the excerpt."
        : "Anyone with the link, the feed and search engines."
    ) {
      FeedbackSelect(options: [FeedbackOption(value: "public", label: String(localized: "Everyone")), FeedbackOption(value: "members", label: String(localized: "Members only"))], selection: $draft.visibility)
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
        if !draft.coverImageUrl.isEmpty {
          TextField("Describe the image (alt text)", text: $draft.coverImageAlt)
            .textFieldStyle(.linear)
            .accessibilityLabel("Describe the image (alt text)")
            .onChange(of: draft.coverImageAlt) { _, value in if value.count > BlogLimits.alt { draft.coverImageAlt = String(value.prefix(BlogLimits.alt)) } }
        }
      }
    }
  }

  // MARK: Search and social

  /// What search engines and link previews show (web: the collapsible in BlogPostSettings.vue).
  private var seo: some View {
    DisclosureGroup(isExpanded: $seoOpen) {
      VStack(alignment: .leading, spacing: 16) {
        searchPreview
        counted("Title for search engines", draft.metaTitle.count, guide: BlogLimits.metaTitleGuide) {
          TextField(draft.title, text: $draft.metaTitle)
            .textFieldStyle(.linear)
            .onChange(of: draft.metaTitle) { _, value in if value.count > BlogLimits.metaTitle { draft.metaTitle = String(value.prefix(BlogLimits.metaTitle)) } }
        }
        counted("Description for search engines", draft.metaDescription.count, guide: BlogLimits.metaDescriptionGuide) {
          TextField(descriptionFallback, text: $draft.metaDescription, axis: .vertical)
            .textFieldStyle(.linear).lineLimit(2...5)
            .onChange(of: draft.metaDescription) { _, value in if value.count > BlogLimits.metaDescription { draft.metaDescription = String(value.prefix(BlogLimits.metaDescription)) } }
        }
        LabeledField(label: "Image for link previews", hint: "The cover when empty.") {
          TextField("https://…", text: $draft.ogImageUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
        }
        LabeledField(label: "Canonical address", hint: "Where the post first appeared, if somewhere else. Search engines credit that address.") {
          TextField("https://…", text: $draft.canonicalUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
        }
      }
      .padding(.top, 12)
    } label: {
      Label("Search and social", systemImage: "magnifyingglass").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
    }
    .tint(Theme.textMuted)
  }

  /// The excerpt as written, else the one taken from the text.
  private var descriptionFallback: String { draft.excerpt.isEmpty ? (current?.excerpt ?? "") : draft.excerpt }

  /// A search result as the post would show in one.
  private var searchPreview: some View {
    let slug = draft.slug.isEmpty ? BlogSlug.from(draft.title) : draft.slug
    let title = draft.metaTitle.isEmpty ? draft.title : draft.metaTitle
    let description = draft.metaDescription.isEmpty ? descriptionFallback : draft.metaDescription
    return VStack(alignment: .leading, spacing: 2) {
      Text("\(store.blogAddress)/\(slug)").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1).truncationMode(.middle)
      Text(title.isEmpty ? String(localized: "Untitled post") : title).font(.app(size: 15, weight: .medium)).foregroundStyle(Theme.info).lineLimit(1)
      Text(description.isEmpty ? String(localized: "The excerpt shows here when there is no description.") : description).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .accessibilityElement(children: .combine)
  }

  /// A field with how much of the search engines' length it uses ("42/60"); longer is allowed, just cut short there.
  private func counted<Field: View>(_ label: String, _ count: Int, guide: Int, @ViewBuilder field: () -> Field) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(LocalizedStringKey(label)).font(.lnMetaMedium).foregroundStyle(Theme.textToned)
        Spacer(minLength: 0)
        Text("\(count)/\(guide)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
      field()
    }
  }

  // MARK: Newsletter

  /// A published post goes out once (a scheduled one's email waits for it to go live);
  /// a draft offers "Publish and email". Campaigns are a plan feature.
  @ViewBuilder private func newsletterSection(_ post: BlogPost?) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Newsletter", systemImage: "envelope").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      if let sent = post?.newsletter, sent.status != "draft", sent.status != "canceled" {
        Text("Went out as a campaign (\(sent.status)). Its numbers are under Email → Campaigns.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      } else if let post, post.status == "published" {
        Text(post.live ? "Email this post to your subscribers, as a campaign." : "Email it to your subscribers when it goes live.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if store.campaignsLocked {
          PlanLockNotice(feature: "campaigns")
        } else {
          Button { newsletter = true } label: { Label("Send as newsletter", systemImage: "paperplane") }
            .buttonStyle(.lnSecondaryCompact)
            .disabled(!post.canSendNewsletter || dirty)
          if dirty && post.canSendNewsletter { Text("Save your changes first.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
      } else {
        Text("Publish the post first: the email links to it.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if store.campaignsLocked {
          PlanLockNotice(feature: "campaigns")
        } else {
          Button { Task { await publishAndEmail() } } label: { Label(willSchedule ? "Schedule and email" : "Publish and email", systemImage: "paperplane") }
            .buttonStyle(.lnSecondaryCompact)
            .disabled(!hasTitle || saving || !filled)
        }
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

  /// Web: "Publish and email". Publishes (or schedules) the post with the rest of the changes, then opens the newsletter.
  private func publishAndEmail() async {
    let before = draft.status
    draft.status = "published"
    if await save() { newsletter = true } else { draft.status = before }
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

  /// The HTML body as a page the preview can draw at the device's width.
  /// The proposal goes into the draft: the text replaces or follows what is there, the rest fills what it offers.
  private func applyAi(_ mode: BlogAiMode, _ result: BlogAiResult) {
    if mode == .continue { draft.body = draft.body.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + result.body }
    else if !result.body.isEmpty { draft.body = result.body }
    guard mode == .write || mode == .meta else { return }
    if !result.title.isEmpty, mode == .write || !hasTitle { draft.title = result.title }
    if !result.excerpt.isEmpty { draft.excerpt = result.excerpt }
    if !result.metaDescription.isEmpty { draft.metaDescription = result.metaDescription }
    if !result.tags.isEmpty { draft.tags = result.tags.joined(separator: ", ") }
  }

  private func htmlPreview(_ body: String) -> String {
    "<!doctype html><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>:root{color-scheme:light dark}body{font:-apple-system-body;font-family:-apple-system,system-ui,sans-serif;margin:12px;line-height:1.5}img,video,iframe{max-width:100%;height:auto}pre{overflow-x:auto}</style>\(body)"
  }

  /// A photo goes to the project's storage: into the text (Markdown, or an `<img>` in an HTML post), or as the cover.
  private func upload(_ item: PhotosPickerItem?, into field: WritableKeyPath<BlogPostDraft, String>) async {
    guard let item else { return }
    uploading = field == \BlogPostDraft.body ? "body" : "cover"
    defer {
      uploading = ""
      bodyPhoto = nil
      coverPhoto = nil
    }
    do {
      guard let data = try await item.loadTransferable(type: Data.self) else { throw APIError.server(String(localized: "Could not read that photo.")) }
      try await place(data, into: field)
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// An image pasted into the body goes to the project's storage and to the end of the text, as a picked photo does.
  private func paste(_ data: Data) async {
    uploading = "body"
    defer { uploading = "" }
    do {
      try await place(data, into: \BlogPostDraft.body)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func place(_ data: Data, into field: WritableKeyPath<BlogPostDraft, String>) async throws {
    let url = try await store.uploadImage(data)
    if field == \BlogPostDraft.body {
      let gap = draft.body.isEmpty || draft.body.hasSuffix("\n\n") ? "" : draft.body.hasSuffix("\n") ? "\n" : "\n\n"
      draft.body += isHTML ? "\(gap)<p><img src=\"\(url)\" alt=\"\"></p>\n" : "\(gap)![](\(url))\n"
    } else {
      draft.coverImageUrl = url
    }
  }
}
