import SwiftUI

/// The operator's side of a project's feedback board (pages/projects/[id]/feedback.vue):
/// triage it as a list or a kanban, edit and moderate posts, reply as the team, and
/// configure the board. It uses the same /v1/feedback API as the embed, as an operator.
struct FeedbackScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session

  var body: some View {
    FeedbackBoardView(store: FeedbackBoardStore(projectId: projectId, session: session))
  }
}

// MARK: - Store

/// The board's config and posts, the view filters, and the thread of the post open
/// in the editor, kept in one place so live events reach all of them.
@MainActor @Observable final class FeedbackBoardStore {
  enum Layout: Hashable { case list, board }

  let projectId: String
  let session: SessionStore
  var config: FeedbackBoardConfig?
  /// The public changelog's own switch (`changelog.enabled`), from the config response.
  var changelogPublic = false
  var projectName = ""
  var posts: [FeedbackPost] = []
  var loading = true
  var error = ""
  /// A failed quick action (a kanban move), shown as an alert.
  var alert = ""

  // Filters, as the web keeps them: statuses toggle on and off; none on shows every status.
  var statusFilter: [String] = []
  var showHidden = true
  var search = ""
  /// '' is every type.
  var typeFilter = ""
  var layout: Layout = .list

  // Board settings saves.
  var saving = false
  var saveError = ""

  // The post open in the editor, and its thread (internal and hidden comments included).
  var openPostId: String?
  var comments: [FeedbackComment] = []

  init(projectId: String, session: SessionStore) {
    self.projectId = projectId
    self.session = session
  }

  var totalVotes: Int { posts.reduce(0) { $0 + $1.voteCount } }
  var counts: [String: Int] { posts.reduce(into: [:]) { $0[$1.status, default: 0] += 1 } }

  /// Hidden, type and search applied; the board groups these by status.
  var filtered: [FeedbackPost] {
    let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return posts.filter { post in
      (showHidden || !post.hidden) && (typeFilter.isEmpty || post.type == typeFilter)
        && (needle.isEmpty || [post.title, post.body, post.author?.name ?? "", post.author?.email ?? ""].contains { $0.localizedStandardContains(needle) })
    }
  }

  /// The list: `filtered` narrowed to the statuses that are on.
  var visible: [FeedbackPost] { filtered.filter { statusFilter.isEmpty || statusFilter.contains($0.status) } }

  func toggleStatus(_ key: String) {
    if let index = statusFilter.firstIndex(of: key) { statusFilter.remove(at: index) } else { statusFilter.append(key) }
  }

  // MARK: Loading

  func load() async {
    loading = true
    error = ""
    defer { loading = false }
    do {
      let result: ConfigResponse = try await session.get("/v1/feedback/config", query: ["project": projectId])
      config = result.config
      changelogPublic = result.changelogPublic ?? false
      projectName = result.project?.name ?? ""
      // The default filter: everything still being considered or worked on.
      if statusFilter.isEmpty { statusFilter = result.config.statuses.filter { ["open", "planned", "active"].contains($0.category) }.map(\.key) }
      try await loadPosts()
    } catch {
      self.error = error.localizedDescription
    }
  }

  func loadPosts() async throws {
    let result: PostsResponse = try await session.get("/v1/feedback", query: ["project": projectId, "includeHidden": "1", "limit": "500", "sort": "new"])
    posts = result.posts
  }

  func upsert(_ post: FeedbackPost) {
    if let index = posts.firstIndex(where: { $0.id == post.id }) { posts[index] = FeedbackPost.merge(posts[index], post) }
    else { posts.insert(post, at: 0) }
  }

  func remove(_ postId: String) { posts.removeAll { $0.id == postId } }

  // MARK: Board settings

