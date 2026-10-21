import SwiftUI

/// What the list shows: every post, or one state.
enum BlogFilter: String, CaseIterable, Identifiable {
  case all, live, scheduled, draft
  var id: String { rawValue }
  var label: String {
    switch self {
    case .all: "All"
    case .live: "Live"
    case .scheduled: "Scheduled"
    case .draft: "Drafts"
    }
  }
}

/// A project's blog (pages/projects/[id]/blog): its posts, the comments on them,
/// the settings and every write. The post editor and the sheets share one.
@MainActor @Observable final class BlogStore {
  let projectId: String
  let workspace: Workspace
  var project: BlogProject?
  var posts: [BlogPost] = []
  var comments: [BlogComment] = []
  var commentTotal = 0
  var commentsHaveMore = false
  var loading = true
  private(set) var loaded = false
  var error = ""
  /// A failed quick action, shown as an alert.
  var alert = ""

  var search = ""
  var filter: BlogFilter = .all
  /// "" for every comment, or visible / hidden.
  var commentFilter = ""

  init(projectId: String, workspace: Workspace) {
    self.projectId = projectId
    self.workspace = workspace
  }

  private var session: SessionStore { workspace.session }
  var settings: BlogSettings { project?.blog ?? BlogSettings() }

  func post(_ id: String) -> BlogPost? { posts.first { $0.id == id } }

  var liveCount: Int { posts.filter { $0.state == .live }.count }
  var draftCount: Int { posts.count - liveCount }

