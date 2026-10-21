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

/// GET /admin/support-agents/:id → `readiness`: what the assistant still needs before it answers
/// customers by itself, in the order to fix them (shared/knowledge.ts assistantReadiness).
struct AssistantReadiness: Decodable, Sendable {
  struct Check: Decodable, Sendable {
    /// llm, knowledge, active or autoReply.
    let key: String
    let ok: Bool
  }
  let checks: [Check]
  /// An AI provider and knowledge to read: a test answer works.
  let canAnswer: Bool
  /// Active with auto-reply on as well: it answers customers by itself.
  let live: Bool
  /// How many answers it may read, capped by the server's look-up (`AssistantVocabulary.faqLookup`).
  let faqs: Int
}

/// POST /admin/support-agents/:id/test-answer: the decision the support runtime would make for a message,
/// and what it was based on.
struct AssistantTestResult: Decodable, Sendable {
  struct Decision: Decodable, Sendable {
    /// answer, handoff or silent.
    let outcome: String
    /// rule, default, noKnowledge, lowConfidence or confident.
    let reason: String
    /// The routing rule behind the decision, as its position in the assistant's list.
    let ruleIndex: Int?
    /// The best knowledge match's score (0..1), and the bar it had to clear.
    let best, minConfidence: Double
  }
  struct Knowledge: Decodable, Sendable {
    let faqId, question: String
    let pathCache: String?
    let score: Double
  }
  let decision: Decision
  let rule: AssistantRule?
  /// Whether the assistant answers customers by itself right now.
  let live: Bool
  let model: String
  let answer: String?
  let knowledge: [Knowledge]
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
  /// How many readable answers the server counts before it says "that many or more" (ASSISTANT_FAQ_LOOKUP).
  static let faqLookup = 50
  static let statuses = ["active", "disabled", "draft"].map { AssistantOption(value: $0, label: $0.capitalized) }
  static let fallbacks = [AssistantOption(value: "human", label: "Hand to a human"), AssistantOption(value: "silent", label: "Stay silent")]
  static let actions = [AssistantOption(value: "auto", label: "Answer with AI"), AssistantOption(value: "human", label: "Leave for a human")]
  static let scopes = [AssistantOption(value: "model", label: "Model"), AssistantOption(value: "path", label: "Path"), AssistantOption(value: "faq", label: "FAQ")]

  static func scopeLabel(_ scope: String) -> String {
    scopes.first { $0.value == scope }?.label ?? scope
  }
}

// MARK: - Wording

// The strip's and the test's sentences, as the web words them (assistants.readiness.*, assistants.test.*).

extension AssistantReadiness {
  /// The number of answers it may read; "50+" once the server's look-up is full.
  var readableFaqs: String { faqs >= AssistantVocabulary.faqLookup ? "\(AssistantVocabulary.faqLookup)+" : String(faqs) }

  /// What a check says: what is in place, or what is missing.
  func text(_ check: Check) -> String {
    switch check.key {
    case "llm": check.ok ? "An AI provider is set up." : "No AI provider."
    case "knowledge": check.ok ? "It can read \(readableFaqs) answer\(faqs == 1 ? "" : "s")" : "No knowledge to read: nothing is assigned, or what is has no active answers."
    case "active": check.ok ? "Status is active." : "Status is not active."
    case "autoReply": check.ok ? "Auto-reply is on." : "Auto-reply is off, so it only answers when asked here."
    default: check.key
    }
  }

  /// The link that fixes a missing check, or nil for a key this app does not know.
  func fixLabel(_ check: Check) -> String? {
    switch check.key {
    case "llm": "Settings → AI"
    case "knowledge": "Assign knowledge"
    case "active": "Set it to active"
    case "autoReply": "Turn it on"
    default: nil
    }
  }
}

extension AssistantTestResult {
  /// "Would answer", "Would hand it to the team" or "Would stay silent".
  var outcomeLabel: String {
    switch decision.outcome {
    case "answer": "Would answer"
    case "handoff": "Would hand it to the team"
    case "silent": "Would stay silent"
    default: decision.outcome
    }
  }

  /// " (ticket type billing · keywords refund, chargeback)": what the rule that decided looks for, or "".
  var ruleConditions: String {
    guard let rule else { return "" }
    var parts: [String] = []
    if let type = rule.conversationType, !type.isEmpty { parts.append("ticket type \(type)") }
    if let keywords = rule.keywords, !keywords.isEmpty { parts.append("keywords \(keywords.joined(separator: ", "))") }
    return parts.isEmpty ? "" : " (\(parts.joined(separator: " · ")))"
  }

  /// Why it decided as it did, then which rule let the message through to the knowledge when one did.
  var reasonText: String {
    let number = (decision.ruleIndex ?? 0) + 1
    var text: String
    switch decision.reason {
    case "rule": text = "Rule \(number) sends messages like this to the team\(ruleConditions)."
    case "default": text = "No rule matched, and the default for messages no rule matches is the team."
    case "noKnowledge": text = "Nothing it may read matched the question."
    case "lowConfidence": text = "The best match scored \(Self.percent(decision.best)), under its confidence bar of \(Self.percent(decision.minConfidence))."
    default: text = "The best match scored \(Self.percent(decision.best)), enough to answer."
    }
    if let index = decision.ruleIndex, decision.reason != "rule" { text += " Rule \(index + 1)\(ruleConditions) let it through." }
    return text
  }

  /// A score as a whole percent.
  static func percent(_ score: Double) -> String { "\(Int((score * 100).rounded()))%" }
}
