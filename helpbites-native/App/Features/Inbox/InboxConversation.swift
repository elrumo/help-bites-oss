import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// The open conversation: breadcrumb header, the Messages-style transcript
// (ChatTranscript.vue) and Linear's comment box (ChatComposer.vue), with the
// properties panel as a trailing inspector (a sheet in compact width).

struct InboxConversationPane: View {
  let id: String
  let compact: Bool
  @Binding var detailsOpen: Bool
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let store = workspace.inbox
    let conversation = id.isEmpty ? nil : store.conversation(id)
    content(conversation, store: store)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Theme.panel)
      // iPad: a trailing column. iPhone: a sheet; a compact .inspector hoists
      // the sheet's Done button into this screen's bar.
      .inspector(isPresented: Binding(get: { !compact && detailsOpen && conversation != nil }, set: { detailsOpen = $0 })) {
        if let conversation {
          InboxPropertiesPanel(conversation: conversation, compact: false)
            .environment(workspace)
            .inspectorColumnWidth(min: 260, ideal: 300, max: 380)
        }
      }
      .sheet(isPresented: Binding(get: { compact && detailsOpen && conversation != nil }, set: { detailsOpen = $0 })) {
        if let conversation {
          InboxPropertiesPanel(conversation: conversation, compact: true).environment(workspace)
        }
      }
      .modifier(InboxCompactChrome(enabled: compact, conversation: conversation, detailsOpen: $detailsOpen))
  }

  @ViewBuilder
  private func content(_ conversation: Conversation?, store: InboxStore) -> some View {
    if let conversation {
      VStack(spacing: 0) {
        if !compact { InboxConversationHeader(conversation: conversation, showStatus: !detailsOpen) }
        InboxThreadView(conversation: conversation).id(conversation.id)
      }
    } else if id.isEmpty {
      EmptyState(systemImage: "bubble.left.and.bubble.right", title: "Pick a conversation", message: "Its full history, the customer and the ticket open here.")
    } else if !store.threadError.isEmpty {
      EmptyState(systemImage: "exclamationmark.bubble", title: "Couldn't open this conversation", message: LocalizedStringKey(store.threadError)) {
        Button("Try again") { Task { await store.select(id) } }.buttonStyle(.lnSecondaryCompact)
      }
    } else {
      ProgressView()
    }
  }
}

/// iPhone: the pushed screen's bar carries who and where, the status, and Details.
private struct InboxCompactChrome: ViewModifier {
  let enabled: Bool
  let conversation: Conversation?
  @Binding var detailsOpen: Bool
  @Environment(Workspace.self) private var workspace

  @ViewBuilder
  func body(content: Content) -> some View {
    if enabled {
      let name = conversation.flatMap { workspace.inbox.endUsers[$0.endUserId]?.inboxName } ?? String(localized: "Conversation")
      content
        .panelScreen(name)
        .toolbar {
          if let conversation {
            ToolbarItem(placement: .principal) { InboxCompactTitle(conversation: conversation, name: name) }
            ToolbarItemGroup(placement: .topBarTrailing) {
              InboxStatusMenu(conversation: conversation)
              InboxActionsMenu(conversation: conversation)
              Button { detailsOpen = true } label: { Label("Details", systemImage: "sidebar.right") }
            }
          }
        }
        // A chat gets the whole screen, as in Messages: the composer sits where the tab bar was.
        #if os(iOS)
        .toolbar(.hidden, for: .tabBar)
        #endif
    } else {
      content
    }
  }
}

