import SwiftUI

/// A project's people (web: projects/[id]/contacts.vue): the app's users,
/// imports, database syncs and sign-ups; the saved segments; and the sources
/// they sync from.
struct ContactsScreen: View {
  let projectId: String
  @State private var tab = "people"

  var body: some View {
    VStack(spacing: 0) {
      Picker("Section", selection: $tab) {
        Text("People").tag("people")
        Text("Segments").tag("segments")
        Text("Sources").tag("sources")
      }
      .pickerStyle(.segmented)
      .padding(.horizontal, Metrics.gutter).padding(.vertical, 8)
      switch tab {
      case "segments": SegmentsList(projectId: projectId)
      case "sources": SourcesList(projectId: projectId)
      default: PeopleList(projectId: projectId)
      }
    }
    .projectScreen(projectId, "Contacts")
  }
}

/// The people list's state: filters, the current page and the cursor. Loads supersede each
/// other, and the next page is fetched as the end of the list scrolls into view.
@MainActor @Observable final class ContactsStore {
  private(set) var contacts: [Contact] = []
  private(set) var next = ""
  private(set) var loading = true
  private(set) var loadingMore = false
  var error = ""
  var search = ""
  var subscription = ""
  var segment = ""
  private var generation = 0

  var queryKey: String { [search.trimmingCharacters(in: .whitespaces), subscription, segment].joined(separator: "\u{1f}") }
  var filtered: Bool { !search.trimmingCharacters(in: .whitespaces).isEmpty || !subscription.isEmpty || !segment.isEmpty }

  private func query(_ projectId: String) -> [String: String] {
    var query = ["project": projectId, "limit": "50"]
    let term = search.trimmingCharacters(in: .whitespaces)
    if !term.isEmpty { query["q"] = term }
    if !subscription.isEmpty { query["subscription"] = subscription }
    if !segment.isEmpty { query["segment"] = segment }
    return query
  }

  func load(_ projectId: String, session: SessionStore) async {
    generation += 1
    let run = generation
    loading = true
    do {
      let page: ContactPage = try await session.get("/v1/contacts", query: query(projectId))
      guard run == generation else { return }
      contacts = page.contacts
      next = page.nextCursor ?? ""
      error = ""
    } catch {
      guard run == generation, !Task.isCancelled else { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  func loadMore(_ projectId: String, session: SessionStore) async {
    guard !next.isEmpty, !loading, !loadingMore else { return }
    let run = generation
    loadingMore = true
    defer { loadingMore = false }
    var query = query(projectId)
    query["cursor"] = next
    do {
      let page: ContactPage = try await session.get("/v1/contacts", query: query)
      guard run == generation else { return }
      let known = Set(contacts.map(\.id))
      contacts += page.contacts.filter { !known.contains($0.id) }
      next = page.nextCursor ?? ""
    } catch { if run == generation { self.error = error.localizedDescription } }
  }

  func replace(_ contact: Contact) { if let i = contacts.firstIndex(where: { $0.id == contact.id }) { contacts[i] = contact } }
  func remove(_ id: String) { contacts.removeAll { $0.id == id } }
}

private struct PeopleList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var store = ContactsStore()
  @State private var segments: [ContactSegment] = []
  @State private var open: Contact?
  @State private var importing = false
  @State private var adding = false

  var body: some View {
    @Bindable var filters = store
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        SearchField(text: $filters.search, prompt: "Name, email or id")
        Menu {
          Picker("Subscription", selection: $filters.subscription) {
            Text("Anyone").tag("")
            ForEach(SubscriptionStatus.allCases) { Text($0.label).tag($0.rawValue) }
          }
          if !segments.isEmpty {
            Picker("Segment", selection: $filters.segment) {
              Text("Everyone").tag("")
              ForEach(segments) { Text($0.name).tag($0.id) }
            }
          }
        } label: {
          Image(systemName: "line.3.horizontal.decrease")
            .foregroundStyle(Theme.textToned)
            .overlay(alignment: .topTrailing) { if !store.subscription.isEmpty || !store.segment.isEmpty { Circle().fill(Theme.accent).frame(width: 7, height: 7).offset(x: 4, y: -3) } }
        }
        .menuStyle(.borderlessButton).fixedSize()
        .accessibilityLabel("Filter contacts")
      }
      .padding(.horizontal, 12).padding(.bottom, 8)
      if !store.error.isEmpty { ErrorText(message: store.error).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.bottom, 6) }
      list
    }
    .background(Theme.panel)
    // Filters reload; typing is debounced, a newer filter cancels this one.
    .task(id: store.queryKey) {
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      await store.load(projectId, session: session)
    }
    .task { if let r: SegmentsResponse = try? await session.get("/v1/segments", query: ["project": projectId]) { segments = r.segments } }
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button { importing = true } label: { Label("Import CSV", systemImage: "square.and.arrow.down") }
        Button { adding = true } label: { Label("Add contact", systemImage: "plus") }
      }
    }
    .sheet(item: $open) { contact in
      ContactDetailSheet(projectId: projectId, contact: contact) { changed in
        if let changed { store.replace(changed) } else { store.remove(contact.id) }
      }
    }
    .sheet(isPresented: $importing) { CsvImportSheet(projectId: projectId) { Task { await store.load(projectId, session: session) } } }
    .sheet(isPresented: $adding) { AddContactSheet(projectId: projectId) { contact in
      Task { await store.load(projectId, session: session); open = contact }
    } }
  }

  private struct SegmentsResponse: Decodable, Sendable { let segments: [ContactSegment] }

  private var list: some View {
    let rows = store.contacts
    return List {
      ForEach(rows) { contact in
        Button { open = contact } label: { PeopleRow(contact: contact) }
          .buttonStyle(.plain)
          .linearRow()
          // The next page loads as the last rows scroll into view: only the visible rows are ever built.
          .onAppear { if contact.id == rows[max(0, rows.count - 10)].id { Task { await store.loadMore(projectId, session: session) } } }
      }
      if store.loadingMore { ProgressView().frame(maxWidth: .infinity).linearRow() }
    }
    .linearList()
    .refreshable { await store.load(projectId, session: session) }
    .overlay {
      if rows.isEmpty {
        if store.loading { SkeletonRows(count: 8).frame(maxHeight: .infinity, alignment: .top) }
        else {
          EmptyState(systemImage: "person.2", title: store.filtered ? "Nobody matches" : "No contacts yet", message: store.filtered ? "Try another filter." : "Your app's users show up here as they use support or feedback. Import a CSV, sync your database under Sources, or add people through the API.") {
            if !store.filtered {
              Button("Import CSV") { importing = true }.buttonStyle(.lnSecondaryCompact)
              Button("Add contact") { adding = true }.buttonStyle(.lnPrimaryCompact)
            }
          }
        }
      }
    }
  }
}

