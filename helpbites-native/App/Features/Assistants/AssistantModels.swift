import Foundation

// What the assistant screens decode beyond Core's `SupportAgent` (API_SPEC §1.8, §2 "AI assistants").

/// GET /admin/support-agents/:id → `agent`, with the routing fields the list shape lacks.
struct AssistantRecord: Decodable, Sendable {
  let id, projectId, name, description, status, systemPrompt, model, endpoint, fallbackBehavior: String
  let temperature: Double
  let autoReply, hasApiKey: Bool
  let minConfidence: Double?
  let defaultAction: String?
  let rules: [AssistantRule]?
}

/// One auto-reply rule; the first match wins. Unset conditions mean "any".
struct AssistantRule: Codable, Sendable {
  var conversationType: String?
  var keywords: [String]?
  var action: String
}

/// GET /admin/support-agents/:id → `llm`: the effective connection, never the key.
struct AssistantLLMStatus: Decodable, Sendable {
  let configured: Bool
  let model: String
  let usingDefaultEndpoint: Bool
}

struct AssistantAssignment: Decodable, Sendable, Identifiable {
  let id, scope, modelId: String
  let pathCache: String?
  let exclude: Bool
}

struct AssistantRetrievedFaq: Decodable, Sendable {
  struct Source: Decodable, Sendable { let section: String? }
  let faqId, question, answer, pathCache: String
  let score: Double
  let source: Source?
}

struct AssistantTicketType: Decodable, Sendable { let key, name: String }
struct AssistantFaqOption: Decodable, Sendable { let id, question: String }

/// A choice in an `AssistantSelectField`: the value sent to the server and its label.
struct AssistantOption: Hashable, Sendable {
  let value, label: String
}

/// The exact enum values (API_SPEC §3) with the web panel's labels.
enum AssistantVocabulary {
  static let defaultModel = "openai/mimo-v2.6-flash"
  static let maxRules = 20
  static let statuses = ["active", "disabled", "draft"].map { AssistantOption(value: $0, label: $0.capitalized) }
  static let fallbacks = [AssistantOption(value: "human", label: "Hand to a human"), AssistantOption(value: "silent", label: "Stay silent")]
  static let actions = [AssistantOption(value: "auto", label: "Answer with AI"), AssistantOption(value: "human", label: "Leave for a human")]
  static let scopes = [AssistantOption(value: "model", label: "Model"), AssistantOption(value: "path", label: "Path"), AssistantOption(value: "faq", label: "FAQ")]

  static func scopeLabel(_ scope: String) -> String {
    scopes.first { $0.value == scope }?.label ?? scope
  }
}