private struct InboxCompactTitle: View {
  let conversation: Conversation
  let name: String
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let project = workspace.project(conversation.projectId)
    let subject = conversation.subject.isEmpty ? (conversation.context?.label ?? "") : conversation.subject
    VStack(spacing: 1) {
      Text(name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
      HStack(spacing: 4) {
        ProjectDot(id: conversation.projectId, accent: project?.theme.accent, icon: project?.iconUrl, size: 6)
        Text([project?.name ?? "", subject].filter { !$0.isEmpty }.joined(separator: " · ")).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
    .lineLimit(1)
    .frame(maxWidth: 240)
    .accessibilityElement(children: .combine)
  }
}

/// iPad: "Project › Customer  subject", like the web's breadcrumb bar.
private struct InboxConversationHeader: View {
  let conversation: Conversation
  let showStatus: Bool
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let project = workspace.project(conversation.projectId)
    let name = workspace.inbox.endUsers[conversation.endUserId]?.inboxName ?? String(localized: "Conversation")
    let subject = conversation.subject.isEmpty ? (conversation.context?.label ?? "") : conversation.subject
    HStack(spacing: 6) {
      if let project {
        Button { workspace.go(.project(project.id, .overview)) } label: {
          HStack(spacing: 6) {
            ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl)
            Text(project.name).foregroundStyle(Theme.textMuted)
          }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open \(project.name)")
        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      Text(name).foregroundStyle(Theme.textHighlighted).layoutPriority(1)
      if !subject.isEmpty { Text(subject).font(.lnMeta).foregroundStyle(Theme.textMuted) }
      Spacer(minLength: 8)
      if showStatus { InboxStatusMenu(conversation: conversation) }
      InboxActionsMenu(conversation: conversation)
    }
    .font(.lnMetaMedium)
    .lineLimit(1)
    .padding(.horizontal, 16)
    .frame(height: 48)
    .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
  }
}

/// Archive (or bring back) and delete the open conversation. Delete asks first, in the inbox screen's dialog.
private struct InboxActionsMenu: View {
  let conversation: Conversation
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let store = workspace.inbox
    let archived = conversation.archivedAt != nil
    Menu {
      Button { Task { await store.setArchived(conversation, !archived) } } label: {
        Label(archived ? "Unarchive" : "Archive", systemImage: archived ? "tray.and.arrow.up" : "archivebox")
      }
      Button(role: .destructive) { store.pendingDelete = conversation } label: { Label("Delete", systemImage: "trash") }
    } label: {
      Image(systemName: "ellipsis.circle")
        .frame(width: 28, height: 28)
        .contentShape(Rectangle())
    }
    .accessibilityLabel("More actions")
  }
}

/// The status picker from the type's statuses (POST /status).
private struct InboxStatusMenu: View {
  let conversation: Conversation
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let store = workspace.inbox
    let statuses = store.statuses(for: conversation)
    let current = statuses.first { $0.key == conversation.status }
    Menu {
      Picker("Status", selection: Binding(get: { conversation.status }, set: { key in Task { await store.setStatus(conversation.id, key) } })) {
        ForEach(statuses) { status in Label(status.label, systemImage: InboxGlyph.status(status.category)).tag(status.key) }
      }
      .pickerStyle(.inline)
    } label: {
      HStack(spacing: 6) {
        StatusIcon(category: current?.category ?? conversation.statusCategory ?? "open", size: 13)
        Text(current?.label ?? conversation.status.capitalized).font(.lnMetaMedium).foregroundStyle(Theme.text)
      }
      .padding(.horizontal, 10)
      .frame(height: 28)
      .overlay(Capsule().strokeBorder(Theme.border))
      .contentShape(Capsule())
    }
    .accessibilityLabel("Status: \(current?.label ?? conversation.status)")
  }
}

// MARK: - Thread

private struct InboxReplyTarget { let name: String; let preview: String }

/// Transcript and composer for one conversation; `.id`'d by it, so the draft,
/// note mode and open thread never leak into the next conversation.
private struct InboxThreadView: View {
  let conversation: Conversation
  @Environment(Workspace.self) private var workspace
  @State private var threadId = ""

  var body: some View {
    let messages = workspace.inbox.messages.filter { $0.conversationId == conversation.id }
    let root = threadId.isEmpty ? nil : messages.first { $0.id == threadId }
    VStack(spacing: 0) {
      InboxTranscript(conversation: conversation, messages: messages, threadId: $threadId)
      InboxComposer(conversation: conversation, replyTarget: root.map(target), threadId: $threadId)
    }
    .background {
      // Escape closes an open thread, as on the web.
      if !threadId.isEmpty {
        Button("Close thread") { withAnimation(.snappy) { threadId = "" } }
          .keyboardShortcut(.escape, modifiers: [])
          .opacity(0)
          .accessibilityHidden(true)
      }
    }
    // A thread whose root was unsent closes.
    .onChange(of: root == nil) { _, gone in if gone, !threadId.isEmpty { threadId = "" } }
  }

  private func target(_ root: Message) -> InboxReplyTarget {
    let name = root.senderName.isEmpty ? (root.sender == "agent" ? String(localized: "yourself") : String(localized: "them")) : root.senderName
    return InboxReplyTarget(name: name, preview: InboxText.preview(root.body, 80))
  }
}

private struct InboxTranscript: View {
  let conversation: Conversation
  let messages: [Message]
  @Binding var threadId: String
  @Environment(Workspace.self) private var workspace
  @State private var preview: PreviewItem?
  @State private var unsending: Message?
  @State private var savingFaq: Message?
  // Only messages that arrive while the transcript is open pop in; the backlog is already there.
  @State private var openedAt = Date().ISO8601Format()

  private static let bottom = "inbox-transcript-bottom"

