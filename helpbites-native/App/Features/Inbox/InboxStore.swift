import Foundation
import Observation

// The inbox's state and every call it makes: the queue (GET /conversations,
// filtered and split into views on the server), the open
// conversation, triage, replies and notes, and the live event stream that keeps
// all of it current. Mirrors app/pages/inbox.vue.

/// The view pills above the list. Each is a server query (`view=`), as on the web
/// panel, and its count comes from the server under the same filters, so a
/// pill's number is the rows it lists.
enum InboxQueue: String, CaseIterable, Identifiable {
  case all, unassigned, mine, open, unread, archived
  var id: String { rawValue }
  var label: String {
    switch self {
    case .all: String(localized: "All")
    case .unassigned: String(localized: "Unassigned")
    case .mine: String(localized: "Mine")
    case .open: String(localized: "Open")
    case .unread: String(localized: "Unread")
    case .archived: String(localized: "Archived")
    }
  }
}

/// PATCH /admin/conversations/:id. Only the keys that are set are sent.
struct InboxTriage: Encodable, Sendable {
  var status: String?
  var priority: String?
  var assigneeId: String?
  var tags: [String]?
  var fields: [String: JSONValue]?
}

/// What the open conversation needs from its project beyond the shared `Project`.
struct InboxProjectInfo: Decodable, Sendable {
  let id: String
  let allowAttachments: Bool?
  let assistantLogoUrl: String?
}

/// POST /admin/conversations, from the new-conversation sheet.
struct InboxStartInput: Encodable, Sendable {
  let projectId, externalId, name, email, subject, body, type: String
  let fields: [String: JSONValue]
  let notifyByEmail: Bool
}

private struct DetailResponse: Decodable, Sendable { let conversation: Conversation; let endUser: EndUser; let project: InboxProjectInfo }
private struct ConversationResponse: Decodable, Sendable { let conversation: Conversation }
private struct MessageResponse: Decodable, Sendable { let message: Message }

@MainActor @Observable final class InboxStore {
  let session: SessionStore

  // MARK: Queue
  var conversations: [Conversation] = []
  var endUsers: [String: EndUser] = [:]
  private(set) var counts = InboxCounts(status: [:], type: [:], assignee: [:])
  private(set) var viewCounts: [String: Int] = [:]
  /// Unread messages across every project; the sidebar badge.
  var totalUnread = 0
  private(set) var unreadByProject: [String: Int] = [:]
  /// Archived conversations in scope; the Archived view's count.
  private(set) var archivedCount = 0
  /// The conversation awaiting a delete confirmation; the inbox screen asks once for every entry point.
  var pendingDelete: Conversation?
  private(set) var hasMore = false
  private(set) var loading = false
  var error = ""
  var queue: InboxQueue = .all
  // Server-side filters; "" means any. Set `projectFilter` before routing here to scope the queue.
  var projectFilter = ""
  var statusFilter = ""
  var priorityFilter = ""
  var typeFilter = ""
  var search = ""
  private var generation = 0

  // MARK: Open conversation
  private(set) var selectedId = ""
  /// The open conversation, kept even when the current filters hide its row.
  private(set) var current: Conversation?
  private(set) var messages: [Message] = []
  private(set) var hasEarlierMessages = false
  private(set) var endUser: EndUser?
  private(set) var project: InboxProjectInfo?
  /// Field values from the detail; live events always carry `fields: {}`.
  private(set) var fields: [String: JSONValue] = [:]
  /// The customer panel's read for the open conversation (plan, earlier conversations, linked feedback); nil until it loads.
  private(set) var context: ConversationHubContext?
  private(set) var threadLoading = false
  var threadError = ""
  var propertiesError = ""

  // MARK: Lookups
  private(set) var typesByProject: [String: [ConversationType]] = [:]
  private(set) var agents: [Agent] = []

  private var events: Task<Void, Never>?

  init(session: SessionStore) {
    self.session = session
    // The last unfiltered page, so the queue has rows on the first frame while the real one loads.
    if let cached = SnapshotCache.load(InboxResponse.self, "inbox") {
      conversations = cached.conversations
      endUsers = cached.endUsers
      hasMore = cached.hasMore
      totalUnread = cached.totalUnread
      counts = cached.counts ?? counts
      viewCounts = cached.viewCounts ?? [:]
      unreadByProject = cached.unreadByProject ?? [:]
    }
  }

  var myAgentId: String { session.agent?.id ?? "" }
  /// This agent's tapback key, matching the server's `actor` field.
  var myReactionActor: String { "agent:\(myAgentId)" }

