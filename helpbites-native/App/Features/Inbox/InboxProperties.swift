import SwiftUI

// The properties column (components/inbox/ConversationContext.vue): status,
// priority and assignee as quiet rows that open a menu, labels as chips, the
// customer, the type's fields, what the ticket is about, and host actions.
// Every change is a PATCH /conversations/:id; actions POST /actions/:key.

struct InboxPropertiesPanel: View {
  let conversation: Conversation
  let compact: Bool
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var openContact: InboxOpenContact?

  var body: some View {
    if compact {
      NavigationStack {
        content
          .panelScreen("Details")
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      }
      .presentationDetents([.medium, .large])
    } else {
      content
    }
  }

  private var content: some View {
    let store = workspace.inbox
    let type = store.type(for: conversation)
    return ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        if !store.propertiesError.isEmpty { ErrorText(message: store.propertiesError).padding(.horizontal, 8) }
        section("Properties") {
          statusRow(store)
          priorityRow(store)
          assigneeRow(store)
        }
        section("Labels") { InboxLabels(tags: conversation.tags ?? []) }
        section("Customer") { customer(store) }
        // Only when the Stripe sync found this person.
        if let billing = hub(store)?.billing {
          section("Billing") { billingCard(billing) }
        }
        if let past = hub(store)?.pastConversations, !past.isEmpty {
          section("Past conversations") { ForEach(past) { pastRow($0, store: store) } }
        }
        if let type, !type.fields.isEmpty {
          section("\(type.name) fields") { InboxFieldEditors(fields: type.fields) }
        }
        section("Feedback") {
          FeedbackLinksSection(projectId: conversation.projectId, conversationId: conversation.id, title: conversation.subject, description: lastCustomerMessage(store))
        }
        if workspace.project(conversation.projectId)?.board != nil {
          section("Board") {
            BoardLinksSection(projectId: conversation.projectId, kind: "conversation", targetId: conversation.id, title: conversation.subject, description: lastCustomerMessage(store))
          }
        }
        section("Changelog") { InboxChangelogLinks(projectId: conversation.projectId, conversationId: conversation.id, type: conversation.type) }
        if let ref = conversation.subjectRef {
          section("About") { about(ref) }
        }
        InboxRecentErrors(conversation: conversation, externalId: store.endUsers[conversation.endUserId]?.externalId ?? "")
        if let type, !type.actions.isEmpty {
          section("Actions") { InboxActions(actions: type.actions) }
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 16)
    }
    .scrollDismissesKeyboard(.interactively)
    .background(Theme.panel)
    .sheet(item: $openContact) { ContactSheetByID(projectId: conversation.projectId, contactId: $0.id).environment(workspace).environment(workspace.session) }
  }

  /// The customer panel's read, once it is for this conversation.
  private func hub(_ store: InboxStore) -> ConversationHubContext? {
    store.selectedId == conversation.id ? store.context : nil
  }

  /// What a board item filed from here starts with: the customer's latest words.
  private func lastCustomerMessage(_ store: InboxStore) -> String {
    guard store.selectedId == conversation.id else { return "" }
    return store.messages.last { $0.sender == "user" && $0.kind != "event" && !$0.body.isEmpty }?.body ?? ""
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      SectionLabel(title).padding(.horizontal, 8).padding(.bottom, 2)
      content()
    }
  }

  // MARK: Properties

  private func statusRow(_ store: InboxStore) -> some View {
    let statuses = store.statuses(for: conversation)
    let current = statuses.first { $0.key == conversation.status }
    return Menu {
      Picker("Status", selection: Binding(get: { conversation.status }, set: { key in Task { await store.triage(InboxTriage(status: key)) } })) {
        ForEach(statuses) { status in Label(status.label, systemImage: InboxGlyph.status(status.category)).tag(status.key) }
      }
      .pickerStyle(.inline)
    } label: {
      InboxPropertyRow(label: "Status", value: current?.label ?? conversation.status.capitalized) {
        StatusIcon(category: current?.category ?? conversation.statusCategory ?? "open")
      }
    }
  }

  private func priorityRow(_ store: InboxStore) -> some View {
    let priority = conversation.priority ?? "normal"
    return Menu {
      Picker("Priority", selection: Binding(get: { priority }, set: { value in Task { await store.triage(InboxTriage(priority: value)) } })) {
        ForEach(InboxPriority.all, id: \.self) { Text($0.capitalized).tag($0) }
      }
      .pickerStyle(.inline)
    } label: {
      InboxPropertyRow(label: "Priority", value: priority.capitalized) { PriorityIcon(priority: priority) }
    }
  }

  private func assigneeRow(_ store: InboxStore) -> some View {
    let assigneeId = conversation.assigneeId ?? ""
    let assignee = store.agents.first { $0.id == assigneeId }
    return Menu {
      Picker("Assignee", selection: Binding(get: { assigneeId }, set: { id in Task { await store.triage(InboxTriage(assigneeId: id)) } })) {
        Label("Unassigned", systemImage: "person.crop.circle.dashed").tag("")
        ForEach(store.agents) { agent in Text(agent.inboxName).tag(agent.id) }
      }
      .pickerStyle(.inline)
    } label: {
      InboxPropertyRow(label: "Assignee", value: assignee?.inboxName ?? (assigneeId.isEmpty ? "Unassigned" : "Assigned")) {
        if let assignee {
          Avatar(name: assignee.inboxName, size: 16)
        } else {
          Image(systemName: "person.crop.circle").font(.system(size: 14)).foregroundStyle(Theme.textDimmed)
        }
      }
    }
  }

  // MARK: Customer and subject

  private func customer(_ store: InboxStore) -> some View {
    let user = store.endUsers[conversation.endUserId]
    let project = workspace.project(conversation.projectId)
    let name = user?.inboxName ?? "Unknown customer"
    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        Avatar(name: name, size: 28)
        VStack(alignment: .leading, spacing: 1) {
          Text(name).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          if let user, !user.email.isEmpty, !user.name.isEmpty {
            Text(user.email).font(.lnMeta).foregroundStyle(Theme.textMuted).textSelection(.enabled)
          }
        }
        .lineLimit(1)
      }
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
        GridRow {
          Text("Project").foregroundStyle(Theme.textMuted)
          HStack(spacing: 6) {
            ProjectDot(id: conversation.projectId, accent: project?.theme.accent, icon: project?.iconUrl)
            Text(project?.name ?? "Unknown").foregroundStyle(Theme.text).lineLimit(1)
          }
        }
        if let user, !user.externalId.isEmpty {
          GridRow {
            Text("ID").foregroundStyle(Theme.textMuted)
            Text(user.externalId).font(.lnMono).foregroundStyle(Theme.textToned).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
          }
        }
      }
      .font(.lnMeta)
      if let contact = hub(store)?.contact {
        Button { openContact = InboxOpenContact(id: contact.id) } label: {
          HStack(spacing: 8) {
            Image(systemName: "person.crop.circle").font(.system(size: 13)).foregroundStyle(Theme.textMuted)
            Text("Open contact").foregroundStyle(Theme.text)
            Spacer(minLength: 0)
            Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
          }
          .font(.lnMeta)
          .frame(height: 32)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 8)
  }

  /// Plan, what they pay a month and where the subscription stands (web: the billing card in ConversationContext.vue).
  private func billingCard(_ billing: HubBilling) -> some View {
    let mrr = billing.currency.isEmpty ? billing.mrr.formatted() : Money.format(billing.mrr, billing.currency)
    return VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(billing.plan.isEmpty ? "No plan" : billing.plan).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Spacer(minLength: 0)
        if billing.status != "none" { Tag(text: billing.status.replacingOccurrences(of: "_", with: " ").capitalized) }
      }
      HStack {
        Text("MRR").foregroundStyle(Theme.textMuted)
        Spacer(minLength: 0)
        Text(mrr).monospacedDigit().foregroundStyle(Theme.text)
      }
      .font(.lnMeta)
    }
    .padding(10)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous).strokeBorder(Theme.border))
    .padding(.horizontal, 8)
  }

  private func pastRow(_ past: HubPastConversation, store: InboxStore) -> some View {
    Button {
      Task { await store.select(past.id) }
      if compact { dismiss() }
    } label: {
      HStack(spacing: 8) {
        StatusIcon(category: past.statusCategory)
        Text(past.subject.isEmpty ? (past.lastMessagePreview.isEmpty ? "Conversation" : past.lastMessagePreview) : past.subject).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
        Spacer(minLength: 0)
        Text(DateText.short(past.lastMessageAt ?? past.createdAt)).font(.lnCaption).foregroundStyle(Theme.textDimmed)
      }
      .padding(.horizontal, 8)
      .frame(height: 32)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  @ViewBuilder
  private func about(_ ref: SubjectRef) -> some View {
    let row = HStack(spacing: 8) {
      if let thumb = ref.thumbnailUrl, !thumb.isEmpty, let url = URL(string: thumb) {
        CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
          .frame(width: 24, height: 24)
          .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border))
      } else {
        Image(systemName: "link").font(.system(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 24)
      }
      Text(ref.label).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 0)
      if ref.url?.isEmpty == false {
        Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
    }
    .padding(.horizontal, 8)
    .frame(height: 36)
    .contentShape(Rectangle())
    if let raw = ref.url, let url = URL(string: raw) { Link(destination: url) { row } } else { row }
  }
}