private struct PeopleRow: View {
  let contact: Contact
  var body: some View {
    let status = SubscriptionStatus.of(contact.subscription)
    HStack(spacing: 12) {
      avatar
      VStack(alignment: .leading, spacing: 2) {
        Text(contact.displayName).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        if !contact.name.isEmpty, !contact.email.isEmpty { Text(contact.email).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1) }
      }
      Spacer(minLength: 8)
      if let tag = contact.tags.first { Tag(text: contact.tags.count > 1 ? "\(tag) +\(contact.tags.count - 1)" : tag).fixedSize() }
      Tag(text: status.label, tint: status.tint).fixedSize()
      Text(DateText.short(contact.lastSeenAt ?? contact.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(minWidth: 32, alignment: .trailing)
    }
    .frame(minHeight: Metrics.rowHeight)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var avatar: some View {
    if let url = URL(string: contact.avatarUrl), !contact.avatarUrl.isEmpty {
      AsyncImage(url: url) { phase in
        if let image = phase.image { image.resizable().scaledToFill().frame(width: 24, height: 24).clipShape(Circle()) }
        else { Avatar(name: contact.displayName) }
      }
    } else {
      Avatar(name: contact.displayName)
    }
  }
}

/// Someone your app knows by email, by id, or both (web: the "Add a contact" modal).
private struct AddContactSheet: View {
  let projectId: String
  var onAdded: (Contact) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var name = ""
  @State private var externalId = ""
  @State private var optedIn = false
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Email", text: $email).inputHints(.emailAddress, capitalization: .never).autocorrectionDisabled()
          TextField("Name (optional)", text: $name)
          TextField("User id (your app's id, optional)", text: $externalId).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
        }
        Section {
          Toggle("They asked to get marketing email", isOn: $optedIn)
        } footer: { Text("Records your panel as the consent source.") }
        Section { ErrorText(message: error) }
      }
      .formStyle(.grouped)
      .navigationTitle("Add a contact")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add") { Task { await add() } }
            .disabled(saving || (email.trimmingCharacters(in: .whitespaces).isEmpty && externalId.trimmingCharacters(in: .whitespaces).isEmpty))
        }
      }
    }
    #if os(macOS)
    .frame(minWidth: 420, minHeight: 380)
    #endif
  }

  private func add() async {
    struct Input: Encodable, Sendable { let project: String; let email, name: String; let externalId, subscription: String? }
    struct Output: Decodable, Sendable { let contact: Contact }
    saving = true
    defer { saving = false }
    let id = externalId.trimmingCharacters(in: .whitespaces)
    do {
      let output: Output = try await session.send("/v1/contacts", body: Input(project: projectId, email: email.trimmingCharacters(in: .whitespaces), name: name, externalId: id.isEmpty ? nil : id, subscription: optedIn ? "subscribed" : nil))
      onAdded(output.contact)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