  /// Saved with the project (`PATCH /admin/projects/:id { feedback }`), not through a feedback route.
  @discardableResult
  func saveConfig(_ next: FeedbackBoardConfig) async -> Bool {
    saving = true
    saveError = ""
    defer { saving = false }
    do {
      let result: ProjectResponse = try await session.send("/v1/admin/projects/\(projectId)", method: "PATCH", body: ConfigInput(feedback: next))
      config = result.project.feedback
      if posts.isEmpty { try? await loadPosts() }
      return true
    } catch {
      saveError = error.localizedDescription
      return false
    }
  }

  func enable() async {
    guard var next = config else { return }
    next.enabled = true
    await saveConfig(next)
  }

  // MARK: Posts

  /// The kanban's move: optimistic, put back if the server says no.
  func move(_ postId: String, to status: String) async {
    guard let index = posts.firstIndex(where: { $0.id == postId }), posts[index].status != status else { return }
    let before = posts[index]
    withAnimation(.snappy) {
      posts[index].status = status
      posts[index].statusCategory = config?.status(status).category ?? "open"
    }
    do {
      let result: PostResponse = try await session.send("/v1/feedback/\(postId)", method: "PATCH", body: ["status": status])
      upsert(result.post)
    } catch {
      upsert(before)
      alert = error.localizedDescription
    }
  }

  /// A post with its thread; the editor calls this when it opens.
  func loadDetail(_ postId: String) async throws -> FeedbackPost {
    let result: DetailResponse = try await session.get("/v1/feedback/\(postId)")
    upsert(result.post)
    if openPostId == postId { comments = result.comments }
    return result.post
  }

  func savePost(id: String?, input: FeedbackPostInput) async throws -> FeedbackPost {
    let post: FeedbackPost
    if let id {
      let result: PostResponse = try await session.send("/v1/feedback/\(id)", method: "PATCH", body: input)
      post = result.post
    } else {
      post = try await createPost(input)
    }
    upsert(post)
    if !statusFilter.isEmpty && !statusFilter.contains(post.status) { statusFilter.append(post.status) }
    return post
  }

  func deletePost(_ postId: String) async throws {
    try await session.delete("/v1/feedback/\(postId)")
    remove(postId)
  }

  /// Merge into another post (an id, `#number` or external id), or nil to unlink.
  func merge(_ postId: String, into target: String?) async throws -> FeedbackPost {
    let result: MergeResponse = try await session.send("/v1/feedback/\(postId)/merge", body: ["into": target.map(JSONValue.string) ?? .null])
    upsert(result.post)
    if let into = result.into { upsert(into) }
    return result.post
  }

  // MARK: Comments

  func addComment(postId: String, body: String, internalNote: Bool) async throws {
    let result: CommentResponse = try await session.send("/v1/feedback/\(postId)/comments", body: CommentInput(body: body, visibility: internalNote ? "internal" : nil))
    if openPostId == postId, !comments.contains(where: { $0.id == result.comment.id }) { comments.append(result.comment) }
    upsert(result.post)
  }

  func setVisibility(_ comment: FeedbackComment, _ visibility: String) async throws {
    let result: CommentResponse = try await session.send("/v1/feedback/\(comment.postId)/comments/\(comment.id)", method: "PATCH", body: ["visibility": visibility])
    replace(result.comment)
    upsert(result.post)
  }

  /// Only a public, top-level comment can be pinned.
  func togglePin(_ comment: FeedbackComment) async throws {
    let pinned = posts.first { $0.id == comment.postId }?.pinnedCommentId == comment.id
    let result: PostResponse = try await session.send("/v1/feedback/\(comment.postId)", method: "PATCH", body: ["pinnedCommentId": pinned ? JSONValue.null : .string(comment.id)])
    upsert(result.post)
  }

  func deleteComment(_ comment: FeedbackComment) async throws {
    // DELETE through `send`, for the post (and its new comment count) it answers with.
    let result: PostResponse = try await session.send("/v1/feedback/\(comment.postId)/comments/\(comment.id)", method: "DELETE")
    comments.removeAll { $0.id == comment.id }
    upsert(result.post)
  }