private struct InboxOpenContact: Identifiable { let id: String }

/// The customer's latest errors from the project's tracker, matched by the
/// Sentry user id the host app sets to the same identity id. Hidden when the
/// tracker isn't connected or the conversation is the tracker's own alert.
private struct InboxRecentErrors: View {
  let conversation: Conversation
  let externalId: String
  @Environment(Workspace.self) private var workspace
  @Environment(\.openURL) private var openURL
  @State private var issues: [ErrorIssue] = []

  private var connected: Bool { workspace.project(conversation.projectId)?.errors?.connected == true }

  var body: some View {
    Group {
      if !issues.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          SectionLabel("Recent errors").padding(.horizontal, 8).padding(.bottom, 2)
          ForEach(issues) { issue in
            Button { open(issue) } label: {
              HStack(spacing: 8) {
                Image(systemName: "ladybug").font(.system(size: 12)).foregroundStyle(Theme.error)
                Text(issue.title).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
              }
              .padding(.horizontal, 8)
              .frame(height: 32)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
    .task(id: "\(conversation.projectId)|\(externalId)|\(connected)") { await load() }
  }

  private func open(_ issue: ErrorIssue) {
    if let id = issue.conversationId, !id.isEmpty {
      Task { await workspace.inbox.select(id) }
    } else if let raw = issue.url, let url = URL(string: raw) {
      openURL(url)
    }
  }

  private func load() async {
    guard connected, !externalId.isEmpty, !["glitchtip-alerts", "bugsink-alerts"].contains(externalId) else { issues = []; return }
    do {
      let page: ErrorIssuePage = try await workspace.session.get("/v1/admin/errors", query: ["project": conversation.projectId, "user": externalId, "limit": "5"])
      issues = page.issues
    } catch { issues = [] }
  }
}

/// A property row: the value reads as plain text, the glyph says what it is.
private struct InboxPropertyRow<Icon: View>: View {
  let label: String
  let value: String
  @ViewBuilder let icon: () -> Icon

  var body: some View {
    HStack(spacing: 10) {
      icon().frame(width: 16, height: 16)
      Text(value).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 0)
      Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.textDimmed)
    }
    .padding(.horizontal, 8)
    .frame(height: 32)
    .contentShape(Rectangle())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(label): \(value)")
  }
}

// MARK: - Labels

private struct InboxLabels: View {
  let tags: [String]
  @Environment(Workspace.self) private var workspace
  @State private var draft = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !tags.isEmpty {
        FlowLayout(spacing: 6) {
          ForEach(tags, id: \.self) { tag in
            HStack(spacing: 4) {
              Text(tag).lineLimit(1)
              Button { save(tags.filter { $0 != tag }) } label: {
                Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).frame(width: 14, height: 14).contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Remove \(tag)")
            }
            .font(.lnCaptionMedium)
            .foregroundStyle(Theme.textToned)
            .padding(.leading, 9)
            .padding(.trailing, 5)
            .frame(height: 24)
            .overlay(Capsule().strokeBorder(Theme.border))
          }
        }
        .padding(.horizontal, 8)
      }
      HStack(spacing: 10) {
        Image(systemName: "tag").font(.system(size: 12)).foregroundStyle(Theme.textDimmed).frame(width: 16)
        TextField("Add label", text: $draft)
          .font(.lnMeta)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.done)
          .onSubmit(add)
      }
      .padding(.horizontal, 8)
      .frame(height: 32)
    }
  }

  /// Lowercased, trimmed to 40, deduped, at most 20 — what the server keeps anyway.
  private func add() {
    let new = draft.split(separator: ",").map { String($0.trimmingCharacters(in: .whitespaces).lowercased().prefix(40)) }.filter { !$0.isEmpty }
    draft = ""
    let next = (tags + new).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
    guard next != tags else { return }
    save(Array(next.prefix(20)))
  }

  private func save(_ tags: [String]) {
    let store = workspace.inbox
    Task { await store.triage(InboxTriage(tags: tags)) }
  }
}

