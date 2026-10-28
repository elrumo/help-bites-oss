import SwiftUI

// A feedback board's vocabulary as /v1/feedback serializes it (shared/feedback.ts),
// the display helpers the web keeps in app/utils/feedbackFormat.ts, and the small
// pieces of UI the list, the board, the editor and the settings share.

// MARK: - Board config

struct FeedbackStatusDefinition: Codable, Equatable, Sendable, Identifiable {
  var key: String
  var label: String
  /// open · planned · active · done · closed: what the status means everywhere.
  var category: String
  /// neutral · primary · info · success · warning · error.
  var color: String
  var isDefault: Bool?
  /// Email the post's followers when it moves here.
  var notify: Bool?
  var id: String { key }
}

struct FeedbackTypeDefinition: Codable, Equatable, Sendable, Identifiable {
  var key: String
  var label: String
  /// An Iconify name (`lucide:bug`) or an emoji; may be ''.
  var icon: String
  var description: String?
  var id: String { key }
}

struct FeedbackPlatformDefinition: Codable, Equatable, Sendable, Identifiable {
  var key: String
  var label: String
  var id: String { key }
}

struct FeedbackTagDefinition: Codable, Equatable, Sendable, Identifiable {
  var key: String
  var label: String
  var color: String
  var id: String { key }
}

struct FeedbackBoardConfig: Codable, Equatable, Sendable {
  var enabled: Bool
  var title: String
  var description: String
  var statuses: [FeedbackStatusDefinition]
  var types: [FeedbackTypeDefinition]
  /// Empty hides the platform picker.
  var platforms: [FeedbackPlatformDefinition]
  /// Empty hides the tag picker.
  var tags: [FeedbackTagDefinition]
  var showAuthorNames: Bool
  var allowComments: Bool
  var allowUserEdits: Bool
  var emailNotifications: Bool
  /// '' or an http(s) URL with {id}, {number} and {slug}.
  var postUrlTemplate: String
  var roadmap: Bool
  var changelog: Bool

  /// A status the config no longer knows reads as an open one, so its posts stay visible.
  func status(_ key: String) -> FeedbackStatusDefinition {
    statuses.first { $0.key == key } ?? FeedbackStatusDefinition(key: key, label: key.isEmpty ? String(localized: "Open") : key, category: "open", color: "neutral")
  }

  func type(_ key: String) -> FeedbackTypeDefinition? {
    key.isEmpty ? nil : types.first { $0.key == key } ?? FeedbackTypeDefinition(key: key, label: key, icon: "")
  }

  func platformLabel(_ key: String) -> String {
    key.isEmpty ? "" : platforms.first { $0.key == key }?.label ?? key
  }

  func tag(_ key: String) -> FeedbackTagDefinition {
    tags.first { $0.key == key } ?? FeedbackTagDefinition(key: key, label: key, color: "neutral")
  }

  var defaultStatusKey: String { (statuses.first { $0.isDefault == true } ?? statuses.first)?.key ?? "" }
}

// MARK: - Posts and comments

struct FeedbackAuthor: Decodable, Equatable, Sendable {
  /// '' when the board hides names from this viewer (live events).
  var name: String
  var isTeam: Bool
  /// Admins only.
  var externalId: String?
  var email: String?
}

struct FeedbackPostRef: Decodable, Equatable, Sendable {
  let id: String
  let number: Int?
  let title: String
}

struct FeedbackPost: Decodable, Equatable, Sendable, Identifiable {
  let id: String
  var number: Int?
  var title: String
  /// Untrusted Markdown or HTML.
  var body: String
  var type: String
  var platform: String
  var tags: [String]
  var status: String
  var statusCategory: String
  var voteCount: Int
  /// Public comments only.
  var commentCount: Int
  var author: FeedbackAuthor?
  var hidden: Bool
  var featured: Bool
  var locked: Bool
  var showOnChangelog: Bool
  var changelogTitle: String
  var changelogBody: String
  var shippedIn: String
  var icon: String
  var pinnedCommentId: String?
  var duplicateOf: FeedbackPostRef?
  var completedAt: String?
  /// The posted date; '' when missing.
  var createdAt: String
  // Admin REST responses only; live events leave them out.
  var externalId: String?
  var metadata: [String: JSONValue]?
  var adminNote: String?
  /// Images and files; absent from a server that predates them.
  var attachments: [ItemAttachment]?

  /// Live events carry the anonymous view of a post: no admin fields, and maybe no
  /// author name or email. Keep what we already know, like mergeFeedbackPost on the web.
  static func merge(_ local: FeedbackPost?, _ incoming: FeedbackPost) -> FeedbackPost {
    guard let local else { return incoming }
    var post = incoming
    post.externalId = incoming.externalId ?? local.externalId
    post.metadata = incoming.metadata ?? local.metadata
    post.adminNote = incoming.adminNote ?? local.adminNote
    post.author = FeedbackAuthor.merge(local.author, incoming.author)
    return post
  }
}