  var body: some View {
    let store = workspace.inbox
    let threads = InboxThreads(messages)
    let lastOwn = messages.last { $0.sender == "agent" && $0.kind != "event" && $0.visibility != "internal" }?.id
    ScrollViewReader { proxy in
      ScrollView {
        VStack(spacing: 0) {
          if store.hasEarlierMessages {
            Button("Load earlier messages") { Task { await store.loadEarlierMessages() } }.buttonStyle(.lnGhost).padding(.bottom, 8)
          }
          ForEach(InboxGroup.build(messages)) { group in
            separator(group.startedAt)
            ForEach(group.runs) { run in
              if run.isEvent {
                ForEach(run.messages) { message in eventLine(message, store: store) }
              } else {
                VStack(alignment: run.own ? .trailing : .leading, spacing: 2) {
                  ForEach(Array(run.messages.enumerated()), id: \.element.id) { index, message in
                    bubble(message, run: run, index: index, threads: threads, lastOwn: lastOwn, store: store)
                  }
                }
                .frame(maxWidth: .infinity, alignment: run.own ? .trailing : .leading)
                .padding(.bottom, 10)
              }
            }
          }
          Color.clear.frame(height: 1).id(Self.bottom)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: messages.last?.id)
      }
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)
      .overlay { if messages.isEmpty { placeholder(store) } }
      .onChange(of: messages.last?.id) { previous, _ in
        if previous == nil { proxy.scrollTo(Self.bottom, anchor: .bottom) } else { withAnimation(.snappy) { proxy.scrollTo(Self.bottom, anchor: .bottom) } }
      }
      .onChange(of: threadId) { _, id in
        guard !id.isEmpty else { return }
        withAnimation(.snappy) { proxy.scrollTo(id, anchor: .center) }
      }
    }
    .fullScreenCover(item: $preview) { ImagePreview(url: $0.url) }
    .sheet(item: $savingFaq) { InboxFaqSheet(message: $0, messages: messages).environment(workspace) }
    .confirmationDialog("Delete this message?", isPresented: Binding(get: { unsending != nil }, set: { if !$0 { unsending = nil } }), titleVisibility: .visible, presenting: unsending) { message in
      Button("Delete", role: .destructive) { Task { await store.unsend(message) } }
    } message: { _ in
      Text("It's removed from the conversation for everyone.")
    }
  }

  // MARK: Pieces

  private func separator(_ raw: String) -> some View {
    let parts = InboxText.separator(raw)
    return Text("\(Text(parts.day).fontWeight(.semibold).foregroundStyle(Theme.textToned)) \(parts.time)")
      .font(.lnCaption)
      .foregroundStyle(Theme.textMuted)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 10)
      .opacity(threadId.isEmpty ? 1 : 0.35)
  }

  private func eventLine(_ message: Message, store: InboxStore) -> some View {
    Text(eventLabel(message, store: store))
      .font(.lnCaption)
      .foregroundStyle(Theme.textMuted)
      .multilineTextAlignment(.center)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 6)
      .opacity(threadId.isEmpty ? 1 : 0.35)
      .id(message.id)
  }

  @ViewBuilder
  private func bubble(_ message: Message, run: InboxRun, index: Int, threads: InboxThreads, lastOwn: String?, store: InboxStore) -> some View {
    let own = run.own
    let note = message.visibility == "internal"
    let dimmed = !threadId.isEmpty && !threads.contains(message.id, in: threadId)
    let replies = threads.replies[message.id]?.count ?? 0
    let readAt = conversation.userReadAt ?? ""
    VStack(alignment: own ? .trailing : .leading, spacing: 3) {
      if let tag = sourceTag(run.messages, index) { sourceLabel(tag, store: store) }
      if note {
        Label("Internal note", systemImage: "lock").font(.lnCaptionMedium).foregroundStyle(Theme.warning).padding(.horizontal, 4)
      }
      if let context = message.context { contextCard(context) }
      if let rootId = threads.quote[message.id], let root = threads.byId[rootId] { quote(root) }
      core(message, own: own, note: note, threads: threads, store: store)
      if !(message.reactions ?? []).isEmpty { reactions(message, store: store) }
      if message.id == lastOwn, !readAt.isEmpty, readAt >= message.createdAt {
        Text("Read").font(.lnCaption).foregroundStyle(Theme.textMuted).padding(.horizontal, 4)
      }
      if replies > 0 { repliesButton(message.id, count: replies) }
    }
    .frame(maxWidth: 520, alignment: own ? .trailing : .leading)
    .padding(own ? .leading : .trailing, 48)
    .opacity(dimmed ? 0.35 : 1)
    .blur(radius: dimmed ? 1.5 : 0)
    // Outside the open thread, a tap closes it.
    .overlay { if dimmed { Color.clear.contentShape(Rectangle()).onTapGesture { withAnimation(.snappy) { threadId = "" } } } }
    .animation(.snappy(duration: 0.2), value: dimmed)
    .transition(message.createdAt > openedAt ? .scale(scale: 0.5, anchor: own ? .bottomTrailing : .bottomLeading).combined(with: .opacity) : .identity)
    .id(message.id)
  }

  /// Images get their own bubbles; the text bubble has no tail. Long-press for
  /// tapbacks, Reply, Copy and Delete.
  private func core(_ message: Message, own: Bool, note: Bool, threads: InboxThreads, store: InboxStore) -> some View {
    VStack(alignment: own ? .trailing : .leading, spacing: 3) {
      ForEach(message.attachments) { file in attachment(file) }
      if !message.body.isEmpty {
        Text(InboxText.linkified(message.body))
          .font(.lnBody)
          .foregroundStyle(own && !note ? Color.white : Theme.textHighlighted)
          .tint(own && !note ? Color.white : Theme.accentText)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(note ? Theme.warning.opacity(0.12) : own ? Theme.accent : Theme.accented, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay { if note { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.warning.opacity(0.3)) } }
      }
    }
    .contextMenu {
      ControlGroup {
        ForEach(InboxText.tapbacks, id: \.self) { emoji in
          Button(emoji) { Task { await store.react(emoji, on: message) } }
        }
      }
      .controlGroupStyle(.palette)
      Button { withAnimation(.snappy) { threadId = threads.rootOf[message.id] ?? message.id } } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
      if !message.body.isEmpty {
        Button { Clipboard.copy(message.body) } label: { Label("Copy", systemImage: "doc.on.doc") }
      }
      if message.sender == "agent", !note, !message.body.isEmpty {
        Button { savingFaq = message } label: { Label("Save as FAQ", systemImage: "text.badge.plus") }
      }
      if message.sender == "agent" {
        Button(role: .destructive) { unsending = message } label: { Label("Delete", systemImage: "trash") }
      }
    }
  }

  private func attachment(_ file: Attachment) -> some View {
    Button { if let url = URL(string: file.url) { preview = PreviewItem(url: url) } } label: {
      CachedAsyncImage(url: URL(string: file.url)) { phase in
        if let image = phase.image {
          image.resizable().scaledToFit()
        } else {
          RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(Theme.elevated)
            .frame(width: 200, height: 150)
            .overlay {
              if phase.error != nil { Image(systemName: "photo").foregroundStyle(Theme.textDimmed) } else { ProgressView() }
            }
        }
      }
      .frame(maxWidth: 260, maxHeight: 320)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Image")
    .accessibilityHint("Opens it full screen")
  }

  private func sourceLabel(_ tag: InboxSourceTag, store: InboxStore) -> some View {
    HStack(spacing: 4) {
      if tag.ai, let raw = store.project?.assistantLogoUrl, !raw.isEmpty, let url = URL(string: raw) {
        CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Image(systemName: "sparkles") }
          .frame(width: 14, height: 14)
          .clipShape(Circle())
      } else {
        Image(systemName: tag.ai ? "sparkles" : "person.fill").font(.system(size: 10, weight: .semibold))
      }
      Text(tag.text)
    }
    .font(.lnCaptionMedium)
    .foregroundStyle(tag.ai ? Theme.accentText : Theme.textMuted)
    .padding(.horizontal, 4)
  }

  /// What the message is about in the host app.
  @ViewBuilder
  private func contextCard(_ context: ConversationContext) -> some View {
    let host = context.url.flatMap { URL(string: $0)?.host() } ?? ""
    let card = HStack(spacing: 10) {
      if let thumb = context.thumbnailUrl, !thumb.isEmpty, let url = URL(string: thumb) {
        CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
          .frame(width: 36, height: 36)
          .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      } else {
        Image(systemName: "link").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textMuted)
      }
      VStack(alignment: .leading, spacing: 1) {
        Text(context.label).font(.lnCaptionMedium).foregroundStyle(Theme.textHighlighted)
        Text(host.isEmpty ? context.type : "\(context.type) · \(host)").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      .lineLimit(1)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous).strokeBorder(Theme.border))
    if let raw = context.url, let url = URL(string: raw) { Link(destination: url) { card } } else { card }
  }

  /// A reply far from its thread quotes the message it answers; tap to open the thread.
  private func quote(_ root: Message) -> some View {
    Button { withAnimation(.snappy) { threadId = root.id } } label: {
      Label {
        Text(root.body.isEmpty ? String(localized: "Image") : InboxText.preview(root.body, 60)).lineLimit(1)
      } icon: {
        Image(systemName: "arrowshape.turn.up.left")
      }
      .font(.lnCaption)
      .foregroundStyle(Theme.textMuted)
      .padding(.horizontal, 4)
    }
    .buttonStyle(.plain)
    .accessibilityHint("Opens the thread")
  }

  private func reactions(_ message: Message, store: InboxStore) -> some View {
    HStack(spacing: 4) {
      ForEach(InboxText.reactionGroups(message.reactions ?? [], mine: store.myReactionActor), id: \.emoji) { group in
        Button { Task { await store.react(group.emoji, on: message) } } label: {
          HStack(spacing: 3) {
            Text(group.emoji).font(.system(size: 12))
            if group.count > 1 { Text("\(group.count)").font(.lnCaptionMedium).monospacedDigit() }
          }
          .foregroundStyle(group.mine ? Theme.accentText : Theme.textToned)
          .padding(.horizontal, 7)
          .frame(height: 22)
          .background(group.mine ? Theme.accent.opacity(0.12) : Theme.panel, in: Capsule())
          .overlay(Capsule().strokeBorder(group.mine ? Theme.accent.opacity(0.55) : Theme.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(group.emoji) \(group.count): \(group.names.joined(separator: ", "))")
        .accessibilityHint(group.mine ? "Takes your reaction back" : "Adds your reaction")
      }
    }
  }

  private func repliesButton(_ id: String, count: Int) -> some View {
    Button { withAnimation(.snappy) { threadId = threadId == id ? "" : id } } label: {
      HStack(spacing: 2) {
        Text(count == 1 ? String(localized: "1 reply") : String(localized: "\(count) replies"))
        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
      }
      .font(.lnCaptionMedium)
      .foregroundStyle(Theme.accentText)
      .padding(.horizontal, 4)
    }
    .buttonStyle(.plain)
  }

  @ViewBuilder
  private func placeholder(_ store: InboxStore) -> some View {
    if store.threadLoading {
      VStack(spacing: 10) {
        ForEach(0..<5, id: \.self) { index in
          HStack {
            if index.isMultiple(of: 2) { Spacer(minLength: 0) }
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .fill(index.isMultiple(of: 2) ? Theme.accent.opacity(0.15) : Theme.elevated)
              .frame(width: [170, 120, 210, 140, 180][index], height: 36)
            if !index.isMultiple(of: 2) { Spacer(minLength: 0) }
          }
        }
      }
      .padding(16)
      .frame(maxHeight: .infinity, alignment: .bottom)
    } else {
      EmptyState(systemImage: "bubble.left", title: "No messages yet", message: "Write the first one. It reaches the customer in the widget and by email.")
    }
  }

  /// Once atop each same-source run of team replies: the AI assistant or the teammate.
  private func sourceTag(_ run: [Message], _ index: Int) -> InboxSourceTag? {
    let message = run[index]
    guard message.sender == "agent", message.visibility != "internal" else { return nil }
    let ai = InboxText.isAI(message)
    if index > 0, run[index - 1].visibility != "internal", InboxText.isAI(run[index - 1]) == ai { return nil }
    let sender = message.senderName.isEmpty ? String(localized: "Assistant") : message.senderName
    return ai
      ? InboxSourceTag(text: String(localized: "\(sender) · AI"), ai: true)
      : InboxSourceTag(text: message.senderName.isEmpty ? String(localized: "Support") : message.senderName, ai: false)
  }

  /// ChatTranscript.vue's eventLabel, with names and labels where we know them.
  private func eventLabel(_ message: Message, store: InboxStore) -> String {
    let event = message.event ?? [:]
    switch event["type"]?.inboxText ?? "" {
    case "created":
      return String(localized: "Ticket created")
    case "status.changed":
      // PATCH events nest the change under `status`.
      let key = event["to"]?.inboxText ?? event["status"]?.inboxObject?["to"]?.inboxText ?? ""
      let label = store.statuses(for: conversation).first { $0.key == key }?.label ?? key
      return String(localized: "Status changed to \(label)")
    case "assigned":
      let id = event["assignee"]?.inboxText ?? ""
      if id.isEmpty { return String(localized: "Assignment cleared") }
      let name = store.agents.first { $0.id == id }?.inboxName ?? id
      return String(localized: "Assigned to \(name)")
    case "action.performed":
      let key = event["actionKey"]?.inboxText ?? ""
      let label = store.type(for: conversation)?.actions.first { $0.key == key }?.label ?? (key.isEmpty ? String(localized: "Host action") : key)
      let result = event["result"]?.inboxText ?? String(localized: "pending")
      return "\(label) · \(result)"
    case "board.linked", "board.unlinked":
      let number = event["number"]?.inboxText ?? ""
      let title = event["title"]?.inboxText ?? ""
      let item = "\(number.isEmpty ? "" : "#\(number) ")\(title.isEmpty ? String(localized: "an item") : title)"
      return event["type"]?.inboxText == "board.linked" ? String(localized: "Linked to planning item \(item)") : String(localized: "Unlinked from planning item \(item)")
    case "feedback.linked", "feedback.unlinked":
      let number = event["number"]?.inboxText ?? ""
      let title = event["title"]?.inboxText ?? ""
      let post = "\(number.isEmpty ? "" : "#\(number) ")\(title.isEmpty ? String(localized: "a post") : title)"
      return event["type"]?.inboxText == "feedback.linked" ? String(localized: "Linked to feedback post \(post)") : String(localized: "Unlinked from feedback post \(post)")
    default:
      return String(localized: "Ticket updated")
    }
  }
}

private struct InboxSourceTag { let text: String; let ai: Bool }

// MARK: - Composer

private struct InboxPickedImage: Identifiable {
  let id = UUID()
  let data: Data
  let thumbnail: PlatformImage
}

/// Linear's comment box: Reply / Internal note above a bordered card. Notes tint it amber.
private struct InboxComposer: View {
  let conversation: Conversation
  let replyTarget: InboxReplyTarget?
  @Binding var threadId: String
  @Environment(Workspace.self) private var workspace
  @State private var draft = ""
  @State private var note = false
  @State private var notify = false
  @State private var picks: [PhotosPickerItem] = []
  @State private var images: [InboxPickedImage] = []
  @State private var sending = false
  @State private var picking = false
  @State private var drafting = false
  @State private var draftNote = ""
  // Kept until a send succeeds, so retrying the same draft can't post it twice.
  @State private var clientId = InboxComposer.newClientId()
  @FocusState private var focused: Bool

  var body: some View {
    let store = workspace.inbox
    let email = store.endUsers[conversation.endUserId]?.email ?? ""
    let allowsImages = !note && (store.project?.allowAttachments ?? workspace.project(conversation.projectId)?.allowAttachments ?? true)
    VStack(alignment: .leading, spacing: 8) {
      if !store.threadError.isEmpty { ErrorText(message: store.threadError) }
      HStack(spacing: 6) {
        Pill(label: "Reply", systemImage: "arrowshape.turn.up.left", isActive: !note) { note = false }
        Pill(label: "Internal note", systemImage: "lock", isActive: note) { note = true }
      }
      if let replyTarget { banner(replyTarget) }
      if !note, !images.isEmpty { thumbnails }
      card(allowsImages: allowsImages)
      if !draftNote.isEmpty { Text(draftNote).font(.lnCaption).foregroundStyle(Theme.warning).padding(.horizontal, 4) }
      footer(email: email)
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
    .padding(.bottom, 12)
    .background(Theme.panel)
    .animation(.snappy(duration: 0.2), value: note)
    .onAppear { notify = !email.isEmpty }
    .onChange(of: email) { _, value in notify = !value.isEmpty }
    .onChange(of: threadId) { _, id in if !id.isEmpty { focused = true } }
    .sheet(isPresented: $picking) {
      InboxReplyPicker(conversationId: conversation.id, projectId: conversation.projectId, customerName: customerName(store)) { insert($0) }
        .environment(workspace)
    }
    .onChange(of: picks) { _, items in
      guard !items.isEmpty else { return }
      picks = []
      Task { await add(items) }
    }
  }

  private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var canSend: Bool { !sending && (note ? !trimmed.isEmpty : (!trimmed.isEmpty || !images.isEmpty)) }

  private func banner(_ target: InboxReplyTarget) -> some View {
    HStack(spacing: 6) {
      Image(systemName: "arrowshape.turn.up.left").font(.system(size: 11, weight: .semibold))
      Text("Replying to \(Text(target.name).fontWeight(.semibold).foregroundStyle(Theme.textHighlighted))\(target.preview.isEmpty ? "" : ", “\(target.preview)”")")
        .lineLimit(1)
      Spacer(minLength: 4)
      Button { withAnimation(.snappy) { threadId = "" } } label: {
        Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 22, height: 22).background(Theme.elevated, in: Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Stop replying")
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.textMuted)
    .padding(.horizontal, 4)
    .transition(.opacity)
  }

  private var thumbnails: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 10) {
        ForEach(images) { image in
          Image(platformImage: image.thumbnail)
            .resizable()
            .scaledToFill()
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous).strokeBorder(Theme.border))
            .overlay(alignment: .topTrailing) {
              Button { images.removeAll { $0.id == image.id } } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 18)).symbolRenderingMode(.palette).foregroundStyle(.white, Color.black.opacity(0.65))
              }
              .buttonStyle(.plain)
              .offset(x: 6, y: -6)
              .accessibilityLabel("Remove image")
            }
        }
      }
      .padding(.top, 6)
      .padding(.trailing, 6)
    }
  }

  private func card(allowsImages: Bool) -> some View {
    HStack(alignment: .bottom, spacing: 4) {
      if allowsImages {
        PhotosPicker(selection: $picks, maxSelectionCount: max(1, 4 - images.count), matching: .images) {
          Image(systemName: "photo").font(.system(size: 16)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Circle())
        }
        .disabled(images.count >= 4)
        .accessibilityLabel("Attach images")
      }
      Button { picking = true } label: {
        Image(systemName: "text.bubble").font(.system(size: 16)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Insert a saved reply or FAQ")
      Button { Task { await writeDraft() } } label: {
        ZStack {
          if drafting { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles").font(.system(size: 16)).foregroundStyle(Theme.textMuted) }
        }
        .frame(width: 32, height: 32)
        .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .disabled(note || drafting)
      .opacity(note ? 0.4 : 1)
      .accessibilityLabel("Draft a reply with AI")
      TextField(note ? "Add an internal note…" : replyTarget == nil ? "Reply to the customer…" : "Reply…", text: $draft, axis: .vertical)
        .font(.lnBody)
        .lineLimit(1...6)
        .focused($focused)
        .padding(.vertical, 6)
        .padding(.leading, allowsImages ? 0 : 8)
      Button(action: send) {
        ZStack {
          if sending { ProgressView().tint(.white).controlSize(.small) } else { Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold)) }
        }
        .foregroundStyle(.white)
        .frame(width: 32, height: 32)
        .background(Theme.accent, in: Circle())
        .opacity(canSend || sending ? 1 : 0.4)
        .scaleEffect(canSend || sending ? 1 : 0.9)
        .animation(.snappy(duration: 0.2), value: canSend)
      }
      .buttonStyle(.plain)
      .disabled(!canSend)
      .keyboardShortcut(.return, modifiers: .command)
      .accessibilityLabel(note ? "Add note" : "Send")
    }
    .padding(5)
    .background(note ? Theme.warning.opacity(0.06) : Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous).strokeBorder(note ? Theme.warning.opacity(0.45) : focused ? Theme.borderAccented : Theme.border))
  }

  @ViewBuilder
  private func footer(email: String) -> some View {
    if note {
      HStack(spacing: 6) {
        Image(systemName: "lock").foregroundStyle(Theme.warning)
        Text("Only your team sees internal notes.")
      }
      .font(.lnCaption)
      .foregroundStyle(Theme.textMuted)
      .padding(.horizontal, 4)
    } else {
      Toggle(isOn: $notify) {
        Text(email.isEmpty ? "Also email this customer" : "Also email \(email)").lineLimit(1)
      }
      .toggleStyle(InboxCheckToggleStyle())
      .disabled(email.isEmpty)
      .padding(.horizontal, 4)
    }
  }

  private func send() {
    guard canSend else { return }
    let store = workspace.inbox
    let body = trimmed, sentDraft = draft, sent = images, asNote = note, replyTo = threadId, id = clientId, email = notify
    sending = true
    Task {
      let ok: Bool
      if asNote {
        ok = await store.addNote(body)
      } else {
        ok = await store.reply(body: body, images: sent.map(\.data), replyToId: replyTo, notify: email, clientId: id)
      }
      sending = false
      guard ok else { return }
      if draft == sentDraft { draft = "" }
      images.removeAll { image in sent.contains { $0.id == image.id } }
      clientId = Self.newClientId()
      draftNote = ""
      if asNote { note = false }
    }
  }

  /// The saved reply or FAQ goes after what is already typed, never over it.
  private func insert(_ text: String) {
    let typed = draft.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
    draft = typed.isEmpty ? text : "\(typed)\n\n\(text)"
    focused = true
  }

  private func customerName(_ store: InboxStore) -> String {
    if store.selectedId == conversation.id, let name = store.context?.contact.name, !name.isEmpty { return name }
    return store.endUsers[conversation.endUserId]?.name ?? ""
  }

  /// An AI draft for the box, from the assistant's knowledge and the public thread. Nothing is sent.
  private func writeDraft() async {
    let store = workspace.inbox
    drafting = true
    draftNote = ""
    defer { drafting = false }
    do {
      let result = try await store.draftReply()
      insert(result.draft)
      if result.sources.isEmpty { draftNote = String(localized: "No FAQ matched this question, so check the facts.") }
    } catch {
      store.threadError = error.localizedDescription
    }
  }

  private func add(_ items: [PhotosPickerItem]) async {
    for item in items {
      guard images.count < 4 else { break }
      guard let raw = try? await item.loadTransferable(type: Data.self),
            let encoded = await Task.detached(priority: .userInitiated, operation: { InboxImageEncoding.encode(raw) }).value,
            let thumbnail = PlatformImage(data: encoded.thumbnail) else {
        workspace.inbox.threadError = String(localized: "Couldn't read that image.")
        continue
      }
      images.append(InboxPickedImage(data: encoded.file, thumbnail: thumbnail))
    }
  }

  private static func newClientId() -> String { "c_\(UUID().uuidString.lowercased())" }
}

