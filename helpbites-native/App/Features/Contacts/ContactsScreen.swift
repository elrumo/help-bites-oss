import SwiftUI

/// A project's people (web: projects/[id]/contacts.vue): the app's users,
/// imports, database syncs and sign-ups; the saved segments; and the sources
/// they sync from. Importing a CSV and connecting a database are on the web.
struct ContactsScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
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

private struct PeopleList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var contacts: [Contact] = []
  @State private var next = ""
  @State private var search = ""
  @State private var subscription = ""
  @State private var loading = true
  @State private var error = ""
  @State private var open: Contact?

  var body: some View {
    List {
      HStack(spacing: 8) {
        SearchField(text: $search, prompt: "Name, email or id") { Task { await load() } }
        Menu {
          Button("Anyone") { subscription = "" }
          ForEach(SubscriptionStatus.allCases) { status in Button(status.label) { subscription = status.rawValue } }
        } label: {
          Label(subscription.isEmpty ? "Anyone" : SubscriptionStatus.of(subscription).label, systemImage: "line.3.horizontal.decrease")
            .font(.lnMetaMedium).foregroundStyle(Theme.textToned)
        }
      }
      .linearRow()
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && contacts.isEmpty { SkeletonRows(count: 6).linearRow() }
      else if contacts.isEmpty {
        EmptyState(systemImage: "person.2", title: search.isEmpty && subscription.isEmpty ? "No contacts yet" : "Nobody matches", message: search.isEmpty && subscription.isEmpty ? "Your app's users show up here as they use support or feedback. Import a CSV or sync your database on the web." : "Try another filter.").linearRow()
      }
      ForEach(contacts) { contact in
        Button { open = contact } label: { row(contact) }.buttonStyle(.plain).linearRow()
      }
      if !next.isEmpty { Button("Load more") { Task { await load(cursor: next) } }.buttonStyle(.lnSecondaryCompact).linearRow() }
    }
    .linearList()
    .refreshable { await load() }
    .task(id: subscription) { await load() }
    .sheet(item: $open) { contact in
      ContactDetailSheet(projectId: projectId, contact: contact) { changed in
        if let changed { contacts = contacts.map { $0.id == changed.id ? changed : $0 } } else { contacts.removeAll { $0.id == contact.id } }
      }
    }
  }

  private func row(_ contact: Contact) -> some View {
    let status = SubscriptionStatus.of(contact.subscription)
    return HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(contact.displayName).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        if !contact.name.isEmpty, !contact.email.isEmpty { Text(contact.email).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1) }
      }
      Spacer(minLength: 8)
      Tag(text: status.label, tint: status.tint)
      Text(DateText.short(contact.lastSeenAt ?? contact.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(minWidth: 32, alignment: .trailing)
    }
    .frame(minHeight: Metrics.rowHeight)
    .contentShape(Rectangle())
  }

  private func load(cursor: String = "") async {
    loading = true
    defer { loading = false }
    do {
      var query = ["project": projectId]
      if !search.isEmpty { query["q"] = search }
      if !subscription.isEmpty { query["subscription"] = subscription }
      if !cursor.isEmpty { query["cursor"] = cursor }
      let page: ContactPage = try await session.get("/v1/contacts", query: query)
      contacts = cursor.isEmpty ? page.contacts : contacts + page.contacts
      next = page.nextCursor ?? ""
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }
}

