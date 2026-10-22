import SwiftUI

// Linear's inbox (app/pages/inbox.vue). Regular width: the conversation list
// beside the open conversation, its properties in a trailing inspector.
// Compact width: the list, pushing the conversation; properties in a sheet.

struct InboxScreen: View {
  @Environment(Workspace.self) private var workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var columnOpen = false
  @State private var columnSized = false
  @State private var sheetOpen = false

  var body: some View {
    let store = workspace.inbox
    let compact = sizeClass == .compact
    Group {
      if compact {
        InboxQueueColumn(compact: true)
          .navigationDestination(item: Binding(
            get: { store.selectedId.isEmpty ? nil : store.selectedId },
            set: { if $0 == nil { store.deselect() } }
          )) { id in
            InboxConversationPane(id: id, compact: true, detailsOpen: $sheetOpen)
          }
      } else {
        GeometryReader { geometry in
          HStack(spacing: 0) {
            InboxQueueColumn(compact: false).frame(width: geometry.size.width < 900 ? 320 : 360)
            Rectangle().fill(Theme.border).frame(width: 1)
            InboxConversationPane(id: store.selectedId, compact: false, detailsOpen: $columnOpen)
          }
          .onAppear {
            // Properties start open where there's room for them, as on the web (xl).
            guard !columnSized else { return }
            columnSized = true
            columnOpen = geometry.size.width >= 1000
          }
        }
      }
    }
    .panelScreen("Inbox")
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        InboxFilterMenu()
        Button { Task { await store.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
          .keyboardShortcut("r", modifiers: .command)
        Button { workspace.composeOpen = true } label: { Label("New conversation", systemImage: "square.and.pencil") }
        if !compact, !store.selectedId.isEmpty {
          Button { withAnimation(.snappy) { columnOpen.toggle() } } label: { Label(columnOpen ? "Hide details" : "Show details", systemImage: "sidebar.right") }
        }
      }
    }
    // Filters and search reload the queue; typing is debounced, and this also
    // runs on appear so a filter set before routing here applies.
    .task(id: store.queryKey) {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      await store.refresh()
    }
    .sheet(isPresented: Binding(get: { workspace.composeOpen }, set: { workspace.composeOpen = $0 })) {
      InboxNewConversationSheet().environment(workspace)
    }
    // One confirmation for every way to delete: the list's menu, the header's menu.
    .confirmationDialog(
      "Delete this conversation?",
      isPresented: Binding(get: { store.pendingDelete != nil }, set: { if !$0 { store.pendingDelete = nil } }),
      titleVisibility: .visible,
      presenting: store.pendingDelete
    ) { conversation in
      Button("Delete", role: .destructive) { Task { await store.delete(conversation) } }
    } message: { _ in
      Text("Every message in it is removed for good, for the customer too. Archive it to keep the history.")
    }
  }
}

// MARK: - Queue column

private struct InboxQueueColumn: View {
  let compact: Bool
  @Environment(Workspace.self) private var workspace