/// A quiet check toggle for the composer's footer; a full switch outweighs the box.
private struct InboxCheckToggleStyle: ToggleStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    Button { configuration.isOn.toggle() } label: {
      HStack(spacing: 6) {
        Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 14))
          .foregroundStyle(configuration.isOn ? Theme.accent : Theme.textDimmed)
        configuration.label.font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      .opacity(isEnabled ? 1 : 0.5)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(.isToggle)
    .accessibilityValue(configuration.isOn ? "On" : "Off")
  }
}

/// Picked images ready to upload, plus a small thumbnail for the chip. PNG, GIF
/// and WebP under the server's 8 MB cap go up as they are, as on the web, so
/// animation and transparency survive; anything else (HEIC, or too big) becomes
/// a JPEG of at most 2048px. The server sniffs the type from the bytes.
private enum InboxImageEncoding {
  static let maxBytes = 8 * 1024 * 1024
  private static let keptAsIs: [[UInt8]] = [[0x89, 0x50, 0x4E, 0x47], [0x47, 0x49, 0x46], [0x52, 0x49, 0x46, 0x46]]

  static func encode(_ data: Data) -> (file: Data, thumbnail: Data)? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let thumbnail = jpeg(source, maxPixels: 168, quality: 0.7) else { return nil }
    if data.count <= maxBytes, keptAsIs.contains(where: { data.starts(with: $0) }) { return (data, thumbnail) }
    guard let full = jpeg(source, maxPixels: 2048, quality: 0.85) else { return nil }
    return (full, thumbnail)
  }

  private static func jpeg(_ source: CGImageSource, maxPixels: Int, quality: Double) -> Data? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? output as Data : nil
  }
}

