import Foundation
import SwiftUI

// The customer panel beside a conversation (shared/conversationHub.ts): who the
// requester is, their Stripe plan, their other conversations, the feedback they
// follow, and the helpers that answer them. One read per open conversation
// (GET /v1/admin/conversations/:id/context); the rest are the calls the panel
// and the composer make. The shapes mirror the server's, field for field.

struct HubContact: Codable, Equatable, Sendable {
  let id, name, email, externalId, language: String
  let lastSeenAt: String?
}

/// `mrr` is in major currency units (19.99), as the Stripe sync writes it on the contact.
struct HubBilling: Codable, Equatable, Sendable {
  let plan: String
  let mrr: Double
  let currency, status, customerId: String
}

struct HubPastConversation: Codable, Identifiable, Equatable, Sendable {
  let id, subject, status, statusCategory, lastMessagePreview, createdAt: String
  let lastMessageAt: String?
}

struct HubFeedbackPost: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let number: Int?
  let title, status, statusLabel, statusCategory: String
  /// The requester follows the post and is emailed about it.
  var following: Bool
}

struct HubFaqModel: Codable, Identifiable, Equatable, Sendable { let id, name: String }
struct HubFaqModels: Codable, Equatable, Sendable { let models: [HubFaqModel]; let defaultModelId: String }

struct ConversationHubContext: Codable, Equatable, Sendable {
  let contact: HubContact
  /// Nil unless the contact has a Stripe customer.
  let billing: HubBilling?
  let pastConversations: [HubPastConversation]
  var feedbackPosts: [HubFeedbackPost]
  let faqModels: HubFaqModels
}

/// POST …/feedback-posts: the conversation's linked ids after the change, and the post as the panel shows it.
struct HubFeedbackLink: Decodable, Sendable {
  let feedbackPostIds: [String]
  let post: HubFeedbackPost
  let linked, created, following: Bool
}

struct SuggestedFaq: Decodable, Identifiable, Equatable, Sendable { let id, question, answer: String }
struct InboxSuggestions: Decodable, Sendable { let faqs: [SuggestedFaq]; let savedReplies: [SavedReply] }

struct HubDraftSource: Decodable, Sendable { let faqId, question: String }
struct HubDraft: Decodable, Sendable { let draft, model: String; let sources: [HubDraftSource] }

/// A post from the feedback board's list, as the "add an existing post" picker needs it.
struct HubPostHit: Decodable, Identifiable, Equatable, Sendable {
  let id: String
  let number: Int?
  let title: String
}

enum InboxHub {
  /// shared/conversationHub.ts `faqPrefill`: the reply as the answer, and the customer's closest
  /// earlier public message as the question. `messages` must be oldest first.
  static func faqPrefill(_ messages: [Message], messageId: String) -> (question: String, answer: String) {
    guard let at = messages.firstIndex(where: { $0.id == messageId }) else { return ("", "") }
    let question = messages[..<at].last { $0.sender == "user" && $0.kind != "event" && $0.visibility != "internal" && !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    return (String((question?.body.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").prefix(500)), messages[at].body.trimmingCharacters(in: .whitespacesAndNewlines))
  }
}

// MARK: - Save as FAQ

/// "Save as FAQ" on a reply (web: components/inbox/SaveFaqModal.vue): the question and the answer
/// start from the thread and are edited here; the model starts on the one the conversation's
/// assistant reads. Saved active, so assistants can use it at once.
struct InboxFaqSheet: View {
  let message: Message
  /// The conversation's messages, oldest first, to find the question this reply answered.
  let messages: [Message]
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var question = ""
  @State private var answer = ""
  @State private var modelId = ""
  @State private var started = false
  @State private var saving = false
  @State private var error = ""

  private var models: [HubFaqModel] { workspace.inbox.context?.faqModels.models ?? [] }
  private var canSave: Bool { !saving && !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    NavigationStack {
      Group {
        if models.isEmpty {
          EmptyState(systemImage: "books.vertical", title: "No knowledge model yet", message: "This workspace has no knowledge model. Create one first, then save answers into it.") {
            Button("Open Knowledge") {
              dismiss()
              workspace.go(.knowledge)
            }
            .buttonStyle(.lnPrimaryCompact)
          }
          .frame(maxHeight: .infinity, alignment: .top)
        } else {
          ScrollView {
            VStack(alignment: .leading, spacing: 16) {
              Text("Assistants use this answer from now on.").font(.lnMeta).foregroundStyle(Theme.textMuted)
              LabeledField(label: "Question") {
                TextField("How do I export my data?", text: $question, axis: .vertical).lineLimit(1...4).textFieldStyle(.linear)
              }
              LabeledField(label: "Answer") {
                LinearTextEditor(text: $answer, placeholder: "The answer", minHeight: 140)
              }
              if models.count > 1 {
                LabeledField(label: "Knowledge model") {
                  Picker("Knowledge model", selection: $modelId) {
                    ForEach(models) { Text($0.name).tag($0.id) }
                  }
                  .pickerStyle(.menu)
                  .labelsHidden()
                }
              }
              ErrorText(message: error)
            }
            .padding(16)
          }
        }
      }
      .panelScreen("Save as FAQ")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        if !models.isEmpty { ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(!canSave) } }
      }
      .onAppear {
        guard !started else { return }
        started = true
        let start = InboxHub.faqPrefill(messages, messageId: message.id)
        question = start.question
        answer = start.answer
        modelId = workspace.inbox.context?.faqModels.defaultModelId ?? models.first?.id ?? ""
      }
    }
    .presentationDetents([.large])
  }

  private func save() async {
    saving = true
    defer { saving = false }
    do {
      try await workspace.inbox.saveFaq(modelId: modelId, question: question.trimmingCharacters(in: .whitespacesAndNewlines), answer: answer.trimmingCharacters(in: .whitespacesAndNewlines))
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