private struct SegmentsList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var segments: [ContactSegment] = []
  @State private var counts: [String: Int] = [:]
  @State private var loading = true
  @State private var error = ""

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && segments.isEmpty { SkeletonRows(count: 3).linearRow() }
      else if segments.isEmpty { EmptyState(systemImage: "line.3.horizontal.decrease.circle", title: "No segments yet", message: "Build them on the web: plan, tags, when people were last seen. Then email exactly that group.").linearRow() }
      ForEach(segments) { segment in
        HStack(spacing: 12) {
          Image(systemName: "line.3.horizontal.decrease.circle").foregroundStyle(Theme.textMuted)
          VStack(alignment: .leading, spacing: 2) {
            Text(segment.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
            Text("\(segment.filter.rules.count) rule\(segment.filter.rules.count == 1 ? "" : "s")").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
          Spacer()
          Text(counts[segment.id].map { "\($0) people" } ?? "…").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
        .frame(minHeight: Metrics.rowHeight)
        .linearRow()
        .swipeActions { Button("Delete", role: .destructive) { Task { await remove(segment) } } }
      }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let segments: [ContactSegment] }
    struct Preview: Decodable, Sendable { let count: Int }
    struct Input: Encodable, Sendable { let project, segment: String }
    loading = true
    defer { loading = false }
    do {
      segments = (try await session.get("/v1/segments", query: ["project": projectId]) as Response).segments
      error = ""
      for segment in segments {
        let preview: Preview = try await session.send("/v1/segments/preview", body: Input(project: projectId, segment: segment.id))
        counts[segment.id] = preview.count
      }
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private func remove(_ segment: ContactSegment) async {
    do {
      try await session.delete("/v1/segments/\(segment.id)?project=\(projectId)")
      segments.removeAll { $0.id == segment.id }
    } catch { self.error = error.localizedDescription }
  }
}

private struct SourcesList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var sources: [ContactSource] = []
  @State private var ready = true
  @State private var loading = true
  @State private var error = ""

  private static let icons = ["parse": "server.rack", "postgres": "cylinder.split.1x2", "firestore": "flame"]

  var body: some View {
    List {
      if !ready {
        Label("Set HELPBITES_SECRET on the server: database credentials are stored encrypted with it.", systemImage: "key")
          .font(.lnMeta).foregroundStyle(Theme.warning).linearRow()
      }
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && sources.isEmpty { SkeletonRows(count: 2).linearRow() }
      else if sources.isEmpty { EmptyState(systemImage: "cylinder.split.1x2", title: "No databases connected", message: "Connect your Parse server, Postgres or Supabase, or Firestore on the web; HelpBites keeps contacts in step, read only.").linearRow() }
      ForEach(sources) { source in row(source).linearRow() }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
  }

  private func row(_ source: ContactSource) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        Image(systemName: Self.icons[source.kind] ?? "cylinder").foregroundStyle(Theme.textMuted)
        VStack(alignment: .leading, spacing: 2) {
          Text(source.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
          Text("\(source.what) · \(source.schedule)\(source.config.updatedField == nil ? " · full scan" : "")").font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
        }
        Spacer(minLength: 8)
        if !source.enabled { Tag(text: "Paused") }
        else if source.status == "running" { Tag(text: "Syncing", tint: Theme.info) }
        else if source.status == "error" { Tag(text: "Failing", tint: Theme.error) }
        else { Tag(text: "Up to date", tint: Theme.success) }
        Menu {
          Button { Task { await run(source, reset: false) } } label: { Label("Sync now", systemImage: "arrow.clockwise") }
          Button { Task { await run(source, reset: true) } } label: { Label("Read everything again", systemImage: "arrow.counterclockwise") }
          Button { Task { await toggle(source) } } label: { Label(source.enabled ? "Pause" : "Resume", systemImage: source.enabled ? "pause" : "play") }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .accessibilityLabel("Source actions")
      }
      if !source.lastError.isEmpty { Text(source.lastError).font(.lnMono).foregroundStyle(Theme.error).lineLimit(3) }
      Text("Read \(source.stats.seen) · new \(source.stats.created) · updated \(source.stats.updated)\(source.stats.failed > 0 ? " · failed \(source.stats.failed)" : "")\(source.lastRunAt.map { " · \(DateText.short($0))" } ?? "")")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .padding(.vertical, 6)
  }

  private func load() async {
    struct Response: Decodable, Sendable { let sources: [ContactSource]; let ready: Bool }
    loading = true
    defer { loading = false }
    do {
      let response: Response = try await session.get("/v1/admin/contact-sources", query: ["project": projectId])
      sources = response.sources
      ready = response.ready
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private func run(_ source: ContactSource, reset: Bool) async {
    struct Input: Encodable, Sendable { let project: String; let reset: Bool }
    struct Output: Decodable, Sendable { let source: ContactSource }
    do {
      let output: Output = try await session.send("/v1/admin/contact-sources/\(source.id)/run", body: Input(project: projectId, reset: reset))
      sources = sources.map { $0.id == source.id ? output.source : $0 }
    } catch { self.error = error.localizedDescription }
  }

  private func toggle(_ source: ContactSource) async {
    struct Input: Encodable, Sendable { let project: String; let enabled: Bool }
    struct Output: Decodable, Sendable { let source: ContactSource }
    do {
      let output: Output = try await session.send("/v1/admin/contact-sources/\(source.id)", method: "PATCH", body: Input(project: projectId, enabled: !source.enabled))
      sources = sources.map { $0.id == source.id ? output.source : $0 }
    } catch { self.error = error.localizedDescription }
  }
}