  private func replace(_ comment: FeedbackComment) {
    guard let index = comments.firstIndex(where: { $0.id == comment.id }) else { return }
    var next = comment
    next.author = FeedbackAuthor.merge(comments[index].author, comment.author)
    comments[index] = next
  }

  // MARK: Live updates

  /// Follows `/v1/feedback/events` until the screen goes away; after a dropped
  /// connection it reconnects with backoff and reloads, so nothing is missed.
  func listen() async {
    var attempt = 0
    var connectedBefore = false
    while !Task.isCancelled {
      do {
        var request = try rawRequest("/v1/feedback/events", query: [URLQueryItem(name: "project", value: projectId)])
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        if connectedBefore { try? await loadPosts() }
        connectedBefore = true
        attempt = 0
        // Each event's JSON is one `data:` line (`lines` skips the blank separators).
        for try await line in bytes.lines where line.hasPrefix("data:") {
          if let event = try? JSONDecoder().decode(LiveEvent.self, from: Data(line.dropFirst(5).utf8)) { await apply(event) }
        }
      } catch {}
      if Task.isCancelled { return }
      attempt += 1
      try? await Task.sleep(for: .seconds(min(30, 1 << min(attempt, 5))))
    }
  }

  private func apply(_ event: LiveEvent) async {
    switch event.type {
    case "feedback.post.created", "feedback.post.updated":
      if let post = event.post { upsert(post) }
    case "feedback.post.deleted":
      if let postId = event.postId { remove(postId) }
    case "feedback.comment.created", "feedback.comment.updated", "feedback.comment.deleted":
      guard let postId = event.postId else { return }
      if let count = event.commentCount, let index = posts.firstIndex(where: { $0.id == postId }) { posts[index].commentCount = count }
      guard postId == openPostId else { return }
      if event.type == "feedback.comment.deleted" {
        comments.removeAll { $0.id == event.commentId }
      } else if let comment = event.comment {
        if comments.contains(where: { $0.id == comment.id }) { replace(comment) }
        // Events carry the public view of a comment; fetch the thread as an admin sees it.
        else if let result: CommentsResponse = try? await session.get("/v1/feedback/\(postId)/comments"), openPostId == postId { comments = result.comments }
      }
    default:
      break
    }
  }

  // MARK: Raw requests

  /// Creating a post names the project in the query (an operator posts as the team).
  private func createPost(_ input: FeedbackPostInput) async throws -> FeedbackPost {
    let result: PostResponse = try await session.send("/v1/feedback?project=\(projectId)", body: input)
    return result.post
  }

  private func rawRequest(_ path: String, query: [URLQueryItem]) throws -> URLRequest {
    guard var components = URLComponents(string: session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else { throw APIError.invalidURL }
    components.path += path
    components.queryItems = query
    guard let url = components.url else { throw APIError.invalidURL }
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    // The workspace the app acts in, as APIClient sends it.
    if let workspace = UserDefaults.standard.string(forKey: "helpbites.workspace"), !workspace.isEmpty { request.setValue(workspace, forHTTPHeaderField: "X-Workspace") }
    return request
  }

  // MARK: Wire

  private struct ConfigResponse: Decodable, Sendable {
    struct ProjectName: Decodable, Sendable { let name: String }
    let config: FeedbackBoardConfig
    let project: ProjectName?
    /// Whether the public changelog is on; nil from an older server.
    let changelogPublic: Bool?
  }
  private struct PostsResponse: Decodable, Sendable { let posts: [FeedbackPost] }
  private struct PostResponse: Decodable, Sendable { let post: FeedbackPost }
  private struct DetailResponse: Decodable, Sendable { let post: FeedbackPost; let comments: [FeedbackComment] }
  private struct CommentsResponse: Decodable, Sendable { let comments: [FeedbackComment] }
  private struct CommentResponse: Decodable, Sendable { let comment: FeedbackComment; let post: FeedbackPost }
  private struct MergeResponse: Decodable, Sendable { let post: FeedbackPost; let into: FeedbackPost? }
  private struct ProjectResponse: Decodable, Sendable {
    struct Saved: Decodable, Sendable { let feedback: FeedbackBoardConfig }
    let project: Saved
  }
  private struct ConfigInput: Encodable, Sendable { let feedback: FeedbackBoardConfig }
  private struct CommentInput: Encodable, Sendable { let body: String; let visibility: String? }
  private struct LiveEvent: Decodable, Sendable {
    let type: String
    let postId: String?
    let post: FeedbackPost?
    let comment: FeedbackComment?
    let commentId: String?
    let commentCount: Int?
  }
}

// MARK: - Screen

private struct FeedbackEditorRoute: Identifiable {
  let id = UUID()
  let postId: String?
}

private struct FeedbackBoardView: View {
  @State var store: FeedbackBoardStore
  @State private var showSettings = false
  @State private var showAi = false
  @State private var editor: FeedbackEditorRoute?
  /// The post being added to planning, and the AI's progress and result for the banner.
  @State private var planning: FeedbackPost?
  @State private var working = ""
  @State private var notice = ""
  @Environment(Workspace.self) private var workspace

