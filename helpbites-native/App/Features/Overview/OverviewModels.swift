import Foundation

// shared/overview.ts and server/routes/v1/admin/overview.get.ts: every project at
// once, the latest unread conversations, and revenue from each project with Stripe.

/// `GET /v1/admin/overview?range=`.
struct WorkspaceOverview: Decodable, Sendable {
  struct Totals: Decodable, Sendable {
    /// Unread customer messages outside the archive: the inbox badge.
    let unreadMessages: Int
    let unread, open, errors: Int
  }
  /// Open, unread (outside the archive) and open error conversations of one project.
  struct ProjectStats: Decodable, Identifiable, Sendable { let id, name: String; let open, unread, errors: Int }
  struct Unread: Decodable, Identifiable, Sendable {
    let conversationId, projectId, name, email, subject, preview: String
    let unread: Int
    let at: String
    var id: String { conversationId }
  }
  let totals: Totals
  /// Every project, in the sidebar's order.
  let projects: [ProjectStats]
  /// The latest conversations with unread messages, newest first.
  let unread: [Unread]
  /// Nil for agents: revenue is for admins and owners.
  let revenue: WorkspaceRevenue?
}

/// Each project counts in its own currency, the one its Revenue tab totals in. Amounts are in
/// major units (19.99). `change` is the move from the period before as a fraction (0.12 is 12%
/// up); nil for all time, or when the period before had nothing.
struct WorkspaceRevenue: Decodable, Sendable {
  struct Month: Decodable, Identifiable, Sendable { let month: String; let net: Double; var id: String { month } }
  struct Total: Decodable, Identifiable, Sendable {
    let currency: String
    let net: Double
    let previousNet, change: Double?
    let mrr: Double
    let subscribers: Int
    let months: [Month]
    var id: String { currency }
  }
  struct ProjectRevenue: Decodable, Identifiable, Sendable {
    let projectId, currency: String
    let net: Double
    let previousNet, change: Double?
    let mrr: Double
    let subscribers, payments: Int
    var id: String { projectId }
  }
  let range: String
  /// Projects with Stripe connected, synced or not.
  let connected: Int
  /// One per currency, the most revenue first.
  let totals: [Total]
  /// Projects that have synced, the most revenue first.
  let projects: [ProjectRevenue]
}