// MARK: - Transcript model (shared/conversations.ts)

private struct InboxRun: Identifiable {
  let id: String
  let own: Bool
  let isEvent: Bool
  var messages: [Message]
}

private struct InboxGroup: Identifiable {
  let id: String
  let startedAt: String
  var runs: [InboxRun]

  /// A fresh stamp on a new day or after an hour's quiet; inside it, runs of
  /// one sender. Timeline events stand alone, centred.
  @MainActor
  static func build(_ messages: [Message]) -> [InboxGroup] {
    var groups: [InboxGroup] = []
    var previousAt: Date?
    for message in messages {
      let at = DateText.date(message.createdAt)
      var fresh = groups.isEmpty
      if let at, let previousAt { fresh = fresh || !Calendar.current.isDate(at, inSameDayAs: previousAt) || at.timeIntervalSince(previousAt) > 3600 }
      if fresh { groups.append(InboxGroup(id: "g-\(message.id)", startedAt: message.createdAt, runs: [])) }
      let event = message.kind == "event"
      let own = message.sender == "agent"
      let group = groups.count - 1
      if !event, let last = groups[group].runs.last, !last.isEvent, last.own == own {
        groups[group].runs[groups[group].runs.count - 1].messages.append(message)
      } else {
        groups[group].runs.append(InboxRun(id: "r-\(message.id)", own: own, isEvent: event, messages: [message]))
      }
      if let at { previousAt = at }
    }
    return groups
  }
}