  var body: some View {
    @Bindable var store = workspace.inbox
    VStack(spacing: 0) {
      SearchField(text: $store.search, prompt: "Search by name, email or user ID") { Task { await store.refresh() } }
        .padding(.horizontal, 12)
        .padding(.top, 8)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(InboxQueue.allCases) { queue in
            Pill(label: queue.label, count: store.count(queue), isActive: store.queue == queue) { store.queue = queue }
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
      }
      if !store.error.isEmpty {
        ErrorText(message: store.error).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.bottom, 8)
      }
      list(store)
    }
    .background(Theme.panel)
  }

  private func list(_ store: InboxStore) -> some View {
    let rows = store.visible
    return List {
      ForEach(rows) { conversation in
        row(conversation, store: store)
      }
      if store.hasMore {
        Button { Task { await store.refresh(more: true) } } label: {
          Text("Load older conversations").font(.lnMetaMedium).foregroundStyle(Theme.textMuted).frame(maxWidth: .infinity).frame(height: 40).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .linearRow()
      }
    }
    .linearList()
    .refreshable { await store.refresh() }
    .overlay {
      if rows.isEmpty {
        if store.loading && store.conversations.isEmpty {
          SkeletonRows(count: 6).frame(maxHeight: .infinity, alignment: .top)
        } else if store.queue == .archived {
          EmptyState(systemImage: "archivebox", title: "Nothing archived", message: "Archive a conversation to clear it from the queue. It comes back if the customer writes again.")
        } else {
          EmptyState(systemImage: "tray", title: "Nothing in this view", message: "New customer messages land here as they arrive.")
        }
      }
    }
  }

  private func row(_ conversation: Conversation, store: InboxStore) -> some View {
    let unread = conversation.unreadByAgent > 0
    let done = store.isDone(conversation)
    let archived = conversation.archivedAt != nil
    return Button { Task { await store.select(conversation.id) } } label: {
      InboxRow(conversation: conversation, user: store.endUsers[conversation.endUserId], project: workspace.project(conversation.projectId), done: done)
    }
    .buttonStyle(.plain)
    .linearRow(selected: !compact && conversation.id == store.selectedId)
    .contextMenu {
      Button { Task { await store.markRead(conversation.id, read: unread) } } label: {
        Label(unread ? "Mark as read" : "Mark as unread", systemImage: unread ? "envelope.open" : "envelope.badge")
      }
      Button { Task { await store.toggleDone(conversation) } } label: {
        Label(done ? "Reopen" : "Mark as done", systemImage: done ? "arrow.uturn.backward" : "checkmark.circle")
      }
      Divider()
      Button { Task { await store.setArchived(conversation, !archived) } } label: {
        Label(archived ? "Unarchive" : "Archive", systemImage: archived ? "tray.and.arrow.up" : "archivebox")
      }
      Button(role: .destructive) { store.pendingDelete = conversation } label: { Label("Delete", systemImage: "trash") }
    }
    .swipeActions(edge: .leading, allowsFullSwipe: true) {
      Button { Task { await store.markRead(conversation.id, read: unread) } } label: {
        Label(unread ? "Read" : "Unread", systemImage: unread ? "envelope.open" : "envelope.badge")
      }
      .tint(Theme.info)
    }
    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
      if archived {
        Button { Task { await store.setArchived(conversation, false) } } label: { Label("Unarchive", systemImage: "tray.and.arrow.up") }
          .tint(Theme.accent)
        Button(role: .destructive) { store.pendingDelete = conversation } label: { Label("Delete", systemImage: "trash") }
      } else {
        Button { Task { await store.toggleDone(conversation) } } label: {
          Label(done ? "Reopen" : "Done", systemImage: done ? "arrow.uturn.backward" : "checkmark")
        }
        .tint(Theme.accent)
        Button { Task { await store.setArchived(conversation, true) } } label: { Label("Archive", systemImage: "archivebox") }
          .tint(Theme.textMuted)
      }
    }
  }
}

/// One Linear row: unread dot, avatar with the project's dot, who and when,
/// then the subject and the latest message on one line.
private struct InboxRow: View {
  let conversation: Conversation
  let user: EndUser?
  let project: Project?
  let done: Bool

  var body: some View {
    let unread = conversation.unreadByAgent > 0
    let title = user?.inboxName ?? String(localized: "Unknown customer")
    HStack(spacing: 10) {
      Circle().fill(unread ? Theme.accent : Color.clear).frame(width: 6, height: 6)
      Avatar(name: title, size: 28)
        .overlay(alignment: .bottomTrailing) {
          ProjectDot(id: conversation.projectId, accent: project?.theme.accent, icon: project?.iconUrl, size: 9)
            .overlay(Circle().strokeBorder(Theme.panel, lineWidth: 1.5))
            .offset(x: 2, y: 2)
        }
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(title)
            .font(.system(size: 14, weight: unread ? .semibold : .medium))
            .foregroundStyle(Theme.textHighlighted)
            .lineLimit(1)
          Spacer(minLength: 4)
          if let priority = conversation.priority, priority == "high" || priority == "urgent" { PriorityIcon(priority: priority, size: 13) }
          if done { StatusIcon(category: "resolved", size: 13) }
          Text(DateText.short(conversation.lastMessageAt ?? conversation.createdAt))
            .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
        summary.lineLimit(1)
      }
    }
    .padding(.vertical, 8)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityValue(unread ? "Unread" : "")
  }

  private var summary: Text {
    let subject = conversation.subject.isEmpty ? (conversation.context?.label ?? "") : conversation.subject
    let latest = conversation.lastMessagePreview.isEmpty
      ? String(localized: "No messages yet")
      : conversation.lastMessageFrom == "agent" ? String(localized: "You: \(conversation.lastMessagePreview)") : conversation.lastMessagePreview
    let preview = Text(latest).foregroundStyle(Theme.textMuted)
    guard !subject.isEmpty else { return preview.font(.lnMeta) }
    return Text("\(Text(subject).fontWeight(.medium).foregroundStyle(Theme.textToned))  \(preview)").font(.lnMeta)
  }
}

