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
  /// The order cards show in a column: 'manual' (the order they are dragged into), 'newest' or 'oldest' (by when made).
  var order = "manual"

  init(projectId: String, workspace: Workspace) {
    self.projectId = projectId
    self.workspace = workspace
  }

  var session: SessionStore { workspace.session }

  var publicCount: Int { items.filter(\.isPublic).count }
  var roadmapReady: Bool { feedbackRoadmap && config?.enabled == true }
  var roadmapURL: URL? {
    guard !publicKey.isEmpty else { return nil }
    return URL(string: "\(session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/roadmap/\(publicKey)")
  }

  var filtering: Bool {
    !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !labelFilter.isEmpty || !assigneeFilter.isEmpty || !priorityFilter.isEmpty || roadmapOnly
  }

  func clearFilters() {
    search = ""
    labelFilter = []
    assigneeFilter = ""
    priorityFilter = ""
    roadmapOnly = false
  }

  func item(_ id: String) -> BoardItem? { items.first { $0.id == id } }
  func agent(_ id: String) -> Agent? { id.isEmpty ? nil : agents.first { $0.id == id } }

  /// A column's items in board order; a status the board no longer knows sits in the default column.
  func column(_ status: String) -> [BoardItem] {
    guard let config else { return [] }
    return items.filter { config.column(of: $0) == status }.sorted(by: boardOrder)
  }

  /// The column as the filters and the order show it.
  func visible(_ status: String) -> [BoardItem] {
    let shown = column(status).filter { matches($0) }
    guard order != "manual" else { return shown }
    // Newest first or oldest first by creation; the number breaks ties.
    return shown.sorted { lhs, rhs in
      let (a, b) = order == "newest" ? (rhs, lhs) : (lhs, rhs)
      return (a.createdAt, a.number ?? 0) < (b.createdAt, b.number ?? 0)
    }
  }

  private func matches(_ item: BoardItem) -> Bool {
    if roadmapOnly && !item.isPublic { return false }
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

  func loadItems() async throws {
    let result: ItemsResponse = try await session.get("/v1/admin/board-items", query: ["project": projectId])
    items = result.items
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

  func create(_ fields: [String: JSONValue]) async throws -> BoardItem {
    let result: ItemResponse = try await session.send("/v1/admin/board-items?project=\(projectId)", body: fields)
    upsert(result.item)
    return result.item
  }

  /// The AI reads a description and proposes a title; nothing is saved.
  func suggestTitle(_ description: String) async throws -> String {
    struct Body: Encodable, Sendable { let description: String }
    struct Reply: Decodable, Sendable { let title: String }
    let reply: Reply = try await session.send("/v1/admin/board-items/suggest-title?project=\(projectId)", body: Body(description: description))
    return reply.title
  }

  /// Send only what changed; `.null` clears a value.
  func update(_ itemId: String, _ fields: [String: JSONValue]) async throws -> BoardItem {
    let result: ItemResponse = try await session.send("/v1/admin/board-items/\(itemId)", method: "PATCH", body: fields)
    upsert(result.item)
    return result.item
  }

  func history(_ itemId: String, offset: Int = 0) async throws -> BoardItemHistoryPage {
    try await session.get("/v1/admin/board-items/\(itemId)/history", query: ["project": projectId, "offset": String(offset)])
  }

  func comments(_ itemId: String, offset: Int = 0) async throws -> BoardItemCommentsPage {
    try await session.get("/v1/admin/board-items/\(itemId)/comments", query: ["project": projectId, "offset": String(offset), "limit": "50"])
  }

  func comment(_ itemId: String, body: String, parentId: String?, replyToId: String?) async throws -> BoardItemComment {
    struct Body: Encodable, Sendable { let body: String; let parentId: String?; let replyToId: String? }
    struct Response: Decodable, Sendable { let comment: BoardItemComment }
    let result: Response = try await session.send("/v1/admin/board-items/\(itemId)/comments?project=\(projectId)", body: Body(body: body, parentId: parentId, replyToId: replyToId))
    return result.comment
  }

  func delete(_ itemId: String) async throws {
    try await session.delete("/v1/admin/board-items/\(itemId)")
    items.removeAll { $0.id == itemId }
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
      let result: ItemResponse = try await session.send("/v1/admin/board-items/\(itemId)", method: "PATCH", body: ["status": JSONValue.string(status), "rank": .number(rank)])
      upsert(result.item)
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

private struct BoardView: View {
  @State var store: BoardStore
  @State private var showSettings = false
  @State private var addingColumn = false
  @State private var showAi = false
  @State private var editor: BoardEditorRoute?
  @State private var roadmapHelp = false
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .panelScreen("Planning")
      .toolbar { toolbar }
      .sheet(item: $editor) { route in BoardItemEditor(store: store, itemId: route.itemId) }
      .sheet(isPresented: $showAi) { AiCardsSheet(session: store.session, projectId: store.projectId, kind: .board) { try? await store.loadItems() } }
      .sheet(isPresented: $showSettings) { BoardSettingsSheet(store: store) }
      .sheet(isPresented: $addingColumn) { AddColumnSheet(store: store) }
      .feedbackErrorAlert($store.alert)
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
  }

  @ViewBuilder private var content: some View {
    if let config = store.config {
      if config.enabled {
        VStack(spacing: 0) {
          filterBar(config)
          Rectangle().fill(Theme.border).frame(height: 1)
          board(config)
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

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      VStack(spacing: 1) {
        ProjectBreadcrumb(projectId: store.projectId, title: "Planning")
        if let config = store.config {
          if config.enabled {
            let items = store.items.count == 1 ? String(localized: "1 item") : String(localized: "\(store.items.count) items")
            Text("\(items), \(store.publicCount) on the roadmap")
              .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
          } else {
            Text("Planning is off").font(.lnCaption).foregroundStyle(Theme.warning)
          }
        }
      }
    }
    if store.config?.enabled == true {
      ToolbarItemGroup(placement: .topBarTrailing) {
        roadmapMenu
        Button { showSettings = true } label: { Label("Settings", systemImage: "slider.horizontal.3") }
        Button { showAi = true } label: { Label("File with AI", systemImage: "sparkles") }
        Button { editor = BoardEditorRoute(itemId: nil) } label: { Label("New item", systemImage: "plus") }
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
      SearchField(text: $store.search, prompt: "Search or #12").padding(.horizontal, Metrics.gutter)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          Pill(label: "On roadmap", count: store.publicCount, systemImage: "globe", isActive: store.roadmapOnly) { store.roadmapOnly.toggle() }
          filterMenu("Assignee", value: assigneeTitle, active: !store.assigneeFilter.isEmpty) {
            Picker("Assignee", selection: $store.assigneeFilter) {
              Text("Anyone").tag("")
              Text("Unassigned").tag("unassigned")
              ForEach(store.agents) { agent in Text(agent.inboxName).tag(agent.id) }
            }
          }
          filterMenu("Order", value: orderTitle, active: store.order != "manual") {
            Picker("Order", selection: $store.order) {
              Text("Manual").tag("manual")
              Text("Newest first").tag("newest")
              Text("Oldest first").tag("oldest")
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

  private var orderTitle: String {
    switch store.order {
    case "newest": String(localized: "Newest first")
    case "oldest": String(localized: "Oldest first")
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
    return Menu {
      items
    } label: {
      HStack(spacing: 6) {
        Text(value).lineLimit(1)
        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
      }
      .font(.lnMetaMedium)
      .foregroundStyle(active ? Theme.textHighlighted : Theme.textMuted)
      .padding(.horizontal, 12)
      .frame(height: 30)
      .background(active ? Theme.elevated : Color.clear, in: Capsule())
      .overlay(Capsule().strokeBorder(active ? Theme.borderAccented : Theme.border))
      .contentShape(Capsule())
    }
    .accessibilityLabel(title)
  }

  // MARK: Kanban

  private func board(_ config: BoardConfig) -> some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 12) {
        ForEach(config.statuses) { status in
          BoardColumn(status: status, items: store.visible(status.key), store: store, filtering: store.filtering) { item in
            editor = BoardEditorRoute(itemId: item.id)
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
        if let number = item.number { Text("#\(number)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
        if !item.priority.isEmpty { PriorityIcon(priority: item.priority, size: 12) }
        Spacer(minLength: 0)
        if item.isPublic {
          Image(systemName: "globe").font(.system(size: 11)).foregroundStyle(Theme.accentText).accessibilityLabel("On the public roadmap")
        }
        if let agent = store.agent(item.assigneeId) { Avatar(name: agent.inboxName, size: 18) }
      }
      Text(item.title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(3).multilineTextAlignment(.leading)
      if let config = store.config, !item.labels.isEmpty {
        FlowLayout(spacing: 4) {
          ForEach(item.labels, id: \.self) { key in
            let label = config.label(key)
            Tag(text: label.label, tint: FeedbackFormat.tint(label.color) ?? Theme.textDimmed)
          }
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

/// Icon and text at caption size, the way card metadata reads.
struct BoardCompactLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.font(.system(size: 11))
      configuration.title
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.textMuted)
    .lineLimit(1)
    .frame(height: 20)
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
