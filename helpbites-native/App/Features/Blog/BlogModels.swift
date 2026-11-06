import SwiftUI

/// The blog's rules, ported from shared/blog.ts (tests/blogNativeParity.test.ts
/// keeps them equal): limits, reserved slugs, the reactions, the design's
/// choices and how a title becomes a slug.
enum BlogLimits {
  static let title = 200
  static let slug = 80
  static let excerpt = 300
  static let tags = 10
  static let tag = 40
  static let comment = 4000
  static let metaTitle = 300
  static let metaDescription = 500
  static let alt = 300
  /// What search engines show before they cut a title or description short (the editor's counters).
  static let metaTitleGuide = 60
  static let metaDescriptionGuide = 145
  static let reservedSlugs = ["comments", "rss", "feed", "tags", "subscribe"]
  static let reactions = ["heart", "+1", "hooray", "laugh", "rocket", "eyes"]
  static let emoji: [String: String] = ["heart": "❤️", "+1": "👍", "hooray": "🎉", "laugh": "😄", "rocket": "🚀", "eyes": "👀"]
  static let navigation = 8
  static let navigationLabel = 40
  static let footer = 300
  static let layouts = ["list", "grid", "magazine"]
  static let fonts = ["sans", "serif"]
  static let colorSchemes = ["auto", "light", "dark"]
  static let socialNetworks = ["x", "bluesky", "mastodon", "github", "linkedin", "instagram", "youtube", "website"]
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
    case .live: String(localized: "Live")
    case .scheduled: String(localized: "Scheduled")
    case .draft: String(localized: "Draft")
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

/// The team's view of a post or page (shared/blog.ts `BlogPost`). The list leaves `body` and `bodyHtml` empty.
/// Fields a server from before pages and SEO leaves out take their defaults.
struct BlogPost: Decodable, Equatable, Identifiable, Sendable {
  struct Newsletter: Decodable, Equatable, Sendable { let campaignId, status: String }
  let id, projectId, title, slug, excerpt: String
  /// post or page: a page (About, Contact) stands on its own, out of the list, the feed and the newsletter.
  let type: String
  let excerptWritten: Bool
  let body, bodyHtml, coverImageUrl: String
  /// markdown, or html for a post imported from Ghost (kept as HTML).
  let bodyFormat: String
  let coverImageAlt: String
  let tags: [String]
  /// Shown first: large on the magazine layout, marked on the others.
  let featured: Bool
  /// public, or members (signed-in readers get the body).
  let visibility: String
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
  /// What search engines and link previews show; empty falls back to the post's own.
  let metaTitle, metaDescription, ogImageUrl, canonicalUrl: String
  let url, createdAt, updatedAt: String

  var isPage: Bool { type == "page" }
  var membersOnly: Bool { visibility == "members" }
  var state: BlogPostState { live ? .live : status == "published" ? .scheduled : .draft }
  var reactionTotal: Int { reactions.reduce(0) { $0 + $1.count } }
  /// Whether it can still go out as a newsletter: a published post, live or scheduled (a scheduled one's email
  /// waits for it), not sent before (a draft or canceled campaign may be replaced). Never a page.
  var canSendNewsletter: Bool { !isPage && status == "published" && (newsletter == nil || ["draft", "canceled"].contains(newsletter?.status ?? "")) }

  private enum Keys: String, CodingKey {
    case id, projectId, type, title, slug, excerpt, excerptWritten, body, bodyFormat, bodyHtml, coverImageUrl, coverImageAlt, tags, featured, visibility
    case status, publishedAt, live, authorName, readingMinutes, commentsOpen, commentCount, reactions, newsletter
    case metaTitle, metaDescription, ogImageUrl, canonicalUrl, url, createdAt, updatedAt
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    id = try c.decode(String.self, forKey: .id)
    projectId = try c.decode(String.self, forKey: .projectId)
    type = try c.decodeIfPresent(String.self, forKey: .type) ?? "post"
    title = try c.decode(String.self, forKey: .title)
    slug = try c.decode(String.self, forKey: .slug)
    excerpt = try c.decode(String.self, forKey: .excerpt)
    excerptWritten = try c.decode(Bool.self, forKey: .excerptWritten)
    body = try c.decode(String.self, forKey: .body)
    bodyFormat = try c.decodeIfPresent(String.self, forKey: .bodyFormat) ?? "markdown"
    bodyHtml = try c.decode(String.self, forKey: .bodyHtml)
    coverImageUrl = try c.decode(String.self, forKey: .coverImageUrl)
    coverImageAlt = try c.decodeIfPresent(String.self, forKey: .coverImageAlt) ?? ""
    tags = try c.decode([String].self, forKey: .tags)
    featured = try c.decodeIfPresent(Bool.self, forKey: .featured) ?? false
    visibility = try c.decodeIfPresent(String.self, forKey: .visibility) ?? "public"
    status = try c.decode(String.self, forKey: .status)
    publishedAt = try c.decodeIfPresent(String.self, forKey: .publishedAt)
    live = try c.decode(Bool.self, forKey: .live)
    authorName = try c.decode(String.self, forKey: .authorName)
    readingMinutes = try c.decode(Int.self, forKey: .readingMinutes)
    commentsOpen = try c.decode(Bool.self, forKey: .commentsOpen)
    commentCount = try c.decode(Int.self, forKey: .commentCount)
    reactions = try c.decode([BlogReaction].self, forKey: .reactions)
    newsletter = try c.decodeIfPresent(Newsletter.self, forKey: .newsletter)
    metaTitle = try c.decodeIfPresent(String.self, forKey: .metaTitle) ?? ""
    metaDescription = try c.decodeIfPresent(String.self, forKey: .metaDescription) ?? ""
    ogImageUrl = try c.decodeIfPresent(String.self, forKey: .ogImageUrl) ?? ""
    canonicalUrl = try c.decodeIfPresent(String.self, forKey: .canonicalUrl) ?? ""
    url = try c.decode(String.self, forKey: .url)
    createdAt = try c.decode(String.self, forKey: .createdAt)
    updatedAt = try c.decode(String.self, forKey: .updatedAt)
  }
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

/// A link in the hosted blog's header: a path on the blog (`/`, `/about`) or an http(s) address.
struct BlogNavLink: Decodable, Equatable, Hashable, Sendable {
  var label = "", url = ""

