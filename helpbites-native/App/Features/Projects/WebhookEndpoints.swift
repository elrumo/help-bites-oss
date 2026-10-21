import SwiftUI

/// The events a webhook endpoint can choose from. Mirrors DOMAIN_EVENTS in shared/domainEvents.ts
/// (tests/webhookNativeParity.test.ts keeps the two in step).
enum DomainEventCatalog {
  struct Group: Identifiable { let key, label: String; let events: [(type: String, label: String)]; var id: String { key } }

  static let groups: [Group] = [
    Group(key: "contact", label: "Contacts", events: [("contact.created", "Contact created"), ("contact.subscription_changed", "Subscription changed")]),
    Group(key: "conversation", label: "Conversations", events: [
      ("conversation.created", "Conversation started"), ("conversation.status_changed", "Conversation status changed"), ("conversation.feedback_linked", "Conversation linked to a post")
    ]),
    Group(key: "feedback", label: "Feedback", events: [
      ("feedback.post.created", "Feedback post created"), ("feedback.post.status_changed", "Feedback status changed"), ("feedback.post.voted", "Feedback vote")
    ]),
    Group(key: "board", label: "Board", events: [("board.item.created", "Board item created"), ("board.item.status_changed", "Board item status changed")]),
    Group(key: "changelog", label: "Changelog", events: [("changelog.entry.published", "Changelog entry published")]),
    Group(key: "errors", label: "Errors", events: [("errors.filed_on_board", "Error filed on the board")]),
    Group(key: "github", label: "GitHub", events: [("github.commit.referenced", "Commit references an item"), ("github.pull_request.merged", "Pull request merged")]),
    Group(key: "email", label: "Email", events: [("email.suppressed", "Address suppressed")]),
    Group(key: "cms", label: "Pages", events: [("cms.entry.published", "Page published"), ("cms.entry.unpublished", "Page unpublished")]),
    Group(key: "onboarding", label: "Onboarding", events: [("onboarding.completed", "Onboarding finished")])
  ]
}

struct WebhookEndpoint: Decodable, Identifiable, Equatable, Sendable {
  let id, url: String
  let description: String
  let events: [String]
  let enabled: Bool
  let secret: String?
  let lastStatus: String?
  var statusText: String {
    if !enabled { return "Switched off" }
    switch lastStatus { case "failed": return "Last delivery failed"; case "delivered": return "Last delivery worked"; default: return "No deliveries yet" }
  }
}

private struct WebhookDelivery: Decodable, Identifiable, Sendable {
  let id, type, status, lastError: String
  let createdAt: String?
}

/// Developer → Webhook endpoints (web: components/settings/WebhookEndpoints.vue).
struct WebhookEndpointsSection: View {
  let projectId: String
  @Environment(SessionStore.self) private var session

  @State private var endpoints: [WebhookEndpoint] = []
  @State private var deliveries: [WebhookDelivery] = []
  @State private var loading = true
  @State private var editing: WebhookEndpoint?
  @State private var adding = false
  @State private var secret = ""
  @State private var error = ""
  @State private var confirmDelete: WebhookEndpoint?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Webhook endpoints").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Spacer()
        Button { adding = true } label: { Label("Add endpoint", systemImage: "plus") }.buttonStyle(.lnGhost)
      }
      Text("Send the events you pick to your own server, each endpoint with its own signing secret.")
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
      if !secret.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("Copy the signing secret now").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          Text("It is shown once. Verify the x-helpbites-signature header with it.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          HStack(spacing: 8) {
            Text(secret).font(.lnMono).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
              .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
              .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
            IconButton(systemImage: "doc.on.doc", label: "Copy", bordered: true) { Clipboard.copy(secret) }
            Button("Done") { secret = "" }.buttonStyle(.lnGhost)
          }
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      }
      ErrorText(message: error)
      if loading {
        SkeletonRows(count: 2)
      } else if endpoints.isEmpty {
        Text("No endpoints yet. Add one to get events as they happen.").font(.lnCallout).foregroundStyle(Theme.textMuted)
      } else {
        Card {
          ForEach(Array(endpoints.enumerated()), id: \.element.id) { index, endpoint in
            CardRow(divider: index < endpoints.count - 1) { row(endpoint) }
          }
        }
      }
      if !deliveries.isEmpty {
        DisclosureGroup("Recent deliveries") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(deliveries) { delivery in
              HStack(spacing: 8) {
                StatusDot(status: delivery.status == "delivered" ? "active" : delivery.status == "failed" ? "failed" : "pending", label: delivery.status)
                Text(delivery.type).font(.lnMono).foregroundStyle(Theme.text)
                Text(delivery.lastError).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
              }
            }
          }
          .padding(.top, 6)
        }
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
    }
    .sheet(isPresented: $adding) {
      WebhookEndpointSheet(projectId: projectId, endpoint: nil) { saved in handle(saved) }
    }
    .sheet(item: $editing) { endpoint in
      WebhookEndpointSheet(projectId: projectId, endpoint: endpoint) { saved in handle(saved) }
    }
    .confirmationDialog("Remove this endpoint?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible) {
      Button("Remove", role: .destructive) { if let target = confirmDelete { Task { await remove(target) } } }
    } message: {
      Text(confirmDelete?.url ?? "")
    }
    .task { await load() }
  }

  private func row(_ endpoint: WebhookEndpoint) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(endpoint.url).font(.lnMono).foregroundStyle(Theme.textHighlighted).lineLimit(1).truncationMode(.middle)
        Spacer(minLength: 0)
        IconButton(systemImage: "paperplane", label: "Send a test event", bordered: false) { Task { await test(endpoint) } }
        IconButton(systemImage: "arrow.triangle.2.circlepath", label: "New signing secret", bordered: false) { Task { await rotate(endpoint) } }
        IconButton(systemImage: "pencil", label: "Edit", bordered: false) { editing = endpoint }
        IconButton(systemImage: "trash", label: "Remove", bordered: false) { confirmDelete = endpoint }
      }
      if !endpoint.description.isEmpty { Text(endpoint.description).font(.lnMeta).foregroundStyle(Theme.textMuted) }
      Text((endpoint.events.contains("*") ? ["Everything"] : endpoint.events).joined(separator: ", ")).font(.lnCaption).foregroundStyle(Theme.textMuted)
      Text(endpoint.statusText).font(.lnCaption).foregroundStyle(endpoint.lastStatus == "failed" ? Theme.error : Theme.textMuted)
    }
  }

  private var base: String { "/v1/admin/projects/\(projectId)/webhooks" }

  private func handle(_ saved: WebhookEndpoint) {
    if let revealed = saved.secret, !revealed.isEmpty { secret = revealed }
    Task { await load() }
  }

  private func load() async {
    struct Endpoints: Decodable, Sendable { let endpoints: [WebhookEndpoint] }
    struct Deliveries: Decodable, Sendable { let deliveries: [WebhookDelivery] }
    do {
      let list: Endpoints = try await session.get(base)
      endpoints = list.endpoints
      let recent: Deliveries = try await session.get(base + "/deliveries", query: ["limit": "15"])
      deliveries = recent.deliveries
      error = ""
    } catch let failure { error = failure.localizedDescription }
    loading = false
  }

  private func test(_ endpoint: WebhookEndpoint) async {
    struct Ok: Decodable, Sendable { let ok: Bool }
    do { let _: Ok = try await session.send(base + "/\(endpoint.id)/test"); error = "" } catch let failure { error = failure.localizedDescription }
  }

  private func rotate(_ endpoint: WebhookEndpoint) async {
    struct Input: Encodable, Sendable { let rotateSecret: Bool }
    struct Output: Decodable, Sendable { let endpoint: WebhookEndpoint }
    do {
      let result: Output = try await session.send(base + "/\(endpoint.id)", method: "PATCH", body: Input(rotateSecret: true))
      secret = result.endpoint.secret ?? ""
      error = ""
    } catch let failure { error = failure.localizedDescription }
  }

  private func remove(_ endpoint: WebhookEndpoint) async {
    do {
      try await session.delete(base + "/\(endpoint.id)")
      endpoints.removeAll { $0.id == endpoint.id }
      error = ""
    } catch let failure { error = failure.localizedDescription }
  }
}

