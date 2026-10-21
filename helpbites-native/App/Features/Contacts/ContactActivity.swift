import SwiftUI

// One person's history in a single list (web: the Activity section of ContactDrawer.vue and
// app/utils/contactActivity.ts): GET /v1/contacts/:id/activity, newest first, paged backwards
// with `nextBefore`. The server writes each item's title and detail.

struct ActivityRef: Decodable, Equatable, Sendable { let kind, id: String }

struct ActivityItem: Decodable, Equatable, Identifiable, Sendable {
  let id, type, at, title: String
  let detail: String?
  let ref: ActivityRef?

  /// `ACTIVITY_TYPES` in shared/activity.ts, with the web's icons.
  var systemImage: String {
    switch type {
    case "joined": "person.badge.plus"
    case "conversation": "bubble.left"
    case "feedback_post": "lightbulb"
    case "feedback_comment": "text.bubble"
    case "vote": "hand.thumbsup"
    case "email": "envelope"
    case "sequence": "list.number"
    case "payment": "creditcard"
    case "subscription": "arrow.triangle.2.circlepath"
    case "onboarding": "rectangle.stack"
    default: "circle"
    }
  }

  /// Where the item leads in the app; nil when it leads nowhere.
  func route(projectId: String) -> AppRoute? {
    switch ref?.kind {
    case "feedback_post": .project(projectId, .feedback)
    case "email_log": .project(projectId, .email)
    case "sequence": .project(projectId, .campaigns)
    case "onboarding_flow": .project(projectId, .onboarding)
    case "stripe": .project(projectId, .revenue)
    default: nil
    }
  }
}

struct ContactActivityPage: Decodable, Sendable {
  let items: [ActivityItem]
  let nextBefore: String?
}

enum ActivityText {
  /// The kinds the Billing section already shows in more detail, live from Stripe.
  static let billingTypes: Set<String> = ["payment", "subscription"]
  static let shownTypes = ["joined", "conversation", "feedback_post", "feedback_comment", "vote", "email", "sequence", "onboarding"].filter { !billingTypes.contains($0) }

  /// "5 minutes ago", "yesterday", "3 weeks ago".
  @MainActor static func relative(_ raw: String) -> String {
    guard let date = DateText.date(raw) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.dateTimeStyle = .named
    formatter.unitsStyle = .full
    return formatter.localizedString(for: date, relativeTo: Date())
  }
}

/// The timeline as rows of a Form: an icon per kind, the title and detail, a relative time. A
/// conversation opens in the inbox, other items open their section; "Show older" pages back.
struct ContactActivitySection: View {
  let projectId: String
  let contactId: String
  /// Called before the app moves to another screen, so a sheet can close.
  var onNavigate: () -> Void = {}
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var items: [ActivityItem] = []
  @State private var next = ""
  @State private var loading = true
  @State private var loadingMore = false
  @State private var failed = false

  var body: some View {
    Section("Activity") {
      if loading { ProgressView().frame(maxWidth: .infinity) }
      else if items.isEmpty { Text(failed ? "Could not load their activity." : "Nothing yet.").font(.lnMeta).foregroundStyle(failed ? Theme.error : Theme.textMuted) }
      ForEach(items) { item in
        if let target = destination(item) {
          Button { open(target) } label: { row(item, linked: true) }.buttonStyle(.plain)
        } else {
          row(item, linked: false)
        }
      }
      if !next.isEmpty {
        Button { Task { await load(more: true) } } label: {
          HStack { Spacer(); if loadingMore { ProgressView() } else { Text("Show older") }; Spacer() }
        }
        .disabled(loadingMore)
      }
    }
    .task(id: contactId) { await load(more: false) }
  }

  private func row(_ item: ActivityItem, linked: Bool) -> some View {
    HStack(spacing: 10) {
      Image(systemName: item.systemImage).foregroundStyle(Theme.textMuted).frame(width: 18)
      VStack(alignment: .leading, spacing: 1) {
        Text(item.title).lineLimit(1)
        if let detail = item.detail, !detail.isEmpty { Text(detail).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
      }
      Spacer(minLength: 8)
      Text(ActivityText.relative(item.at)).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityHint(linked ? "Opens it" : "")
  }

  /// A conversation, or another screen of the app.
  private enum Target { case conversation(String), route(AppRoute) }

  private func destination(_ item: ActivityItem) -> Target? {
    if item.ref?.kind == "conversation", let id = item.ref?.id { return .conversation(id) }
    return item.route(projectId: projectId).map { .route($0) }
  }

  private func open(_ target: Target) {
    onNavigate()
    switch target {
    case .conversation(let id):
      workspace.go(.inbox)
      Task { await workspace.inbox.select(id) }
    case .route(let route):
      workspace.go(route)
    }
  }

  private func load(more: Bool) async {
    if more { loadingMore = true } else { loading = true; items = []; next = "" }
    defer { loading = false; loadingMore = false }
    var query = ["project": projectId, "types": ActivityText.shownTypes.joined(separator: ","), "limit": "20"]
    if more, !next.isEmpty { query["before"] = next }
    do {
      let page: ContactActivityPage = try await session.get("/v1/contacts/\(contactId)/activity", query: query)
      let known = Set(items.map(\.id))
      items += page.items.filter { !known.contains($0.id) }
      next = page.nextBefore ?? ""
      failed = false
    } catch { if !Task.isCancelled { failed = true } }
  }
}
