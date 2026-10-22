import SwiftUI

// shared/changelog.ts as the admin API returns it (entries, releases, the
// project's changelog options), plus the small pure rules the panel applies to
// them (`isEntryPublic`, `changelogPrefill`, the tag colours of changelogUi.ts).

enum ChangelogTag: String, Codable, CaseIterable, Identifiable, Sendable {
  case new, improved, fix, removed, breaking
  var id: String { rawValue }
  var label: String {
    switch self {
    case .new: String(localized: "New")
    case .improved: String(localized: "Improved")
    case .fix: String(localized: "Fixed")
    case .removed: String(localized: "Removed")
    case .breaking: String(localized: "Breaking")
    }
  }
  /// The chip colour (CHANGELOG_TAG_CLASS): emerald, sky, amber, stone, red.
  var tint: Color {
    switch self {
    case .new: Color(light: 0x047857, dark: 0x6ee7b7)
    case .improved: Color(light: 0x0369a1, dark: 0x7dd3fc)
    case .fix: Color(light: 0xb45309, dark: 0xfcd34d)
    case .removed: Color(light: 0x57534e, dark: 0xd6d3d1)
    case .breaking: Color(light: 0xb91c1c, dark: 0xfca5a5)
    }
  }
}

enum ChangelogEntryStatus: String, Codable, Sendable { case draft, published, archived }
enum ChangelogReviewStatus: String, Codable, Sendable { case pending, approved, rejected }

/// What an entry links to, resolved by the server. `kind` is feedback, board or conversation.
struct ChangelogSource: Decodable, Equatable, Identifiable, Sendable {
  let kind, id, label, status: String
  let number: Int?
  let done: Bool
  var key: String { "\(kind):\(id)" }
  static func == (lhs: Self, rhs: Self) -> Bool { lhs.key == rhs.key && lhs.done == rhs.done && lhs.label == rhs.label }
  var kindLabel: String { ["feedback": String(localized: "Feedback post"), "board": String(localized: "Planning item"), "conversation": String(localized: "Conversation")][kind] ?? kind }
  var symbol: String { ["feedback": "lightbulb", "board": "rectangle.split.3x1", "conversation": "bubble.left"][kind] ?? "link" }
}

struct ChangelogEntry: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let number: Int?
  let slug, title, summary, body, bodyFormat, area, releaseId, version: String
  let tag: ChangelogTag
  let status: ChangelogEntryStatus
  let publishedAt: String?
  let commitShas: [String]
  let reviewStatus: ChangelogReviewStatus?
  let reviewedBy, reviewNotes: String?
  let authorName: String
  let aiGenerated: Bool
  let commentCount: Int
  let sources: [ChangelogSource]
  let createdAt, updatedAt: String

  /// Archived entries never show; a draft is private; a published one waits on a draft release.
  func state(in release: ChangelogRelease?) -> ChangelogState {
    switch status {
    case .archived: .archived
    case .draft: .draft
    case .published: (release.map { $0.status == .published } ?? true) ? .live : .waiting
    }
  }
  var doneSources: Int { sources.filter(\.done).count }
  var needsReview: Bool { status == .draft && reviewStatus != nil }
}

/// Where an entry stands (stateOf in the web page).
enum ChangelogState: String, Sendable {
  case live, waiting, draft, archived
  var label: String {
    switch self {
    case .live: String(localized: "Public")
    case .waiting: String(localized: "Waiting for release")
    case .draft: String(localized: "Draft")
    case .archived: String(localized: "Archived")
    }
  }
  var tint: Color {
    switch self {
    case .live: Theme.success
    case .waiting: Theme.warning
    case .draft, .archived: Theme.textToned
    }
  }
}

struct ChangelogRelease: Decodable, Equatable, Identifiable, Sendable {
  enum Status: String, Decodable, Sendable { case draft, published }
  let id, version, title, summary: String
  let status: Status
  let publishedAt: String?
  let createdAt: String

