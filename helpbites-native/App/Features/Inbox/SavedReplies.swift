import SwiftUI

// Saved replies and the picker beside the reply box (web: components/inbox/ComposerTools.vue
// and SavedRepliesModal.vue). A reply is canned text with {{firstName}} and {{name}} in it;
// the picker fills them from the customer when it inserts one. FAQs from the project's
// assistants' knowledge sit in the same list. Managing replies lives here too, reached from
// the picker, so it needs no screen of its own.

struct SavedReply: Codable, Identifiable, Equatable, Sendable {
  let id, title, body: String
  let shortcut: String
  /// Absent in the picker's suggestions.
  var projectId: String?
}

/// shared/savedReplies.ts limits; tests/supportNativeParity.test.ts keeps them in step.
enum SavedReplyLimits {
  static let title = 120
  static let body = 8000
  static let shortcut = 30
  static let perProject = 200
}

/// shared/savedReplies.ts `fillSavedReply`, by hand. `{{firstName}}` is the first word of the
/// customer's name and `{{name}}` all of it, either `there` when they gave none; spaces inside
/// the braces and letter case are ignored; any other `{{…}}` is left as written.
enum SavedReplyFill {
  static let fallbackName = "there"
  static let placeholders = ["{{firstName}}", "{{name}}"]
  private static let pattern = "\\{\\{\\s*(firstName|name)\\s*\\}\\}"

  static func firstName(_ name: String?) -> String {
    let first = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
    return first.isEmpty ? fallbackName : first
  }

  static func fullName(_ name: String?) -> String {
    let full = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return full.isEmpty ? fallbackName : full
  }

  static func fill(_ body: String, name: String?) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return body }
    let source = body as NSString
    var out = body
    // From the end, so the earlier ranges still hold as the text changes length.
    for match in regex.matches(in: body, range: NSRange(location: 0, length: source.length)).reversed() {
      let key = source.substring(with: match.range(at: 1)).lowercased()
      out = (out as NSString).replacingCharacters(in: match.range, with: key == "firstname" ? firstName(name) : fullName(name))
    }
    return out
  }
}

// MARK: - The picker

/// Saved replies and FAQs that fit what the customer asked, searchable. Tapping one hands its
/// text back (replies filled in for the customer) and closes.
struct InboxReplyPicker: View {
  let conversationId: String
  let projectId: String
  let customerName: String
  let insert: (String) -> Void
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var result: InboxSuggestions?
  @State private var error = ""
  @State private var managing = false
  @State private var reload = 0

  var body: some View {
    NavigationStack {
      Group {
        if let result {
          if result.savedReplies.isEmpty && result.faqs.isEmpty {
            EmptyState(systemImage: "text.bubble", title: "Nothing matches", message: query.isEmpty ? "Save a reply with the Manage button, or add FAQs to the assistant's knowledge." : nil)
              .frame(maxHeight: .infinity, alignment: .top)
          } else {
            list(result)
          }
        } else if !error.isEmpty {
          ErrorText(message: error).padding(20).frame(maxHeight: .infinity, alignment: .top)
        } else {
          SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
        }
      }
      .searchable(text: $query, prompt: "Search saved replies and FAQs")
      .panelScreen("Replies and FAQs")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .primaryAction) { Button("Manage") { managing = true } }
      }
      .task(id: "\(query)|\(reload)") {
        // Typing waits a beat; the first look at the list does not.
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        if Task.isCancelled { return }
        await load()
      }
      .sheet(isPresented: $managing, onDismiss: { reload += 1 }) { SavedRepliesSheet(projectId: projectId).environment(workspace) }
    }
    .presentationDetents([.medium, .large])
  }

  private func list(_ result: InboxSuggestions) -> some View {
    List {
      if !result.savedReplies.isEmpty {
        Section {
          ForEach(result.savedReplies) { reply in
            row(title: reply.title, trailing: reply.shortcut.isEmpty ? nil : "/\(reply.shortcut)", text: SavedReplyFill.fill(reply.body, name: customerName)) {
              insert(SavedReplyFill.fill(reply.body, name: customerName))
            }
          }
        } header: { SectionLabel("Saved replies") }
      }
      if !result.faqs.isEmpty {
        Section {
          ForEach(result.faqs) { faq in
            row(title: faq.question, trailing: nil, text: faq.answer) { insert(faq.answer) }
          }
        } header: { SectionLabel("FAQs") }
      }
    }
    .linearList()
  }

  private func row(title: String, trailing: String?, text: String, action: @escaping () -> Void) -> some View {
    Button {
      action()
      dismiss()
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          if let trailing { Text(trailing).font(.lnMono).foregroundStyle(Theme.textMuted) }
          Spacer(minLength: 0)
        }
        Text(text).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(2)
      }
      .padding(.vertical, 6)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .linearRow()
  }

  private func load() async {
    do {
      var params: [String: String] = [:]
      let term = query.trimmingCharacters(in: .whitespaces)
      if !term.isEmpty { params["q"] = term }
      result = try await workspace.session.get("/v1/admin/conversations/\(conversationId)/suggestions", query: params)
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }
}

// MARK: - Managing the library