// MARK: - Type fields

/// One editor per field type. Toggles and menus save at once; text saves when
/// you leave the field or press return, sending only that key (the server merges).
private struct InboxFieldEditors: View {
  let fields: [ConversationField]
  @Environment(Workspace.self) private var workspace
  @State private var drafts: [String: String] = [:]
  @FocusState private var focus: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(fields) { field in editor(field) }
    }
    .padding(.horizontal, 8)
    .onChange(of: focus) { previous, _ in if let previous { commit(previous) } }
    .onDisappear { for key in drafts.keys { commit(key) } }
  }

  @ViewBuilder
  private func editor(_ field: ConversationField) -> some View {
    let label = (field.label.isEmpty ? field.key : field.label) + (field.required == true ? " *" : "")
    let locked = field.editableBy == "none"
    switch field.type {
    case "bool":
      Toggle(isOn: Binding(get: { workspace.inbox.fields[field.key]?.inboxBool ?? false }, set: { save(field.key, .bool($0)) })) {
        Text(label).font(.lnMeta).foregroundStyle(Theme.text)
      }
      .tint(Theme.accent)
      .disabled(locked)
    case "select":
      let current = text(field.key)
      LabeledField(label: label) {
        Menu {
          Picker(label, selection: Binding(get: { current }, set: { save(field.key, .string($0)) })) {
            Text("None").tag("")
            ForEach(field.options ?? [], id: \.self) { Text($0).tag($0) }
          }
          .pickerStyle(.inline)
        } label: {
          InboxFieldBox { Text(current.isEmpty ? "None" : current).foregroundStyle(current.isEmpty ? Theme.textDimmed : Theme.text) }
        }
        .disabled(locked)
      }
    default:
      LabeledField(label: label) {
        TextField(field.type == "url" ? "https://" : "", text: Binding(get: { drafts[field.key] ?? text(field.key) }, set: { drafts[field.key] = $0 }), axis: field.type == "longtext" ? .vertical : .horizontal)
          .lineLimit(field.type == "longtext" ? 3...8 : 1...1)
          .textFieldStyle(.linear)
          .keyboardType(field.type == "number" ? .decimalPad : field.type == "url" ? .URL : .default)
          .textInputAutocapitalization(field.type == "url" ? .never : .sentences)
          .autocorrectionDisabled(field.type == "url" || field.type == "number")
          .focused($focus, equals: field.key)
          .onSubmit { commit(field.key) }
          .disabled(locked)
      }
    }
  }

  private func text(_ key: String) -> String { workspace.inbox.fields[key]?.inboxText ?? "" }

  private func commit(_ key: String) {
    guard let draft = drafts.removeValue(forKey: key) else { return }
    let value = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value != text(key) else { return }
    save(key, .string(value))
  }

  private func save(_ key: String, _ value: JSONValue) {
    let store = workspace.inbox
    Task { await store.triage(InboxTriage(fields: [key: value])) }
  }
}