/// Add or change one endpoint: where it posts and which events it gets.
private struct WebhookEndpointSheet: View {
  let projectId: String
  let endpoint: WebhookEndpoint?
  let onSaved: (WebhookEndpoint) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  @State private var url = ""
  @State private var description = ""
  @State private var everything = true
  @State private var picked: Set<String> = []
  @State private var enabled = true
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      Form {
        Section("Endpoint") {
          TextField("https://api.example.com/helpbites/events", text: $url)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          TextField("Description (optional)", text: $description)
          Toggle("Send events to this endpoint", isOn: $enabled)
        }
        Section("Events") {
          Toggle("Everything", isOn: $everything)
          if !everything {
            ForEach(DomainEventCatalog.groups) { group in
              Toggle(group.label, isOn: groupBinding(group))
              ForEach(group.events, id: \.type) { event in
                Toggle(event.label, isOn: eventBinding(event.type, group: group)).padding(.leading, 16).disabled(picked.contains("\(group.key).*"))
              }
            }
          }
        }
        if !error.isEmpty { Section { Text(error).foregroundStyle(Theme.error) } }
      }
      .navigationTitle(endpoint == nil ? "Add endpoint" : "Edit endpoint")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Save") } }.disabled(saving || url.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      .presentationDetents([.large])
      .onAppear {
        guard let endpoint else { return }
        url = endpoint.url; description = endpoint.description; enabled = endpoint.enabled
        everything = endpoint.events.contains("*")
        picked = everything ? [] : Set(endpoint.events)
      }
    }
  }

  private func groupBinding(_ group: DomainEventCatalog.Group) -> Binding<Bool> {
    Binding(
      get: { picked.contains("\(group.key).*") || group.events.allSatisfy { picked.contains($0.type) } },
      set: { on in
        picked.remove("\(group.key).*")
        for event in group.events { picked.remove(event.type) }
        if on { picked.insert("\(group.key).*") }
      }
    )
  }

  private func eventBinding(_ type: String, group: DomainEventCatalog.Group) -> Binding<Bool> {
    Binding(
      get: { picked.contains(type) || picked.contains("\(group.key).*") },
      set: { on in if on { picked.insert(type) } else { picked.remove(type) } }
    )
  }

  private func save() async {
    struct Input: Encodable, Sendable { let url, description: String; let events: [String]; let enabled: Bool }
    struct Output: Decodable, Sendable { let endpoint: WebhookEndpoint }
    if !everything && picked.isEmpty { error = "Pick at least one event, or choose Everything"; return }
    saving = true; error = ""
    defer { saving = false }
    let base = "/v1/admin/projects/\(projectId)/webhooks"
    let input = Input(url: url.trimmingCharacters(in: .whitespaces), description: description, events: everything ? ["*"] : picked.sorted(), enabled: enabled)
    do {
      let result: Output = try await session.send(endpoint.map { base + "/\($0.id)" } ?? base, method: endpoint == nil ? "POST" : "PATCH", body: input)
      onSaved(result.endpoint)
      dismiss()
    } catch let failure { error = failure.localizedDescription }
  }
}