  /// "2.4 · Autumn" with a "(draft)" marker, for pickers.
  var pickerLabel: String { "\(version)\(title.isEmpty ? "" : " · \(title)")\(status == .draft ? String(localized: " (draft)") : "")" }
}

struct ChangelogRun: Decodable, Equatable, Sendable {
  let state: String
  let created, skipped: Int
  let truncated: Bool?
  let error: String?
  var running: Bool { state == "running" }
}

/// `project.changelog` (ChangelogConfig). Optional keys so an older server still loads the screen.
struct ChangelogSettings: Decodable, Equatable, Sendable {
  var autoDraft = false, enabled = false, comments = false, notify = false
  var areas: [String] = [], commentNotify: [String] = []
  var siteName = "", entryUrl = "", pageUrl = ""
  var onPush = false, autoPublish = false
  var timezone = "UTC"
  var weeklyHour = 8, quietMinutes = 30, maxWaitMinutes = 60

  init() {}
  private enum Keys: String, CodingKey { case autoDraft, enabled, comments, notify, areas, commentNotify, siteName, entryUrl, pageUrl, commitAi, digest }
  private enum AiKeys: String, CodingKey { case onPush, autoPublish }
  private enum DigestKeys: String, CodingKey { case timezone, weeklyHour, quietMinutes, maxWaitMinutes }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    autoDraft = try c.decodeIfPresent(Bool.self, forKey: .autoDraft) ?? false
    enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
    comments = try c.decodeIfPresent(Bool.self, forKey: .comments) ?? false
    notify = try c.decodeIfPresent(Bool.self, forKey: .notify) ?? false
    areas = try c.decodeIfPresent([String].self, forKey: .areas) ?? []
    commentNotify = try c.decodeIfPresent([String].self, forKey: .commentNotify) ?? []
    siteName = try c.decodeIfPresent(String.self, forKey: .siteName) ?? ""
    entryUrl = try c.decodeIfPresent(String.self, forKey: .entryUrl) ?? ""
    pageUrl = try c.decodeIfPresent(String.self, forKey: .pageUrl) ?? ""
    if let ai = try? c.nestedContainer(keyedBy: AiKeys.self, forKey: .commitAi) {
      onPush = try ai.decodeIfPresent(Bool.self, forKey: .onPush) ?? false
      autoPublish = try ai.decodeIfPresent(Bool.self, forKey: .autoPublish) ?? false
    }
    if let digest = try? c.nestedContainer(keyedBy: DigestKeys.self, forKey: .digest) {
      timezone = try digest.decodeIfPresent(String.self, forKey: .timezone) ?? "UTC"
      weeklyHour = try digest.decodeIfPresent(Int.self, forKey: .weeklyHour) ?? 8
      quietMinutes = try digest.decodeIfPresent(Int.self, forKey: .quietMinutes) ?? 30
      maxWaitMinutes = try digest.decodeIfPresent(Int.self, forKey: .maxWaitMinutes) ?? 60
    }
  }
}

/// The few fields of `GET /v1/admin/projects` this screen needs.
struct ChangelogProject: Decodable, Sendable {
  let id, publicKey, name: String
  let changelog: ChangelogSettings?

  @MainActor static func load(_ id: String, session: SessionStore) async throws -> ChangelogProject {
    struct Response: Decodable, Sendable { let projects: [ChangelogProject] }
    let response: Response = try await session.get("/v1/admin/projects")
    guard let project = response.projects.first(where: { $0.id == id }) else { throw APIError.server(String(localized: "Project not found")) }
    return project
  }
}

struct ChangelogSubscribers: Decodable, Equatable, Sendable {
  let instant, weekly, pending, unsubscribed: Int
}

/// `POST …/notify/run`: the instant sweep answers flushed/entries/recipients, the weekly digest due/sent/entries/recipients.
struct ChangelogNotifyResult: Decodable, Equatable, Sendable {
  let flushed, due, sent: Bool?
  let entries, recipients: Int?

