import SwiftUI

/// A project's planning board (pages/projects/[id]/board.vue): Linear-style items on a
/// kanban, linked to the feedback posts and conversations they answer, and the
/// source of the public roadmap. Drag a card across columns to change its status,
/// or onto another card to put it there.
struct BoardScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace

  var body: some View {
    BoardView(store: BoardStore(projectId: projectId, workspace: workspace))
  }
}

// MARK: - Store

/// The planning board's settings and items, the view filters, and every write. The item
/// editor uses one too when it opens from the inbox or a feedback post.
@MainActor @Observable final class BoardStore {
  let projectId: String
  let workspace: Workspace
  var config: BoardConfig?
  var projectName = ""
  var publicKey = ""
  /// The roadmap is published through public feedback: on, with its Roadmap view.
  var feedbackRoadmap = false
  /// The feedback page's statuses, for a linked post's badge.
  var feedbackStatuses: [FeedbackStatusDefinition] = []
  var items: [BoardItem] = []
  /// The item whose editor is open. Kept here rather than in the board view: opening a card then redraws
  /// only the sheet, not every column and card first.
  fileprivate var editor: BoardEditorRoute?
  var agents: [Agent] = []
  var loading = true
  var error = ""
  /// A failed quick action (a move, a settings toggle), shown as an alert.
  var alert = ""
  var savingBoard = false

  // Filters, as the web keeps them.
  var search = ""
  var labelFilter: Set<String> = []
  /// '' is anyone; 'unassigned', or an agent id.
  var assigneeFilter = ""
  /// '' is any; 'none', or a priority.
  var priorityFilter = ""
  var roadmapOnly = false
  /// '' is every kind; 'task' or 'epic'.
  var kindFilter = ""
  /// '' is any epic; otherwise an epic's id, and only that epic's cards show.
  var epicFilter = ""
  /// '' is any release; otherwise a changelog release's id, and only what it ships shows.
  var releaseFilter = ""
  /// 'kanban' or 'list', remembered per project.
  var view = "kanban"
  /// What the list groups by: 'status', 'epic' or 'release'.
  var grouping = "status"
  /// The order cards show in a column: 'manual' (the order they are dragged into), 'newest' or 'oldest' (by when made), or 'votes' (most voted first).
  var order = "manual"

  init(projectId: String, workspace: Workspace) {
    self.projectId = projectId
    self.workspace = workspace
    // The order picked last time on this project, as the web keeps it per project.
    if let saved = UserDefaults.standard.string(forKey: Self.orderKey(projectId)), Self.orders.contains(saved) { order = saved }
    if UserDefaults.standard.string(forKey: Self.viewKey(projectId)) == "list" { view = "list" }
  }

  private static let orders = ["manual", "newest", "oldest", "votes"]
  private static func orderKey(_ projectId: String) -> String { "helpbites.board.order.\(projectId)" }

  /// Picks an order and remembers it for this project.
  func setOrder(_ value: String) {
    guard Self.orders.contains(value) else { return }
    order = value
    UserDefaults.standard.set(value, forKey: Self.orderKey(projectId))
  }

  private static func viewKey(_ projectId: String) -> String { "helpbites.board.view.\(projectId)" }

  /// Picks kanban or list and remembers it for this project.
  func setView(_ value: String) {
    view = value == "list" ? "list" : "kanban"
    UserDefaults.standard.set(view, forKey: Self.viewKey(projectId))
  }

  var session: SessionStore { workspace.session }
  /// New items not uploaded yet: every create goes through it, and its cards sit on the board marked as waiting.
  var outbox: PlanningSync { workspace.outbox }

  var publicCount: Int { items.filter(\.isPublic).count }
  var roadmapReady: Bool { feedbackRoadmap && config?.enabled == true }
  var roadmapURL: URL? {
    guard !publicKey.isEmpty else { return nil }
    return URL(string: "\(session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/roadmap/\(publicKey)")
  }

  /// An item's address in the panel: `?item=` opens its editor, the link the web's cards, inbox and posts share.
  func itemURL(_ item: BoardItem) -> URL? {
    URL(string: "\(session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/projects/\(projectId)/board?item=\(item.id)")
  }

  var filtering: Bool {
    !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !labelFilter.isEmpty || !assigneeFilter.isEmpty || !priorityFilter.isEmpty || !kindFilter.isEmpty || !epicFilter.isEmpty || !releaseFilter.isEmpty || roadmapOnly
  }

  func clearFilters() {
    search = ""
    labelFilter = []
    assigneeFilter = ""
    priorityFilter = ""
    kindFilter = ""
    epicFilter = ""
    releaseFilter = ""
    roadmapOnly = false
  }

  // MARK: Epics and releases

  /// The board's epics in board order, and the project's changelog releases (newest first, drafts included, from
  /// GET /v1/admin/changelog/releases): what the filters, the menus and the pickers list.
  var epics: [BoardItem] { items.filter { $0.itemKind == "epic" }.sorted(by: boardOrder) }
  var releases: [ChangelogRelease] = []

  func release(_ id: String) -> ChangelogRelease? { id.isEmpty ? nil : releases.first { $0.id == id } }

  /// The epics or releases a card can be put into, named as the pickers name them ("#12 Title", "2.4 · Autumn").
  func parents(_ kind: String) -> [(id: String, label: String)] {
    kind == "epic" ? epics.map { (id: $0.id, label: parentLabel($0)) } : releases.map { (id: $0.id, label: $0.pickerLabel) }
  }

  /// How an epic is named where one is picked, "#12 Title" (the web's `parentLabel`).
  func parentLabel(_ item: BoardItem) -> String { item.number.map { "#\($0) \(item.title)" } ?? item.title }

  /// An epic or release filter that names one deleted since reads as "any", not as an empty board.
  private func pruneParentFilters() {
    if !epicFilter.isEmpty, !items.contains(where: { $0.id == epicFilter && $0.itemKind == "epic" }) { epicFilter = "" }
    if !releaseFilter.isEmpty, !releases.contains(where: { $0.id == releaseFilter }) { releaseFilter = "" }
  }

  // MARK: Saved views

  var savedViews: [BoardSavedView] { config?.views ?? [] }

  /// The layout, grouping, order and filters of a saved view. An epic or release the view names that no longer exists reads as "any".
  func applyView(_ saved: BoardSavedView) {
    setView(saved.layout)
    grouping = ["status", "epic", "release"].contains(saved.group) ? saved.group : "status"
    setOrder(saved.order)
    search = saved.filters.search
    labelFilter = Set(saved.filters.labels.filter { label in config?.labels.contains { $0.key == label } == true })
    assigneeFilter = saved.filters.assignee
    priorityFilter = saved.filters.priority
    kindFilter = saved.filters.kind
    epicFilter = saved.filters.epic
    releaseFilter = saved.filters.release
    pruneParentFilters()
    roadmapOnly = saved.filters.roadmapOnly
  }

