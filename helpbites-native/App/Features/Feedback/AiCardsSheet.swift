import SwiftUI

/// The AI chat on the Feedback and Planning screens (AiCardsChat.vue): text in, separate cards out.
/// `POST /v1/admin/projects/:id/ai-cards` files them; `onCreated` lets the screen reload.
struct AiCardsSheet: View {
  enum Kind: String { case feedback, board }

  let session: SessionStore
  let projectId: String
  let kind: Kind
  let onCreated: @MainActor () async -> Void

  @State private var turns: [Turn] = []
  @State private var draft = ""
  /// Images and files attached to the message being written: they go onto every card it creates.
  @State private var files: [ItemAttachment] = []
  @State private var sending = false
  @Environment(\.dismiss) private var dismiss

  struct Turn: Identifiable {
    let id = UUID()
    let role: String
    let text: String
    var failed = false
    var files: [ItemAttachment] = []
    var created: [Card] = []
    var changed: [Change] = []
    var errors: [String] = []
  }

  struct Card: Decodable, Sendable, Identifiable {
    let id: String
    let number: Int?
    let title: String
  }

  /// An existing item the chat changed or related, with what changed.
  struct Change: Decodable, Sendable, Identifiable {
    let id: String
    let number: Int?
    let title: String
    let changes: [String]
  }

  private struct Message: Encodable, Sendable { let role: String, content: String }
  private struct Input: Encodable, Sendable { let kind: String, messages: [Message], attachments: [ItemAttachment] }
  private struct Failure: Decodable, Sendable { let title: String, message: String }
  private struct Output: Decodable, Sendable { let reply: String, created: [Card], updated: [Change], failed: [Failure] }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            Text(kind == .feedback ? "Paste customer emails, reviews or notes. Each request becomes its own post." : "Paste a plan, meeting notes or a list. Each task becomes its own item.")
              .font(.lnMeta).foregroundStyle(Theme.textMuted)
            ForEach(turns) { turn in bubble(turn) }
            if sending { ProgressView().frame(maxWidth: .infinity, alignment: .leading) }
          }
          .padding(16)
        }
        Divider()
        VStack(spacing: 8) {
          AttachmentsSection(attachments: $files, session: session, projectId: projectId)
          HStack(alignment: .bottom, spacing: 8) {
            TextField("Text to file", text: $draft, axis: .vertical).lineLimit(1...8).textFieldStyle(.roundedBorder)
            Button { Task { await send() } } label: { Label("Create cards", systemImage: "sparkles") }
              .buttonStyle(.borderedProminent)
              .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
        .padding(12)
      }
      .panelScreen(kind == .feedback ? "File feedback with AI" : "File items with AI")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
    }
  }

  @ViewBuilder private func bubble(_ turn: Turn) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      if !turn.text.isEmpty { Text(turn.text) }
      ForEach(turn.files, id: \.url) { file in Text("📎 \(file.name)").font(.lnCaption) }
      if !turn.created.isEmpty {
        Text("Created \(turn.created.count):").font(.lnCaption).bold().padding(.top, 4)
        ForEach(turn.created) { card in
          Text(card.number.map { "#\($0) \(card.title)" } ?? card.title).font(.lnCaption)
        }
      }
      if !turn.changed.isEmpty {
        Text("Changed \(turn.changed.count):").font(.lnCaption).bold().padding(.top, 4)
        ForEach(turn.changed) { item in
          Text("\(item.number.map { "#\($0) " } ?? "")\(item.title) · \(item.changes.joined(separator: ", "))").font(.lnCaption)
        }
      }
      ForEach(turn.errors, id: \.self) { Text($0).font(.lnCaption).foregroundStyle(Theme.error) }
    }
    .font(.lnMeta)
    .foregroundStyle(turn.failed ? Theme.error : Theme.text)
    .padding(10)
    .frame(maxWidth: .infinity, alignment: turn.role == "user" ? .trailing : .leading)
    .background(turn.role == "user" ? Theme.accent.opacity(0.15) : Theme.elevated, in: RoundedRectangle(cornerRadius: 12))
  }

  private func send() async {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !sending else { return }
    let attached = files
    turns.append(Turn(role: "user", text: text, files: attached))
    draft = ""
    files = []
    sending = true
    defer { sending = false }
    // The model sees the words, plus what it already filed or changed so it does not repeat it.
    let history = turns.filter { !$0.failed }.map { turn in
      let changed = turn.changed.map { "\($0.number.map { "#\($0)" } ?? $0.title): \($0.changes.joined(separator: ", "))" }
      return Message(role: turn.role, content: ([turn.text] + (turn.created.isEmpty ? [] : ["Created: " + turn.created.map(\.title).joined(separator: "; ")]) + (changed.isEmpty ? [] : ["Changed: " + changed.joined(separator: "; ")])).joined(separator: "\n"))
    }
    do {
      let result: Output = try await session.send("/v1/admin/projects/\(projectId)/ai-cards", body: Input(kind: kind.rawValue, messages: history, attachments: attached))
      let nothingChanged = result.created.isEmpty && result.updated.isEmpty
      let reply = result.reply.isEmpty && nothingChanged ? String(localized: "Nothing to file in that.") : result.reply
      turns.append(Turn(role: "assistant", text: reply, created: result.created, changed: result.updated, errors: result.failed.map { "\($0.title): \($0.message)" }))
      if !nothingChanged { await onCreated() }
    } catch {
      files = attached
      turns.append(Turn(role: "assistant", text: error.localizedDescription, failed: true))
    }
  }
}