  private var planningOn: Bool { workspace.project(store.projectId)?.board?.enabled == true }

  var body: some View {
    content
      .overlay(alignment: .bottom) {
        if !working.isEmpty { WorkingBanner(message: working) }
        else if !notice.isEmpty { Text(notice).font(.lnMeta).padding(.horizontal, 14).padding(.vertical, 10).background(.regularMaterial, in: Capsule()).padding(.bottom, 16).transition(.opacity) }
      }
      .sheet(item: $planning) { post in
        PlanningAddSheet(projectId: store.projectId, post: post) { notify($0) }
      }
      .panelScreen("Feedback")
      .toolbar { toolbar }
      .sheet(item: $editor) { route in FeedbackPostEditor(store: store, postId: route.postId) }
      .sheet(isPresented: $showAi) { AiCardsSheet(session: store.session, projectId: store.projectId, kind: .feedback) { try? await store.loadPosts() } }
      .sheet(isPresented: $showSettings) {
        if let config = store.config { FeedbackBoardSettingsSheet(store: store, config: config) }
      }
      .feedbackErrorAlert($store.alert)
      .task { await store.load() }
      .task(id: store.config != nil) { if store.config != nil { await store.listen() } }
  }

  @ViewBuilder private var content: some View {
    if let config = store.config {
      if config.enabled {
        VStack(spacing: 0) {
          filterBar(config)
          Rectangle().fill(Theme.border).frame(height: 1)
          results(config)
        }
      } else {
        notEnabled
      }
    } else if !store.error.isEmpty {
      EmptyState(systemImage: "exclamationmark.triangle", title: "Could not load feedback", message: store.error) {
        Button("Try again") { Task { await store.load() } }.buttonStyle(.lnSecondary)
      }
      .frame(maxHeight: .infinity)
    } else {
      SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      VStack(spacing: 1) {
        ProjectBreadcrumb(projectId: store.projectId, title: "Feedback")
        if let config = store.config {
          if config.enabled {
            let posts = store.posts.count == 1 ? String(localized: "1 post") : String(localized: "\(store.posts.count) posts")
            let votes = store.totalVotes == 1 ? String(localized: "1 vote") : String(localized: "\(store.totalVotes) votes")
            Text("\(posts), \(votes)")
              .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
          } else {
            Text("Feedback is off").font(.lnCaption).foregroundStyle(Theme.warning)
          }
        }
      }
    }
    if store.config?.enabled == true {
      ToolbarItemGroup(placement: .topBarTrailing) {
        changelogMenu
        Button { showSettings = true } label: { Label("Settings", systemImage: "slider.horizontal.3") }
        Button { showAi = true } label: { Label("File with AI", systemImage: "sparkles") }
        Button { editor = FeedbackEditorRoute(postId: nil) } label: { Label("New post", systemImage: "plus") }
      }
    }
  }

