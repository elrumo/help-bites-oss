import SwiftUI

/// The changelog entries a conversation is behind (components/ChangelogLinks.vue, kind
/// "conversation"): unlink one, start a draft linked to this ticket, or add it to an entry.
struct InboxChangelogLinks: View {
  let projectId: String
  let conversationId: String
  /// The conversation's type key: an error ticket drafts as a fix.
  let type: String?
  @Environment(Workspace.self) private var workspace
  @State private var linked: [Row] = []
  @State private var all: [Row] = []
  @State private var loaded = false
  @State private var composing = false
  @State private var title = ""
  @State private var busy = ""
  @State private var picking = false
  @State private var error = ""

  struct Row: Decodable, Identifiable, Equatable, Sendable {
    let id, title, status: String
    let number: Int?
    var label: String { "\(number.map { "#\($0) " } ?? "")\(title)\(status == "draft" ? " (draft)" : "")" }
  }
  private struct Entries: Decodable, Sendable { let entries: [Row] }
  private struct One: Decodable, Sendable { let entry: Row }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if !loaded { RoundedRectangle(cornerRadius: Metrics.radiusSmall).fill(Theme.elevated).frame(height: 28).padding(.horizontal, 8) }
      ForEach(linked) { entry in
        HStack(spacing: 8) {
          Button { workspace.go(.project(projectId, .changelog)) } label: {
            HStack(spacing: 8) {
              Circle().fill(entry.status == "published" ? Theme.success : Theme.textDimmed).frame(width: 7, height: 7)
              if let number = entry.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
              Text(entry.title).foregroundStyle(Theme.text).lineLimit(1)
              Spacer(minLength: 0)
            }
            .font(.lnMeta).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          Button { Task { await link(entry.id, false) } } label: {
            Group { if busy == entry.id { ProgressView().controlSize(.mini) } else { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textDimmed) } }
              .frame(width: 24, height: 24).contentShape(Rectangle())
          }
          .buttonStyle(.plain).disabled(!busy.isEmpty)
          .accessibilityLabel("Unlink \(entry.label)")
        }
        .padding(.horizontal, 8).frame(height: 32)
      }
      if composing {
        VStack(alignment: .leading, spacing: 6) {
          TextField("What changed, for your users", text: $title).textFieldStyle(.linear).onSubmit { Task { await create() } }
          HStack {
            Button("Create draft") { Task { await create() } }.buttonStyle(.lnPrimaryCompact).disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || busy == "new")
            Button("Cancel") { composing = false }.buttonStyle(.lnGhost)
          }
        }
        .padding(.horizontal, 8).padding(.top, 4)
      } else {
        HStack(spacing: 6) {
          Button { title = ""; composing = true } label: { Label("New entry", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact)
          Button { picking = true } label: { Label("Add to existing", systemImage: "list.bullet.rectangle") }.buttonStyle(.lnSecondaryCompact)
        }
        .padding(.horizontal, 8).padding(.top, 4)
      }
      ErrorText(message: error).padding(.horizontal, 8)
    }
    .task(id: "\(projectId)|\(conversationId)") { await load() }
    .sheet(isPresented: $picking) { picker }
  }

  private var picker: some View {
    NavigationStack {
      let candidates = all.filter { entry in !linked.contains { $0.id == entry.id } }
      List(candidates) { entry in
        Button { picking = false; Task { await link(entry.id, true) } } label: { Text(entry.label).lineLimit(1) }.buttonStyle(.plain).linearRow()
      }
      .linearList()
      .overlay { if candidates.isEmpty { EmptyState(systemImage: "scroll", title: all.isEmpty ? "No entries yet" : "Every entry is linked") } }
      .panelScreen("Add to an entry")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { picking = false } } }
    }
    .task { if all.isEmpty, let result: Entries = try? await workspace.session.get("/v1/admin/changelog/entries", query: ["project": projectId]) { all = result.entries } }
    #if os(macOS)
    .frame(minWidth: 420, minHeight: 420)
    #endif
  }

  private func load() async {
    guard !conversationId.isEmpty else { linked = []; loaded = true; return }
    do {
      linked = (try await workspace.session.get("/v1/admin/changelog/entries", query: ["project": projectId, "conversation": conversationId]) as Entries).entries
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loaded = true
  }

  private func link(_ entryId: String, _ on: Bool) async {
    struct Input: Encodable, Sendable { let kind, id: String; let linked: Bool }
    busy = entryId; error = ""
    defer { busy = "" }
    do {
      let result: One = try await workspace.session.send("/v1/admin/changelog/entries/\(entryId)/links", body: Input(kind: "conversation", id: conversationId, linked: on))
      if on { if !linked.contains(where: { $0.id == result.entry.id }) { linked.append(result.entry) } } else { linked.removeAll { $0.id == entryId } }
    } catch { self.error = error.localizedDescription }
  }

  private func create() async {
    struct Input: Encodable, Sendable { let title, body, tag, status: String; let conversationIds: [String] }
    let text = title.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return }
    busy = "new"; error = ""
    defer { busy = "" }
    do {
      let result: One = try await workspace.session.send("/v1/admin/changelog/entries?project=\(projectId)", body: Input(title: String(text.prefix(200)), body: "", tag: type == "error" ? "fix" : "improved", status: "draft", conversationIds: [conversationId]))
      linked.append(result.entry); all = []; composing = false
    } catch { self.error = error.localizedDescription }
  }
}
