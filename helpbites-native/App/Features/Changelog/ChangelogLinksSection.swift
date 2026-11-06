import SwiftUI

/// The changelog entries a feedback post, board item or conversation is behind
/// (components/ChangelogLinks.vue): open one, unlink it, add it to an existing entry,
/// or start a draft linked to it. For the post editor (`kind` "feedback"), the board
/// item editor ("board") and the inbox ("conversation": tickets and errors alike).
/// A new entry starts with only what is already public (`ChangelogPrefill`): a ticket
/// or error gives nothing, so you write the title. Nothing is published from here.
struct ChangelogLinksSection: View {
  let projectId: String
  let kind: String
  let targetId: String
  /// The source's own fields `ChangelogPrefill` reads: title, body, type, publicDescription…
  var source: [String: String] = [:]
  @Environment(Workspace.self) private var workspace
  @State private var linked: [ChangelogEntry] = []
  @State private var loaded = false
  @State private var busy = ""
  @State private var composing = false
  @State private var title = ""
  @State private var creating = false
  @State private var picking = false
  @State private var editing: EditorRoute?
  @State private var error = ""
  /// The changelog, made only when an entry is opened or picked.
  @State private var store: ChangelogStore?

  private struct EditorRoute: Identifiable { let id: String }

  private var filterKey: String { ["feedback": "feedbackPost", "board": "boardItem"][kind] ?? "conversation" }
  private var linkKey: String { ["feedback": "feedbackPostIds", "board": "boardItemIds"][kind] ?? "conversationIds" }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if !loaded {
        RoundedRectangle(cornerRadius: Metrics.radiusSmall).fill(Theme.elevated).frame(height: Metrics.scaled(28)).padding(.horizontal, 8)
      }
      ForEach(linked) { entry in row(entry) }
      if composing {
        HStack(spacing: 6) {
          TextField("What changed, for your users", text: $title).textFieldStyle(.linear)
            .onChange(of: title) { _, value in if value.count > 200 { title = String(value.prefix(200)) } }
            .onSubmit { Task { await create() } }
          Button { Task { await create() } } label: { if creating { ProgressView().controlSize(.mini) } else { Text("Create draft") } }
            .buttonStyle(.lnPrimaryCompact)
            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || creating)
          Button("Cancel") { composing = false }.buttonStyle(.lnGhost)
        }
        .padding(.horizontal, 8).padding(.top, 4)
      } else {
        HStack(spacing: 6) {
          Button { startComposing() } label: { Label("New entry", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact)
          Button { _ = changelog(); picking = true } label: { Label("Add to existing", systemImage: "scroll") }.buttonStyle(.lnSecondaryCompact)
        }
        .padding(.horizontal, 8).padding(.top, 4)
      }
      ErrorText(message: error).padding(.horizontal, 8)
    }
    .task(id: "\(projectId)|\(kind)|\(targetId)") { composing = false; await load() }
    .sheet(isPresented: $picking) {
      if let store { ChangelogEntryPicker(store: store, exclude: Set(linked.map(\.id))) { entry in Task { await link(entry, true) } } }
    }
    .sheet(item: $editing, onDismiss: { Task { await load() } }) { route in
      if let store { ChangelogEntryEditor(store: store, entryId: route.id) }
    }
  }

  private func row(_ entry: ChangelogEntry) -> some View {
    HStack(spacing: 8) {
      Button { _ = changelog(); editing = EditorRoute(id: entry.id) } label: {
        HStack(spacing: 8) {
          Circle().fill(entry.status == .published ? Theme.success : Theme.textDimmed).frame(width: 7, height: 7)
            .accessibilityLabel(entry.status == .published ? "Published" : "Draft")
          if let number = entry.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
          Text(entry.title).foregroundStyle(Theme.text).lineLimit(1)
          Spacer(minLength: 0)
        }
        .font(.lnMeta)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Button { Task { await link(entry, false) } } label: {
        Group {
          if busy == entry.id { ProgressView().controlSize(.mini) } else { Image(systemName: "xmark").font(.app(size: 9, weight: .bold)).foregroundStyle(Theme.textDimmed) }
        }
        .frame(width: 24, height: 24)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(!busy.isEmpty)
      .accessibilityLabel("Unlink \(entry.number.map { "#\($0) " } ?? "")\(entry.title)")
    }
    .padding(.horizontal, 8)
    .frame(height: Metrics.scaled(32))
  }

  /// Made on an action, never while the view updates.
  private func changelog() -> ChangelogStore {
    if let store { return store }
    let made = ChangelogStore(projectId: projectId, workspace: workspace)
    store = made
    return made
  }

  private func load() async {
    guard !targetId.isEmpty, !projectId.isEmpty else { linked = []; loaded = true; return }
    struct Entries: Decodable, Sendable { let entries: [ChangelogEntry] }
    do {
      let result: Entries = try await workspace.session.get("/v1/admin/changelog/entries", query: ["project": projectId, filterKey: targetId])
      linked = result.entries
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loaded = true
  }

  private func link(_ entry: ChangelogEntry, _ on: Bool) async {
    busy = entry.id
    defer { busy = "" }
    error = ""
    do {
      let body: [String: JSONValue] = ["kind": .string(kind), "id": .string(targetId), "linked": .bool(on)]
      struct Response: Decodable, Sendable { let entry: ChangelogEntry }
      let result: Response = try await workspace.session.send("/v1/admin/changelog/entries/\(entry.id)/links", body: body)
      if on { if !linked.contains(where: { $0.id == entry.id }) { linked.append(result.entry) } } else { linked.removeAll { $0.id == entry.id } }
      store?.upsert(result.entry)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func startComposing() {
    title = ChangelogPrefill.make(kind: kind, source: source).title
    composing = true
  }

  private func create() async {
    let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    creating = true
    defer { creating = false }
    error = ""
    let prefill = ChangelogPrefill.make(kind: kind, source: source)
    let fields: [String: JSONValue] = ["title": .string(String(text.prefix(200))), "body": .string(prefill.body), "tag": .string(prefill.tag.rawValue), "status": .string("draft"), linkKey: .array([.string(targetId)])]
    do {
      struct Response: Decodable, Sendable { let entry: ChangelogEntry }
      let result: Response = try await workspace.session.send("/v1/admin/changelog/entries?project=\(projectId)", body: fields)
      linked.append(result.entry)
      store?.upsert(result.entry)
      composing = false
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// "Add to existing…": every entry of the project, searchable.
struct ChangelogEntryPicker: View {
  let store: ChangelogStore
  let exclude: Set<String>
  let onPick: (ChangelogEntry) -> Void
  @State private var search = ""
  @Environment(\.dismiss) private var dismiss

  private var rows: [ChangelogEntry] {
    let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return store.entries.filter { entry in
      !exclude.contains(entry.id) && (needle.isEmpty || entry.title.localizedStandardContains(needle) || "#\(entry.number ?? 0)" == needle)
    }
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        SearchField(text: $search, prompt: "Search entries").padding(Metrics.gutter)
        if !store.loaded {
          SkeletonRows(count: 4)
          Spacer(minLength: 0)
        } else if rows.isEmpty {
          EmptyState(systemImage: "scroll", title: "No entries", message: "Nothing else to add it to.")
          Spacer(minLength: 0)
        } else {
          List(rows) { entry in
            Button { onPick(entry); dismiss() } label: {
              HStack(spacing: 8) {
                Circle().fill(entry.status == .published ? Theme.success : Theme.textDimmed).frame(width: 7, height: 7)
                if let number = entry.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
                Text(entry.title).foregroundStyle(Theme.text).lineLimit(1)
                if entry.status == .draft { Text("(draft)").foregroundStyle(Theme.textMuted) }
                Spacer(minLength: 0)
              }
              .font(.lnMeta)
              .frame(minHeight: Metrics.scaled(36))
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .linearRow()
          }
          .linearList()
        }
      }
      .panelScreen("Add to existing")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .task { await store.ensureLoaded() }
    }
    .presentationDetents([.medium, .large])
    .changelogSheetSize()
  }
}

#Preview("Prefill rules") {
  ChangelogPrefill.selfCheck()
  return Text("ChangelogPrefill checks passed").padding()
}
