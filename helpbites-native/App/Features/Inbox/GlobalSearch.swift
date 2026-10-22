import SwiftUI

// Content search across conversations and knowledge (GET /v1/admin/search), for
// the ⌘K palette. The shell embeds `GlobalSearchResults(query:)` below its search
// field; the store debounces, cancels superseded requests and renders nothing
// until the query has a term. Empty when the server has no Meilisearch.

struct GlobalSearchResponse: Decodable, Sendable {
  let conversations: [Conversation]
  let endUsers: [String: EndUser]
  let faqs: [Faq]
}

@MainActor @Observable final class GlobalSearchStore {
  private(set) var result: GlobalSearchResponse?
  private(set) var loading = false
  private(set) var error = ""
  private var task: Task<Void, Never>?

  /// Debounced by 250 ms; a newer call cancels the previous request.
  func search(_ raw: String, session: SessionStore, project: String = "") {
    task?.cancel()
    let term = raw.trimmingCharacters(in: .whitespaces)
    guard term.count >= 2 else { result = nil; loading = false; error = ""; return }
    loading = true
    task = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      var query = ["q": term]
      if !project.isEmpty { query["project"] = project }
      do {
        let found: GlobalSearchResponse = try await session.get("/v1/admin/search", query: query)
        guard !Task.isCancelled else { return }
        self?.result = found; self?.error = ""
      } catch {
        guard !Task.isCancelled else { return }
        self?.error = error.localizedDescription
      }
      self?.loading = false
    }
  }
}

/// Result rows for a search term: conversations (open in the inbox) and knowledge
/// answers (open Knowledge). Tapping calls `onPick` after navigating; the host
/// should dismiss itself there.
struct GlobalSearchResults: View {
  let query: String
  var onPick: () -> Void = {}
  @Environment(Workspace.self) private var workspace
  @State private var store = GlobalSearchStore()

  var body: some View {
    let term = query.trimmingCharacters(in: .whitespaces)
    Group {
      if term.count < 2 {
        EmptyView()
      } else if let result = store.result, !store.loading || !(result.conversations.isEmpty && result.faqs.isEmpty) {
        if result.conversations.isEmpty && result.faqs.isEmpty {
          EmptyState(systemImage: "magnifyingglass", title: "No matches", message: "Nothing in conversations or knowledge matches “\(term)”.")
        } else {
          List {
            if !result.conversations.isEmpty {
              Section {
                ForEach(result.conversations) { conversation in
                  Button { pick(conversation) } label: { conversationRow(conversation, user: result.endUsers[conversation.endUserId]) }
                    .buttonStyle(.plain).linearRow()
                }
              } header: { SectionLabel("Conversations") }
            }
            if !result.faqs.isEmpty {
              Section {
                ForEach(result.faqs) { faq in
                  Button { workspace.go(.knowledge); onPick() } label: { faqRow(faq) }
                    .buttonStyle(.plain).linearRow()
                }
              } header: { SectionLabel("Knowledge") }
            }
          }
          .linearList()
        }
      } else if !store.error.isEmpty {
        ErrorText(message: store.error).padding()
      } else {
        SkeletonRows(count: 4)
      }
    }
    .onChange(of: query, initial: true) { _, value in store.search(value, session: workspace.session) }
  }

  private func pick(_ conversation: Conversation) {
    workspace.go(.inbox)
    Task { await workspace.inbox.select(conversation.id) }
    onPick()
  }

  private func conversationRow(_ conversation: Conversation, user: EndUser?) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text(user?.inboxName ?? String(localized: "Unknown customer")).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Spacer(minLength: 4)
        Text(DateText.short(conversation.lastMessageAt ?? conversation.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      let line = conversation.subject.isEmpty ? conversation.lastMessagePreview : conversation.subject
      if !line.isEmpty { Text(line).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1) }
    }
    .padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
  }

  private func faqRow(_ faq: Faq) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(faq.question).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
      Text(faq.answer).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
    }
    .padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
  }
}