extension FeedbackAuthor {
  static func merge(_ local: FeedbackAuthor?, _ incoming: FeedbackAuthor?) -> FeedbackAuthor? {
    guard var author = incoming, let known = local else { return incoming }
    if author.name.isEmpty { author.name = known.name }
    author.email = author.email ?? known.email
    author.externalId = author.externalId ?? known.externalId
    return author
  }
}

struct FeedbackComment: Decodable, Equatable, Sendable, Identifiable {
  let id: String
  let postId: String
  /// The top-level comment a reply sits under.
  var parentId: String?
  /// public · internal (a team-only note) · hidden (moderated away).
  var visibility: String
  var body: String
  var author: FeedbackAuthor?
  var editedAt: String?
  var createdAt: String
}

/// The editor's create/update body. Optional strings go as '' to clear them,
/// which the server reads the same as null.
struct FeedbackPostInput: Encodable, Sendable {
  let title, body, status, type, platform: String
  /// Only sent when the board defines tags.
  let tags: [String]?
  let attachments: [ItemAttachment]
  let featured, showOnChangelog, hidden, locked: Bool
  let shippedIn, adminNote, changelogTitle, changelogBody, icon: String
  /// ISO, or '' to clear; left out of a new post without a date.
  let completedAt: String?
}

// MARK: - Formatting

enum FeedbackFormat {
  @MainActor private static let relative: RelativeDateTimeFormatter = {
    let formatter = RelativeDateTimeFormatter()
    formatter.dateTimeStyle = .named
    return formatter
  }()

  @MainActor private static let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()

  /// "just now", "3 hours ago", "last week"; a plain date past a year.
  @MainActor static func timeAgo(_ raw: String?) -> String {
    guard let date = DateText.date(raw) else { return "" }
    let seconds = date.timeIntervalSinceNow
    let distance = abs(seconds)
    if distance < 45 { return String(localized: "just now") }
    if distance > 365 * 86400 { return date.formatted(.dateTime.year().month(.abbreviated).day()) }
    let units: [(Calendar.Component, Double)] = [(.minute, 60), (.hour, 3600), (.day, 86400), (.weekOfMonth, 604800), (.month, 2629800)]
    let unit = units.last { distance >= $0.1 } ?? units[0]
    var components = DateComponents()
    // Math.round: halves go up (-1.5 → -1), as Intl shows them on the web.
    components.setValue(Int((seconds / unit.1 + 0.5).rounded(.down)), for: unit.0)
    return relative.localizedString(from: components)
  }

  /// "2026-10-02" (the web's date input value) ↔ that day at noon here.
  @MainActor static func day(_ date: Date) -> String { dayFormatter.string(from: date) }
  @MainActor static func date(day: String) -> Date? { dayFormatter.date(from: day)?.addingTimeInterval(12 * 3600) }

  /// Plain text from a Markdown-or-HTML body, for previews (feedbackPlainText).
  static func plainText(_ body: String, limit: Int = 0) -> String {
    var text = body
    func replace(_ pattern: String, _ template: String) {
      text = text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }
    replace("(?i)<(br|/p|/li|/h[1-6]|/blockquote|/pre)\\s*/?>", "\n")
    replace("<[^>]*>", "")
    // &amp; last, so "&amp;lt;" reads "&lt;" as it does on the web.
    for (entity, value) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&#39;", "'"), ("&nbsp;", " "), ("&amp;", "&")] {
      text = text.replacingOccurrences(of: entity, with: value)
    }
    replace("!?\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
    replace("\\*\\*|__|~~|`", "")
    replace("(?m)^ {0,3}(#{1,6}|>)\\s?", "")
    replace("[ \\t]+", " ")
    replace("\\n{3,}", "\n\n")
    text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard limit > 0, text.count > limit else { return text }
    return String(text.prefix(limit - 1)).trimmingCharacters(in: .whitespaces) + "…"
  }

