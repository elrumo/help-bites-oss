import SwiftUI

/// The conversations a public entry answers (GET …/linked-conversations): its own links and its
/// board items'. `defaultBody` is the starting text of a reply.
struct ChangelogLinkedConversations: Decodable, Equatable, Sendable {
  struct Conversation: Decodable, Equatable, Identifiable, Sendable {
    let id, subject, endUserName, status: String
  }
  let count: Int
  let conversations: [Conversation]
  let defaultBody: String
}

/// What happened to each conversation (POST …/reply-conversations).
struct ChangelogReplyResult: Decodable, Equatable, Sendable {
  struct Row: Decodable, Equatable, Sendable {
    let conversationId: String
    let ok, emailSent: Bool
    let error: String
  }
  let sent, failed: Int
  let results: [Row]
}

/// "Reply to N linked conversations" (components/ChangelogReplyDialog.vue): tell the people a published
/// entry answers, in the thread they already have. The message starts as the entry's title and public
/// address and is yours to edit. Nothing is sent until you press Send.
struct ChangelogReplySheet: View {
  let projectId: String
  let entryId: String
  let linked: ChangelogLinkedConversations
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var message: String
  @State private var chosen: Set<String>
  @State private var notifyByEmail = true
  @State private var sending = false
  @State private var result: ChangelogReplyResult?
  @State private var error = ""

  init(projectId: String, entryId: String, linked: ChangelogLinkedConversations) {
    self.projectId = projectId
    self.entryId = entryId
    self.linked = linked
    _message = State(initialValue: linked.defaultBody)
    _chosen = State(initialValue: Set(linked.conversations.map(\.id)))
  }

  private var canSend: Bool { !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !chosen.isEmpty && !sending && result == nil }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Text("Tell the people this entry answers. Nothing is sent until you press Send.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Your message") {
            LinearTextEditor(text: $message, minHeight: 110)
              .disabled(result != nil)
              .onChange(of: message) { _, value in if value.count > 8000 { message = String(value.prefix(8000)) } }
          }
          conversationList
          FeedbackToggleRow(title: "Email them too", detail: "People with an email address also get the reply by email, as with any reply from the inbox.", isOn: $notifyByEmail)
            .disabled(result != nil)
          if let result {
            Text("\(result.sent) sent, \(result.failed) failed.").font(.lnMetaMedium).foregroundStyle(result.failed > 0 ? Theme.warning : Theme.success)
          }
          ErrorText(message: error)
        }
        .frame(maxWidth: 640, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Reply to linked conversations")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(result == nil ? "Cancel" : "Close") { dismiss() } }
        if result == nil {
          ToolbarItem(placement: .confirmationAction) {
            Button { Task { await send() } } label: { if sending { ProgressView().controlSize(.mini) } else { Text("Send to \(chosen.count)") } }
              .disabled(!canSend)
          }
        }
      }
    }
    .presentationDetents([.large])
    .changelogSheetSize()
  }

  private var conversationList: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text("Conversations").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("\(chosen.count) of \(linked.count) selected").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
        Spacer(minLength: 0)
        if result == nil {
          Button(chosen.count == linked.conversations.count ? "Select none" : "Select all") {
            chosen = chosen.count == linked.conversations.count ? [] : Set(linked.conversations.map(\.id))
          }
          .buttonStyle(.lnGhost)
        }
      }
      Card {
        ForEach(Array(linked.conversations.enumerated()), id: \.element.id) { index, conversation in
          CardRow(divider: index < linked.conversations.count - 1) { row(conversation) }
        }
      }
    }
  }

  private func row(_ conversation: ChangelogLinkedConversations.Conversation) -> some View {
    let picked = chosen.contains(conversation.id)
    let outcome = result?.results.first { $0.conversationId == conversation.id }
    return Button {
      if picked { chosen.remove(conversation.id) } else { chosen.insert(conversation.id) }
    } label: {
      HStack(spacing: 10) {
        Image(systemName: picked ? "checkmark.circle.fill" : "circle").font(.app(size: 18)).foregroundStyle(picked ? Theme.accent : Theme.textDimmed)
        Text(conversation.subject.isEmpty ? String(localized: "Conversation") : conversation.subject).foregroundStyle(Theme.text).lineLimit(1)
        if !conversation.endUserName.isEmpty { Text("· \(conversation.endUserName)").foregroundStyle(Theme.textMuted).lineLimit(1) }
        Spacer(minLength: 4)
        if let outcome {
          ChangelogChip(text: outcome.ok ? (outcome.emailSent ? String(localized: "Sent and emailed") : String(localized: "Sent")) : String(localized: "Failed"), tint: outcome.ok ? Theme.success : Theme.error)
        } else {
          Text(conversation.status.capitalized).font(.lnCaption).foregroundStyle(Theme.textToned)
        }
      }
      .font(.lnMeta)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(result != nil)
    .accessibilityAddTraits(picked ? .isSelected : [])
  }

  private func send() async {
    sending = true
    defer { sending = false }
    error = ""
    do {
      let body: [String: JSONValue] = [
        "body": .string(message.trimmingCharacters(in: .whitespacesAndNewlines)),
        "conversationIds": .array(linked.conversations.map(\.id).filter { chosen.contains($0) }.map { .string($0) }),
        "notifyByEmail": .bool(notifyByEmail)
      ]
      let sent: ChangelogReplyResult = try await workspace.session.send("/v1/admin/changelog/entries/\(entryId)/reply-conversations?project=\(projectId)", body: body)
      result = sent
    } catch {
      self.error = error.localizedDescription
    }
  }
}