  func saveCurrentView(named name: String) async {
    let name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(BoardSavedView.maxNameLength))
    guard !name.isEmpty, savedViews.count < BoardSavedView.maxCount else { return }
    let slug = String(name.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }.map(String.init).joined().prefix(30))
    let saved = BoardSavedView(
      id: "\(slug.isEmpty ? "view" : slug)-\(String(UUID().uuidString.prefix(5)).lowercased())", name: name, layout: view, group: grouping, order: order,
      filters: BoardViewFilters(search: search.trimmingCharacters(in: .whitespacesAndNewlines), labels: labelFilter.sorted(), assignee: assigneeFilter, priority: priorityFilter, kind: kindFilter, epic: epicFilter, release: releaseFilter, roadmapOnly: roadmapOnly)
    )
    await saveBoard(["views": .array((savedViews + [saved]).map(\.asJSON))])
  }

  func deleteView(_ saved: BoardSavedView) async {
    await saveBoard(["views": .array(savedViews.filter { $0.id != saved.id }.map(\.asJSON))])
  }

  /// An item by id. A waiting card's local id finds the server's item once it has gone up (an editor still open on it).
  func item(_ id: String) -> BoardItem? {
    items.first { $0.id == id } ?? outbox.serverId(id).flatMap { real in items.first { $0.id == real } }
  }

  /// Why the server refused a waiting card, when it did.
  func pendingError(_ id: String) -> String? { outbox.entry(id)?.error }
  func agent(_ id: String) -> Agent? { id.isEmpty ? nil : agents.first { $0.id == id } }

  /// A column's items in board order; a status the board no longer knows sits in the default column.
  func column(_ status: String) -> [BoardItem] {
    guard let config else { return [] }
    return items.filter { config.column(of: $0) == status }.sorted(by: boardOrder)
  }

  /// The column as the filters and the order show it.
  func visible(_ status: String) -> [BoardItem] { ordered(column(status).filter { matches($0) }) }

  private func ordered(_ shown: [BoardItem]) -> [BoardItem] {
    guard order != "manual" else { return shown }
    if order == "votes" { return shown.sorted { ($0.voteCount, $1.rank, $1.number ?? 0) > ($1.voteCount, $0.rank, $0.number ?? 0) } }
    // Newest first or oldest first by creation; the number breaks ties.
    return shown.sorted { lhs, rhs in
      let (a, b) = order == "newest" ? (rhs, lhs) : (lhs, rhs)
      return (a.createdAt, a.number ?? 0) < (b.createdAt, b.number ?? 0)
    }
  }

  /// One group of the list view: the items (as the filters and order show them) and what a quick add in it fills in.
  /// An epic or release group shows its progress in the header.
  struct ListGroup: Identifiable {
    let id: String
    let title: String
    let tint: Color
    let items: [BoardItem]
    let fields: [String: JSONValue]
    var progress: BoardProgress? = nil
  }

  func parentId(_ item: BoardItem, _ parent: String) -> String { (parent == "epic" ? item.epicId : item.releaseId) ?? "" }

  /// The list's groups: a group per status (the board's order), or per epic or release with the rest in a last group.
  func groups() -> [ListGroup] {
    guard let config else { return [] }
    let shown = ordered(items.sorted(by: boardOrder).filter { matches($0) })
    guard grouping == "epic" || grouping == "release" else {
      return config.statuses.map { status in
        ListGroup(id: status.key, title: status.label, tint: FeedbackFormat.tint(status.color) ?? Theme.textDimmed, items: shown.filter { config.column(of: $0) == status.key }, fields: ["status": .string(status.key)])
      }
    }
    let key = grouping == "epic" ? "epicId" : "releaseId"
    let parents: [ListGroup] = grouping == "epic"
      ? epics.map { epic in ListGroup(id: epic.id, title: epic.title, tint: Theme.accent, items: shown.filter { parentId($0, grouping) == epic.id }, fields: [key: .string(epic.id)], progress: epic.progress) }
      : releases.map { release in ListGroup(id: release.id, title: release.pickerLabel, tint: Theme.accent, items: shown.filter { parentId($0, grouping) == release.id }, fields: [key: .string(release.id)], progress: release.progress) }
    let known = Set(parents.map(\.id))
    return parents + [ListGroup(id: "none", title: grouping == "epic" ? String(localized: "No epic") : String(localized: "No release"), tint: Theme.textDimmed, items: shown.filter { !known.contains(parentId($0, grouping)) }, fields: [:])]
  }

  private func matches(_ item: BoardItem) -> Bool {
    if roadmapOnly && !item.isPublic { return false }
    if !kindFilter.isEmpty && item.itemKind != kindFilter { return false }
    if !epicFilter.isEmpty && item.epicId != epicFilter { return false }
    if !releaseFilter.isEmpty && item.releaseId != releaseFilter { return false }
    if !labelFilter.isEmpty && !item.labels.contains(where: { labelFilter.contains($0) }) { return false }
    switch assigneeFilter {
    case "": break
    case "unassigned": if !item.assigneeId.isEmpty { return false }
    default: if item.assigneeId != assigneeFilter { return false }
    }
    switch priorityFilter {
    case "": break
    case "none": if !item.priority.isEmpty { return false }
    default: if item.priority != priorityFilter { return false }
    }
    let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    if needle.isEmpty { return true }
    if let number = Int(needle.hasPrefix("#") ? String(needle.dropFirst()) : needle) { return item.number == number }
    return [item.title, item.description, item.publicDescription].contains { $0.localizedStandardContains(needle) }
  }

  // MARK: Loading

  func load() async {
    loading = true
    error = ""
    defer { loading = false }
    do {
      let project = try await ProjectsAdminProject.load(projectId, session: session)
      guard project.board != nil else { throw APIError.server(String(localized: "This server has no project planning yet. Update HelpBites to use it.")) }
      apply(project)
      try await loadItems()
      if agents.isEmpty, let team: AgentsResponse = try? await session.get("/v1/admin/agents") { agents = team.agents }
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// The items and the project's changelog releases, read together: a release's cards and progress come with them.
  func loadItems() async throws {
    async let rows: ItemsResponse = session.get("/v1/admin/board-items", query: ["project": projectId])
    async let changelog: ReleasesResponse = session.get("/v1/admin/changelog/releases", query: ["project": projectId])
    let (result, releaseList) = try await (rows, changelog)
    items = result.items
    releases = releaseList.releases
    outbox.reload()
    items += outbox.entries(projectId).map(placeholder)
    pruneParentFilters()
  }

  /// A waiting item as a card: its fields over an empty item's, at the bottom of its column as the server would put it.
  func placeholder(_ entry: PendingItem) -> BoardItem {
    let stamp = ISO8601DateFormatter().string(from: entry.createdAt)
    let empty: [String: JSONValue] = [
      "id": .string(entry.id), "projectId": .string(projectId), "title": .string(""), "description": .string(""), "publicDescription": .string(""),
      "status": .string(config?.defaultStatusKey ?? ""), "statusCategory": .string("open"), "rank": .number(entry.createdAt.timeIntervalSince1970 * 1000),
      "priority": .string(""), "assigneeId": .string(""), "labels": .array([]), "public": .bool(false), "feedbackPostIds": .array([]),
      "conversationIds": .array([]), "voteCount": .number(0), "posts": .array([]), "conversations": .array([]), "createdAt": .string(stamp), "updatedAt": .string(stamp)
    ]
    // The empty item always decodes; the merged one fails only on a field of the wrong type, which then shows empty.
    var item = JSONValue.object(empty.merging(entry.fields) { $1 }).decoded(BoardItem.self) ?? JSONValue.object(empty).decoded(BoardItem.self)!
    item.statusCategory = config?.status(item.status)?.category ?? "open"
    item.epic = item.epicId.flatMap { id in items.first { $0.id == id } }.map { BoardRelatedItem(id: $0.id, number: $0.number, title: $0.title, status: $0.status) }
    item.release = item.releaseId.flatMap(release).map { BoardRelatedItem(id: $0.id, number: nil, title: $0.version, status: $0.status.rawValue) }
    return item
  }

  private func apply(_ project: ProjectsAdminProject) {
    config = project.board
    projectName = project.name
    publicKey = project.publicKey
    feedbackRoadmap = project.feedback?.enabled == true && project.feedback?.roadmap == true
    feedbackStatuses = project.feedback?.statuses ?? []
  }

  func upsert(_ item: BoardItem) {
    if let index = items.firstIndex(where: { $0.id == item.id }) { items[index] = item } else { items.append(item) }
  }

  // MARK: Settings

  /// `PATCH /admin/projects/:id { board }`: partial, so a toggle never resends the statuses.
  @discardableResult
  func saveBoard(_ patch: [String: JSONValue]) async -> Bool {
    savingBoard = true
    defer { savingBoard = false }
    do {
      let project = try await ProjectsAdminProject.save(projectId, BoardPatch(board: patch), workspace: workspace)
      apply(project)
      return true
    } catch {
      alert = error.localizedDescription
      return false
    }
  }

  /// The statuses and labels, from the shared settings form (where labels are its tags).
  func saveLists(_ next: FeedbackBoardConfig) async throws -> FeedbackBoardConfig {
    let project = try await ProjectsAdminProject.save(projectId, ListsPatch(board: ListsPatch.Lists(statuses: next.statuses, labels: next.tags)), workspace: workspace)
    apply(project)
    guard let board = project.board else { throw APIError.server(String(localized: "Planning could not be saved.")) }
    return board.settingsForm
  }

  /// A new column: a status added to the end of the board's statuses, saved like the settings form.
  func addColumn(_ label: String, category: String) async throws {
    guard let config else { return }
    var lists = config.settingsForm
    lists.statuses.append(FeedbackStatusDefinition(key: FeedbackFormat.normalizeKey(label), label: label, category: category, color: "neutral", isDefault: false, notify: false))
    _ = try await saveLists(lists)
  }

  /// A new label, typed in an item's picker: a tag added to the board's labels, saved like the settings form.
  func addLabel(_ label: String) async throws {
    guard let config else { return }
    let key = FeedbackFormat.normalizeKey(label)
    guard !key.isEmpty, !config.labels.contains(where: { $0.key == key }) else { return }
    var lists = config.settingsForm
    lists.tags.append(FeedbackTagDefinition(key: key, label: label, color: "neutral"))
    _ = try await saveLists(lists)
  }

  /// A column dragged by its header carries this prefix in its drag String, so a drop can tell it from a card id.
  static let columnDragPrefix = "column:"

  /// Admins drag a column onto another: the statuses are saved in that order, and a failed save puts the old order back.
  func moveColumn(_ from: String, before target: String) async {
    guard session.canManage, let current = config, from != target else { return }
    guard let at = current.statuses.firstIndex(where: { $0.key == from }), let to = current.statuses.firstIndex(where: { $0.key == target }) else { return }
    var next = current
    let moved = next.statuses.remove(at: at)
    next.statuses.insert(moved, at: to)
    config = next
    do {
      _ = try await saveLists(next.settingsForm)
    } catch {
      config = current
      alert = error.localizedDescription
    }
  }

  // MARK: Items

  /// Through the outbox, so the item is on disk before it is sent: with no answer from the server it comes back as a
  /// waiting card, which goes up when the server is back.
  func create(_ fields: [String: JSONValue]) async throws -> BoardItem {
    let item: BoardItem
    switch try await outbox.submit(projectId, fields) {
    case .sent(let created): item = created
    case .queued(let entry): item = placeholder(entry)
    }
    upsert(item)
    return item
  }

  /// A list group's quick add: a title, filed into that group's status, epic or release.
  func quickAdd(_ title: String, into group: ListGroup) async {
    var fields = group.fields
    fields["title"] = .string(title)
    do { _ = try await create(fields) } catch { alert = error.localizedDescription }
  }

  /// Put an item into an epic or release (`field` is epicId or releaseId), or out of it with an empty id.
  /// The items are read again, so the group's progress follows.
  func assign(_ itemId: String, field: String, to parentId: String) async throws {
    _ = try await update(itemId, [field: .string(parentId)])
    try await loadItems()
  }

  /// The same from a card's or row's menu: a refusal shows as the board's alert.
  func setParent(_ itemId: String, field: String, to parentId: String) async {
    do { try await assign(itemId, field: field, to: parentId) } catch { alert = error.localizedDescription }
  }

  /// The AI reads a description and proposes a title; nothing is saved. Out of reach of the server, Apple Intelligence on
  /// this device writes it instead, where there is one.
  func suggestTitle(_ description: String) async throws -> String {
    struct Body: Encodable, Sendable { let description: String }
    struct Reply: Decodable, Sendable { let title: String }
    do {
      if Connectivity.shared.offline { throw APIError.transport(URLError(.notConnectedToInternet)) }
      let reply: Reply = try await session.send("/v1/admin/board-items/suggest-title?project=\(projectId)", body: Body(description: description))
      return reply.title
    } catch APIError.transport {
      if let title = await BoardTitle.onDevice(description) { return title }
      throw APIError.server(String(localized: "The server can't be reached, and Apple Intelligence isn't available on this device to write the title."))
    }
  }

  /// Send only what changed; `.null` clears a value. A waiting card's change goes into what will be uploaded.
  func update(_ itemId: String, _ fields: [String: JSONValue]) async throws -> BoardItem {
    var id = itemId
    var fields = fields
    if PendingItem.isLocal(itemId) {
      await outbox.settled()
      if let entry = try outbox.amend(itemId, fields) {
        let item = placeholder(entry)
        upsert(item)
        outbox.drain()
        return item
      }
      // It went up meanwhile: the change goes to the server's item.
      guard let uploaded = outbox.serverId(itemId) else { throw APIError.server(String(localized: "That item no longer exists.")) }
      id = uploaded
    }
    fields = try await outbox.uploadingFiles(fields, projectId: projectId)
    let result: ItemResponse = try await session.send("/v1/admin/board-items/\(id)", method: "PATCH", body: fields)
    upsert(result.item)
    return result.item
  }

  func history(_ itemId: String, offset: Int = 0) async throws -> BoardItemHistoryPage {
    try await session.get("/v1/admin/board-items/\(itemId)/history", query: ["project": projectId, "offset": String(offset)])
  }

  func comments(_ itemId: String, offset: Int = 0) async throws -> BoardItemCommentsPage {
    try await session.get("/v1/admin/board-items/\(itemId)/comments", query: ["project": projectId, "offset": String(offset), "limit": "50"])
  }

  func comment(_ itemId: String, body: String, attachments: [ItemAttachment], parentId: String?, replyToId: String?) async throws -> BoardItemComment {
    struct Body: Encodable, Sendable { let body: String; let attachments: [ItemAttachment]; let parentId: String?; let replyToId: String? }
    struct Response: Decodable, Sendable { let comment: BoardItemComment }
    let result: Response = try await session.send("/v1/admin/board-items/\(itemId)/comments?project=\(projectId)", body: Body(body: body, attachments: attachments, parentId: parentId, replyToId: replyToId))
    return result.comment
  }

  /// A release named from a card's picker: a changelog release of that version already there is taken (versions are
  /// not unique, so the match is made here, trimmed and case-insensitive), else a draft is created.
  func releaseNamed(_ version: String) async throws -> ChangelogRelease {
    let name = version.trimmingCharacters(in: .whitespacesAndNewlines)
    if let existing = releases.first(where: { $0.version.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(name) == .orderedSame }) { return existing }
    struct ReleaseResponse: Decodable, Sendable { let release: ChangelogRelease }
    let body: [String: JSONValue] = ["version": .string(name)]
    let result: ReleaseResponse = try await session.send("/v1/admin/changelog/releases?project=\(projectId)", body: body)
    releases.insert(result.release, at: 0)
    return result.release
  }

  func delete(_ itemId: String) async throws {
    let groupsCards = item(itemId)?.itemKind == "epic"
    var id = itemId
    if PendingItem.isLocal(itemId) {
      await outbox.settled()
      guard let uploaded = outbox.serverId(itemId) else {
        // Never uploaded: it is simply not sent.
        outbox.discard(itemId)
        items.removeAll { $0.id == itemId }
        return
      }
      items.removeAll { $0.id == itemId }
      id = uploaded
    }
    try await session.delete("/v1/admin/board-items/\(id)")
    items.removeAll { $0.id == id }
    // An epic leaves its cards free of it: read them again (the delete itself went through either way).
    if groupsCards { try? await loadItems() }
    pruneParentFilters()
  }

  /// Link or unlink a feedback post (an id or `#N`) or a conversation.
  func link(_ itemId: String, kind: String, target: String, linked: Bool) async throws -> BoardItem {
    let body: [String: JSONValue] = ["kind": .string(kind), "id": .string(target), "linked": .bool(linked)]
    let result: ItemResponse = try await session.send("/v1/admin/board-items/\(itemId)/links", body: body)
    upsert(result.item)
    return result.item
  }

  /// A drop: into `status`'s column, before `anchor` (nil: at the end). Shown at
  /// once and put back if the server says no.
  func move(_ itemId: String, to status: String, before anchor: String?) async {
    guard let config, let previous = item(itemId) else { return }
    // Reordering inside a column only means something in manual order.
    if order != "manual", config.column(of: previous) == status { return }
    guard let rank = boardDropRank(moving: itemId, column: column(status), before: anchor) else { return }
    var moved = previous
    moved.status = status
    moved.rank = rank
    moved.statusCategory = config.status(status)?.category ?? "open"
    withAnimation(.snappy) { upsert(moved) }
    do {
      _ = try await update(itemId, ["status": .string(status), "rank": .number(rank)])
    } catch {
      withAnimation(.snappy) { upsert(previous) }
      alert = error.localizedDescription
    }
  }

  /// One step up or down its column, for the card's menu.
  func nudge(_ itemId: String, by offset: Int) async {
    guard let config, let item = item(itemId) else { return }
    let status = config.column(of: item)
    let column = column(status)
    guard let at = column.firstIndex(where: { $0.id == itemId }) else { return }
    let target = at + offset
    guard column.indices.contains(target) else { return }
    // Up: before the card above. Down: before the one after the next, or at the end.
    let anchor = offset < 0 ? column[target].id : (target + 1 < column.count ? column[target + 1].id : nil)
    await move(itemId, to: status, before: anchor)
  }

  // MARK: Wire

  private struct ItemsResponse: Decodable, Sendable { let items: [BoardItem] }
  private struct ReleasesResponse: Decodable, Sendable { let releases: [ChangelogRelease] }
  private struct ItemResponse: Decodable, Sendable { let item: BoardItem }
  private struct AgentsResponse: Decodable, Sendable { let agents: [Agent] }
  private struct BoardPatch: Encodable, Sendable { let board: [String: JSONValue] }
  private struct ListsPatch: Encodable, Sendable {
    struct Lists: Encodable, Sendable { let statuses: [FeedbackStatusDefinition]; let labels: [FeedbackTagDefinition] }
    let board: Lists
  }
}

extension BoardConfig {
  /// The board's statuses and labels in the feedback settings form's shape (labels are its tags).
  var settingsForm: FeedbackBoardConfig {
    FeedbackBoardConfig(
      enabled: enabled, title: "", description: "", statuses: statuses, types: [], platforms: [], tags: labels,
      showAuthorNames: false, allowComments: true, allowUserEdits: true, emailNotifications: true,
      postUrlTemplate: "", roadmap: true, changelog: true
    )
  }
}

/// Display helpers the board, its cards and the editor share.
@MainActor enum BoardFormat {
  static let priorities = ["urgent", "high", "normal", "low"]

  /// "Nov 15" for a "2026-11-15" target day; a calendar day, so no time zone moves it.
  static func shortDay(_ day: String) -> String? {
    FeedbackFormat.date(day: day).map { $0.formatted(.dateTime.month(.abbreviated).day()) }
  }

  static func priorityLabel(_ priority: String) -> String { priority.isEmpty ? String(localized: "No priority") : priorityName(priority) }

  static func priorityName(_ priority: String) -> String {
    switch priority {
    case "urgent": String(localized: "Urgent")
    case "high": String(localized: "High")
    case "normal": String(localized: "Normal")
    case "low": String(localized: "Low")
    default: priority.capitalized
    }
  }
}

// MARK: - Screen

private struct BoardEditorRoute: Identifiable {
  let id = UUID()
  let itemId: String?
}

/// Presents the item editor; the only view that reads `store.editor`.
private struct BoardEditorPresenter: View {
  @Bindable var store: BoardStore
  var body: some View {
    Color.clear.sheet(item: $store.editor) { route in BoardItemEditor(store: store, itemId: route.itemId) }
  }
}

private struct BoardView: View {
  @State var store: BoardStore
  @State private var showSettings = false
  @State private var addingColumn = false
  @State private var showAi = false
  @State private var roadmapHelp = false
  @State private var namingView = false
  @State private var viewName = ""
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .panelScreen("Planning")
      .projectHeader(store.projectId, "Planning", detail: countLine, warning: store.config?.enabled == false)
      .toolbar { toolbar }
      .background { BoardEditorPresenter(store: store) }
      .sheet(isPresented: $showAi) { AiCardsSheet(session: store.session, projectId: store.projectId, kind: .board) { try? await store.loadItems() } }
      .sheet(isPresented: $showSettings) { BoardSettingsSheet(store: store) }
      .sheet(isPresented: $addingColumn) { AddColumnSheet(store: store) }
      .feedbackErrorAlert($store.alert)
      .alert("Save current view", isPresented: $namingView) {
        TextField("View name", text: $viewName)
        Button("Save") { Task { await store.saveCurrentView(named: viewName) } }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Keeps the layout, grouping, order and filters, for everyone on this project.")
      }
      .alert("Turn on feedback first", isPresented: $roadmapHelp) {
        Button("OK", role: .cancel) {}
      } message: {
        Text("The public roadmap is published through public feedback: turn it on, with its Roadmap view, under Feedback → Settings.")
      }
      .task { await store.load() }
      // No live sync between operators yet: coming back to the app refetches.
      .onChange(of: scenePhase) { _, phase in
        if phase == .active, store.config != nil { Task { try? await store.loadItems() } }
      }
      // A waiting item went up (or was refused), or the server is back: read the board again.
      .onChange(of: store.outbox.revision) { _, _ in Task { try? await store.loadItems() } }
      .onChange(of: Connectivity.shared.offline) { _, offline in
        guard !offline else { return }
        Task { if store.config == nil { await store.load() } else { try? await store.loadItems() } }
      }
  }

  @ViewBuilder private var content: some View {
    if let config = store.config {
      if config.enabled {
        VStack(spacing: 0) {
          offlineStrip
          filterBar(config)
          Rectangle().fill(Theme.border).frame(height: 1)
          if store.view == "list" {
            BoardList(store: store) { item in store.editor = BoardEditorRoute(itemId: item.id) }
          } else {
            board(config)
          }
        }
      } else {
        notEnabled
      }
    } else if !store.error.isEmpty {
      EmptyState(systemImage: "exclamationmark.triangle", title: "Could not load planning", message: store.error) {
        Button("Try again") { Task { await store.load() } }.buttonStyle(.lnSecondary)
      }
      .frame(maxHeight: .infinity)
    } else {
      SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
    }
  }

  /// Offline, or with items still to upload: what the board shows and what happens to new items.
  @ViewBuilder private var offlineStrip: some View {
    let offline = Connectivity.shared.offline
    let waiting = store.outbox.entries(store.projectId).count
    if offline || waiting > 0 {
      HStack(spacing: 8) {
        Image(systemName: offline ? "wifi.slash" : "icloud.and.arrow.up").font(.app(size: 12, weight: .medium))
        Group {
          if offline {
            Text("Offline. This is the board as it was last loaded; new items stay on this device and upload when you're back online.")
          } else if waiting == 1 {
            Text("1 item waiting to upload")
          } else {
            Text("\(waiting) items waiting to upload")
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Button("Try again") { Task { store.outbox.drain(); try? await store.loadItems() } }.buttonStyle(.lnGhost)
      }
      .font(.lnCaption)
      .foregroundStyle(Theme.textMuted)
      .padding(.horizontal, Metrics.gutter)
      .padding(.vertical, 6)
      .background(Theme.elevated)
    }
  }

  private var countLine: String? {
    guard let config = store.config else { return nil }
    guard config.enabled else { return String(localized: "Planning is off") }
    let items = store.items.count == 1 ? String(localized: "1 item") : String(localized: "\(store.items.count) items")
    return String(localized: "\(items), \(store.publicCount) on the roadmap")
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if store.config?.enabled == true {
      ToolbarItemGroup(placement: .topBarTrailing) {
        roadmapMenu
        Button { showSettings = true } label: { Label("Settings", systemImage: "slider.horizontal.3") }
        Button { showAi = true } label: { Label("File with AI", systemImage: "sparkles") }
        Button { store.editor = BoardEditorRoute(itemId: nil) } label: { Label("New item", systemImage: "plus") }
      }
    }
  }

  /// The public roadmap's own page, /roadmap/<public key>.
  @ViewBuilder private var roadmapMenu: some View {
    if store.roadmapReady, let url = store.roadmapURL {
      Menu {
        Button { Clipboard.copy(url.absoluteString) } label: { Label("Copy link", systemImage: "doc.on.doc") }
        Link(destination: url) { Label("Open in browser", systemImage: "safari") }
        ShareLink(item: url) { Label("Share…", systemImage: "square.and.arrow.up") }
      } label: {
        Label("Public roadmap", systemImage: "map")
      }
    } else {
      Button { roadmapHelp = true } label: { Label("Public roadmap", systemImage: "map") }
    }
  }

  // Not set up yet: what planning is, and the two ways in.
  private var notEnabled: some View {
    ScrollView {
      EmptyState(
        systemImage: "rectangle.split.3x1",
        title: "Planning for \(store.projectName.isEmpty ? String(localized: "this project") : store.projectName)",
        message: "Plan the work behind your feedback and support: items on a kanban, linked to the posts and conversations they answer. Pick which ones go on a public roadmap."
      ) {
        Button("Customize first") { showSettings = true }.buttonStyle(.lnSecondary)
        Button("Turn on planning") { Task { await store.saveBoard(["enabled": .bool(true)]) } }.buttonStyle(.lnPrimary).disabled(store.savingBoard)
      }
    }
  }

  // MARK: Filters

  private func filterBar(_ config: BoardConfig) -> some View {
    VStack(spacing: 10) {
      HStack(spacing: 10) {
        SearchField(text: $store.search, prompt: "Search or #12")
        Picker("View", selection: Binding(get: { store.view }, set: { store.setView($0) })) {
          Image(systemName: "rectangle.split.3x1").tag("kanban").accessibilityLabel("Kanban")
          Image(systemName: "list.bullet").tag("list").accessibilityLabel("List")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 96)
      }
      .padding(.horizontal, Metrics.gutter)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          if !store.savedViews.isEmpty || store.session.canManage {
            filterMenu("Views", value: String(localized: "Views"), active: false) {
              ForEach(store.savedViews) { saved in Button(saved.name) { store.applyView(saved) } }
              if store.session.canManage {
                if !store.savedViews.isEmpty { Divider() }
                Button("Save current view…") { viewName = ""; namingView = true }.disabled(store.savedViews.count >= BoardSavedView.maxCount)
                if !store.savedViews.isEmpty {
                  Menu("Delete a view") {
                    ForEach(store.savedViews) { saved in Button(saved.name, role: .destructive) { Task { await store.deleteView(saved) } } }
                  }
                }
              }
            }
          }
          Pill(label: "On roadmap", count: store.publicCount, systemImage: "globe", isActive: store.roadmapOnly) { store.roadmapOnly.toggle() }
          filterMenu("Assignee", value: assigneeTitle, active: !store.assigneeFilter.isEmpty) {
            Picker("Assignee", selection: $store.assigneeFilter) {
              Text("Anyone").tag("")
              Text("Unassigned").tag("unassigned")
              ForEach(store.agents) { agent in Text(agent.inboxName).tag(agent.id) }
            }
          }
          if store.view == "list" {
            filterMenu("Group by", value: groupingTitle, active: store.grouping != "status") {
              Picker("Group by", selection: $store.grouping) {
                Text("Group by status").tag("status")
                Text("Group by epic").tag("epic")
                Text("Group by release").tag("release")
              }
            }
          }
          filterMenu("Type", value: store.kindFilter.isEmpty ? String(localized: "Any type") : BoardKind.name(store.kindFilter), active: !store.kindFilter.isEmpty) {
            Picker("Type", selection: $store.kindFilter) {
              Text("Any type").tag("")
              ForEach(BoardKind.all, id: \.self) { kind in Text(BoardKind.name(kind)).tag(kind) }
            }
          }
          // Narrow the board to one epic's cards or one release's items; offered once the board has some.
          if !store.epics.isEmpty {
            filterMenu("Epic", value: epicTitle, active: !store.epicFilter.isEmpty) {
              Picker("Epic", selection: $store.epicFilter) {
                Text("Any epic").tag("")
                ForEach(store.epics) { epic in Text(store.parentLabel(epic)).tag(epic.id) }
              }
            }
          }
          if !store.releases.isEmpty {
            filterMenu("Release", value: releaseTitle, active: !store.releaseFilter.isEmpty) {
              Picker("Release", selection: $store.releaseFilter) {
                Text("Any release").tag("")
                ForEach(store.releases) { release in Text(release.pickerLabel).tag(release.id) }
              }
            }
          }
          filterMenu("Order", value: orderTitle, active: store.order != "manual") {
            Picker("Order", selection: Binding(get: { store.order }, set: { store.setOrder($0) })) {
              Text("Manual").tag("manual")
              Text("Newest first").tag("newest")
              Text("Oldest first").tag("oldest")
              Text("Most votes first").tag("votes")
            }
          }
          filterMenu("Priority", value: priorityTitle, active: !store.priorityFilter.isEmpty) {
            Picker("Priority", selection: $store.priorityFilter) {
              Text("Any priority").tag("")
              Text("No priority").tag("none")
              ForEach(BoardFormat.priorities, id: \.self) { priority in Text(BoardFormat.priorityName(priority)).tag(priority) }
            }
          }
          if !config.labels.isEmpty {
            Rectangle().fill(Theme.border).frame(width: 1, height: 18).padding(.horizontal, 4)
            ForEach(config.labels) { label in
              let on = store.labelFilter.contains(label.key)
              Pill(label: label.label, isActive: on) { toggleLabel(label.key) }
            }
          }
          if store.filtering {
            Button("Clear") { store.clearFilters() }.buttonStyle(.lnGhost)
          }
        }
        .padding(.horizontal, Metrics.gutter)
      }
    }
    .padding(.vertical, 10)
  }

  private func toggleLabel(_ key: String) {
    if store.labelFilter.contains(key) {
      store.labelFilter.remove(key)
    } else {
      store.labelFilter.insert(key)
    }
  }

  private var assigneeTitle: String {
    switch store.assigneeFilter {
    case "": String(localized: "Anyone")
    case "unassigned": String(localized: "Unassigned")
    default: store.agent(store.assigneeFilter)?.inboxName ?? String(localized: "Assignee")
    }
  }

  /// The filter's pill: "Any epic", or the epic it narrows to, cut short so a long title does not stretch the bar.
  private var epicTitle: String { parentFilterTitle(store.item(store.epicFilter).map { store.parentLabel($0) }, none: String(localized: "Any epic")) }
  private var releaseTitle: String { parentFilterTitle(store.release(store.releaseFilter)?.pickerLabel, none: String(localized: "Any release")) }

  private func parentFilterTitle(_ label: String?, none: String) -> String {
    guard let label else { return none }
    return label.count > 26 ? String(label.prefix(25)) + "…" : label
  }

  private var groupingTitle: String {
    switch store.grouping {
    case "epic": String(localized: "Group by epic")
    case "release": String(localized: "Group by release")
    default: String(localized: "Group by status")
    }
  }

  private var orderTitle: String {
    switch store.order {
    case "newest": String(localized: "Newest first")
    case "oldest": String(localized: "Oldest first")
    case "votes": String(localized: "Most votes first")
    default: String(localized: "Manual")
    }
  }

  private var priorityTitle: String {
    switch store.priorityFilter {
    case "": String(localized: "Any priority")
    case "none": String(localized: "No priority")
    default: BoardFormat.priorityName(store.priorityFilter)
    }
  }

  private func filterMenu<Content: View>(_ title: String, value: String, active: Bool, @ViewBuilder content: () -> Content) -> some View {
    let items = content()
    return FilterMenu(value: value, active: active) { items }.accessibilityLabel(title)
  }

  // MARK: Kanban

  private func board(_ config: BoardConfig) -> some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 12) {
        ForEach(config.statuses) { status in
          BoardColumn(status: status, items: store.visible(status.key), store: store, filtering: store.filtering) { item in
            store.editor = BoardEditorRoute(itemId: item.id)
          }
        }
        Button { addingColumn = true } label: {
          Label("Add column", systemImage: "plus")
            .font(.lnMetaMedium)
            .foregroundStyle(Theme.textMuted)
            .frame(width: 280, height: 64)
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        }
        .buttonStyle(.plain)
      }
      .padding(Metrics.gutter)
    }
  }
}

