import SwiftUI

/// What the list shows: everything, or one state, or the entries waiting on a person.
enum ChangelogFilter: String, CaseIterable, Identifiable {
  case all, live, waiting, draft, review, ai, archived
  var id: String { rawValue }
  var label: String {
    switch self {
    case .all: "All"
    case .live: "Public"
    case .waiting: "Waiting"
    case .draft: "Drafts"
    case .review: "Needs review"
    case .ai: "AI"
    case .archived: "Archived"
    }
  }
}

/// A project's changelog: entries, releases and the project's options, the list
/// filters, and every write (pages/projects/[id]/changelog.vue). The entry editor
/// and `ChangelogLinksSection` share one.
@MainActor @Observable final class ChangelogStore {
  let projectId: String
  let workspace: Workspace
  var project: ChangelogProject?
  var entries: [ChangelogEntry] = []
  /// Archived entries (merged away), fetched only when asked for.
  var archived: [ChangelogEntry] = []
  var releases: [ChangelogRelease] = []
  var loading = true
  private(set) var loaded = false
  var error = ""
  /// A failed quick action, shown as an alert.
  var alert = ""

  // Filters (the web lists everything; a long changelog needs these).
  var search = ""
  var filter: ChangelogFilter = .all
  var tagFilter: ChangelogTag?

  // Selecting several entries.
  var selecting = false
  var selected: Set<String> = []
  var bulkBusy = ""

  // Writing entries from commits.
  var run: ChangelogRun?
  var repoNames: [String]?
  private var poll: Task<Void, Never>?

  init(projectId: String, workspace: Workspace) {
    self.projectId = projectId
    self.workspace = workspace
  }

  private var session: SessionStore { workspace.session }
  var settings: ChangelogSettings { project?.changelog ?? ChangelogSettings() }

  func release(_ id: String) -> ChangelogRelease? { id.isEmpty ? nil : releases.first { $0.id == id } }
  func entry(_ id: String) -> ChangelogEntry? { entries.first { $0.id == id } ?? archived.first { $0.id == id } }
  func state(_ entry: ChangelogEntry) -> ChangelogState { entry.state(in: release(entry.releaseId)) }

  var publicCount: Int { entries.filter { state($0) == .live }.count }
  var draftCount: Int { entries.count - publicCount }
  var aiPending: Int { entries.filter { $0.aiGenerated && $0.status == .draft }.count }
  var selectedEntries: [ChangelogEntry] { entries.filter { selected.contains($0.id) } }

  /// `/changelog/<public key>` on the app's own host, once the public changelog is on.
  var publicURL: URL? {
    guard let project, settings.enabled else { return nil }
    return URL(string: "\(session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/changelog/\(project.publicKey)")
  }

  var filtering: Bool { !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || filter != .all || tagFilter != nil }

  func clearFilters() {
    search = ""
    filter = .all
    tagFilter = nil
  }

  func count(_ filter: ChangelogFilter) -> Int? {
    switch filter {
    case .all: entries.count
    case .live: publicCount
    case .waiting: entries.filter { state($0) == .waiting }.count
    case .draft: entries.filter { $0.status == .draft }.count
    case .review: entries.filter(\.needsReview).count
    case .ai: aiPending
    case .archived: filter == .archived ? archived.count : nil
    }
  }

  // MARK: Listing

  private func matches(_ entry: ChangelogEntry) -> Bool {
    if let tagFilter, entry.tag != tagFilter { return false }
    switch filter {
    case .all, .archived: break
    case .live: if state(entry) != .live { return false }
    case .waiting: if state(entry) != .waiting { return false }
    case .draft: if entry.status != .draft { return false }
    case .review: if !entry.needsReview { return false }
    case .ai: if !(entry.aiGenerated && entry.status == .draft) { return false }
    }
    let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    if needle.isEmpty { return true }
    if let number = Int(needle.hasPrefix("#") ? String(needle.dropFirst()) : needle), entry.number == number { return true }
    return [entry.title, entry.summary, entry.body, entry.slug, entry.area].contains { $0.localizedStandardContains(needle) }
  }