/// A project's saved replies: add, edit, swipe to delete.
struct SavedRepliesSheet: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var replies: [SavedReply] = []
  @State private var loaded = false
  @State private var error = ""
  @State private var editing: SavedReplyDraft?

  private struct RepliesResponse: Decodable, Sendable { let replies: [SavedReply] }

  var body: some View {
    NavigationStack {
      Group {
        if !loaded && error.isEmpty {
          SkeletonRows(count: 3).frame(maxHeight: .infinity, alignment: .top)
        } else if replies.isEmpty {
          VStack(spacing: 0) {
            ErrorText(message: error).padding(.horizontal, 16).padding(.top, 12)
            EmptyState(systemImage: "text.bubble", title: "No saved replies yet", message: "Canned answers you insert while replying. {{firstName}} and {{name}} are filled in from the customer.") {
              Button("New saved reply") { editing = SavedReplyDraft() }.buttonStyle(.lnPrimaryCompact)
            }
            .frame(maxHeight: .infinity, alignment: .top)
          }
        } else {
          List {
            ForEach(replies) { reply in
              Button { editing = SavedReplyDraft(reply) } label: {
                VStack(alignment: .leading, spacing: 2) {
                  HStack(spacing: 6) {
                    Text(reply.title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                    if !reply.shortcut.isEmpty { Text("/\(reply.shortcut)").font(.lnMono).foregroundStyle(Theme.textMuted) }
                    Spacer(minLength: 0)
                  }
                  Text(reply.body).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(2)
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .linearRow()
            }
            .onDelete { offsets in
              let doomed = offsets.map { replies[$0] }
              Task { for reply in doomed { await remove(reply) } }
            }
            Text("\(replies.count) / \(SavedReplyLimits.perProject)").font(.lnCaption).foregroundStyle(Theme.textMuted).linearRow()
            ErrorText(message: error).linearRow()
          }
          .linearList()
        }
      }
      .panelScreen("Saved replies")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        ToolbarItem(placement: .primaryAction) {
          Button { editing = SavedReplyDraft() } label: { Label("New", systemImage: "plus") }.disabled(replies.count >= SavedReplyLimits.perProject)
        }
      }
      .task { await load() }
      .sheet(item: $editing) { draft in
        SavedReplyEditor(projectId: projectId, draft: draft) { saved in
          if let index = replies.firstIndex(where: { $0.id == saved.id }) { replies[index] = saved } else { replies.append(saved) }
          replies.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
        .environment(workspace)
      }
    }
    .presentationDetents([.large])
  }

  private func load() async {
    do {
      let result: RepliesResponse = try await workspace.session.get("/v1/admin/saved-replies", query: ["project": projectId])
      replies = result.replies
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loaded = true
  }

  private func remove(_ reply: SavedReply) async {
    do {
      try await workspace.session.delete("/v1/admin/saved-replies/\(reply.id)")
      replies.removeAll { $0.id == reply.id }
      error = ""
    } catch {
      self.error = error.localizedDescription
    }
  }
}

private struct SavedReplyDraft: Identifiable {
  let id = UUID()
  var replyId: String?
  var title = ""
  var shortcut = ""
  var body = ""

  init() {}
  init(_ reply: SavedReply) {
    replyId = reply.id
    title = reply.title
    shortcut = reply.shortcut
    body = reply.body
  }
}

private struct SavedReplyEditor: View {
  let projectId: String
  @State var draft: SavedReplyDraft
  let saved: (SavedReply) -> Void
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var saving = false
  @State private var error = ""

  private struct Input: Encodable, Sendable {
    let project: String?
    let title, body, shortcut: String
  }
  private struct Output: Decodable, Sendable { let reply: SavedReply }

  private var canSave: Bool {
    !saving && !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          LabeledField(label: "Title") {
            TextField("Refund policy", text: $draft.title).textFieldStyle(.linear)
          }
          LabeledField(label: "Shortcut", hint: "Optional, e.g. refund") {
            TextField("refund", text: $draft.shortcut)
              .textFieldStyle(.linear)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
          LabeledField(label: "Reply", hint: "Use {{firstName}} and {{name}}: they're filled in from the customer.") {
            LinearTextEditor(text: $draft.body, placeholder: "Hi {{firstName}}, …", minHeight: 160)
          }
          ErrorText(message: error)
        }
        .padding(16)
      }
      .panelScreen(draft.replyId == nil ? "New saved reply" : "Edit saved reply")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(!canSave) }
      }
    }
    .presentationDetents([.large])
  }

  private func save() async {
    saving = true
    defer { saving = false }
    let title = String(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(SavedReplyLimits.title))
    let body = String(draft.body.trimmingCharacters(in: .whitespacesAndNewlines).prefix(SavedReplyLimits.body))
    do {
      let result: Output
      if let id = draft.replyId {
        result = try await workspace.session.send("/v1/admin/saved-replies/\(id)", method: "PATCH", body: Input(project: nil, title: title, body: body, shortcut: draft.shortcut))
      } else {
        result = try await workspace.session.send("/v1/admin/saved-replies", body: Input(project: projectId, title: title, body: body, shortcut: draft.shortcut))
      }
      saved(result.reply)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