  /// The public changelog (/changelog/<public key>): copy its link or open it. It has its own
  /// switch (Changelog → Settings) and does not depend on Feedback.
  @ViewBuilder private var changelogMenu: some View {
    let key = workspace.project(store.projectId)?.publicKey ?? ""
    let base = store.session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let url = URL(string: "\(base)/changelog/\(key)")
    let ready = store.changelogPublic && url != nil && !key.isEmpty
    Menu {
      Button {
        if ready { Clipboard.copy(url?.absoluteString) } else { store.alert = String(localized: "Turn on the changelog first: switch on “Public changelog” in Project → Changelog → Settings. It does not depend on Feedback.") }
      } label: { Label("Copy changelog link", systemImage: "link") }
      if ready, let url { Link(destination: url) { Label("Open public changelog", systemImage: "arrow.up.right.square") } }
    } label: { Label("Public changelog", systemImage: "sparkles") }
  }

  // Not set up yet: what public feedback is, and the two ways in.
  private var notEnabled: some View {
    ScrollView {
      EmptyState(
        systemImage: "lightbulb",
        title: "Public feedback for \(store.projectName.isEmpty ? String(localized: "this project") : store.projectName)",
        message: "Users post ideas and bugs, vote on what matters and follow progress through a roadmap and changelog. Embed the ready-made page with one script tag, or build your own UI on the API."
      ) {
        Button("Customize first") { showSettings = true }.buttonStyle(.lnSecondary)
        Button("Turn on feedback") { Task { await store.enable() } }.buttonStyle(.lnPrimary).disabled(store.saving)
      }
      ErrorText(message: showSettings ? "" : store.saveError)
    }
  }

  // MARK: Filters

