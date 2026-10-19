import SwiftUI

/// One project's conversations, grouped Linear-style into open and done (web: projects/[id]/conversations.vue).
struct ProjectConversationsScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var items: [Conversation] = []
  @State private var endUsers: [String: EndUser] = [:]
  @State private var loading = true
  @State private var error = ""

  var body: some View {
    Group {
      if loading {
        SkeletonRows().frame(maxHeight: .infinity, alignment: .top)
      } else if !error.isEmpty {
        ErrorText(message: error).padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      } else if items.isEmpty {
        EmptyState(systemImage: "bubble.left.and.bubble.right", title: "No conversations yet", message: "When this project's users write from the widget, their conversations show up here.")
          .frame(maxHeight: .infinity)
      } else {
        List {
          ForEach(groups, id: \.title) { group in
            GroupHeader(title: group.title, count: group.items.count, leading: AnyView(StatusIcon(category: group.category)))
              .padding(.top, 8)
              .linearRow()
            ForEach(group.items) { conversation in
              Button { open(conversation.id) } label: { row(conversation) }
                .buttonStyle(.plain)
                .linearRow()
            }
          }
        }
        .linearList()
        .refreshable { await load() }
      }
    }
    .projectScreen(projectId, "Conversations")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { open(nil) } label: { Label("Open in inbox", systemImage: "tray") }
      }
    }
    .task { await load() }
  }

  // Linear groups a list by status; here that's still open versus settled.
  private var groups: [(title: String, category: String, items: [Conversation])] {
    let open = items.filter { ["open", "pending"].contains(category($0)) }
    let done = items.filter { !["open", "pending"].contains(category($0)) }
    return [(title: "Open", category: "open", items: open), (title: "Done", category: "resolved", items: done)].filter { !$0.items.isEmpty }
  }

  private func row(_ conversation: Conversation) -> some View {
    let lines = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
    let customer = customerName(conversation)
    return HStack(spacing: 12) {
      PriorityIcon(priority: conversation.priority ?? "normal")
      StatusIcon(category: category(conversation))
      lines {
        Text(subject(conversation)).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1).layoutPriority(1)
        Text((conversation.lastMessageFrom == "agent" ? "You: " : "") + conversation.lastMessagePreview)
          .font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 0)
      if conversation.unreadByAgent > 0 {
        Text("\(conversation.unreadByAgent)")
          .font(.system(size: 11, weight: .semibold)).monospacedDigit().foregroundStyle(.white)
          .padding(.horizontal, 6).frame(minWidth: 16, minHeight: 16)
          .background(Theme.accent, in: Capsule())
          .accessibilityLabel("\(conversation.unreadByAgent) unread")
      }
      Avatar(name: customer, size: 20).accessibilityLabel(customer)
      Text(DateText.date(conversation.lastMessageAt)?.formatted(.dateTime.month(.abbreviated).day()) ?? "")
        .font(.lnCaption).foregroundStyle(Theme.textMuted).frame(width: 52, alignment: .trailing)
    }
    .padding(.vertical, 6)
    .frame(minHeight: Metrics.rowHeight)
    .contentShape(Rectangle())
  }

  private func category(_ conversation: Conversation) -> String {
    conversation.statusCategory ?? (conversation.status == "done" ? "resolved" : "open")
  }

  private func subject(_ conversation: Conversation) -> String {
    if !conversation.subject.isEmpty { return conversation.subject }
    if let label = conversation.context?.label, !label.isEmpty { return label }
    return "Conversation"
  }

  private func customerName(_ conversation: Conversation) -> String {
    guard let user = endUsers[conversation.endUserId] else { return "Customer" }
    return [user.name, user.email, user.externalId].first { !$0.isEmpty } ?? "Customer"
  }

  /// The web links to `/inbox?project=<id>&c=<conversation>`: filter the inbox to this project, then select.
  private func open(_ conversationId: String?) {
    workspace.inbox.projectFilter = projectId
    workspace.go(.inbox)
    if let conversationId { Task { await workspace.inbox.select(conversationId) } }
  }

  private func load() async {
    do {
      let response: InboxResponse = try await session.get("/v1/admin/conversations", query: ["project": projectId])
      items = response.conversations
      endUsers = response.endUsers
      error = ""
    } catch {
      self.error = error.localizedDescription
    }
    loading = false
  }
}