  /// A comment body for display: inline Markdown, or HTML flattened to text.
  /// ponytail: inline Markdown only (no lists or headings as blocks); a Markdown renderer if threads need them.
  static func attributed(_ body: String) -> AttributedString {
    let source = body.range(of: "<[a-zA-Z/][^>]*>", options: .regularExpression) == nil ? body : plainText(body)
    return (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
  }

  /// normalizeFeedbackKey: lowercase `[a-z0-9_-]`, at most 40 characters.
  static func normalizeKey(_ value: String) -> String {
    var key = String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)).lowercased()
    key = key.replacingOccurrences(of: "[^a-z0-9_-]+", with: "-", options: .regularExpression)
    key = key.replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)
    return String(key.prefix(40))
  }

  /// feedbackSlug: lowercase ASCII words joined by dashes, at most 80 characters.
  static func slug(_ title: String) -> String {
    var slug = title.folding(options: .diacriticInsensitive, locale: nil).lowercased()
    slug = slug.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    slug = String(slug.replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression).prefix(80))
    return slug.replacingOccurrences(of: "-+$", with: "", options: .regularExpression)
  }

  /// Where a post lives on the host site (feedbackPostUrl with a template); nil without one.
  static func postURL(_ config: FeedbackBoardConfig, _ post: FeedbackPost) -> URL? {
    guard !config.postUrlTemplate.isEmpty else { return nil }
    let id = post.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? post.id
    var url = config.postUrlTemplate
      .replacingOccurrences(of: "{id}", with: id)
      .replacingOccurrences(of: "{number}", with: post.number.map(String.init) ?? id)
      .replacingOccurrences(of: "{slug}", with: slug(post.title))
    if let dash = url.range(of: "-(?=$|[?#])", options: .regularExpression) { url.removeSubrange(dash) }
    return URL(string: url)
  }

  /// A board colour on the panel's palette; nil for neutral.
  static func tint(_ color: String) -> Color? {
    switch color {
    case "primary": Theme.accentText
    case "info": Theme.info
    case "success": Theme.success
    case "warning": Theme.warning
    case "error": Theme.error
    default: nil
    }
  }

  /// `lucide:bug`, `i-lucide-bug`; anything else (an emoji) is literal text.
  static func isIconifyName(_ icon: String) -> Bool {
    icon.range(of: "(?i)^(i-[a-z0-9]+-[a-z0-9-]+|[a-z0-9-]+:[a-z0-9-]+)$", options: .regularExpression) != nil
  }

  /// The SF Symbol for an Iconify name; a tag when there is no close match.
  static func symbol(_ icon: String) -> String {
    var name = icon.lowercased()
    if let colon = name.lastIndex(of: ":") {
      name = String(name[name.index(after: colon)...])
    } else if name.hasPrefix("i-") {
      name = String(name.dropFirst(2))
      if let dash = name.firstIndex(of: "-") { name = String(name[name.index(after: dash)...]) }
    }
    name = name.replacingOccurrences(of: "-\\d+$", with: "", options: .regularExpression)
    return feedbackSymbols[name] ?? "tag"
  }
}

/// Lucide (and common Iconify) names → SF Symbols.
private let feedbackSymbols: [String: String] = [
  "lightbulb": "lightbulb", "bug": "ladybug", "sparkles": "sparkles", "sparkle": "sparkle", "star": "star", "heart": "heart",
  "message-circle": "bubble.left", "message-square": "text.bubble", "messages-square": "bubble.left.and.bubble.right",
  "zap": "bolt", "flame": "flame", "rocket": "paperplane", "wrench": "wrench.and.screwdriver", "hammer": "hammer",
  "settings": "gearshape", "settings-2": "slider.horizontal.3", "cog": "gearshape", "palette": "paintpalette", "paintbrush": "paintbrush",
  "shield": "shield", "shield-check": "checkmark.shield", "lock": "lock", "gauge": "gauge.with.dots.needle.67percent",
  "trending-up": "chart.line.uptrend.xyaxis", "chart-bar": "chart.bar", "bar-chart": "chart.bar", "book": "book", "book-open": "book",
  "file-text": "doc.text", "help-circle": "questionmark.circle", "circle-help": "questionmark.circle",
  "alert-triangle": "exclamationmark.triangle", "triangle-alert": "exclamationmark.triangle", "alert-circle": "exclamationmark.circle",
  "circle-alert": "exclamationmark.circle", "globe": "globe", "smartphone": "iphone", "monitor": "desktopcomputer", "laptop": "laptopcomputer",
  "tablet": "ipad", "monitor-smartphone": "macbook.and.iphone", "code": "chevron.left.forwardslash.chevron.right", "terminal": "terminal",
  "database": "cylinder", "server": "server.rack", "cloud": "cloud", "tag": "tag", "flag": "flag", "thumbs-up": "hand.thumbsup",
  "thumbs-down": "hand.thumbsdown", "megaphone": "megaphone", "gift": "gift", "puzzle": "puzzlepiece", "layout": "square.grid.2x2",
  "layout-grid": "square.grid.2x2", "users": "person.2", "user": "person", "mail": "envelope", "bell": "bell", "calendar": "calendar",
  "image": "photo", "camera": "camera", "link": "link", "search": "magnifyingglass", "accessibility": "accessibility",
  "languages": "character.bubble", "wand": "wand.and.stars", "wand-sparkles": "wand.and.stars", "plug": "powerplug",
  "credit-card": "creditcard", "shopping-cart": "cart", "map": "map", "music": "music.note", "video": "video", "eye": "eye",
  "check": "checkmark", "circle-check": "checkmark.circle", "x": "xmark", "plus": "plus", "inbox": "tray", "package": "shippingbox",
  "keyboard": "keyboard", "clock": "clock", "timer": "timer", "trash": "trash", "download": "arrow.down.circle", "upload": "arrow.up.circle",
  "refresh-cw": "arrow.clockwise", "moon": "moon", "sun": "sun.max", "wifi": "wifi", "bot": "cpu", "cpu": "cpu"
]

