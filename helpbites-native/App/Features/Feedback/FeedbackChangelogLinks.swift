import SwiftUI

/// The changelog entries a post is behind (components/ChangelogLinks.vue, kind "feedback"):
/// open one, unlink it, start a draft from the post, or add the post to an entry that
/// already exists. Nothing is published from here.
struct FeedbackChangelogLinks: View {
  let projectId: String
  let post: FeedbackPost
  /// Opens the project's changelog (the editor closes first).
  let openChangelog: () -> Void
  @Environment(SessionStore.self) private var session
  @State private var linked: [Entry] = []
  @State private var all: [Entry] = []
  @State private var loaded = false
  @State private var composing = false
  @State private var picking = false
  @State private var title = ""
  @State private var creating = false
  @State private var busy = ""
  @State private var error = ""

  struct Entry: Decodable, Identifiable, Equatable, Sendable {
    let id, title, status: String
    let number: Int?
    var label: String { (number.map { "#\($0) " } ?? "") + title }
  }
  private struct EntriesResponse: Decodable, Sendable { let entries: [Entry] }
  private struct EntryResponse: Decodable, Sendable { let entry: Entry }
  private struct LinkInput: Encodable, Sendable { let kind, id: String; let linked: Bool }
  private struct CreateInput: Encodable, Sendable {
    let title, body, tag, status: String
    let feedbackPostIds: [String]
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !loaded { RoundedRectangle(cornerRadius: Metrics.radiusSmall).fill(Theme.elevated).frame(height: Metrics.scaled(28)) }
      ForEach(linked) { entry in row(entry) }
      if composing {
        HStack(spacing: 8) {
          TextField("What changed, for your users", text: $title).textFieldStyle(.linear).onSubmit { Task { await create() } }
          Button("Create draft") { Task { await create() } }
            .buttonStyle(.lnPrimaryCompact)
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || creating)
          Button("Cancel") { composing = false }.buttonStyle(.lnGhost)
        }
      } else {
        HStack(spacing: 6) {
          Button {
            title = prefill.title
            composing = true
          } label: { Label("New entry", systemImage: "plus") }
            .buttonStyle(.lnSecondaryCompact)
          Button { picking = true } label: { Label("Add to existing", systemImage: "scroll") }
            .buttonStyle(.lnSecondaryCompact)
        }
      }
      ErrorText(message: error)
    }
    .task(id: post.id) { await load() }
    .sheet(isPresented: $picking) {
      FeedbackEntryPicker(projectId: projectId, exclude: Set(linked.map(\.id))) { entry in Task { await link(entry.id, true) } }
    }
  }

  private func row(_ entry: Entry) -> some View {
    HStack(spacing: 8) {
      Button(action: openChangelog) {
        HStack(spacing: 8) {
          Circle().fill(entry.status == "published" ? Theme.success : Theme.textDimmed).frame(width: 7, height: 7)
            .accessibilityLabel(entry.status == "published" ? "Published" : "Draft")
          Text(entry.label).foregroundStyle(Theme.text).lineLimit(1)
          Spacer(minLength: 0)
        }
        .font(.lnMeta)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Button { Task { await link(entry.id, false) } } label: {
        Group {
          if busy == entry.id { ProgressView().controlSize(.mini) } else { Image(systemName: "xmark").font(.app(size: 9, weight: .bold)).foregroundStyle(Theme.textDimmed) }
        }
        .frame(width: 24, height: 24)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(!busy.isEmpty)
      .accessibilityLabel("Unlink \(entry.label)")
    }
    .frame(minHeight: Metrics.scaled(32))
  }

  /// `changelogPrefill("feedback", …)`: what is already public, nothing else.
  private var prefill: (title: String, body: String, tag: String) {
    (
      post.changelogTitle.isEmpty ? post.title : post.changelogTitle,
      post.changelogBody.isEmpty ? post.body : post.changelogBody,
      post.type == "bug" ? "fix" : post.type == "feature" ? "new" : "improved"
    )
  }

  private func load() async {
    do {
      let result: EntriesResponse = try await session.get("/v1/admin/changelog/entries", query: ["project": projectId, "feedbackPost": post.id])
      linked = result.entries
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loaded = true
  }

  private func link(_ entryId: String, _ on: Bool) async {
    busy = entryId
    defer { busy = "" }
    error = ""
    do {
      let result: EntryResponse = try await session.send("/v1/admin/changelog/entries/\(entryId)/links", body: LinkInput(kind: "feedback", id: post.id, linked: on))
      if on { if !linked.contains(where: { $0.id == entryId }) { linked.append(result.entry) } } else { linked.removeAll { $0.id == entryId } }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func create() async {
    let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    creating = true
    defer { creating = false }
    error = ""
    do {
      let input = CreateInput(title: String(name.prefix(200)), body: prefill.body, tag: prefill.tag, status: "draft", feedbackPostIds: [post.id])
      let result: EntryResponse = try await session.send("/v1/admin/changelog/entries?project=\(projectId)", body: input)
      linked.append(result.entry)
      composing = false
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// Every entry of the project (archived ones excluded), searchable; tap one to link the post to it.
private struct FeedbackEntryPicker: View {
  let projectId: String
  let exclude: Set<String>
  let pick: (FeedbackChangelogLinks.Entry) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var entries: [FeedbackChangelogLinks.Entry] = []
  @State private var loading = true
  @State private var search = ""
  @State private var error = ""

  private struct Response: Decodable, Sendable { let entries: [FeedbackChangelogLinks.Entry] }

  private var shown: [FeedbackChangelogLinks.Entry] {
    let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return entries.filter { !exclude.contains($0.id) && (needle.isEmpty || $0.label.localizedStandardContains(needle)) }
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        SearchField(text: $search, prompt: "Search entries").padding(Metrics.gutter)
        if loading {
          SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
        } else if !error.isEmpty {
          ErrorText(message: error).padding(Metrics.gutter).frame(maxHeight: .infinity, alignment: .top)
        } else if shown.isEmpty {
          EmptyState(systemImage: "scroll", title: "No entries to add", message: "Every entry already has this post, or the changelog is empty.").frame(maxHeight: .infinity)
        } else {
          List(shown) { entry in
            Button {
              pick(entry)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                Text(entry.label).foregroundStyle(Theme.text).lineLimit(2)
                if entry.status == "draft" { Text("Draft").font(.lnCaption).foregroundStyle(Theme.textMuted) }
                Spacer(minLength: 0)
              }
              .font(.lnRow)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .linearRow()
          }
          .linearList()
        }
      }
      .panelScreen("Add to entry")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .task {
        do {
          let result: Response = try await session.get("/v1/admin/changelog/entries", query: ["project": projectId])
          entries = result.entries
        } catch {
          self.error = error.localizedDescription
        }
        loading = false
      }
    }
    .presentationDetents([.large])
  }
}