  private func filterBar(_ config: FeedbackBoardConfig) -> some View {
    VStack(spacing: 10) {
      HStack(spacing: 8) {
        SearchField(text: $store.search)
        typeMenu(config)
        Picker("Layout", selection: $store.layout) {
          Image(systemName: "list.bullet").accessibilityLabel("List").tag(FeedbackBoardStore.Layout.list)
          Image(systemName: "rectangle.split.3x1").accessibilityLabel("Columns").tag(FeedbackBoardStore.Layout.board)
        }
        .pickerStyle(.segmented)
        .frame(width: 88)
      }
      .padding(.horizontal, Metrics.gutter)

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(config.statuses) { status in
            Pill(label: status.label, count: store.counts[status.key] ?? 0, isActive: store.statusFilter.contains(status.key)) {
              store.toggleStatus(status.key)
            }
          }
          Rectangle().fill(Theme.border).frame(width: 1, height: 18).padding(.horizontal, 4)
          Pill(label: "Hidden", systemImage: store.showHidden ? "eye" : "eye.slash", isActive: store.showHidden) { store.showHidden.toggle() }
            .accessibilityHint("Show hidden posts")
        }
        .padding(.horizontal, Metrics.gutter)
      }
    }
    .padding(.vertical, 10)
  }

  private func typeMenu(_ config: FeedbackBoardConfig) -> some View {
    Menu {
      Picker("Type", selection: $store.typeFilter) {
        Text("All types").tag("")
        ForEach(config.types) { type in Text(type.label).tag(type.key) }
      }
    } label: {
      HStack(spacing: 6) {
        Text(store.typeFilter.isEmpty ? String(localized: "All types") : config.type(store.typeFilter)?.label ?? store.typeFilter).lineLimit(1)
        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
      }
      .font(.lnMetaMedium)
      .foregroundStyle(store.typeFilter.isEmpty ? Theme.textMuted : Theme.textHighlighted)
      .padding(.horizontal, 10)
      .frame(maxWidth: 130)
      .frame(height: 34)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    }
    .accessibilityLabel("Type")
  }

  // MARK: Results

  @ViewBuilder private func results(_ config: FeedbackBoardConfig) -> some View {
    if store.loading {
      SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
    } else if !store.error.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        ErrorText(message: store.error)
        Button("Try again") { Task { await store.load() } }.buttonStyle(.lnSecondaryCompact)
      }
      .padding(24)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else if store.layout == .list {
      list(config)
    } else {
      board(config)
    }
  }

  @ViewBuilder private func list(_ config: FeedbackBoardConfig) -> some View {
    let visible = store.visible
    if visible.isEmpty {
      ScrollView {
        if store.posts.isEmpty {
          EmptyState(systemImage: "lightbulb", title: "No posts yet", message: "Share the feedback page, or start it off with a post of your own.") {
            Button { editor = FeedbackEditorRoute(postId: nil) } label: { Label("New post", systemImage: "plus") }.buttonStyle(.lnPrimary)
          }
        } else {
          EmptyState(systemImage: "lightbulb", title: "Nothing matches these filters", message: "Turn a status back on, or clear the search.")
        }
      }
      .refreshable { try? await store.loadPosts() }
    } else {
      List(visible) { post in
        Button { editor = FeedbackEditorRoute(postId: post.id) } label: { FeedbackPostRow(post: post, config: config) }
          .buttonStyle(.plain)
          .linearRow(selected: editor?.postId == post.id)
          .contextMenu { postMenu(post, config) }
      }
      .linearList()
      .refreshable { try? await store.loadPosts() }
    }
  }

  // Kanban: one column per status; drag a card, or use its menu, to move it.
  private func board(_ config: FeedbackBoardConfig) -> some View {
    let filtered = store.filtered
    return ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 12) {
        ForEach(config.statuses) { status in
          FeedbackBoardColumn(status: status, posts: filtered.filter { $0.status == status.key }, config: config, store: store) { post in
            editor = FeedbackEditorRoute(postId: post.id)
          } menu: { post in
            postMenu(post, config)
          }
        }
      }
      .padding(Metrics.gutter)
    }
  }

  @ViewBuilder private func postMenu(_ post: FeedbackPost, _ config: FeedbackBoardConfig) -> some View {
    Button { editor = FeedbackEditorRoute(postId: post.id) } label: { Label("Open", systemImage: "square.and.pencil") }
    Menu {
      ForEach(config.statuses.filter { $0.key != post.status }) { status in
        Button(status.label) { Task { await store.move(post.id, to: status.key) } }
      }
    } label: {
      Label("Move to", systemImage: "arrow.right.circle")
    }
    if planningOn {
      Divider()
      Button { Task { await createPlanning(post) } } label: { Label("Create planning item", systemImage: "sparkles") }
        .disabled(!working.isEmpty)
      Button { planning = post } label: { Label("Add to planning item…", systemImage: "rectangle.split.3x1") }
    }
  }

  /// One tap: the AI writes the item (or items) from the post, which is linked to each.
  private func createPlanning(_ post: FeedbackPost) async {
    guard working.isEmpty else { return }
    working = FeedbackPlanning.workingMessage
    defer { working = "" }
    do {
      notify(FeedbackPlanning.summary(try await FeedbackPlanning.create(session: store.session, projectId: store.projectId, postId: post.id)))
    } catch {
      store.alert = error.localizedDescription
    }
  }

  private func notify(_ message: String) {
    withAnimation { notice = message }
    Task {
      try? await Task.sleep(for: .seconds(4))
      withAnimation { if notice == message { notice = "" } }
    }
  }
}

// MARK: - List row

