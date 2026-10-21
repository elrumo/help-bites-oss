import SwiftUI

/// One person (web: components/contacts/ContactDrawer.vue): marketing consent
/// and its proof, how they got here, name, tags and attributes, and erasing them.
struct ContactDetailSheet: View {
  let projectId: String
  @State var contact: Contact
  /// The saved contact, or nil once it is erased.
  var onChange: (Contact?) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var tags = ""
  @State private var attributes: [(key: String, value: String)] = []
  @State private var saving = false
  @State private var error = ""
  @State private var confirmResubscribe = false
  @State private var confirmErase = false
  @State private var conversations: [Conversation] = []
  /// Lead forms and syncs by id, for "Added via" and "Lead forms".
  @State private var names: [String: String] = [:]
  @State private var emails: [EmailLogEntry] = []

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Marketing email", selection: Binding(get: { contact.subscription }, set: { value in
            if contact.subscription == "unsubscribed" && value == "subscribed" { confirmResubscribe = true } else { Task { await save(subscription: value) } }
          })) {
            ForEach(SubscriptionStatus.allCases.filter { $0 != .pending || contact.subscription == "pending" }) { Text($0.label).tag($0.rawValue) }
          }
          if let consent = contact.consent {
            Text("Opted in via \(consentSource(consent.source)) on \(DateText.day(consent.at))\(consent.confirmedAt.map { ", confirmed \(DateText.day($0))" } ?? "")")
              .font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          if !contact.unsubscribedTopics.isEmpty {
            Text("Opted out of \(contact.unsubscribedTopics.joined(separator: ", "))").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        } footer: { Text(SubscriptionStatus.of(contact.subscription).hint) }

        Section("Profile") {
          TextField("Name", text: $name)
          TextField("Tags, comma-separated", text: $tags)
        }

        Section {
          ForEach(attributes.indices, id: \.self) { i in
            HStack {
              TextField("key", text: Binding(get: { attributes[i].key }, set: { attributes[i].key = $0 })).font(.lnMono).frame(maxWidth: 120)
              TextField("value", text: Binding(get: { attributes[i].value }, set: { attributes[i].value = $0 }))
            }
          }
          .onDelete { attributes.remove(atOffsets: $0) }
          Button { attributes.append((key: "", value: "")) } label: { Label("Attribute", systemImage: "plus") }
        } header: { Text("Attributes") } footer: { Text("Synced columns and your own values. Numbers stay numbers.") }

        Section {
          LabeledContent("Email", value: contact.email.isEmpty ? "—" : contact.email)
          LabeledContent("User id", value: contact.externalId.isEmpty ? "—" : contact.externalId)
          LabeledContent("Added", value: DateText.day(contact.createdAt))
          if contact.origin != nil {
            LabeledContent("Added via", value: ContactOriginKind.label(contact.origin, names: names))
          }
          if let forms = contact.leadForms, !forms.isEmpty {
            LabeledContent("Lead forms", value: forms.map { names[$0] ?? "A deleted form" }.joined(separator: ", "))
          }
          LabeledContent("Last seen", value: contact.lastSeenAt.map { DateText.day($0) } ?? "—")
        }

        Section("Conversations") {
          if conversations.isEmpty { Text("None yet.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
          ForEach(conversations) { conversation in
            Button {
              workspace.go(.inbox)
              Task { await workspace.inbox.select(conversation.id) }
              dismiss()
            } label: {
              HStack {
                Text(conversation.subject.isEmpty ? (conversation.lastMessagePreview.isEmpty ? "Conversation" : conversation.lastMessagePreview) : conversation.subject).lineLimit(1)
                Spacer(minLength: 8)
                Tag(text: conversation.status.capitalized)
                Text(DateText.short(conversation.lastMessageAt ?? conversation.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }

        if !contact.email.isEmpty {
          Section("Email") {
            if emails.isEmpty { Text("Nothing sent yet.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
            ForEach(emails) { entry in
              HStack {
                Text(entry.subject ?? "").lineLimit(1)
                Spacer(minLength: 8)
                Text(EmailStatusText.style(entry.status ?? "").label).font(.lnCaption).foregroundStyle(Theme.textMuted)
                Text(DateText.short(entry.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
            }
          }
        }

        Section("Billing") {
          ContactBillingSection(projectId: projectId, contactId: contact.id, revenue: contact.attributes["stripe_revenue"].flatMap { if case .number(let value) = $0 { value } else { nil } }, customerId: contact.attributes["stripe_customer"].flatMap { if case .string(let value) = $0 { value } else { nil } })
        }

        Section {
          ErrorText(message: error)
          Button("Erase this person", role: .destructive) { confirmErase = true }
        }
      }
      .navigationTitle(contact.displayName)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving) }
      }
      .confirmationDialog("They unsubscribed. Only subscribe them again if they asked you to.", isPresented: $confirmResubscribe, titleVisibility: .visible) {
        Button("Subscribe again") { Task { await save(subscription: "subscribed", resubscribe: true) } }
      }
      .confirmationDialog("Erase \(contact.displayName)? Their conversations, feedback and email history go too.", isPresented: $confirmErase, titleVisibility: .visible) {
        Button("Erase", role: .destructive) { Task { await erase() } }
      }
    }
    .task { names = await ContactOriginNames.load(projectId, session: session) }
    .task {
      // Their conversations (open one in the inbox) and the email we sent them.
      if let result: InboxResponse = try? await session.get("/v1/admin/conversations", query: ["project": projectId, "endUser": contact.id, "limit": "20"]) { conversations = result.conversations }
      if !contact.email.isEmpty {
        struct Logs: Decodable, Sendable { let logs: [EmailLogEntry] }
        if let result: Logs = try? await session.get("/v1/admin/email-logs", query: ["project": projectId, "to": contact.email, "limit": "20"]) { emails = result.logs.filter { $0.to == contact.email } }
      }
    }
    .onAppear {
      name = contact.name
      tags = contact.tags.joined(separator: ", ")
      attributes = contact.attributes.sorted { $0.key < $1.key }.map { (key: $0.key, value: $0.value.display) }
    }
  }

  /// A value typed back in, in the type it was stored as.
  private func typed(_ value: String, _ before: JSONValue?) -> JSONValue {
    if case .number = before, let number = Double(value) { return .number(number) }
    if case .bool = before, value == "true" || value == "false" { return .bool(value == "true") }
    return .string(value)
  }

  /// Consent records the writer (form, import, a source id…): said the way origins are.
  private func consentSource(_ source: String) -> String {
    if let name = names[source] { return name }
    let via = ["form": "signup", "lead_form": "lead_form", "import": "import", "panel": "panel", "sync": "sync", "stripe": "stripe"][source] ?? (source.count == 10 ? "sync" : "api")
    return ContactOriginKind(rawValue: via)?.label ?? source
  }

  private func save(subscription: String? = nil, resubscribe: Bool = false) async {
    struct Input: Encodable, Sendable {
      let project: String
      let name: String?, tags: [String]?, attributes: [String: JSONValue]?, subscription: String?, resubscribe: Bool?
    }
    struct Output: Decodable, Sendable { let contact: Contact }
    saving = true
    defer { saving = false }
    var changes: [String: JSONValue]?
    if subscription == nil {
      var next: [String: JSONValue] = [:]
      for (key, value) in attributes where !key.trimmingCharacters(in: .whitespaces).isEmpty { next[key.trimmingCharacters(in: .whitespaces)] = typed(value, contact.attributes[key]) }
      for key in contact.attributes.keys where next[key] == nil { next[key] = .null }
      changes = next
    }
    let input = subscription == nil
      ? Input(project: projectId, name: name, tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }, attributes: changes, subscription: nil, resubscribe: nil)
      : Input(project: projectId, name: nil, tags: nil, attributes: nil, subscription: subscription, resubscribe: resubscribe ? true : nil)
    do {
      let output: Output = try await session.send("/v1/contacts/\(contact.id)", method: "PATCH", body: input)
      contact = output.contact
      onChange(output.contact)
      error = ""
    } catch { self.error = error.localizedDescription }
  }

  private func erase() async {
    do {
      try await session.delete("/v1/contacts/\(contact.id)?project=\(projectId)")
      onChange(nil)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
