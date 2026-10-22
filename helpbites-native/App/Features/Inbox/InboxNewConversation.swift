import SwiftUI

// Start a conversation as the team (components/NewChatModal.vue), plus the
// ticket type and its intake fields. Opened by the inbox's compose button and
// File › New Conversation, ⌘N (workspace.composeOpen).

struct InboxNewConversationSheet: View {
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var projectId = ""
  @State private var query = ""
  @State private var picked = ""
  @State private var results: [EndUser] = []
  @State private var externalId = ""
  @State private var name = ""
  @State private var email = ""
  @State private var subject = ""
  @State private var typeKey = "support"
  @State private var fieldText: [String: String] = [:]
  @State private var fieldFlags: [String: Bool] = [:]
  @State private var message = ""
  @State private var notify = true
  @State private var sending = false
  @State private var error = ""

  var body: some View {
    let types = workspace.inbox.typesByProject[projectId] ?? []
    let type = types.first { $0.key == typeKey }
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Write to any user of a project. If they have never opened the chat, paste their id from your app and the conversation will be waiting for them.")
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)
          LabeledField(label: "Project") { projectMenu }
          LabeledField(label: "Who", hint: "Search known users, or type an id") {
            TextField("Name, email or user id", text: $query)
              .textFieldStyle(.linear)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            if !results.isEmpty { matches }
          }
          HStack(alignment: .top, spacing: 12) {
            LabeledField(label: "Name", hint: "Optional") { TextField("", text: $name).textFieldStyle(.linear) }
            LabeledField(label: "Email", hint: "Optional") {
              TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
          }
          LabeledField(label: "Subject", hint: "Optional") { TextField("", text: $subject).textFieldStyle(.linear) }
          if types.count > 1 {
            LabeledField(label: "Ticket type", hint: type?.description.isEmpty == false ? type?.description : nil) { typeMenu(types) }
          }
          if let type {
            ForEach(type.fields.filter { $0.editableBy != "none" }) { field in intake(field) }
          }
          LabeledField(label: "Message") { LinearTextEditor(text: $message, placeholder: String(localized: "Write the first message…"), minHeight: 120) }
          Toggle(isOn: $notify) { Text("Also send by email").font(.lnCallout).foregroundStyle(Theme.text) }
            .tint(Theme.accent)
          if !error.isEmpty { ErrorText(message: error) }
        }
        .padding(20)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("New conversation")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if sending { ProgressView() } else { Button("Send", action: submit).disabled(!canSend) }
        }
      }
    }
    .task(id: workspace.projects.first?.id) {
      if projectId.isEmpty { projectId = workspace.inbox.projectFilter.isEmpty ? workspace.projects.first?.id ?? "" : workspace.inbox.projectFilter }
    }
    .task(id: projectId) {
      let store = workspace.inbox
      await store.loadTypes(projectId)
      let types = store.typesByProject[projectId] ?? []
      if !types.contains(where: { $0.key == typeKey }) { typeKey = types.first { $0.key == "support" }?.key ?? types.first?.key ?? "support" }
    }
    // Typing fills the id; known users are looked up as you type.
    .task(id: query) {
      let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
      externalId = term
      guard !term.isEmpty, term != picked, !projectId.isEmpty else { results = []; return }
      try? await Task.sleep(for: .milliseconds(200))
      guard !Task.isCancelled else { return }
      struct Hits: Decodable, Sendable { let endUsers: [EndUser] }
      let hits: Hits? = try? await workspace.session.get("/v1/admin/end-users", query: ["project": projectId, "q": term])
      guard !Task.isCancelled else { return }
      results = hits?.endUsers ?? []
    }
  }

  private var canSend: Bool {
    !sending && !projectId.isEmpty && !externalId.isEmpty && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var projectMenu: some View {
    let project = workspace.project(projectId)
    return Menu {
      Picker("Project", selection: $projectId) {
        ForEach(workspace.projects) { Text($0.name).tag($0.id) }
      }
      .pickerStyle(.inline)
    } label: {
      InboxFieldBox {
        if let project {
          HStack(spacing: 8) {
            ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl)
            Text(project.name)
          }
        } else {
          Text(workspace.projects.isEmpty ? "No projects yet" : "Choose a project").foregroundStyle(Theme.textDimmed)
        }
      }
    }
    .disabled(workspace.projects.isEmpty)
  }

  private var matches: some View {
    VStack(spacing: 0) {
      ForEach(results.prefix(8)) { user in
        Button { pick(user) } label: {
          HStack(spacing: 10) {
            Avatar(name: user.inboxName, size: 24)
            Text(user.name.isEmpty ? user.externalId : user.name).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
            Text(user.email.isEmpty ? user.externalId : user.email).font(.lnCaption).foregroundStyle(Theme.textMuted)
            Spacer(minLength: 0)
          }
          .lineLimit(1)
          .padding(.horizontal, 12)
          .frame(height: 40)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        if user.id != results.prefix(8).last?.id { Rectangle().fill(Theme.border).frame(height: 1).padding(.leading, 46) }
      }
    }
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private func typeMenu(_ types: [ConversationType]) -> some View {
    Menu {
      Picker("Ticket type", selection: $typeKey) {
        ForEach(types) { Text($0.name).tag($0.key) }
      }
      .pickerStyle(.inline)
    } label: {
      InboxFieldBox { Text(types.first { $0.key == typeKey }?.name ?? typeKey.capitalized) }
    }
  }

  @ViewBuilder
  private func intake(_ field: ConversationField) -> some View {
    let label = (field.label.isEmpty ? field.key : field.label) + (field.required == true ? " *" : "")
    switch field.type {
    case "bool":
      Toggle(isOn: Binding(get: { fieldFlags[field.key] ?? false }, set: { fieldFlags[field.key] = $0 })) {
        Text(label).font(.lnCallout).foregroundStyle(Theme.text)
      }
      .tint(Theme.accent)
    case "select":
      let current = fieldText[field.key] ?? ""
      LabeledField(label: label) {
        Menu {
          Picker(label, selection: Binding(get: { current }, set: { fieldText[field.key] = $0 })) {
            Text("None").tag("")
            ForEach(field.options ?? [], id: \.self) { Text($0).tag($0) }
          }
          .pickerStyle(.inline)
        } label: {
          InboxFieldBox { Text(current.isEmpty ? String(localized: "None") : current).foregroundStyle(current.isEmpty ? Theme.textDimmed : Theme.text) }
        }
      }
    default:
      LabeledField(label: label) {
        TextField(field.type == "url" ? "https://" : "", text: Binding(get: { fieldText[field.key] ?? "" }, set: { fieldText[field.key] = $0 }), axis: field.type == "longtext" ? .vertical : .horizontal)
          .lineLimit(field.type == "longtext" ? 3...8 : 1...1)
          .textFieldStyle(.linear)
          .keyboardType(field.type == "number" ? .decimalPad : field.type == "url" ? .URL : .default)
          .textInputAutocapitalization(field.type == "url" ? .never : .sentences)
          .autocorrectionDisabled(field.type == "url" || field.type == "number")
      }
    }
  }

  private func pick(_ user: EndUser) {
    picked = user.externalId
    query = user.externalId
    externalId = user.externalId
    name = user.name
    email = user.email
    results = []
  }

  private func submit() {
    let store = workspace.inbox
    let keys = Set((store.typesByProject[projectId] ?? []).first { $0.key == typeKey }?.fields.map(\.key) ?? [])
    var fields: [String: JSONValue] = [:]
    for (key, value) in fieldText where keys.contains(key) {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { fields[key] = .string(trimmed) }
    }
    for (key, value) in fieldFlags where keys.contains(key) { fields[key] = .bool(value) }
    let input = InboxStartInput(
      projectId: projectId,
      externalId: externalId,
      name: name.trimmingCharacters(in: .whitespacesAndNewlines),
      email: email.trimmingCharacters(in: .whitespacesAndNewlines),
      subject: subject.trimmingCharacters(in: .whitespacesAndNewlines),
      body: message.trimmingCharacters(in: .whitespacesAndNewlines),
      type: typeKey,
      fields: fields,
      notifyByEmail: notify
    )
    sending = true
    error = ""
    Task {
      do {
        let id = try await store.createConversation(input)
        dismiss()
        await store.refresh()
        await store.select(id)
      } catch {
        self.error = error.localizedDescription
        sending = false
      }
    }
  }
}