  func summary(job: String, dryRun: Bool) -> String {
    let entries = entries ?? 0, recipients = recipients ?? 0
    let people = recipients == 1 ? String(localized: "1 subscriber") : String(localized: "\(recipients) subscribers")
    let items = entries == 1 ? String(localized: "1 entry") : String(localized: "\(entries) entries")
    if job == "instant" {
      guard flushed == true else { return entries > 0 ? String(localized: "\(items) published, still waiting for things to go quiet. Nothing sent.") : String(localized: "Nothing is waiting to be sent.") }
      return dryRun ? String(localized: "Would send \(items) to \(people).") : String(localized: "Sent \(items) to \(people).")
    }
    guard due == true else { return String(localized: "The weekly digest is not due yet.") }
    guard sent == true else { return entries == 0 ? String(localized: "Nothing was published in the window, or the digest already went out.") : String(localized: "Nothing to send.") }
    return dryRun ? String(localized: "Would send \(items) to \(people).") : String(localized: "Sent \(items) to \(people).")
  }
}

/// What an import answered: per item `{ index, created }` and the ones that failed.
struct ChangelogImportResult: Decodable, Sendable {
  struct Item: Decodable, Sendable { let index: Int; let created: Bool? }
  struct Failure: Decodable, Sendable { let index: Int; let message: String }
  let results: [Item]
  let failed: [Failure]
}

// MARK: - Pure rules

/// shared/changelog.ts `changelogPrefill`: only text that is already public is copied.
enum ChangelogPrefill {
  struct Draft: Equatable { var title: String; var body: String; var tag: ChangelogTag }

  static func make(kind: String, source: [String: String]) -> Draft {
    func text(_ key: String) -> String { (source[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    switch kind {
    case "feedback":
      let type = text("type")
      return Draft(
        title: text("changelogTitle").isEmpty ? text("title") : text("changelogTitle"),
        body: text("changelogBody").isEmpty ? text("body") : text("changelogBody"),
        tag: type == "bug" ? .fix : type == "feature" ? .new : .improved
      )
    case "board":
      return Draft(title: text("title"), body: text("publicDescription"), tag: .improved)
    default:
      return Draft(title: "", body: "", tag: text("type") == "error" ? .fix : .improved)
    }
  }

  /// A small check of the port, run from the preview.
  static func selfCheck() {
    assert(make(kind: "feedback", source: ["title": "A", "body": "B", "type": "bug"]) == Draft(title: "A", body: "B", tag: .fix))
    assert(make(kind: "feedback", source: ["title": "A", "changelogTitle": "C", "type": "feature"]).title == "C")
    assert(make(kind: "board", source: ["title": "T", "publicDescription": "P", "description": "secret"]) == Draft(title: "T", body: "P", tag: .improved))
    assert(make(kind: "conversation", source: ["type": "error", "subject": "secret"]) == Draft(title: "", body: "", tag: .fix))
  }
}

/// A calendar day ("2026-10-02") sent as noon UTC, the way the web's date input does.
func changelogPublishedAt(day: String) -> JSONValue { day.isEmpty ? .null : .string("\(day)T12:00:00.000Z") }

/// One release and the entries under it, or the entries of no release (`release == nil`).
struct ChangelogGroup: Identifiable {
  let release: ChangelogRelease?
  let entries: [ChangelogEntry]
  var id: String { release?.id ?? "none" }
}

/// Small pill in a row: a tint on a faint wash of it.
struct ChangelogChip: View {
  let text: String
  var tint: Color = Theme.textToned
  var body: some View {
    Text(verbatim: text)
      .font(.lnCaptionMedium)
      .foregroundStyle(tint)
      .lineLimit(1)
      .padding(.horizontal, 7)
      .frame(height: 20)
      .background(tint.opacity(0.14), in: Capsule())
  }
}

extension ChangelogTag {
  var chip: ChangelogChip { ChangelogChip(text: label, tint: tint) }
}