  /// Launch and every return to the foreground: reload, then listen.
  func start() async {
    await refresh()
    if agents.isEmpty { await loadAgents() }
    if !selectedId.isEmpty { await select(selectedId) }
    startEvents()
  }

  func stop() { events?.cancel(); events = nil }

  // MARK: - Queue

  /// Changes whenever the server query does; the screen reloads on it.
  var queryKey: String { [projectFilter, statusFilter, priorityFilter, typeFilter, search.trimmingCharacters(in: .whitespaces), queue.rawValue].joined(separator: "\u{1f}") }
  var filtersActive: Bool { !projectFilter.isEmpty || !statusFilter.isEmpty || !priorityFilter.isEmpty || !typeFilter.isEmpty }

  func clearFilters() { projectFilter = ""; statusFilter = ""; priorityFilter = ""; typeFilter = "" }

  /// The list's query: filters, search and the view.
  private func queueQuery() -> [String: String] {
    var query: [String: String] = [:]
    if !projectFilter.isEmpty { query["project"] = projectFilter }
    if !statusFilter.isEmpty { query["status"] = statusFilter }
    if !priorityFilter.isEmpty { query["priority"] = priorityFilter }
    if !typeFilter.isEmpty { query["type"] = typeFilter }
    if queue != .all { query["view"] = queue.rawValue }
    let term = search.trimmingCharacters(in: .whitespaces)
    if !term.isEmpty { query["q"] = term }
    return query
  }