  private var origin: String { session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

  /// `/blog/<public key>` on the app's own host, once the blog is on.
  var publicURL: URL? {
    guard let project, settings.enabled else { return nil }
    return URL(string: "\(origin)/blog/\(project.publicKey)")
  }

  var feedURL: URL? {
    guard let project, settings.enabled else { return nil }
    return URL(string: "\(origin)/v1/projects/\(project.publicKey)/blog.rss")
  }

  func count(_ filter: BlogFilter) -> Int {
    switch filter {
    case .all: posts.count
    case .live: posts.filter { $0.state == .live }.count
    case .scheduled: posts.filter { $0.state == .scheduled }.count
    case .draft: posts.filter { $0.state == .draft }.count
    }
  }

  var shown: [BlogPost] {
    let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return posts.filter { post in
      switch filter {
      case .all: break
      case .live: if post.state != .live { return false }
      case .scheduled: if post.state != .scheduled { return false }
      case .draft: if post.state != .draft { return false }
      }
      return needle.isEmpty || post.title.localizedStandardContains(needle) || post.tags.contains { $0.localizedStandardContains(needle) }
    }
  }

  // MARK: Loading

  func load() async {
    loading = true
    error = ""
    defer { loading = false }
    do {
      try await fetch()
      loaded = true
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }

  /// For the editor, which may open before the screen did.
  func ensureLoaded() async { if !loaded { await load() } }

  private func fetch() async throws {
    struct Posts: Decodable, Sendable { let posts: [BlogPost] }
    let id = projectId
    async let mine = BlogProject.load(id, session: session)
    async let rows: Posts = session.get("/v1/admin/blog/posts", query: ["project": id])
    let (project, posts) = try await (mine, rows)
    self.project = project
    self.posts = posts.posts
  }

  /// A quiet refetch (coming back to the app); keeps what is on screen when it fails.
  func refresh() async {
    guard loaded else { return }
    try? await fetch()
  }

  private func upsert(_ post: BlogPost) {
    if let index = posts.firstIndex(where: { $0.id == post.id }) { posts[index] = post } else { posts.insert(post, at: 0) }
  }

  // MARK: Posts

  private struct PostResponse: Decodable, Sendable { let post: BlogPost }

  /// One post with its Markdown (the list leaves it out).
  func full(_ id: String) async throws -> BlogPost {
    let result: PostResponse = try await session.get("/v1/admin/blog/posts/\(id)")
    upsert(result.post)
    return result.post
  }

  func create(_ fields: [String: JSONValue]) async throws -> BlogPost {
    var body = fields
    body["project"] = .string(projectId)
    let result: PostResponse = try await session.send("/v1/admin/blog/posts", body: body)
    upsert(result.post)
    return result.post
  }

  /// Send only what changed; `.null` clears a value.
  func update(_ id: String, _ fields: [String: JSONValue]) async throws -> BlogPost {
    let result: PostResponse = try await session.send("/v1/admin/blog/posts/\(id)", method: "PATCH", body: fields)
    upsert(result.post)
    return result.post
  }

  func delete(_ id: String) async throws {
    try await session.delete("/v1/admin/blog/posts/\(id)")
    posts.removeAll { $0.id == id }
  }

  /// `POST /v1/admin/blog/images`: the URL to put in the body or the cover.
  func uploadImage(_ data: Data) async throws -> String {
    let file = try EmailImageUpload.prepare(data)
    let stored: Attachment = try await session.upload("/v1/admin/blog/images", fields: ["project": projectId], file: file.data, filename: "image.\(file.ext)", mimeType: file.mime)
    return stored.url
  }

  /// Email a published post to subscribers, as a campaign. `send`: now, schedule or draft.
  func sendNewsletter(_ id: String, subject: String, topic: String, send: String, scheduledAt: Date? = nil) async throws -> BlogPost {
    struct Response: Decodable, Sendable { let post: BlogPost }
    var body: [String: JSONValue] = ["subject": .string(subject), "audience": .object(["topic": .string(topic), "segment": .string("")]), "send": .string(send)]
    if let scheduledAt { body["scheduledAt"] = .string(ISO8601DateFormatter().string(from: scheduledAt)) }
    let result: Response = try await session.send("/v1/admin/blog/posts/\(id)/newsletter", body: body)
    upsert(result.post)
    return result.post
  }

  // MARK: Comments

  func loadComments(more: Bool = false) async {
    struct Page: Decodable, Sendable { let comments: [BlogComment]; let total: Int; let hasMore: Bool }
    var query = ["project": projectId, "skip": String(more ? comments.count : 0)]
    if !commentFilter.isEmpty { query["status"] = commentFilter }
    do {
      let page: Page = try await session.get("/v1/admin/blog/comments", query: query)
      comments = more ? comments + page.comments : page.comments
      commentTotal = page.total
      commentsHaveMore = page.hasMore
    } catch {
      if case APIError.cancelled = error { return }
      alert = error.localizedDescription
    }
  }

  /// Hide or show: moderation, not editing someone's words.
  func moderate(_ comment: BlogComment, status: String) async {
    struct Response: Decodable, Sendable { let commentCount: Int? }
    do {
      let _: Response = try await session.send("/v1/blog/comments/\(comment.id)", method: "PATCH", body: ["status": status])
      if let index = comments.firstIndex(where: { $0.id == comment.id }) { comments[index].status = status }
    } catch {
      alert = error.localizedDescription
    }
  }

  func deleteComment(_ comment: BlogComment) async {
    struct Response: Decodable, Sendable { let deleted: Bool }
    do {
      let _: Response = try await session.send("/v1/blog/comments/\(comment.id)", method: "DELETE")
      comments.removeAll { $0.id == comment.id }
      commentTotal = max(0, commentTotal - 1)
    } catch {
      alert = error.localizedDescription
    }
  }

  /// Answer as the team: the comment is marked so on the blog.
  func reply(to comment: BlogComment, _ text: String) async throws {
    struct Response: Decodable, Sendable { let commentCount: Int }
    let body: [String: String] = ["body": text, "parentId": comment.id]
    let _: Response = try await session.send("/v1/blog/\(comment.postId)/comments?project=\(projectId)", body: body)
    await loadComments()
  }

  // MARK: Settings

  /// `PATCH /admin/projects/:id { blog }`: partial, only the keys sent change.
  func saveSettings(_ patch: [String: JSONValue]) async throws {
    struct Saved: Decodable, Sendable { let project: BlogProject }
    let saved: Saved = try await session.send("/v1/admin/projects/\(projectId)", method: "PATCH", body: ["blog": JSONValue.object(patch)])
    project = saved.project
  }
}