// MARK: - List

/// The list view, as Monday lays out a board: collapsible groups with a coloured header and a count, one row per
/// item, and a quick add at the foot of each group. A row is two lines so it fits a phone: number, kind and title
/// with the status; then priority, epic, release, assignee and date.
/// ponytail: no drag to reorder here and no per-column table on iPad/Mac; reorder on the kanban, add columns if asked.
private struct BoardList: View {
  let store: BoardStore
  let open: (BoardItem) -> Void
  @State private var collapsed: Set<String> = []

  var body: some View {
    let groups = store.groups()
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        ForEach(groups) { group in section(group) }
      }
      .padding(Metrics.gutter)
    }
  }

  private func section(_ group: BoardStore.ListGroup) -> some View {
    let isCollapsed = collapsed.contains(group.id)
    return VStack(alignment: .leading, spacing: 0) {
      Button {
        if isCollapsed { collapsed.remove(group.id) } else { collapsed.insert(group.id) }
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "chevron.right").font(.app(size: 10, weight: .bold)).rotationEffect(.degrees(isCollapsed ? 0 : 90)).foregroundStyle(group.tint)
          Text(group.title).font(.lnMetaMedium).foregroundStyle(group.tint).lineLimit(1)
          Text("\(group.items.count)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
          if let progress = group.progress, progress.total > 0 { BoardProgressBar(progress: progress).frame(width: 110) }
          Spacer(minLength: 0)
        }
        .frame(minHeight: Metrics.scaled(36))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(group.title), \(group.items.count)")
      .accessibilityValue(isCollapsed ? "Collapsed" : "Expanded")

      if !isCollapsed {
        VStack(spacing: 0) {
          ForEach(group.items) { item in
            row(item)
            Rectangle().fill(Theme.borderMuted).frame(height: 1)
          }
          BoardQuickAdd { title in await store.quickAdd(title, into: group) }
        }
        .overlay(alignment: .leading) { Rectangle().fill(group.tint).frame(width: 3) }
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
        .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      }
    }
  }

  private func row(_ item: BoardItem) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Button { open(item) } label: {
        VStack(alignment: .leading, spacing: 5) {
          HStack(spacing: 6) {
            if item.isPending { BoardPendingChip(refused: store.pendingError(item.id) != nil) }
            if let number = item.number { Text("#\(number)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
            if let icon = BoardKind.icon(item.itemKind) {
              Image(systemName: icon).font(.app(size: 11)).foregroundStyle(Theme.accentText).accessibilityLabel(BoardKind.name(item.itemKind))
            }
            Text(item.title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(2).multilineTextAlignment(.leading)
          }
          meta(item)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      statusMenu(item)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .contextMenu {
      Button { open(item) } label: { Label("Open", systemImage: "square.and.pencil") }
      BoardParentMenus(item: item, store: store)
      if !item.isPending, let url = store.itemURL(item) { Button { Clipboard.copy(url.absoluteString) } label: { Label("Copy link", systemImage: "link") } }
    }
  }

  @ViewBuilder private func meta(_ item: BoardItem) -> some View {
    let day = BoardFormat.shortDay(item.targetDay)
    if !item.priority.isEmpty || item.epic != nil || item.release != nil || item.progress?.total ?? 0 > 0 || store.agent(item.assigneeId) != nil || day != nil || item.estimate != nil || item.isPublic {
      FlowLayout(spacing: 6) {
        if !item.priority.isEmpty { PriorityIcon(priority: item.priority, size: 12) }
        if let progress = item.progress, progress.total > 0 { BoardProgressBar(progress: progress).frame(width: 110) }
        if let epic = item.epic { BoardParentChip(kind: "epic", title: epic.title) }
        if let release = item.release { BoardParentChip(kind: "release", title: release.title) }
        if let agent = store.agent(item.assigneeId) { Avatar(name: agent.inboxName, size: 18) }
        if let day { Label(day, systemImage: "calendar").labelStyle(BoardCompactLabelStyle()).accessibilityLabel("Target \(day)") }
        if let estimate = item.estimate { Label(BoardEstimate.text(estimate), systemImage: "gauge.with.needle").labelStyle(BoardCompactLabelStyle()).accessibilityLabel("Estimate \(BoardEstimate.text(estimate)) points") }
        if item.isPublic { Image(systemName: "globe").font(.app(size: 11)).foregroundStyle(Theme.accentText).accessibilityLabel("On the public roadmap") }
      }
    }
  }

  /// The status as a pill; tapping it moves the item to another status, the way a card's "Move to" does.
  @ViewBuilder private func statusMenu(_ item: BoardItem) -> some View {
    if let config = store.config, let status = config.status(config.column(of: item)) {
      Menu {
        ForEach(config.statuses.filter { $0.key != status.key }) { target in
          Button(target.label) { Task { await store.move(item.id, to: target.key, before: nil) } }
        }
      } label: {
        FeedbackStatusBadge(status: status)
      }
      .accessibilityLabel("Status: \(status.label)")
    }
  }
}

/// "+ Add item" at the foot of a group; opens a title field that files the item into the group.
private struct BoardQuickAdd: View {
  let add: (String) async -> Void
  @State private var adding = false
  @State private var title = ""
  @FocusState private var focused: Bool

  var body: some View {
    if adding {
      HStack(spacing: 8) {
        TextField("Title", text: $title)
          .textFieldStyle(.linear)
          .focused($focused)
          .submitLabel(.done)
          .onSubmit { Task { await submit() } }
        Button("Add") { Task { await submit() } }
          .buttonStyle(GhostButtonStyle(tint: Theme.accentText))
          .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Button { adding = false; title = "" } label: { Image(systemName: "xmark").font(.app(size: 10, weight: .bold)).foregroundStyle(Theme.textMuted).frame(width: 24, height: 24) }
          .buttonStyle(.plain)
          .accessibilityLabel("Cancel")
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
    } else {
      Button { adding = true; focused = true } label: {
        Label("Add item", systemImage: "plus").font(.lnMeta).foregroundStyle(Theme.textMuted).frame(maxWidth: .infinity, minHeight: 36, alignment: .leading).padding(.horizontal, 12).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
    }
  }

  private func submit() async {
    let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    title = ""
    await add(String(text.prefix(BoardTitle.maxLength)))
    focused = true
  }
}

/// "Epic" and "Release" in an item's menu: put it into one, or take it out, as the web list's cells do. Each shows
/// where the item's kind can have one (a card has an epic; a card or an epic has a release) and the board has some.
private struct BoardParentMenus: View {
  let item: BoardItem
  let store: BoardStore

  var body: some View {
    if BoardKind.canHave(item.itemKind, parent: "epic") { menu("epic", current: item.epicId ?? "") }
    if BoardKind.canHave(item.itemKind, parent: "release") { menu("release", current: item.releaseId ?? "") }
  }

  @ViewBuilder private func menu(_ kind: String, current: String) -> some View {
    let others = store.parents(kind).filter { $0.id != item.id }
    if !others.isEmpty {
      let none = kind == "epic" ? String(localized: "No epic") : String(localized: "No release")
      Menu {
        Button { pick(kind, "") } label: {
          if current.isEmpty { Label(none, systemImage: "checkmark") } else { Text(none) }
        }
        ForEach(others, id: \.id) { parent in
          Button { pick(kind, parent.id) } label: {
            if parent.id == current { Label(parent.label, systemImage: "checkmark") } else { Text(parent.label) }
          }
        }
      } label: {
        if kind == "epic" { Label("Epic", systemImage: "square.stack.3d.up") } else { Label("Release", systemImage: "shippingbox") }
      }
    }
  }

  private func pick(_ kind: String, _ parentId: String) {
    Task { await store.setParent(item.id, field: kind == "epic" ? "epicId" : "releaseId", to: parentId) }
  }
}

/// A card made on this device that the server has not taken yet: waiting for a connection, or refused (its editor
/// says why).
struct BoardPendingChip: View {
  let refused: Bool

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: refused ? "exclamationmark.icloud" : "icloud.and.arrow.up").font(.app(size: 10))
      Text(refused ? "Not uploaded" : "Waiting to upload").font(.lnCaption).lineLimit(1)
    }
    .foregroundStyle(refused ? Theme.error : Theme.textToned)
    .padding(.horizontal, 6)
    .frame(height: 18)
    .background(Theme.elevated, in: Capsule())
    .accessibilityElement(children: .combine)
  }
}

/// The epic or changelog release an item belongs to, as a small capsule.
struct BoardParentChip: View {
  let kind: String
  let title: String

  private var symbol: String { kind == "release" ? "shippingbox" : "square.stack.3d.up" }
  private var name: String { kind == "release" ? String(localized: "Release") : BoardKind.name(kind) }

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: symbol).font(.app(size: 10))
      Text(title).font(.lnCaption).lineLimit(1)
    }
    .foregroundStyle(Theme.textToned)
    .padding(.horizontal, 6)
    .frame(height: 18)
    .background(Theme.elevated, in: Capsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(name): \(title)")
  }
}