  func refresh(more: Bool = false) async {
    guard !session.token.isEmpty else { return }
    generation += 1
    let run = generation
    loading = true
    error = ""
    var query = queueQuery()
    if more, let last = conversations.last?.lastMessageAt { query["before"] = last }
    do {
      let page: InboxResponse = try await session.get("/v1/admin/conversations", query: query)
      guard run == generation else { return }
      if more {
        let known = Set(conversations.map(\.id))
        conversations += page.conversations.filter { !known.contains($0.id) }
      } else {
        conversations = page.conversations
      }
      if !more, !filtersActive, search.isEmpty, queue == .all { SnapshotCache.save(page, "inbox") }
      endUsers.merge(page.endUsers) { _, new in new }
      hasMore = page.hasMore
      totalUnread = page.totalUnread
      counts = page.counts ?? InboxCounts(status: [:], type: [:], assignee: [:])
      viewCounts = page.viewCounts ?? [:]
      unreadByProject = page.unreadByProject ?? [:]
      archivedCount = page.archivedCount ?? 0
      if let current, let row = conversations.first(where: { $0.id == current.id }) { self.current = row }
    } catch {
      guard run == generation else { return }
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }

  var visible: [Conversation] {
    let me = myAgentId
    switch queue {
    case .all, .archived: return conversations
    case .unassigned: return conversations.filter { ($0.assigneeId ?? "").isEmpty }
    case .mine: return conversations.filter { !me.isEmpty && $0.assigneeId == me }
    case .open: return conversations.filter { $0.statusCategory == "open" }
    case .unread: return conversations.filter { $0.unreadByAgent > 0 }
    }
  }

  func count(_ queue: InboxQueue) -> Int {
    if let count = viewCounts[queue.rawValue] { return count }
    // An older server: its facets, which ignore the list's filters.
    return switch queue {
    case .all: conversations.count
    case .unassigned: counts.assignee["unassigned"] ?? 0
    case .mine: counts.assignee[myAgentId] ?? 0
    case .open: counts.status["open"] ?? 0
    case .unread: totalUnread
    case .archived: archivedCount
    }
  }

  func conversation(_ id: String) -> Conversation? {
    if let current, current.id == id { return current }
    return conversations.first { $0.id == id }
  }

  func isDone(_ conversation: Conversation) -> Bool {
    conversation.statusCategory == "resolved" || conversation.statusCategory == "closed" || conversation.status == "done"
  }

  func markRead(_ id: String, read: Bool = true) async {
    guard let conversation = conversation(id) else { return }
    let next = read ? 0 : max(1, conversation.unreadByAgent)
    totalUnread = max(0, totalUnread - conversation.unreadByAgent + next)
    let readAt = read ? DateText.iso.string(from: Date()) : nil
    update(id) { $0.unreadByAgent = next; $0.agentReadAt = readAt }
    struct Input: Encodable, Sendable { let read: Bool }
    if let result: ConversationResponse = try? await session.send("/v1/admin/conversations/\(id)/read", body: Input(read: read)) { upsert(result.conversation) }
  }

  /// The list's quick toggle, aware of the type: close to its first terminal
  /// status and reopen to its default, falling back to the support keys.
  func toggleDone(_ conversation: Conversation) async {
    await loadTypes(conversation.projectId)
    let statuses = type(for: conversation)?.statuses ?? []
    let openKey = statuses.first { $0.isDefault == true }?.key ?? statuses.first { $0.category == "open" }?.key ?? "open"
    let doneKey = statuses.first { $0.isTerminal == true }?.key ?? statuses.first { $0.category == "resolved" || $0.category == "closed" }?.key ?? "done"
    await setStatus(conversation.id, isDone(conversation) ? openKey : doneKey)
  }

  /// Archive takes a thread out of the queue without losing it; unarchive brings it back.
  func setArchived(_ conversation: Conversation, _ archived: Bool) async {
    struct Input: Encodable, Sendable { let archived: Bool }
    let id = conversation.id
    do {
      let result: ConversationResponse = try await session.send("/v1/admin/conversations/\(id)/archive", body: Input(archived: archived))
      archivedCount = max(0, archivedCount + (archived ? 1 : -1))
      totalUnread = max(0, totalUnread + (archived ? -1 : 1) * conversation.unreadByAgent)
      upsert(result.conversation)
      if id == selectedId { deselect() }
    } catch {
      if id == selectedId { threadError = error.localizedDescription } else { self.error = error.localizedDescription }
    }
  }

  /// Permanently remove a conversation and all of its messages.
  func delete(_ conversation: Conversation) async {
    let id = conversation.id
    do {
      try await session.delete("/v1/admin/conversations/\(id)")
      if conversation.archivedAt != nil { archivedCount = max(0, archivedCount - 1) } else { totalUnread = max(0, totalUnread - conversation.unreadByAgent) }
      remove(id)
    } catch {
      if id == selectedId { threadError = error.localizedDescription } else { self.error = error.localizedDescription }
    }
  }

  func setStatus(_ id: String, _ status: String) async {
    struct Input: Encodable, Sendable { let status: String }
    do {
      let result: ConversationResponse = try await session.send("/v1/admin/conversations/\(id)/status", body: Input(status: status))
      upsert(result.conversation)
    } catch {
      if id == selectedId { threadError = error.localizedDescription } else { self.error = error.localizedDescription }
    }
  }

  // MARK: - Open conversation

  func select(_ id: String) async {
    selectedId = id
    threadError = ""
    propertiesError = ""
    guard !id.isEmpty else { return }
    if current?.id != id {
      current = conversations.first { $0.id == id }
      messages = []
      hasEarlierMessages = false
      endUser = nil
      project = nil
      fields = [:]
      context = nil
    }
    threadLoading = true
    Task { await loadContext(id) }
    defer { if selectedId == id { threadLoading = false } }
    do {
      async let detailRequest: DetailResponse = session.get("/v1/admin/conversations/\(id)")
      async let pageRequest: MessagePage = session.get("/v1/admin/conversations/\(id)/messages")
      let (detail, page) = try await (detailRequest, pageRequest)
      guard selectedId == id else { return }
      endUsers[detail.endUser.id] = detail.endUser
      endUser = detail.endUser
      project = detail.project
      fields = detail.conversation.fields ?? [:]
      current = detail.conversation
      upsert(detail.conversation)
      messages = page.messages
      hasEarlierMessages = page.hasMore
      await loadTypes(detail.conversation.projectId)
      if detail.conversation.unreadByAgent > 0 { await markRead(id) }
    } catch {
      if selectedId == id { threadError = error.localizedDescription }
    }
  }

  func deselect() {
    selectedId = ""
    threadLoading = false
  }

  func loadEarlierMessages() async {
    let id = selectedId
    guard let first = messages.first, !id.isEmpty else { return }
    do {
      let page: MessagePage = try await session.get("/v1/admin/conversations/\(id)/messages", query: ["before": first.createdAt])
      guard selectedId == id else { return }
      let known = Set(messages.map(\.id))
      messages.insert(contentsOf: page.messages.filter { !known.contains($0.id) }, at: 0)
      hasEarlierMessages = page.hasMore
    } catch { threadError = error.localizedDescription }
  }

  /// Reply to the customer. Images are uploaded first, then the message;
  /// `clientId` makes a retry of the same draft idempotent on the server.
  func reply(body: String, images: [Data], replyToId: String, notify: Bool, clientId: String) async -> Bool {
    let id = selectedId
    guard !id.isEmpty else { return false }
    threadError = ""
    struct Input: Encodable, Sendable { let body: String; let attachments: [Attachment]; let replyToId: String; let clientId: String; let notifyByEmail: Bool }
    struct Output: Decodable, Sendable { let message: Message; let conversation: Conversation; let emailSent: Bool?; let emailError: String? }
    do {
      var attachments: [Attachment] = []
      for (index, image) in images.enumerated() {
        let attachment: Attachment = try await session.upload("/v1/admin/attachments", fields: ["conversationId": id], file: image, filename: "image-\(index + 1)", mimeType: "application/octet-stream")
        attachments.append(attachment)
      }
      let result: Output = try await session.send("/v1/admin/conversations/\(id)/messages", body: Input(body: body, attachments: attachments, replyToId: replyToId, clientId: clientId, notifyByEmail: notify))
      upsertMessage(result.message)
      upsert(result.conversation)
      if notify, result.emailSent != true, let failure = result.emailError, !failure.isEmpty, failure != "throttled" {
        threadError = String(localized: "Sent, but the email failed: \(failure)")
      }
      return true
    } catch {
      if selectedId == id { threadError = error.localizedDescription }
      return false
    }
  }

  func addNote(_ body: String) async -> Bool {
    let id = selectedId
    guard !id.isEmpty else { return false }
    threadError = ""
    struct Input: Encodable, Sendable { let body: String }
    do {
      let result: MessageResponse = try await session.send("/v1/admin/conversations/\(id)/notes", body: Input(body: body))
      upsertMessage(result.message)
      return true
    } catch {
      if selectedId == id { threadError = error.localizedDescription }
      return false
    }
  }

  /// Toggle a tapback: picking the same emoji again takes it back.
  func react(_ emoji: String, on message: Message) async {
    struct Input: Encodable, Sendable { let emoji: String }
    do {
      let result: MessageResponse = try await session.send("/v1/admin/messages/\(message.id)/reactions", body: Input(emoji: emoji))
      upsertMessage(result.message)
    } catch { threadError = error.localizedDescription }
  }

  func unsend(_ message: Message) async {
    messages.removeAll { $0.id == message.id }
    do { try await session.delete("/v1/admin/messages/\(message.id)") }
    catch {
      threadError = error.localizedDescription
      await reloadMessages(message.conversationId)
    }
  }

  func triage(_ body: InboxTriage) async {
    let id = selectedId
    guard !id.isEmpty else { return }
    propertiesError = ""
    do {
      let result: ConversationResponse = try await session.send("/v1/admin/conversations/\(id)", method: "PATCH", body: body)
      upsert(result.conversation)
      if selectedId == id, let values = result.conversation.fields { fields = values }
    } catch { propertiesError = error.localizedDescription }
  }

  func runAction(_ action: ConversationAction, note: String) async {
    let id = selectedId
    guard !id.isEmpty else { return }
    propertiesError = ""
    struct Input: Encodable, Sendable { let note: String? }
    struct Output: Decodable, Sendable { let conversation: Conversation; let event: Message }
    do {
      let result: Output = try await session.send("/v1/admin/conversations/\(id)/actions/\(action.key)", body: Input(note: note.isEmpty ? nil : note))
      upsert(result.conversation)
      upsertMessage(result.event)
    } catch {
      propertiesError = error.localizedDescription
      // The server records the failed attempt on the timeline; show it.
      await reloadMessages(id)
    }
  }

  // MARK: - The customer panel

  func loadContext(_ id: String) async {
    guard !id.isEmpty else { return }
    // The panel's extra sections just stay out when this fails; the thread itself still works.
    if let result: ConversationHubContext = try? await session.get("/v1/admin/conversations/\(id)/context"), selectedId == id { context = result }
  }

  /// Link or unlink a feedback post (a post id or `#12`). Linking makes the customer follow it when they can.
  func linkFeedbackPost(_ postId: String, linked: Bool) async throws {
    let id = selectedId
    guard !id.isEmpty else { return }
    struct Input: Encodable, Sendable { let postId: String; let linked: Bool }
    let result: HubFeedbackLink = try await session.send("/v1/admin/conversations/\(id)/feedback-posts", body: Input(postId: postId, linked: linked))
    applyFeedbackLink(result, to: id)
  }

  /// File a new post written by the customer, who follows it, and link it here.
  func fileFeedbackPost(title: String, body: String) async throws {
    let id = selectedId
    guard !id.isEmpty else { return }
    struct Create: Encodable, Sendable { let title: String; let body: String }
    struct Input: Encodable, Sendable { let create: Create }
    let result: HubFeedbackLink = try await session.send("/v1/admin/conversations/\(id)/feedback-posts", body: Input(create: Create(title: title, body: body)))
    applyFeedbackLink(result, to: id)
  }

  private func applyFeedbackLink(_ result: HubFeedbackLink, to id: String) {
    guard selectedId == id, var panel = context else { return }
    if result.linked {
      if let index = panel.feedbackPosts.firstIndex(where: { $0.id == result.post.id }) { panel.feedbackPosts[index] = result.post } else { panel.feedbackPosts.append(result.post) }
    } else {
      panel.feedbackPosts.removeAll { $0.id == result.post.id }
    }
    context = panel
  }

  /// "Save as FAQ": a new active FAQ in a knowledge model, from a reply and the question it answered.
  func saveFaq(modelId: String, question: String, answer: String) async throws {
    let id = selectedId
    guard !id.isEmpty else { return }
    struct Input: Encodable, Sendable { let modelId: String?; let question: String; let answer: String }
    struct Saved: Decodable, Sendable {}
    let _: Saved = try await session.send("/v1/admin/conversations/\(id)/faq", body: Input(modelId: modelId.isEmpty ? nil : modelId, question: question, answer: answer))
  }

  /// An AI draft of a reply for the operator to edit. Nothing is stored or sent.
  func draftReply() async throws -> HubDraft {
    let id = selectedId
    return try await session.send("/v1/admin/conversations/\(id)/draft")
  }

  /// Start a conversation as the team; returns its id.
  func createConversation(_ input: InboxStartInput) async throws -> String {
    struct Output: Decodable, Sendable { let conversation: Conversation; let endUser: EndUser }
    let result: Output = try await session.send("/v1/admin/conversations", body: input)
    endUsers[result.endUser.id] = result.endUser
    return result.conversation.id
  }

  // MARK: - Types and teammates

  func loadTypes(_ projectId: String) async {
    guard !projectId.isEmpty, typesByProject[projectId] == nil else { return }
    struct Output: Decodable, Sendable { let types: [ConversationType] }
    if let result: Output = try? await session.get("/v1/admin/projects/\(projectId)/types") { typesByProject[projectId] = result.types }
  }

  func type(for conversation: Conversation) -> ConversationType? {
    typesByProject[conversation.projectId]?.first { $0.key == (conversation.type ?? "support") }
  }

  /// The type's statuses, or the built-in support pair while types load.
  func statuses(for conversation: Conversation) -> [ConversationStatus] {
    let statuses = type(for: conversation)?.statuses ?? []
    return statuses.isEmpty ? Self.supportStatuses : statuses
  }

  private static let supportStatuses = [
    ConversationStatus(key: "open", label: String(localized: "Open"), category: "open", isDefault: true, isTerminal: nil, reopenTo: nil),
    ConversationStatus(key: "done", label: String(localized: "Done"), category: "resolved", isDefault: nil, isTerminal: true, reopenTo: "open")
  ]

  private func loadAgents() async {
    struct Output: Decodable, Sendable { let agents: [Agent] }
    if let result: Output = try? await session.get("/v1/admin/agents") { agents = result.agents }
  }

  // MARK: - Live events

  private func startEvents() {
    events?.cancel()
    let token = session.token
    guard !token.isEmpty else { return }
    events = Task { [weak self] in
      var delay: Double = 1
      var reconnecting = false
      while !Task.isCancelled {
        guard let self, self.session.token == token else { return }
        if reconnecting {
          // Anything may have happened while we were away.
          await self.refresh()
          if !self.selectedId.isEmpty { await self.select(self.selectedId) }
        }
        reconnecting = true
        do {
          for try await event in await self.session.api.eventStream(token: token) {
            self.apply(event)
            delay = 1
          }
        } catch {}
        try? await Task.sleep(for: .seconds(delay))
        delay = min(delay * 2, 30)
      }
    }
  }

  private func apply(_ event: SupportEvent) {
    if event.type == "conversation.deleted" { remove(event.conversationId); return }
    let inserted = upsert(event.conversation)
    if inserted, endUsers[event.conversation.endUserId] == nil { Task { await loadEndUser(event.conversationId) } }
    let open = event.conversationId == selectedId
    switch event.type {
    case "message.created":
      guard let message = event.message else { return }
      // Count it everywhere; marking the open conversation read takes it back off.
      if message.sender == "user" { totalUnread += 1 }
      guard open else { return }
      upsertMessage(message)
      if message.sender == "user" { Task { await markRead(event.conversationId) } }
      // A teammate changed field values; events carry only the keys.
      if message.kind == "event", message.event?["fields"] != nil { Task { await reloadFields(event.conversationId) } }
      // A teammate linked or unlinked a feedback post from another window.
      if message.kind == "event", message.event?["type"]?.inboxText.hasPrefix("feedback.") == true { Task { await loadContext(event.conversationId) } }
    case "message.updated":
      if open, let message = event.message { upsertMessage(message) }
    case "message.deleted":
      if open, let id = event.messageId { messages.removeAll { $0.id == id } }
    default:
      break
    }
  }

  private func loadEndUser(_ conversationId: String) async {
    if let detail: DetailResponse = try? await session.get("/v1/admin/conversations/\(conversationId)") { endUsers[detail.endUser.id] = detail.endUser }
  }

  private func reloadMessages(_ id: String) async {
    guard let page: MessagePage = try? await session.get("/v1/admin/conversations/\(id)/messages"), selectedId == id else { return }
    messages = page.messages
    hasEarlierMessages = page.hasMore
  }

  private func reloadFields(_ id: String) async {
    guard let detail: DetailResponse = try? await session.get("/v1/admin/conversations/\(id)"), selectedId == id else { return }
    fields = detail.conversation.fields ?? [:]
  }

  // MARK: - Local state

  /// Replace a conversation everywhere it shows. New rows join the list only
  /// when they match the current filters. Returns whether a row was added.
  @discardableResult
  private func upsert(_ conversation: Conversation) -> Bool {
    refreshCountsSoon()
    if current?.id == conversation.id { current = conversation }
    // Archived rows belong to the Archived view only; the queue never lists them.
    if (conversation.archivedAt != nil) != (queue == .archived) {
      conversations.removeAll { $0.id == conversation.id }
      return false
    }
    var inserted = false
    if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
      conversations[index] = conversation
    } else if matchesFilters(conversation) {
      conversations.append(conversation)
      inserted = true
    } else {
      return false
    }
    conversations.sort { ($0.lastMessageAt ?? "") > ($1.lastMessageAt ?? "") }
    return inserted
  }

