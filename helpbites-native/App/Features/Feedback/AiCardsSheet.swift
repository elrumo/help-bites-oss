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
  @State private var sending = false
  @Environment(\.dismiss) private var dismiss

  struct Turn: Identifiable {
    let id = UUID()
    let role: String
    let text: String
    var failed = false
    var created: [Card] = []
    var errors: [String] = []
  }

  struct Card: Decodable, Sendable, Identifiable {
    let id: String
    let number: Int?
    let title: String
  }

  private struct Message: Encodable, Sendable { let role: String, content: String }
  private struct Input: Encodable, Sendable { let kind: String, messages: [Message] }
  private struct Failure: Decodable, Sendable { let title: String, message: String }
  private struct Output: Decodable, Sendable { let reply: String, created: [Card], failed: [Failure] }

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
        HStack(alignment: .bottom, spacing: 8) {
          TextField("Text to file", text: $draft, axis: .vertical).lineLimit(1...8).textFieldStyle(.roundedBorder)
          Button { Task { await send() } } label: { Label("Create cards", systemImage: "sparkles") }
            .buttonStyle(.borderedProminent)
            .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
      if !turn.created.isEmpty {
        Text("Created \(turn.created.count):").font(.lnCaption).bold().padding(.top, 4)
        ForEach(turn.created) { card in
          Text(card.number.map { "#\($0) \(card.title)" } ?? card.title).font(.lnCaption)
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
    turns.append(Turn(role: "user", text: text))
    draft = ""
    sending = true
    defer { sending = false }
    // The model sees the words, plus the titles it already filed so it does not file them twice.
    let history = turns.filter { !$0.failed }.map { turn in
      Message(role: turn.role, content: ([turn.text] + (turn.created.isEmpty ? [] : ["Created: " + turn.created.map(\.title).joined(separator: "; ")])).joined(separator: "\n"))
    }
    do {
      let result: Output = try await session.send("/v1/admin/projects/\(projectId)/ai-cards", body: Input(kind: kind.rawValue, messages: history))
      let reply = result.reply.isEmpty && result.created.isEmpty ? String(localized: "Nothing to file in that.") : result.reply
      turns.append(Turn(role: "assistant", text: reply, created: result.created, errors: result.failed.map { "\($0.title): \($0.message)" }))
      if !result.created.isEmpty { await onCreated() }
    } catch {
      turns.append(Turn(role: "assistant", text: error.localizedDescription, failed: true))
    }
  }
}