/// How far an epic or release is: a bar, and cards done of cards.
struct BoardProgressBar: View {
  let progress: BoardProgress

  var body: some View {
    HStack(spacing: 6) {
      Capsule().fill(Theme.elevated).frame(height: 4)
        .overlay(alignment: .leading) { GeometryReader { box in Capsule().fill(Theme.success).frame(width: box.size.width * progress.fraction) } }
      Text("\(progress.done)/\(progress.total)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      if let points = progress.estimateTotal, points > 0 {
        Text("\(BoardEstimate.text(progress.estimateDone ?? 0))/\(BoardEstimate.text(points)) pts").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(progress.done) of \(progress.total) cards done")
  }
}

// MARK: - Add column

/// A column is a status. Its category decides what its items mean: planned, active and done
/// items show on the roadmap; open ones stay private.
private struct AddColumnSheet: View {
  let store: BoardStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var category = "open"
  @State private var saving = false
  @State private var message = ""

  private var key: String { FeedbackFormat.normalizeKey(name) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("For example: To test", text: $name)
          Picker("Category", selection: $category) {
            ForEach(feedbackCategoryOptions, id: \.value) { option in Text(option.label).tag(option.value) }
          }
        } footer: {
          Text("A column is a status. Open items stay private; planned, active and done items show on the roadmap.")
        }
        if !message.isEmpty {
          Section { Label(message, systemImage: "exclamationmark.circle").foregroundStyle(Theme.error) }
        }
      }
      .navigationTitle("New column")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add column") { Task { await add() } }.disabled(key.isEmpty || saving)
        }
      }
    }
  }

  private func add() async {
    guard !key.isEmpty else { return }
    if store.config?.statuses.contains(where: { $0.key == key }) == true {
      message = String(localized: "A column with this name already exists.")
      return
    }
    saving = true
    defer { saving = false }
    do {
      try await store.addColumn(name.trimmingCharacters(in: .whitespacesAndNewlines), category: category)
      dismiss()
    } catch let failure {
      message = failure.localizedDescription
    }
  }
}