  /// Release-less entries first (where new drafts land), then draft releases, then published ones, newest first.
  var groups: [ChangelogGroup] {
    if filter == .archived {
      let rows = archived.filter(matches)
      return rows.isEmpty ? [] : [ChangelogGroup(release: nil, entries: rows)]
    }
    let visible = entries.filter(matches)
    var out: [ChangelogGroup] = []
    let loose = visible.filter { release($0.releaseId) == nil }
    if !loose.isEmpty { out.append(ChangelogGroup(release: nil, entries: loose)) }
    let ordered = releases.sorted {
      if ($0.status == .draft) != ($1.status == .draft) { return $0.status == .draft }
      return ($0.publishedAt ?? $0.createdAt) > ($1.publishedAt ?? $1.createdAt)
    }
    for release in ordered {
      let rows = visible.filter { $0.releaseId == release.id }
      // A filter hides empty releases; the unfiltered list keeps them so one can be filled.
      if !rows.isEmpty || !filtering { out.append(ChangelogGroup(release: release, entries: rows)) }
    }
    return out
  }

  // MARK: Loading

  func load() async {
    loading = true
    error = ""
    defer { loading = false }
    do {
      try await fetch()
      loaded = true
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }

  /// For the editor and links section, which may open before the screen did.
  func ensureLoaded() async { if !loaded { await load() } }

  private func fetch() async throws {
    struct Entries: Decodable, Sendable { let entries: [ChangelogEntry] }
    struct Releases: Decodable, Sendable { let releases: [ChangelogRelease] }
    let id = projectId
    async let mine = ChangelogProject.load(id, session: session)
    async let rows: Entries = session.get("/v1/admin/changelog/entries", query: ["project": id])
    async let groups: Releases = session.get("/v1/admin/changelog/releases", query: ["project": id])
    let (project, entries, releases) = try await (mine, rows, groups)
    self.project = project
    self.entries = entries.entries
    self.releases = releases.releases
  }

  /// A quiet refetch (coming back to the app); keeps what is on screen when it fails.
  func refresh() async {
    guard loaded else { return }
    try? await fetch()
    if filter == .archived { await loadArchived() }
  }

  func loadArchived() async {
    struct Entries: Decodable, Sendable { let entries: [ChangelogEntry] }
    do {
      let result: Entries = try await session.get("/v1/admin/changelog/entries", query: ["project": projectId, "status": "archived"])
      archived = result.entries
    } catch {
      if case APIError.cancelled = error { return }
      alert = error.localizedDescription
    }
  }

  func upsert(_ entry: ChangelogEntry) {
    if entry.status == .archived {
      entries.removeAll { $0.id == entry.id }
      if let index = archived.firstIndex(where: { $0.id == entry.id }) { archived[index] = entry } else { archived.insert(entry, at: 0) }
    } else if let index = entries.firstIndex(where: { $0.id == entry.id }) {
      entries[index] = entry
    } else {
      entries.insert(entry, at: 0)
    }
    if entry.status != .archived { archived.removeAll { $0.id == entry.id } }
  }

  // MARK: Entries

  private struct EntryResponse: Decodable, Sendable { let entry: ChangelogEntry }

  func create(_ fields: [String: JSONValue]) async throws -> ChangelogEntry {
    let result: EntryResponse = try await session.send("/v1/admin/changelog/entries?project=\(projectId)", body: fields)
    upsert(result.entry)
    return result.entry
  }

  /// Send only what changed; `.null` clears a value.
  func update(_ id: String, _ fields: [String: JSONValue]) async throws -> ChangelogEntry {
    let result: EntryResponse = try await session.send("/v1/admin/changelog/entries/\(id)", method: "PATCH", body: fields)
    upsert(result.entry)
    return result.entry
  }

  func review(_ id: String, approve: Bool, notes: String = "") async throws -> ChangelogEntry {
    let body: [String: JSONValue] = ["action": .string(approve ? "approve" : "reject"), "notes": .string(notes)]
    let result: EntryResponse = try await session.send("/v1/admin/changelog/entries/\(id)/review", body: body)
    upsert(result.entry)
    return result.entry
  }

  func delete(_ id: String) async throws {
    try await session.delete("/v1/admin/changelog/entries/\(id)")
    entries.removeAll { $0.id == id }
    archived.removeAll { $0.id == id }
    selected.remove(id)
  }

  /// Link or unlink a feedback post or board item (an id or `#N`) or a conversation.
  func link(_ entryId: String, kind: String, target: String, linked: Bool) async throws -> ChangelogEntry {
    let body: [String: JSONValue] = ["kind": .string(kind), "id": .string(target), "linked": .bool(linked)]
    let result: EntryResponse = try await session.send("/v1/admin/changelog/entries/\(entryId)/links", body: body)
    upsert(result.entry)
    return result.entry
  }

  // MARK: Selecting

  func toggle(_ id: String) {
    if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
  }

  func endSelecting() {
    selecting = false
    selected = []
  }

  /// Approve and publish each selected draft.
  func approveSelected() async {
    let drafts = selectedEntries.filter { $0.status == .draft }
    bulkBusy = "approve"
    defer { bulkBusy = "" }
    do {
      for entry in drafts { _ = try await review(entry.id, approve: true) }
      endSelecting()
    } catch {
      alert = error.localizedDescription
      await refresh()
    }
  }

  /// One new draft from the selection; the originals are archived, their commits and links move over.
  func mergeSelected() async -> ChangelogEntry? {
    let picked = selectedEntries
    guard let first = picked.first else { return nil }
    bulkBusy = "merge"
    defer { bulkBusy = "" }
    struct Merged: Decodable, Sendable { let entry: ChangelogEntry }
    let entry: [String: JSONValue] = [
      "title": .string(first.title),
      "body": .string(picked.map(\.body).filter { !$0.isEmpty }.joined(separator: "\n\n")),
      "tag": .string(first.tag.rawValue),
      "status": .string("draft")
    ]
    do {
      let body: [String: JSONValue] = ["refs": .array(picked.map { .string($0.id) }), "entry": .object(entry)]
      let result: Merged = try await session.send("/v1/admin/changelog/entries/merge?project=\(projectId)", body: body)
      endSelecting()
      try await fetch()
      return result.entry
    } catch {
      alert = error.localizedDescription
      return nil
    }
  }

  func moveSelected(toRelease releaseId: String) async {
    bulkBusy = "move"
    defer { bulkBusy = "" }
    do {
      for entry in selectedEntries where entry.releaseId != releaseId {
        _ = try await update(entry.id, ["releaseId": releaseId.isEmpty ? .null : .string(releaseId)])
      }
      endSelecting()
    } catch {
      alert = error.localizedDescription
      await refresh()
    }
  }

  func deleteSelected() async {
    bulkBusy = "delete"
    defer { bulkBusy = "" }
    do {
      for entry in selectedEntries { try await delete(entry.id) }
      endSelecting()
    } catch {
      alert = error.localizedDescription
      await refresh()
    }
  }

  // MARK: Releases

  private struct ReleaseResponse: Decodable, Sendable { let release: ChangelogRelease }

  func saveRelease(id: String?, version: String, title: String, summary: String) async throws {
    let body: [String: JSONValue] = ["version": .string(version), "title": .string(title), "summary": .string(summary)]
    let result: ReleaseResponse
    if let id { result = try await session.send("/v1/admin/changelog/releases/\(id)", method: "PATCH", body: body) }
    else { result = try await session.send("/v1/admin/changelog/releases?project=\(projectId)", body: body) }
    if let index = releases.firstIndex(where: { $0.id == result.release.id }) { releases[index] = result.release } else { releases.insert(result.release, at: 0) }
  }

  /// Publishes the release and its draft entries, which go out with it.
  func publishRelease(_ release: ChangelogRelease) async {
    bulkBusy = release.id
    defer { bulkBusy = "" }
    do {
      let _: ReleaseResponse = try await session.send("/v1/admin/changelog/releases/\(release.id)/publish")
      try await fetch()
    } catch {
      alert = error.localizedDescription
    }
  }

  /// Its entries stay, as entries of no release.
  func deleteRelease(_ id: String) async throws {
    try await session.delete("/v1/admin/changelog/releases/\(id)")
    try await fetch()
  }

  // MARK: Options

  /// `PATCH /admin/projects/:id { changelog }`: partial, only the keys sent change.
  func saveSettings(_ patch: [String: JSONValue]) async throws {
    struct Saved: Decodable, Sendable { let project: ChangelogProject }
    let saved: Saved = try await session.send("/v1/admin/projects/\(projectId)", method: "PATCH", body: ["changelog": JSONValue.object(patch)])
    project = saved.project
  }

  // MARK: Writing from commits

  func loadRun() async throws {
    struct Response: Decodable, Sendable { let run: ChangelogRun? }
    let response: Response = try await session.get("/v1/admin/changelog/generate", query: ["project": projectId])
    run = response.run
  }

  func openGenerate() async throws {
    struct Repo: Decodable, Sendable { let fullName: String? }
    struct Repos: Decodable, Sendable { let repos: [Repo] }
    async let repos: Repos = session.get("/v1/admin/projects/\(projectId)/repos")
    try await loadRun()
    repoNames = try await repos.repos.map { $0.fullName ?? "" }
    if run?.running == true { watchRun() }
  }

  /// `days` nil reads every commit the cap allows.
  func generate(days: Int?) async throws {
    struct Queued: Decodable, Sendable { let queued: Bool? }
    let _: Queued = try await session.send("/v1/admin/changelog/generate?project=\(projectId)", body: ["days": days.map { JSONValue.number(Double($0)) } ?? .null])
    try await loadRun()
    watchRun()
  }

  /// The run is a background job on the server: poll it, and refetch the entries once it ends.
  private func watchRun() {
    poll?.cancel()
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(3))
        guard let self, !Task.isCancelled else { return }
        try? await self.loadRun()
        if self.run?.running != true {
          try? await self.fetch()
          return
        }
      }
    }
  }

  func stopWatching() { poll?.cancel() }

  // MARK: Subscribers

  func subscribers() async throws -> ChangelogSubscribers {
    try await session.get("/v1/admin/changelog/subscriptions/summary", query: ["project": projectId])
  }

  func notify(job: String, dryRun: Bool) async throws -> ChangelogNotifyResult {
    try await session.send("/v1/admin/changelog/notify/run?project=\(projectId)", body: ["job": JSONValue.string(job), "dryRun": .bool(dryRun)])
  }

  // MARK: Imports

  enum ImportKind: String, CaseIterable, Identifiable {
    case entries, comments, subscriptions
    var id: String { rawValue }
    var label: String { self == .subscriptions ? "Subscribers" : rawValue.capitalized }
    var path: String {
      switch self {
      case .entries: "/v1/admin/changelog/entries/import"
      case .comments: "/v1/admin/changelog/comments/import"
      case .subscriptions: "/v1/admin/changelog/subscriptions/import"
      }
    }
    /// The most items one request takes.
    var chunk: Int { self == .subscriptions ? 500 : 100 }
  }

  struct ImportSummary: Equatable {
    var created = 0, updated = 0
    var failures: [String] = []
  }

  /// A JSON file: an array of items, or an object holding them under the kind's key
  /// (subscriptions may also carry `runs`, the past sends). Sent in the sizes the API takes.
  func importFile(_ data: Data, kind: ImportKind) async throws -> ImportSummary {
    let parsed = try await Task.detached { try JSONDecoder().decode(JSONValue.self, from: data) }.value
    var items: [JSONValue] = []
    var extra: [String: JSONValue] = [:]
    switch parsed {
    case .array(let list): items = list
    case .object(let object):
      guard case .array(let list)? = object[kind.rawValue] else { throw APIError.server("The file has no \"\(kind.rawValue)\" list.") }
      items = list
      if kind == .subscriptions, let runs = object["runs"] { extra["runs"] = runs }
    default: throw APIError.server("The file must be a JSON list, or an object with a \"\(kind.rawValue)\" list.")
    }
    guard !items.isEmpty else { throw APIError.server("The file has nothing to import.") }
    var summary = ImportSummary()
    for start in stride(from: 0, to: items.count, by: kind.chunk) {
      var body = extra
      body[kind.rawValue] = .array(Array(items[start..<min(start + kind.chunk, items.count)]))
      extra = [:]
      let result: ChangelogImportResult = try await session.send("\(kind.path)?project=\(projectId)", body: body)
      for item in result.results { if item.created == false { summary.updated += 1 } else { summary.created += 1 } }
      summary.failures += result.failed.map { "#\(start + $0.index + 1): \($0.message)" }
    }
    if kind == .entries { try? await fetch() }
    return summary
  }
}
