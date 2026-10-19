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

struct BoardConfig: Codable, Equatable, Sendable {
  var enabled: Bool
  var statuses: [FeedbackStatusDefinition]
  var labels: [FeedbackTagDefinition]
  /// Linked feedback posts follow an item's status category.
  var syncFeedback: Bool
  var roadmap: BoardRoadmapOptions

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

struct BoardItem: Codable, Equatable, Sendable, Identifiable {
  let id: String
  let projectId: String
  let number: Int?
  var title: String
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
  /// An ISO date at UTC midnight, or nil.
  var targetDate: String?
  /// On the public roadmap once its status is planned, active or done.
  var isPublic: Bool
  var feedbackPostIds: [String]
  var conversationIds: [String]
  /// Σ of the linked, non-hidden posts' votes.
  var voteCount: Int
  var posts: [BoardLinkedPost]
  var conversations: [BoardLinkedConversation]
  var completedAt: String?
  var createdAt: String
  var updatedAt: String

  enum CodingKeys: String, CodingKey {
    case id, projectId, number, title, description, publicDescription, status, statusCategory, rank, priority, assigneeId, labels, targetDate
    case isPublic = "public"
    case feedbackPostIds, conversationIds, voteCount, posts, conversations, completedAt, createdAt, updatedAt
  }

  /// "2026-11-15" from the stored date, as a date input holds it; '' for none.
  var targetDay: String { String((targetDate ?? "").prefix(10)) }
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