// MARK: - Column

/// One status. Dropping on a card puts the dragged one just above it; dropping
/// anywhere else in the column puts it at the end.
private struct BoardColumn: View {
  let status: FeedbackStatusDefinition
  let items: [BoardItem]
  let store: BoardStore
  let filtering: Bool
  let open: (BoardItem) -> Void
  @State private var targeted = false
  @State private var targetedCard: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header

      ScrollView {
        LazyVStack(spacing: 8) {
          ForEach(items) { item in card(item) }
          if items.isEmpty {
            Text(filtering ? "Nothing matches" : "No items")
              .font(.lnCaption)
              .foregroundStyle(Theme.textDimmed)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 16)
          }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
      }
    }
    .frame(width: 280)
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Theme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(targeted && targetedCard == nil ? Theme.accent : Color.clear, lineWidth: 2))
    .dropDestination(for: String.self) { ids, _ in
      guard let id = ids.first else { return false }
      if let from = columnKey(id) {
        Task { await store.moveColumn(from, before: status.key) }
        return true
      }
      Task { await store.move(id, to: status.key, before: nil) }
      return true
    } isTargeted: { targeted = $0 }
  }

  /// The title row. Admins drag it to move the column; everyone else sees the same row.
  @ViewBuilder private var header: some View {
    let row = HStack {
      FeedbackStatusBadge(status: status)
      Spacer()
      Text("\(items.count)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
    }
    .padding(.horizontal, 12)
    .padding(.top, 12)
    .padding(.bottom, 8)
    if store.session.canManage {
      row.draggable(BoardStore.columnDragPrefix + status.key)
    } else {
      row
    }
  }

  /// The status key of a column dragged by its header; nil for a card id.
  private func columnKey(_ id: String) -> String? {
    id.hasPrefix(BoardStore.columnDragPrefix) ? String(id.dropFirst(BoardStore.columnDragPrefix.count)) : nil
  }

  private func card(_ item: BoardItem) -> some View {
    Button { open(item) } label: { BoardCard(item: item, store: store) }
      .buttonStyle(.plain)
      .draggable(item.id)
      .overlay(alignment: .top) {
        if targetedCard == item.id {
          Capsule().fill(Theme.accent).frame(height: 3).offset(y: -5.5).accessibilityHidden(true)
        }
      }
      .dropDestination(for: String.self) { ids, _ in
        guard let id = ids.first, id != item.id else { return false }
        if let from = columnKey(id) {
          Task { await store.moveColumn(from, before: status.key) }
          return true
        }
        Task { await store.move(id, to: status.key, before: item.id) }
        return true
      } isTargeted: { on in
        if on { targetedCard = item.id } else if targetedCard == item.id { targetedCard = nil }
      }
      .contextMenu { menu(item) }
  }

  @ViewBuilder private func menu(_ item: BoardItem) -> some View {
    Button { open(item) } label: { Label("Open", systemImage: "square.and.pencil") }
    Button { Task { await store.nudge(item.id, by: -1) } } label: { Label("Move up", systemImage: "arrow.up") }
    Button { Task { await store.nudge(item.id, by: 1) } } label: { Label("Move down", systemImage: "arrow.down") }
    if let config = store.config {
      Menu {
        ForEach(config.statuses.filter { $0.key != item.status }) { target in
          Button(target.label) { Task { await store.move(item.id, to: target.key, before: nil) } }
        }
      } label: {
        Label("Move to", systemImage: "arrow.right.circle")
      }
    }
    BoardParentMenus(item: item, store: store)
    if !item.isPending, let url = store.itemURL(item) { Button { Clipboard.copy(url.absoluteString) } label: { Label("Copy link", systemImage: "link") } }
  }
}