// MARK: - Filters

/// Project, status, priority and ticket type, applied on the server. The icon
/// carries a dot while any is set.
private struct InboxFilterMenu: View {
  @Environment(Workspace.self) private var workspace

  var body: some View {
    @Bindable var store = workspace.inbox
    Menu {
      Picker("Project", selection: $store.projectFilter) {
        Text("All projects").tag("")
        ForEach(workspace.projects) { Text($0.name).tag($0.id) }
      }
      .pickerStyle(.menu)
      Picker("Status", selection: $store.statusFilter) {
        Text("Any status").tag("")
        Text("Open").tag("open")
        Text("Done").tag("done")
      }
      .pickerStyle(.menu)
      Picker("Priority", selection: $store.priorityFilter) {
        Text("Any priority").tag("")
        ForEach(InboxPriority.all, id: \.self) { Text(InboxPriority.label($0)).tag($0) }
      }
      .pickerStyle(.menu)
      Picker("Ticket type", selection: $store.typeFilter) {
        Text("Any type").tag("")
        ForEach(typeKeys(store), id: \.self) { key in Text(typeName(key, store: store)).tag(key) }
      }
      .pickerStyle(.menu)
      if store.filtersActive {
        Button(role: .destructive) { store.clearFilters() } label: { Label("Clear filters", systemImage: "xmark") }
      }
    } label: {
      Image(systemName: "line.3.horizontal.decrease")
        .overlay(alignment: .topTrailing) {
          if store.filtersActive { Circle().fill(Theme.accent).frame(width: 7, height: 7).offset(x: 4, y: -3) }
        }
    }
    .accessibilityLabel(store.filtersActive ? "Filters, active" : "Filter conversations")
  }

  /// The type keys the queue actually holds, from the server's facets.
  private func typeKeys(_ store: InboxStore) -> [String] {
    var keys = Set(store.counts.type.keys)
    if !store.typeFilter.isEmpty { keys.insert(store.typeFilter) }
    return keys.sorted()
  }

  private func typeName(_ key: String, store: InboxStore) -> String {
    store.typesByProject.values.lazy.flatMap { $0 }.first { $0.key == key }?.name ?? key.capitalized
  }
}

// MARK: - Shared bits

enum InboxPriority {
  static let all = ["low", "normal", "high", "urgent"]

  static func label(_ key: String) -> String {
    switch key {
    case "low": String(localized: "Low")
    case "normal": String(localized: "Normal")
    case "high": String(localized: "High")
    case "urgent": String(localized: "Urgent")
    default: key.capitalized
    }
  }
}

enum InboxGlyph {
  /// SF Symbol stand-ins for StatusIcon inside system menus, which can't draw custom views.
  static func status(_ category: String) -> String {
    switch category {
    case "pending": "circle.lefthalf.filled"
    case "resolved": "checkmark.circle.fill"
    case "closed": "xmark.circle.fill"
    default: "circle"
    }
  }
}

extension EndUser {
  /// How the panel names a customer: name, else email, else their id.
  var inboxName: String { !name.isEmpty ? name : !email.isEmpty ? email : !externalId.isEmpty ? externalId : String(localized: "Unknown customer") }
}

extension Agent {
  var inboxName: String { name.isEmpty ? username : name }
}

extension JSONValue {
  /// A field value as editable text ("" when unset).
  var inboxText: String {
    switch self {
    case .string(let value): value
    case .number(let value): value == value.rounded() && abs(value) < 1e15 ? String(Int64(value)) : String(value)
    case .bool(let value): value ? "true" : "false"
    default: ""
    }
  }
  var inboxBool: Bool? { if case .bool(let value) = self { value } else { nil } }
  var inboxObject: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
}

/// A menu's label drawn as a `.linear` field: value, then the up-down chevron.
struct InboxFieldBox<Content: View>: View {
  @ViewBuilder let label: () -> Content
  var body: some View {
    HStack(spacing: 8) {
      label().font(.lnBody).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 0)
      Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
    }
    .padding(.horizontal, 12)
    .frame(minHeight: 40)
    .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    .contentShape(Rectangle())
  }
}
