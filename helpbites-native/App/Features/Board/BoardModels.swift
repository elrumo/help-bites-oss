import Foundation

// A project board as the API serializes it (shared/board.ts): the board's
// settings on the admin project, and its items from /v1/admin/board-items.
// Statuses and labels reuse the feedback board's definitions; a status's
// category means the same here (planned, active and done can go public).

struct BoardRoadmapOptions: Codable, Equatable, Sendable {
  /// columns · timeline · list
  var layout: String
  var showLabels: Bool
  var showDates: Bool
}

/// Filters a saved view keeps (BoardViewFilters): '' is any; assignee may be 'unassigned', priority 'none'.
struct BoardViewFilters: Codable, Equatable, Sendable {
  var search = ""
  var labels: [String] = []
  var assignee = ""
  var priority = ""
  var kind = ""
  var epic = ""
  var release = ""
  var roadmapOnly = false
}

/// A named layout, grouping, order and set of filters, shared by the project (BoardSavedView, `board.views`).
struct BoardSavedView: Codable, Equatable, Sendable, Identifiable {
  let id: String
  var name: String
  /// kanban · list
  var layout: String
  /// status · epic · release
  var group: String
  /// manual · newest · oldest · votes
  var order: String
  var filters: BoardViewFilters

  static let maxCount = 20
  static let maxNameLength = 40

  var asJSON: JSONValue {
    .object([
      "id": .string(id), "name": .string(name), "layout": .string(layout), "group": .string(group), "order": .string(order),
      "filters": .object([
        "search": .string(filters.search), "labels": .array(filters.labels.map(JSONValue.string)), "assignee": .string(filters.assignee),
        "priority": .string(filters.priority), "kind": .string(filters.kind), "epic": .string(filters.epic), "release": .string(filters.release),
        "roadmapOnly": .bool(filters.roadmapOnly)
      ])
    ])
  }
}

struct BoardConfig: Codable, Equatable, Sendable {
  var enabled: Bool
  var statuses: [FeedbackStatusDefinition]
  var labels: [FeedbackTagDefinition]
  /// Linked feedback posts follow an item's status category.
  var syncFeedback: Bool
  var roadmap: BoardRoadmapOptions
  /// Saved views; absent from a server that predates them.
  var views: [BoardSavedView]?

  /// The categories the public roadmap shows (ROADMAP_CATEGORIES).
  static let roadmapCategories = ["planned", "active", "done"]

  func status(_ key: String) -> FeedbackStatusDefinition? { statuses.first { $0.key == key } }

  func label(_ key: String) -> FeedbackTagDefinition {
    labels.first { $0.key == key } ?? FeedbackTagDefinition(key: key, label: key, color: "neutral")
  }

  var defaultStatusKey: String { (statuses.first { $0.isDefault == true } ?? statuses.first)?.key ?? "" }

  /// A status the board no longer knows sits in the default column.
  func column(of item: BoardItem) -> String { status(item.status) == nil ? defaultStatusKey : item.status }

  /// Whether a public item in this status shows on the roadmap.
  func isOnRoadmap(_ statusKey: String) -> Bool { Self.roadmapCategories.contains(status(statusKey)?.category ?? "open") }
}

/// A linked feedback post; hidden ones never reach the roadmap nor count.
struct BoardLinkedPost: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let number: Int?
  let title, status, statusCategory: String
  let voteCount: Int
  let hidden: Bool
}

struct BoardLinkedConversation: Codable, Equatable, Sendable, Identifiable {
  let id, subject, status, endUserName: String
}

/// An error from the project's tracker that an item was filed from (POST /v1/admin/errors/:id/board).
struct BoardErrorRef: Codable, Equatable, Sendable, Identifiable {
  let provider, issueId, linkId, title, url: String
  var id: String { "\(provider):\(issueId)" }
  var providerName: String { provider == "bugsink" ? "Bugsink" : provider == "glitchtip" ? "GlitchTip" : provider }
}

/// Another item of the same board that this one is related to.
struct BoardRelatedItem: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let number: Int?
  let title: String
  let status: String
}

/// An epic's or release's cards, and how many are in a done status.
struct BoardProgress: Codable, Equatable, Sendable {
  let total, done: Int
  /// The same in estimate points; absent from a server that predates estimates.
  var estimateTotal, estimateDone: Double?
  var fraction: Double { total > 0 ? Double(done) / Double(total) : 0 }
}

/// What an item is (BOARD_ITEM_KINDS): a card, an epic that groups cards, or a release that ships cards and epics.
enum BoardKind {
  static let all = ["task", "epic", "release"]

  /// kindCanHave: only a card has an epic; a release has no parent.
  static func canHave(_ kind: String, parent: String) -> Bool { parent == "epic" ? kind == "task" : kind != "release" }

  static func name(_ kind: String) -> String {
    switch kind {
    case "epic": String(localized: "Epic")
    case "release": String(localized: "Release")
    default: String(localized: "Card")
    }
  }

  /// nil for a plain card, which shows no kind mark.
  static func icon(_ kind: String) -> String? {
    switch kind {
    case "epic": "square.stack.3d.up"
    case "release": "shippingbox"
    default: nil
    }
  }
}