/// A card: number, priority, roadmap and assignee; the title; labels; votes,
/// links and the target date.
private struct BoardCard: View {
  let item: BoardItem
  let store: BoardStore

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        if item.isPending { BoardPendingChip(refused: store.pendingError(item.id) != nil) }
        if let number = item.number { Text("#\(number)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
        if let icon = BoardKind.icon(item.itemKind) {
          Image(systemName: icon).font(.app(size: 11)).foregroundStyle(Theme.accentText).accessibilityLabel(BoardKind.name(item.itemKind))
        }
        if !item.priority.isEmpty { PriorityIcon(priority: item.priority, size: 12) }
        Spacer(minLength: 0)
        if item.isPublic {
          Image(systemName: "globe").font(.app(size: 11)).foregroundStyle(Theme.accentText).accessibilityLabel("On the public roadmap")
        }
        if let agent = store.agent(item.assigneeId) { Avatar(name: agent.inboxName, size: 18) }
      }
      Text(item.title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(3).multilineTextAlignment(.leading)
      if let progress = item.progress, progress.total > 0 { BoardProgressBar(progress: progress) }
      if item.epic != nil || item.release != nil {
        FlowLayout(spacing: 4) {
          if let epic = item.epic { BoardParentChip(kind: "epic", title: epic.title) }
          if let release = item.release { BoardParentChip(kind: "release", title: release.title) }
        }
      }
      if let config = store.config, !item.labels.isEmpty {
        FlowLayout(spacing: 4) {
          ForEach(item.labels, id: \.self) { key in
            let label = config.label(key)
            Tag(text: label.label, tint: FeedbackFormat.tint(label.color) ?? Theme.textDimmed)
          }
        }
      }
      let attachments = item.attachments ?? []
      let images = attachments.filter(\.isImage).count
      let videos = attachments.filter(\.isVideo).count
      let files = attachments.count - images - videos
      let hasDescription = !item.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      if hasDescription || !attachments.isEmpty || !(item.related ?? []).isEmpty || !(item.errorRefs ?? []).isEmpty {
        HStack(spacing: 4) {
          if hasDescription { BoardPill(systemImage: "text.alignleft", count: nil, label: "Has a description") }
          if images > 0 { BoardPill(systemImage: "photo", count: images, label: "\(images) images") }
          if videos > 0 { BoardPill(systemImage: "video", count: videos, label: "\(videos) videos") }
          if files > 0 { BoardPill(systemImage: "paperclip", count: files, label: "\(files) files") }
          if let related = item.related?.count, related > 0 { BoardPill(systemImage: "link", count: related, label: "\(related) related items") }
          if !(item.errorRefs ?? []).isEmpty { BoardPill(systemImage: "ladybug", count: nil, label: "Filed from an error") }
        }
      }
      if !item.posts.isEmpty || !item.conversations.isEmpty || !item.targetDay.isEmpty {
        HStack(spacing: 10) {
          if !item.posts.isEmpty {
            Label { Text("\(item.voteCount)").fontWeight(.semibold) } icon: { Image(systemName: "chevron.up") }
              .accessibilityLabel("\(item.voteCount) votes on linked posts")
            Label("\(item.posts.count)", systemImage: "lightbulb").accessibilityLabel("\(item.posts.count) linked posts")
          }
          if !item.conversations.isEmpty {
            Label("\(item.conversations.count)", systemImage: "text.bubble").accessibilityLabel("\(item.conversations.count) linked conversations")
          }
          Spacer(minLength: 0)
          if let day = BoardFormat.shortDay(item.targetDay) { Label(day, systemImage: "calendar").accessibilityLabel("Target \(day)") }
        }
        .labelStyle(BoardCompactLabelStyle())
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
  }
}

/// A small capsule on a card: an icon and, for images and files, how many.
private struct BoardPill: View {
  let systemImage: String
  let count: Int?
  let label: LocalizedStringKey

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: systemImage).font(.app(size: 10))
      if let count { Text("\(count)").font(.lnCaption).monospacedDigit() }
    }
    .foregroundStyle(Theme.textToned)
    .padding(.horizontal, 6)
    .frame(height: 18)
    .background(Theme.elevated, in: Capsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }
}

