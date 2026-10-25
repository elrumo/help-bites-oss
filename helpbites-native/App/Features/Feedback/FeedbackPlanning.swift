import SwiftUI

/// Filing a feedback post on the planning board (composables/useFeedbackPlanning.ts): the server's AI
/// decides whether the post is one piece of work or several and writes each item, or copies the post
/// when the workspace has no AI. `POST /v1/admin/board-items/from-feedback`.
enum FeedbackPlanning {
  struct Created: Decodable, Sendable {
    let items: [BoardItem]
    let ai: Bool
  }

  private struct Input: Encodable, Sendable { let postId: String }

  /// Shown while the AI works; it can take several seconds.
  static let workingMessage = String(localized: "The AI is reading the post and deciding how to plan it…")

  static func create(session: SessionStore, projectId: String, postId: String) async throws -> Created {
    try await session.send("/v1/admin/board-items/from-feedback?project=\(projectId)", body: Input(postId: postId))
  }

  /// "Created #12 Filter by protected" or "Created 3 planning items".
  static func summary(_ created: Created) -> String {
    guard created.items.count == 1, let item = created.items.first else { return String(localized: "Created \(created.items.count) planning items") }
    return String(localized: "Created \(item.number.map { "#\($0) " } ?? "")\(item.title)")
  }
}

/// A pill that says the AI is busy.
struct WorkingBanner: View {
  let message: String

  var body: some View {
    HStack(spacing: 8) {
      ProgressView().controlSize(.small)
      Text(message).font(.lnMeta).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().stroke(Theme.borderMuted))
    .padding(.bottom, 16)
    .accessibilityElement(children: .combine)
  }
}

/// "Add to planning": file the post as new items with the AI, or attach it to one that exists.
/// A post can feed several items, and an item can hold several posts.
struct PlanningAddSheet: View {
  let projectId: String
  let post: FeedbackPost
  /// Told what happened, for the screen's banner.
  let done: @MainActor (String) -> Void
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var store: BoardStore?
  @State private var query = ""
  @State private var busy = ""
  @State private var error = ""

  private var candidates: [BoardItem] {
    guard let store else { return [] }
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let number = Int(needle.hasPrefix("#") ? String(needle.dropFirst()) : needle)
    return store.items.sorted(by: boardOrder).filter { item in
      needle.isEmpty || (number != nil ? item.number == number : item.title.localizedStandardContains(needle) || item.description.localizedStandardContains(needle))
    }
  }

  var body: some View {
    NavigationStack {
      List {
        Section {
          VStack(alignment: .leading, spacing: 8) {
            Text("The AI reads the post and decides whether it needs one planning item or several, writing the title, text and urgency of each. Without an AI provider it copies the post.")
              .font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
            Button { Task { await create() } } label: { Label(busy == "__new__" ? "Creating…" : "Create planning item", systemImage: "sparkles") }
              .buttonStyle(.lnPrimary)
              .disabled(!busy.isEmpty)
            if busy == "__new__" {
              HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(FeedbackPlanning.workingMessage).font(.lnMeta).foregroundStyle(Theme.accent)
              }
            }
            ErrorText(message: error)
          }
          .linearRow()
        }
        Section("Or add to an item") {
          if store?.config == nil && store?.error.isEmpty != false {
            SkeletonRows(count: 3).linearRow()
          } else if candidates.isEmpty {
            Text(query.isEmpty ? "No planning items yet." : "Nothing matches.").font(.lnMeta).foregroundStyle(Theme.textMuted).linearRow()
          }
          ForEach(candidates) { item in
            let linked = item.feedbackPostIds.contains(post.id)
            Button { Task { await attach(item) } } label: {
              HStack(spacing: 8) {
                Circle().fill(FeedbackFormat.tint(store?.config?.status(item.status)?.color ?? "neutral") ?? Theme.textDimmed).frame(width: 7, height: 7)
                if let number = item.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
                Text(item.title).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 0)
                if linked { Label("Linked", systemImage: "checkmark").labelStyle(.titleAndIcon).font(.lnCaption).foregroundStyle(Theme.textMuted) }
                else if busy == item.id { ProgressView().controlSize(.mini) }
              }
              .font(.lnMeta)
              .frame(minHeight: 36)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(linked || !busy.isEmpty)
            .linearRow()
          }
        }
      }
      .linearList()
      .searchable(text: $query, prompt: "Search items or #12")
      .panelScreen("Add to planning")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task {
        let board = BoardStore(projectId: projectId, workspace: workspace)
        store = board
        await board.load()
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func create() async {
    busy = "__new__"
    error = ""
    defer { busy = "" }
    do {
      let created = try await FeedbackPlanning.create(session: workspace.session, projectId: projectId, postId: post.id)
      done(FeedbackPlanning.summary(created))
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func attach(_ item: BoardItem) async {
    guard let store else { return }
    busy = item.id
    error = ""
    defer { busy = "" }
    do {
      let next = try await store.link(item.id, kind: "feedback", target: post.id, linked: true)
      done(String(localized: "Added to \(next.number.map { "#\($0) " } ?? "")\(next.title)"))
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