// MARK: - Host actions

/// The type's host actions: confirm text first, a required internal note via a
/// prompt, destructive ones in red. The webhook's verdict lands on the timeline.
private struct InboxActions: View {
  let actions: [ConversationAction]
  @Environment(Workspace.self) private var workspace
  @State private var confirming: ConversationAction?
  @State private var noting: ConversationAction?
  @State private var note = ""
  @State private var running = ""

  var body: some View {
    FlowLayout(spacing: 6) {
      ForEach(actions) { action in
        Button { start(action) } label: {
          HStack(spacing: 6) {
            if running == action.key { ProgressView().controlSize(.mini) }
            Text(title(action))
          }
        }
        .buttonStyle(InboxActionStyle(destructive: action.destructive == true))
        .disabled(!running.isEmpty)
      }
    }
    .padding(.horizontal, 8)
    .confirmationDialog(confirming?.confirm ?? "", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible, presenting: confirming) { action in
      Button(title(action), role: action.destructive == true ? .destructive : nil) { run(action, note: "") }
    }
    .alert(noting.map(title) ?? "Action", isPresented: Binding(get: { noting != nil }, set: { if !$0 { noting = nil } }), presenting: noting) { action in
      TextField("Internal note", text: $note)
      Button("Cancel", role: .cancel) {}
      Button(title(action), role: action.destructive == true ? .destructive : nil) { run(action, note: note.trimmingCharacters(in: .whitespacesAndNewlines)) }
    } message: { action in
      Text(action.confirm?.isEmpty == false ? action.confirm ?? "" : "This action needs an internal note for your team.")
    }
  }

  private func title(_ action: ConversationAction) -> String { action.label.isEmpty ? action.key : action.label }

  private func start(_ action: ConversationAction) {
    if action.requiresNote == true {
      note = ""
      noting = action
    } else if let confirm = action.confirm, !confirm.isEmpty {
      confirming = action
    } else {
      run(action, note: "")
    }
  }

  private func run(_ action: ConversationAction, note: String) {
    let store = workspace.inbox
    running = action.key
    Task {
      await store.runAction(action, note: note)
      running = ""
    }
  }
}

private struct InboxActionStyle: ButtonStyle {
  let destructive: Bool
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.lnMetaMedium)
      .foregroundStyle(destructive ? Theme.error : Theme.text)
      .padding(.horizontal, 12)
      .frame(minHeight: 30)
      .background(destructive ? Theme.error.opacity(configuration.isPressed ? 0.18 : 0.1) : configuration.isPressed ? Theme.elevated : Color.clear, in: Capsule())
      .overlay { if !destructive { Capsule().strokeBorder(Theme.border) } }
      .opacity(isEnabled ? 1 : 0.5)
      .contentShape(Capsule())
  }
}