/// Icon and text at caption size, the way card metadata reads.
struct BoardCompactLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.font(.app(size: 11))
      configuration.title
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.textMuted)
    .lineLimit(1)
    .frame(height: Metrics.scaled(20))
  }
}

// MARK: - Settings

/// Planning's own options, saved as they change, above the statuses and labels
/// (the feedback settings form in its board-only mode).
private struct BoardSettingsSheet: View {
  let store: BoardStore

  var body: some View {
    if let config = store.config {
      FeedbackBoardSettingsSheet(
        config: config.settingsForm,
        boardOnly: true,
        intro: "Planning items, their statuses and labels, and the public roadmap.",
        save: { next in try await store.saveLists(next) }
      ) {
        BoardOptionsSection(store: store)
      }
    }
  }
}

private struct BoardOptionsSection: View {
  let store: BoardStore

  private static let layouts = [
    FeedbackOption(value: "columns", label: String(localized: "Columns by status")),
    FeedbackOption(value: "timeline", label: String(localized: "Timeline by quarter")),
    FeedbackOption(value: "list", label: String(localized: "Compact list"))
  ]

  var body: some View {
    if let config = store.config {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Text("Planning").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text(store.savingBoard ? "Saving…" : "Saves as you change it").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        Card {
          CardRow { FeedbackToggleRow(title: "Planning is on", detail: "Items, links from the inbox and feedback, and the roadmap. The public roadmap keeps listing feedback posts until an item is on it.", isOn: toggle(config.enabled, key: "enabled")) }
          CardRow { FeedbackToggleRow(title: "Sync linked feedback", detail: "When an item moves to another status category, its linked posts follow — and their followers get the usual emails.", isOn: toggle(config.syncFeedback, key: "syncFeedback")) }
          CardRow {
            LabeledField(label: "Roadmap layout") {
              FeedbackSelect(options: Self.layouts, selection: Binding(get: { config.roadmap.layout }, set: { value in save(["roadmap": .object(["layout": .string(value)])]) }))
            }
          }
          CardRow { FeedbackToggleRow(title: "Show labels", detail: "On roadmap cards.", isOn: roadmapToggle(config.roadmap.showLabels, key: "showLabels")) }
          CardRow(divider: false) { FeedbackToggleRow(title: "Show dates", detail: "Target dates on roadmap cards; the timeline always shows them.", isOn: roadmapToggle(config.roadmap.showDates, key: "showDates")) }
        }
      }
    }
  }

  private func toggle(_ value: Bool, key: String) -> Binding<Bool> {
    Binding(get: { value }, set: { next in save([key: .bool(next)]) })
  }

  private func roadmapToggle(_ value: Bool, key: String) -> Binding<Bool> {
    Binding(get: { value }, set: { next in save(["roadmap": .object([key: .bool(next)])]) })
  }

  private func save(_ patch: [String: JSONValue]) {
    let store = store
    Task { await store.saveBoard(patch) }
  }
}