/// One-level reply threads: replying to a reply joins the original's thread.
private struct InboxThreads {
  var byId: [String: Message] = [:]
  var rootOf: [String: String] = [:]
  var replies: [String: [Message]] = [:]
  /// Replies that quote their root because they don't follow it or its thread.
  var quote: [String: String] = [:]

  init(_ messages: [Message]) {
    for message in messages { byId[message.id] = message }
    for message in messages {
      // Bounded and stopped by a self-reference, so a malformed chain can't spin.
      var root = ""
      var next = message.replyToId
      var hops = 0
      while !next.isEmpty, next != message.id, hops < 8, let parent = byId[next] {
        root = next
        next = parent.replyToId
        hops += 1
      }
      guard !root.isEmpty else { continue }
      rootOf[message.id] = root
      replies[root, default: []].append(message)
    }
    var previous: Message?
    for message in messages {
      if let root = rootOf[message.id] {
        let adjacent = previous.map { $0.id == root || rootOf[$0.id] == root } ?? false
        if !adjacent { quote[message.id] = root }
      }
      previous = message
    }
  }

  func contains(_ id: String, in thread: String) -> Bool { id == thread || rootOf[id] == thread }
}

private struct InboxReactionGroup {
  let emoji: String
  var count: Int
  var mine: Bool
  var names: [String]
}