/// FeedbackPostRow, Linear style: the vote tally, number and title, an excerpt,
/// then status, type, platform, tags, comments and who posted it when.
private struct FeedbackPostRow: View {
  let post: FeedbackPost
  let config: FeedbackBoardConfig

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      FeedbackVoteTile(count: post.voteCount)
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          title.font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(2).multilineTextAlignment(.leading)
          Spacer(minLength: 0)
          if post.locked { Image(systemName: "lock").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Locked") }
          if post.hidden { Image(systemName: "eye.slash").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Hidden from the public feedback page") }
        }
        let excerpt = FeedbackFormat.plainText(post.body, limit: 220)
        if !excerpt.isEmpty {
          Text(excerpt).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(2).multilineTextAlignment(.leading)
        }
        HStack(alignment: .top, spacing: 8) {
          FlowLayout(spacing: 8) {
            FeedbackStatusBadge(status: config.status(post.status))
            if let type = config.type(post.type) {
              Label { Text(type.label) } icon: { FeedbackTypeIcon(icon: type.icon, size: 11) }.labelStyle(FeedbackCompactLabelStyle())
            }
            if !post.platform.isEmpty {
              Label(config.platformLabel(post.platform), systemImage: "macbook.and.iphone").labelStyle(FeedbackCompactLabelStyle())
            }
            ForEach(post.tags, id: \.self) { key in
              let tag = config.tag(key)
              Tag(text: tag.label, tint: FeedbackFormat.tint(tag.color))
            }
            Label("\(post.commentCount)", systemImage: "bubble.left").labelStyle(FeedbackCompactLabelStyle()).accessibilityLabel("\(post.commentCount) comments")
          }
          byline.font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize()
        }
        .padding(.top, 2)
      }
    }
    .padding(.vertical, 10)
    .contentShape(Rectangle())
  }

  private var title: Text {
    guard let number = post.number else { return Text(post.title) }
    return Text("\(Text("#\(number) ").foregroundStyle(Theme.textDimmed).fontWeight(.regular))\(post.title)")
  }

  private var byline: Text {
    let when = DateText.short(post.createdAt)
    if post.author?.isTeam == true { return Text("\(Text("Team").foregroundStyle(Theme.accentText).fontWeight(.medium)) · \(when)") }
    if let name = post.author?.name, !name.isEmpty { return Text("\(Text(name).foregroundStyle(Theme.textToned).fontWeight(.medium)) · \(when)") }
    return Text(when)
  }
}

/// Icon and text at caption size, the way the row's metadata reads.
private struct FeedbackCompactLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.font(.system(size: 11))
      configuration.title
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.textMuted)
    .lineLimit(1)
    .frame(height: 20)
  }
}

// MARK: - Board column

private struct FeedbackBoardColumn<Actions: View>: View {
  let status: FeedbackStatusDefinition
  let posts: [FeedbackPost]
  let config: FeedbackBoardConfig
  let store: FeedbackBoardStore
  let open: (FeedbackPost) -> Void
  @ViewBuilder let menu: (FeedbackPost) -> Actions
  @State private var targeted = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        FeedbackStatusBadge(status: status)
        Spacer()
        Text("\(posts.count)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
      .padding(.horizontal, 12)
      .padding(.top, 12)
      .padding(.bottom, 8)

      ScrollView {
        LazyVStack(spacing: 8) {
          ForEach(posts) { post in
            Button { open(post) } label: { card(post) }
              .buttonStyle(.plain)
              .draggable(post.id)
              .contextMenu { menu(post) }
          }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
      }
    }
    .frame(width: 280)
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Theme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(targeted ? Theme.accent : Color.clear, lineWidth: 2))
    .dropDestination(for: String.self) { ids, _ in
      guard let id = ids.first else { return false }
      Task { await store.move(id, to: status.key) }
      return true
    } isTargeted: { targeted = $0 }
  }

  private func card(_ post: FeedbackPost) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .top, spacing: 6) {
        Text(post.title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(3).multilineTextAlignment(.leading)
        Spacer(minLength: 0)
        if post.hidden { Image(systemName: "eye.slash").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Hidden") }
      }
      HStack(spacing: 10) {
        Label { Text("\(post.voteCount)").fontWeight(.semibold) } icon: { Image(systemName: "chevron.up") }.accessibilityLabel("\(post.voteCount) votes")
        Label("\(post.commentCount)", systemImage: "bubble.left").accessibilityLabel("\(post.commentCount) comments")
        if let type = config.type(post.type) {
          Label { Text(type.label) } icon: { FeedbackTypeIcon(icon: type.icon, size: 10) }
        }
      }
      .labelStyle(FeedbackCompactLabelStyle())
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
  }
}