struct BoardItem: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let projectId: String
  let number: Int?
  var title: String
  /// task · epic · release; absent from a server that predates epics and releases.
  var kind: String?
  /// Internal Markdown; never public.
  var description: String
  /// The only text the roadmap shows.
  var publicDescription: String
  var status: String
  var statusCategory: String
  /// Sort key within a column; lower comes first.
  var rank: Double
  /// '' · low · normal · high · urgent
  var priority: String
  var assigneeId: String
  var labels: [String]
  /// Images and files; absent from a server that predates them.
  var attachments: [ItemAttachment]?
  /// An ISO date at UTC midnight, or nil.
  var targetDate: String?
  /// Effort in points, or nil when nobody sized it; absent from a server that predates estimates.
  var estimate: Double?
  /// On the public roadmap once its status is planned, active or done.
  var isPublic: Bool
  var feedbackPostIds: [String]
  var conversationIds: [String]
  /// Related items, linked both ways; absent from a server that predates them.
  var relatedItemIds: [String]?
  var related: [BoardRelatedItem]?
  /// The epic and the release it belongs to ('' or nil for none); absent from a server that predates them.
  var epicId: String?
  var releaseId: String?
  var epic: BoardRelatedItem?
  var release: BoardRelatedItem?
  /// Set on an epic or a release: its cards.
  var progress: BoardProgress?
  /// The errors it was filed from; absent from a server that predates filing them.
  var errorRefs: [BoardErrorRef]?
  /// Σ of the linked, non-hidden posts' votes.
  var voteCount: Int
  var posts: [BoardLinkedPost]
  var conversations: [BoardLinkedConversation]
  var completedAt: String?
  var createdAt: String
  var updatedAt: String
  var lastModifiedBy: String?
  var lastModifiedSource: String?

  enum CodingKeys: String, CodingKey {
    case id, projectId, number, title, kind, description, publicDescription, status, statusCategory, rank, priority, assigneeId, labels, attachments, targetDate, estimate
    case isPublic = "public"
    case feedbackPostIds, conversationIds, relatedItemIds, related, epicId, releaseId, epic, release, progress, errorRefs, voteCount, posts, conversations, completedAt, createdAt, updatedAt, lastModifiedBy, lastModifiedSource
  }

  var itemKind: String { kind ?? "task" }
  var isGroup: Bool { itemKind != "task" }

  /// "2026-11-15" from the stored date, as a date input holds it; '' for none.
  var targetDay: String { String((targetDate ?? "").prefix(10)) }
}

enum BoardEstimate {
  /// "3" or "2.5": no trailing zero, as the field and the cards show it.
  static func text(_ points: Double) -> String { points == points.rounded() ? String(Int(points)) : String(points) }
  /// A field's text as points; nil for empty or anything that is not a number from 0 to 1000 (BOARD_ESTIMATE_MAX).
  static func points(_ text: String?) -> Double? {
    guard let text = text?.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."), let value = Double(text), value >= 0, value <= 1000 else { return nil }
    return (value * 100).rounded() / 100
  }
}

struct BoardItemHistoryChange: Codable, Equatable, Sendable, Identifiable {
  let field: String
  let from, to: JSONValue
  var id: String { field }
}

struct BoardItemHistory: Codable, Equatable, Sendable, Identifiable {
  let id, itemId, itemTitle, actorId, actorName, source, action, createdAt: String
  let itemNumber: Int?
  let changes: [BoardItemHistoryChange]
}

struct BoardItemHistoryPage: Codable, Sendable {
  let history: [BoardItemHistory]
  let hasMore: Bool
  let nextOffset: Int?
}

struct BoardItemComment: Codable, Equatable, Sendable, Identifiable {
  let id, itemId, body, actorId, actorName, authorName, authorType, source, createdAt: String
  let attachments: [ItemAttachment]
  let parentId, replyToId: String?
}

struct BoardItemCommentsPage: Codable, Sendable {
  let comments: [BoardItemComment]
  let hasMore: Bool
  let nextOffset: Int?
}

/// rankBetween: the midpoint between two neighbours, one step past the only
/// neighbour there is, 0 in an empty column.
/// ponytail: about 50 halvings of the same gap exhaust a Double; rebalance the
/// column (ranks 1, 2, 3…) if that ever happens.
enum BoardRank {
  static func between(_ before: Double?, _ after: Double?) -> Double {
    let a = before.flatMap { $0.isFinite ? $0 : nil }
    let b = after.flatMap { $0.isFinite ? $0 : nil }
    switch (a, b) {
    case let (a?, b?): return (a + b) / 2
    case let (a?, nil): return a + 1
    case let (nil, b?): return b - 1
    case (nil, nil): return 0
    }
  }
}

/// Board items in board order: rank, then number.
func boardOrder(_ lhs: BoardItem, _ rhs: BoardItem) -> Bool {
  lhs.rank != rhs.rank ? lhs.rank < rhs.rank : (lhs.number ?? 0) < (rhs.number ?? 0)
}

/// Where a drop lands: the rank between its new neighbours in the column, or
/// nil when the card would end up exactly where it is.
func boardDropRank(moving itemId: String, column: [BoardItem], before anchor: String?) -> Double? {
  let rest = column.filter { $0.id != itemId }
  let position = anchor.flatMap { id in rest.firstIndex { $0.id == id } } ?? rest.count
  let previous = position > 0 ? rest[position - 1] : nil
  let next = position < rest.count ? rest[position] : nil
  if let at = column.firstIndex(where: { $0.id == itemId }) {
    let currentPrevious = at > 0 ? column[at - 1].id : nil
    let currentNext = at + 1 < column.count ? column[at + 1].id : nil
    if currentPrevious == previous?.id && currentNext == next?.id { return nil }
  }
  return BoardRank.between(previous?.rank, next?.rank)
}