  init(label: String = "", url: String = "") {
    self.label = label
    self.url = url
  }
  private enum Keys: String, CodingKey { case label, url }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
    url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
  }
}

/// `Project.blog.design`: how the hosted blog looks (shared/blog.ts `BlogDesign`). Missing keys take the defaults.
struct BlogDesign: Decodable, Equatable, Sendable {
  /// list, grid or magazine.
  var layout = "list"
  /// sans or serif.
  var font = "sans"
  /// auto, light or dark.
  var colorScheme = "auto"
  /// "#rrggbb", or "" for the project's accent.
  var accent = ""
  /// "" falls back to the project's logo.
  var logoUrl = ""
  var coverImageUrl = ""
  var navigation: [BlogNavLink] = []
  /// Network (`BlogLimits.socialNetworks`) → profile URL; a network without one is absent.
  var social: [String: String] = [:]
  var footer = ""

  init() {}
  private enum Keys: String, CodingKey { case layout, font, colorScheme, accent, logoUrl, coverImageUrl, navigation, social, footer }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    layout = try c.decodeIfPresent(String.self, forKey: .layout) ?? "list"
    font = try c.decodeIfPresent(String.self, forKey: .font) ?? "sans"
    colorScheme = try c.decodeIfPresent(String.self, forKey: .colorScheme) ?? "auto"
    accent = try c.decodeIfPresent(String.self, forKey: .accent) ?? ""
    logoUrl = try c.decodeIfPresent(String.self, forKey: .logoUrl) ?? ""
    coverImageUrl = try c.decodeIfPresent(String.self, forKey: .coverImageUrl) ?? ""
    navigation = (try? c.decodeIfPresent([BlogNavLink].self, forKey: .navigation)) ?? []
    social = (try? c.decodeIfPresent([String: String].self, forKey: .social)) ?? [:]
    footer = try c.decodeIfPresent(String.self, forKey: .footer) ?? ""
  }
}

/// `Project.blog`. Missing keys take the server's defaults.
struct BlogSettings: Decodable, Equatable, Sendable {
  var enabled = false
  var title = "", description = "", postUrl = "", newsletterTopic = ""
  var comments = true, reactions = true, subscribeForm = false
  var commentNotify: [String] = []
  var design = BlogDesign()

  init() {}
  private enum Keys: String, CodingKey { case enabled, title, description, postUrl, newsletterTopic, comments, reactions, subscribeForm, commentNotify, design }
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
    design = (try? c.decodeIfPresent(BlogDesign.self, forKey: .design)) ?? BlogDesign()
  }
}

/// What a Ghost import did (`POST /v1/admin/blog/import`).
struct BlogImportResult: Decodable, Sendable {
  let created, updated, skipped: Int
  let warnings: [String]
}

/// A Ghost export (Settings → Advanced → Import/Export → Export content): JSON with the posts under
/// `db[0].data.posts`, or `data.posts` in older files. Read here to say what is in it; the server maps it.
enum BlogGhostExport {
  struct Unreadable: LocalizedError {
    let errorDescription: String?
  }

  /// The parsed file and how many posts and pages it holds, or why it is not an export.
  static func read(_ data: Data) throws -> (export: JSONValue, count: Int) {
    let parsed: JSONValue
    do { parsed = try JSONDecoder().decode(JSONValue.self, from: data) } catch { throw Unreadable(errorDescription: String(localized: "This file is not JSON.")) }
    guard let count = postCount(parsed) else { throw Unreadable(errorDescription: String(localized: "This is not a Ghost export: no posts in it.")) }
    return (parsed, count)
  }

  static func postCount(_ value: JSONValue) -> Int? {
    guard case .object(let root) = value else { return nil }
    func posts(_ data: JSONValue?) -> Int? {
      guard case .object(let object)? = data, case .array(let list)? = object["posts"] else { return nil }
      return list.count
    }
    var first: JSONValue?
    if case .array(let db)? = root["db"], case .object(let entry)? = db.first { first = entry["data"] }
    return posts(first) ?? posts(root["data"])
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
    guard let project = response.projects.first(where: { $0.id == id }) else { throw APIError.server(String(localized: "Project not found")) }
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
      .frame(height: Metrics.scaled(20))
      .background(tint.opacity(0.14), in: Capsule())
  }
}