@MainActor
private enum InboxText {
  /// The six Messages tapbacks (shared/support.ts MESSAGE_REACTION_EMOJIS).
  static let tapbacks = ["❤️", "👍", "👎", "😆", "❗", "❓"]
  static let links = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

  /// An assistant's reply: the server stamps `supportAgentId` (older servers only gave an `ai-…` clientId).
  static func isAI(_ message: Message) -> Bool { message.supportAgentId?.isEmpty == false || message.clientId.hasPrefix("ai-") }

  static func preview(_ body: String, _ maxLength: Int) -> String {
    let flat = body.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return flat.count <= maxLength ? flat : String(flat.prefix(maxLength - 1)).trimmingCharacters(in: .whitespaces) + "…"
  }

  /// Message text with its http(s) links tappable and underlined.
  static func linkified(_ body: String) -> AttributedString {
    var text = AttributedString(body)
    guard let links else { return text }
    for match in links.matches(in: body, range: NSRange(body.startIndex..., in: body)) {
      guard let url = match.url, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let range = Range(match.range, in: text) else { continue }
      text[range].link = url
      text[range][AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute.self] = .single
    }
    return text
  }

  /// "Today" + "14:23", "Yesterday", a weekday within the week, else "16 May 2026".
  static func separator(_ raw: String) -> (day: String, time: String) {
    guard let date = DateText.date(raw) else { return ("", "") }
    let time = date.formatted(date: .omitted, time: .shortened)
    if Calendar.current.isDateInToday(date) { return (String(localized: "Today"), time) }
    if Calendar.current.isDateInYesterday(date) { return (String(localized: "Yesterday"), time) }
    if Date().timeIntervalSince(date) < 7 * 86_400 { return (date.formatted(.dateTime.weekday(.abbreviated)), time) }
    return (date.formatted(.dateTime.day().month(.abbreviated).year()), time)
  }

  /// Tapbacks collapsed per emoji, in the order they were first given.
  static func reactionGroups(_ reactions: [MessageReaction], mine actor: String) -> [InboxReactionGroup] {
    var groups: [InboxReactionGroup] = []
    for reaction in reactions {
      if let index = groups.firstIndex(where: { $0.emoji == reaction.emoji }) {
        groups[index].count += 1
        groups[index].mine = groups[index].mine || reaction.actor == actor
        if !reaction.actorName.isEmpty { groups[index].names.append(reaction.actorName) }
      } else {
        groups.append(InboxReactionGroup(emoji: reaction.emoji, count: 1, mine: reaction.actor == actor, names: reaction.actorName.isEmpty ? [] : [reaction.actorName]))
      }
    }
    return groups
  }
}
