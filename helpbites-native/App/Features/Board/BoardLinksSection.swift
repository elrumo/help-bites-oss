import SwiftUI

/// The planning items a conversation or a feedback post feeds (components/BoardLinks.vue):
/// open one, unlink it, file a new one prefilled from it (already linked), or add it
/// to an item already in planning. Callers show it only when the server has planning
/// (`Project.board` is set); planning that's off offers to set it up.
struct BoardLinksSection: View {
  let projectId: String
  /// "conversation" or "feedback".
  let kind: String
  let targetId: String
  /// What a new item starts with: the subject or post title, and the last customer message or post text.
  let title: String
  let description: String
  @Environment(Workspace.self) private var workspace
  @State private var linked: [BoardItem] = []
  @State private var loaded = false
  @State private var busy = ""
  @State private var creating = false
  @State private var error = ""
  @State private var picking = false
  @State private var editing: EditorRoute?
  /// The planning board, loaded only when an item is opened or picked.
  @State private var board: BoardStore?

  private struct EditorRoute: Identifiable { let id: String }

  private var config: BoardConfig? { workspace.project(projectId)?.board }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if config?.enabled == false {
        Button { workspace.go(.project(projectId, .board)) } label: {
          HStack(spacing: 8) {
            Image(systemName: "rectangle.split.3x1").font(.system(size: 12)).foregroundStyle(Theme.textDimmed)
            Text("Set up Planning").foregroundStyle(Theme.textMuted)
            Spacer(minLength: 0)
          }
          .font(.lnMeta)
          .padding(.horizontal, 8)
          .frame(height: 32)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      } else {
        if !loaded {
          RoundedRectangle(cornerRadius: Metrics.radiusSmall).fill(Theme.elevated).frame(height: 28).padding(.horizontal, 8)
        }
        ForEach(linked) { item in row(item) }
        HStack(spacing: 6) {
          Button { Task { await create() } } label: { Label("New item", systemImage: "plus") }
            .buttonStyle(.lnSecondaryCompact)
            .disabled(creating)
          Button {
            _ = boardStore()
            picking = true
          } label: { Label("Add to existing", systemImage: "rectangle.stack.badge.plus") }
            .buttonStyle(.lnSecondaryCompact)
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        ErrorText(message: error).padding(.horizontal, 8)
      }
    }
    .task(id: "\(projectId)|\(kind)|\(targetId)|\(config?.enabled == true)") { await load() }
    .sheet(isPresented: $picking) {
      if let board {
        BoardItemPicker(store: board, exclude: Set(linked.map(\.id))) { item in Task { await link(item.id, true) } }
      }
    }
    .sheet(item: $editing, onDismiss: { Task { await load() } }) { route in
      if let board { BoardItemEditor(store: board, itemId: route.id) }
    }
  }

  private func row(_ item: BoardItem) -> some View {
    HStack(spacing: 8) {
      Button {
        _ = boardStore()
        editing = EditorRoute(id: item.id)
      } label: {
        HStack(spacing: 8) {
          Circle().fill(FeedbackFormat.tint(config?.status(item.status)?.color ?? "neutral") ?? Theme.textDimmed).frame(width: 7, height: 7)
          if let number = item.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
          Text(item.title).foregroundStyle(Theme.text).lineLimit(1)
          if item.isPublic {
            Image(systemName: "globe").font(.system(size: 10)).foregroundStyle(Theme.textDimmed).accessibilityLabel("On the public roadmap")
          }
          Spacer(minLength: 0)
        }
        .font(.lnMeta)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Button { Task { await link(item.id, false) } } label: {
        Group {
          if busy == item.id { ProgressView().controlSize(.mini) } else { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textDimmed) }
        }
        .frame(width: 24, height: 24)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(!busy.isEmpty)
      .accessibilityLabel("Unlink \(item.number.map { "#\($0) " } ?? "")\(item.title)")
    }
    .padding(.horizontal, 8)
    .frame(height: 32)
  }

  /// Made on an action, never while the view updates.
  private func boardStore() -> BoardStore {
    if let board { return board }
    let store = BoardStore(projectId: projectId, workspace: workspace)
    board = store
    return store
  }

  // MARK: Requests

  private var filterKey: String { kind == "feedback" ? "feedbackPost" : "conversation" }
  private var linkKey: String { kind == "feedback" ? "feedbackPostIds" : "conversationIds" }

  private func load() async {
    guard config?.enabled == true, !targetId.isEmpty else {
      linked = []
      loaded = true
      return
    }
    do {
      let result: ItemsResponse = try await workspace.session.get("/v1/admin/board-items", query: ["project": projectId, filterKey: targetId])
      linked = result.items
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loaded = true
  }

  private func create() async {
    creating = true
    defer { creating = false }
    error = ""
    let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
    var name = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { name = FeedbackFormat.plainText(text, limit: 80).components(separatedBy: "\n").first ?? "" }
    if name.isEmpty { name = "Untitled" }
    let fields: [String: JSONValue] = ["title": .string(String(name.prefix(200))), "description": .string(text), linkKey: .array([.string(targetId)])]
    do {
      let result: ItemResponse = try await workspace.session.send("/v1/admin/board-items?project=\(projectId)", body: fields)
      linked.append(result.item)
      board?.upsert(result.item)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func link(_ itemId: String, _ on: Bool) async {
    busy = itemId
    defer { busy = "" }
    error = ""
    do {
      let body: [String: JSONValue] = ["kind": .string(kind), "id": .string(targetId), "linked": .bool(on)]
      let result: ItemResponse = try await workspace.session.send("/v1/admin/board-items/\(itemId)/links", body: body)
      if on {
        if !linked.contains(where: { $0.id == itemId }) { linked.append(result.item) }
      } else {
        linked.removeAll { $0.id == itemId }
      }
      board?.upsert(result.item)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private struct ItemsResponse: Decodable, Sendable { let items: [BoardItem] }
  private struct ItemResponse: Decodable, Sendable { let item: BoardItem }
}