  /// Drop a conversation everywhere, closing it if it is the open one.
  private func remove(_ id: String) {
    refreshCountsSoon()
    conversations.removeAll { $0.id == id }
    if selectedId == id { deselect() }
    if current?.id == id { current = nil; messages = [] }
  }

  /// A row changed (triage, archive, a live event): the counts follow from the server, a moment later and once per burst.
  private var countsTask: Task<Void, Never>?
  private func refreshCountsSoon() {
    countsTask?.cancel()
    countsTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(600))
      guard let self, !Task.isCancelled, !self.session.token.isEmpty else { return }
      var query = self.queueQuery()
      query["limit"] = "1"
      guard let page: InboxResponse = try? await self.session.get("/v1/admin/conversations", query: query), !Task.isCancelled else { return }
      self.totalUnread = page.totalUnread
      if let counts = page.viewCounts { self.viewCounts = counts }
      self.archivedCount = page.archivedCount ?? self.archivedCount
    }
  }

  private func update(_ id: String, _ change: (inout Conversation) -> Void) {
    if let index = conversations.firstIndex(where: { $0.id == id }) { change(&conversations[index]) }
    if var open = current, open.id == id { change(&open); current = open }
  }

  private func matchesFilters(_ conversation: Conversation) -> Bool {
    search.trimmingCharacters(in: .whitespaces).isEmpty
      && (projectFilter.isEmpty || conversation.projectId == projectFilter)
      && (statusFilter.isEmpty || conversation.status == statusFilter)
      && (priorityFilter.isEmpty || conversation.priority == priorityFilter)
      && (typeFilter.isEmpty || (conversation.type ?? "support") == typeFilter)
  }

  /// Insert in time order, or replace in place (reactions, action results).
  private func upsertMessage(_ message: Message) {
    guard message.conversationId == selectedId else { return }
    if let index = messages.firstIndex(where: { $0.id == message.id }) {
      messages[index] = message
    } else {
      let index = messages.lastIndex { $0.createdAt <= message.createdAt }.map { $0 + 1 } ?? 0
      messages.insert(message, at: index)
    }
  }
}