// MARK: - Shared pieces

/// FeedbackStatusBadge: the status colour's dot and label on a faint wash of it.
struct FeedbackStatusBadge: View {
  let status: FeedbackStatusDefinition
  var body: some View {
    let tint = FeedbackFormat.tint(status.color)
    HStack(spacing: 5) {
      Circle().fill(tint ?? Theme.textDimmed).frame(width: 6, height: 6)
      Text(status.label).lineLimit(1)
    }
    .font(.lnCaptionMedium)
    .foregroundStyle(tint ?? Theme.textToned)
    .padding(.horizontal, 8)
    .frame(height: 20)
    .background(tint?.opacity(0.12) ?? Theme.accented, in: Capsule())
  }
}

/// A post type's icon: an SF Symbol for an Iconify name, the emoji itself otherwise.
struct FeedbackTypeIcon: View {
  let icon: String
  var size: CGFloat = 12
  var body: some View {
    if !icon.isEmpty && !FeedbackFormat.isIconifyName(icon) {
      Text(icon).font(.system(size: size))
    } else {
      Image(systemName: FeedbackFormat.symbol(icon)).font(.system(size: size, weight: .medium))
    }
  }
}

/// The read-only vote tally operators see (they do not vote).
struct FeedbackVoteTile: View {
  let count: Int
  var body: some View {
    VStack(spacing: 1) {
      Image(systemName: "chevron.up").font(.system(size: 11, weight: .semibold))
      Text("\(count)").font(.lnCaptionMedium).monospacedDigit()
    }
    .foregroundStyle(Theme.textToned)
    .frame(width: 36, height: 40)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(count) votes")
  }
}

struct FeedbackOption: Hashable {
  let value: String
  let label: String
  /// A board colour, drawn as a dot.
  var color: String? = nil
}

/// A select drawn like a `.linear` field: the current choice and a chevron, a menu of the rest.
struct FeedbackSelect: View {
  let options: [FeedbackOption]
  @Binding var selection: String
  var compact = false
  /// An extra entry under the choices, such as "New epic…".
  var create: (title: LocalizedStringKey, action: () -> Void)? = nil
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    let current = options.first { $0.value == selection }
    Menu {
      Picker(selection: $selection) {
        ForEach(options, id: \.value) { option in Text(option.label).tag(option.value) }
      } label: { EmptyView() }
      if let create {
        Divider()
        Button(action: create.action) { Label(create.title, systemImage: "plus") }
      }
    } label: {
      HStack(spacing: 7) {
        if let color = current?.color { Circle().fill(FeedbackFormat.tint(color) ?? Theme.textDimmed).frame(width: 7, height: 7) }
        Text(current?.label ?? selection).lineLimit(1)
        Spacer(minLength: 4)
        Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      .font(compact ? .lnMeta : .lnBody)
      .foregroundStyle(Theme.text)
      .padding(.horizontal, compact ? 10 : 12)
      .frame(maxWidth: .infinity, minHeight: compact ? 36 : 40)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      .contentShape(Rectangle())
      .opacity(isEnabled ? 1 : 0.5)
    }
  }
}

/// A switch with its label and the line that explains it.
struct FeedbackToggleRow: View {
  let title: String
  let detail: String
  @Binding var isOn: Bool
  var body: some View {
    Toggle(isOn: $isOn) {
      VStack(alignment: .leading, spacing: 2) {
        Text(LocalizedStringKey(title)).font(.lnRow).foregroundStyle(Theme.textHighlighted)
        Text(LocalizedStringKey(detail)).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
      }
    }
    .tint(Theme.accent)
  }
}

extension View {
  /// An action's error as an alert; dismissing it clears the message.
  func feedbackErrorAlert(_ message: Binding<String>) -> some View {
    alert(message.wrappedValue, isPresented: Binding(get: { !message.wrappedValue.isEmpty }, set: { if !$0 { message.wrappedValue = "" } })) {
      Button("OK", role: .cancel) {}
    }
  }
}
