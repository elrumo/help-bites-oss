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
  static let statuses = ["active", "disabled", "draft"].map { AssistantOption(value: $0, label: knowledgeStatusLabel($0)) }
  static let fallbacks = [AssistantOption(value: "human", label: String(localized: "Hand to a human")), AssistantOption(value: "silent", label: String(localized: "Stay silent"))]
  static let actions = [AssistantOption(value: "auto", label: String(localized: "Answer with AI")), AssistantOption(value: "human", label: String(localized: "Leave for a human"))]
  static let scopes = [AssistantOption(value: "model", label: String(localized: "Model")), AssistantOption(value: "path", label: String(localized: "Path")), AssistantOption(value: "faq", label: String(localized: "FAQ"))]

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
    case "llm": check.ok ? String(localized: "An AI provider is set up.") : String(localized: "No AI provider.")
    case "knowledge": check.ok ? (faqs == 1 ? String(localized: "It can read \(readableFaqs) answer") : String(localized: "It can read \(readableFaqs) answers")) : String(localized: "No knowledge to read: nothing is assigned, or what is has no active answers.")
    case "active": check.ok ? String(localized: "Status is active.") : String(localized: "Status is not active.")
    case "autoReply": check.ok ? String(localized: "Auto-reply is on.") : String(localized: "Auto-reply is off, so it only answers when asked here.")
    default: check.key
    }
  }

  /// The link that fixes a missing check, or nil for a key this app does not know.
  func fixLabel(_ check: Check) -> String? {
    switch check.key {
    case "llm": String(localized: "Settings → AI")
    case "knowledge": String(localized: "Assign knowledge")
    case "active": String(localized: "Set it to active")
    case "autoReply": String(localized: "Turn it on")
    default: nil
    }
  }
}

extension AssistantTestResult {
  /// "Would answer", "Would hand it to the team" or "Would stay silent".
  var outcomeLabel: String {
    switch decision.outcome {
    case "answer": String(localized: "Would answer")
    case "handoff": String(localized: "Would hand it to the team")
    case "silent": String(localized: "Would stay silent")
    default: decision.outcome
    }
  }

  /// " (ticket type billing · keywords refund, chargeback)": what the rule that decided looks for, or "".
  var ruleConditions: String {
    guard let rule else { return "" }
    var parts: [String] = []
    if let type = rule.conversationType, !type.isEmpty { parts.append(String(localized: "ticket type \(type)")) }
    if let keywords = rule.keywords, !keywords.isEmpty { parts.append(String(localized: "keywords \(keywords.joined(separator: ", "))")) }
    return parts.isEmpty ? "" : " (\(parts.joined(separator: " · ")))"
  }

  /// Why it decided as it did, then which rule let the message through to the knowledge when one did.
  var reasonText: String {
    let number = (decision.ruleIndex ?? 0) + 1
    var text: String
    switch decision.reason {
    case "rule": text = String(localized: "Rule \(number) sends messages like this to the team\(ruleConditions).")
    case "default": text = String(localized: "No rule matched, and the default for messages no rule matches is the team.")
    case "noKnowledge": text = String(localized: "Nothing it may read matched the question.")
    case "lowConfidence": text = String(localized: "The best match scored \(Self.percent(decision.best)), under its confidence bar of \(Self.percent(decision.minConfidence)).")
    default: text = String(localized: "The best match scored \(Self.percent(decision.best)), enough to answer.")
    }
    if let index = decision.ruleIndex, decision.reason != "rule" { text += String(localized: " Rule \(index + 1)\(ruleConditions) let it through.") }
    return text
  }

  /// A score as a whole percent.
  static func percent(_ score: Double) -> String { "\(Int((score * 100).rounded()))%" }
}
