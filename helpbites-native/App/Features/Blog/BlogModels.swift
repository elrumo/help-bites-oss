import SwiftUI

/// The blog's rules, ported from shared/blog.ts (tests/blogNativeParity.test.ts
/// keeps them equal): limits, reserved slugs, the reactions and how a title
/// becomes a slug.
enum BlogLimits {
  static let title = 200
  static let slug = 80
  static let excerpt = 300
  static let tags = 10
  static let tag = 40
  static let comment = 4000
  static let reservedSlugs = ["comments", "rss", "feed", "tags", "subscribe"]
  static let reactions = ["heart", "+1", "hooray", "laugh", "rocket", "eyes"]
  static let emoji: [String: String] = ["heart": "❤️", "+1": "👍", "hooray": "🎉", "laugh": "😄", "rocket": "🚀", "eyes": "👀"]
}

enum BlogSlug {
  /// Title → URL key, as blogSlugify: accents keep their base letter ("Cómo" → "como"), anything else is a hyphen.
  static func from(_ value: String) -> String {
    var folded = String.UnicodeScalarView()
    for scalar in value.decomposedStringWithCanonicalMapping.unicodeScalars where !(0x0300...0x036F).contains(scalar.value) {
      folded.append(scalar)
    }
    var out = ""
    var gap = false
    for scalar in String(folded).lowercased().unicodeScalars {
      if (97...122).contains(scalar.value) || (48...57).contains(scalar.value) {
        if gap && !out.isEmpty { out.append("-") }
        out.unicodeScalars.append(scalar)
        gap = false
      } else {
        gap = true
      }
    }
    var slug = String(out.prefix(BlogLimits.slug))
    while slug.hasSuffix("-") { slug.removeLast() }
    return slug
  }
}

struct BlogReaction: Decodable, Equatable, Hashable, Sendable {
  let key: String
  let count: Int
  var emoji: String { BlogLimits.emoji[key] ?? key }
}

/// Where a post stands: public now, waiting for its date, or a draft.
enum BlogPostState {
  case live, scheduled, draft
  var label: String {
    switch self {
    case .live: "Live"
    case .scheduled: "Scheduled"
    case .draft: "Draft"
    }
  }
  var tint: Color {
    switch self {
    case .live: Theme.success
    case .scheduled: Theme.info
    case .draft: Theme.textToned
    }
  }
}

/// The team's view of a post (shared/blog.ts `BlogPost`). The list leaves `body` and `bodyHtml` empty.
struct BlogPost: Decodable, Equatable, Identifiable, Sendable {
  struct Newsletter: Decodable, Equatable, Sendable { let campaignId, status: String }
  let id, projectId, title, slug, excerpt: String
  let excerptWritten: Bool
  let body, bodyHtml, coverImageUrl: String
  let tags: [String]
  /// draft or published.
  let status: String
  let publishedAt: String?
  let live: Bool
  let authorName: String
  let readingMinutes: Int
  let commentsOpen: Bool
  let commentCount: Int
  let reactions: [BlogReaction]
  let newsletter: Newsletter?
  let url, createdAt, updatedAt: String

  var state: BlogPostState { live ? .live : status == "published" ? .scheduled : .draft }
  var reactionTotal: Int { reactions.reduce(0) { $0 + $1.count } }
  /// Whether it can still go out as a newsletter: published, and not sent before (a draft or canceled campaign may be replaced).
  var canSendNewsletter: Bool { live && (newsletter == nil || ["draft", "canceled"].contains(newsletter?.status ?? "")) }
}

/// A comment in the moderation list (shared/blog.ts `BlogCommentWithPost`).
struct BlogComment: Decodable, Equatable, Identifiable, Sendable {
  let id, postId: String
  let parentId: String?
  let body, bodyHtml: String
  /// visible or hidden; deleted ones are never listed.
  var status: String
  let authorName: String
  let authorAvatar: String?
  let authorIsStaff: Bool
  let createdAt: String
  let editedAt: String?
  let postTitle: String?
  let postSlug: String?
}

/// `Project.blog`. Missing keys take the server's defaults.
struct BlogSettings: Decodable, Equatable, Sendable {
  var enabled = false
  var title = "", description = "", postUrl = "", newsletterTopic = ""
  var comments = true, reactions = true, subscribeForm = false
  var commentNotify: [String] = []

  init() {}
  private enum Keys: String, CodingKey { case enabled, title, description, postUrl, newsletterTopic, comments, reactions, subscribeForm, commentNotify }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
    postUrl = try c.decodeIfPresent(String.self, forKey: .postUrl) ?? ""
    newsletterTopic = try c.decodeIfPresent(String.self, forKey: .newsletterTopic) ?? ""
    comments = try c.decodeIfPresent(Bool.self, forKey: .comments) ?? true
    reactions = try c.decodeIfPresent(Bool.self, forKey: .reactions) ?? true
    subscribeForm = try c.decodeIfPresent(Bool.self, forKey: .subscribeForm) ?? false
    commentNotify = try c.decodeIfPresent([String].self, forKey: .commentNotify) ?? []
  }
}

/// The project as the blog needs it: its key for public links, the blog's options and the newsletter's topics.
struct BlogProject: Decodable, Sendable {
  struct Topic: Decodable, Hashable, Sendable { let key, name: String }
  struct Marketing: Decodable, Sendable { let topics: [Topic]?; let postalAddress: String? }
  let id, publicKey, name: String
  let blog: BlogSettings?
  let marketing: Marketing?

  @MainActor static func load(_ id: String, session: SessionStore) async throws -> BlogProject {
    struct Response: Decodable, Sendable { let projects: [BlogProject] }
    let response: Response = try await session.get("/v1/admin/projects")
    guard let project = response.projects.first(where: { $0.id == id }) else { throw APIError.server("Project not found") }
    return project
  }
}

struct BlogChip: View {
  let text: String
  var tint: Color = Theme.textToned
  var body: some View {
    Text(text)
      .font(.lnCaptionMedium)
      .foregroundStyle(tint)
      .lineLimit(1)
      .padding(.horizontal, 7)
      .frame(height: 20)
      .background(tint.opacity(0.14), in: Capsule())
  }
}
