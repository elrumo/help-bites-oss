import SwiftUI

/// Which knowledge an assistant may use: grants (or exclusions) of a whole model, a
/// path inside it, or a single FAQ. `onChange` runs after an access is added or removed,
/// so the readiness strip can read again.
struct AssistantKnowledgeAccess: View {
  let assistantId: String
  let projectId: String
  var onChange: () -> Void = {}
  @Environment(SessionStore.self) private var session
  @State private var assignments: [AssistantAssignment] = []
  @State private var models: [KnowledgeModel] = []
  @State private var nodes: [KnowledgeNode] = []
  @State private var faqs: [AssistantFaqOption] = []
  @State private var scope = "model"
  @State private var modelId = ""
  @State private var nodeId = ""
  @State private var faqId = ""
  @State private var exclude = false
  @State private var adding = false
  @State private var error = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Knowledge access").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      if assignments.isEmpty {
        AssistantDashedNote(text: "This assistant does not currently have access to any support knowledge.")
      } else {
        Card {
          ForEach(assignments) { assignment in
            CardRow(divider: assignment.id != assignments.last?.id) { row(assignment) }
          }
        }
      }
      addForm
      ErrorText(message: error)
    }
    .task(id: projectId) { await load() }
    .task(id: modelId) { await loadModelOptions() }
    .onChange(of: modelId) { nodeId = ""; faqId = "" }
  }

  private func row(_ assignment: AssistantAssignment) -> some View {
    HStack(spacing: 8) {
      Tag(text: assignment.exclude ? "Exclude" : AssistantVocabulary.scopeLabel(assignment.scope), tint: assignment.exclude ? Theme.error : Theme.accent)
      Text(describe(assignment)).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 0)
      IconButton(systemImage: "xmark", label: "Remove access") { Task { await remove(assignment) } }
    }
  }

  private func describe(_ assignment: AssistantAssignment) -> String {
    let model = models.first { $0.id == assignment.modelId }?.name ?? String(localized: "model")
    switch assignment.scope {
    case "model": return String(localized: "Entire model: \(model)")
    case "path": return String(localized: "Path: \(model) › \(assignment.pathCache ?? "")")
    default: return String(localized: "Single FAQ in \(model)")
    }
  }

  private var addForm: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 8) {
        LabeledField(label: "Grant") { AssistantSelectField(selection: $scope, options: AssistantVocabulary.scopes) }
          .frame(width: 112)
        LabeledField(label: "Model") {
          AssistantSelectField(selection: $modelId, options: models.map { AssistantOption(value: $0.id, label: $0.name) }, placeholder: models.isEmpty ? "No knowledge models" : "Choose a model")
        }
      }
      if scope == "path" {
        LabeledField(label: "Path") {
          AssistantSelectField(selection: $nodeId, options: nodes.map { AssistantOption(value: $0.id, label: $0.pathCache) }, placeholder: pickerPlaceholder(nodes.isEmpty, "No paths in this model", "Choose a path"))
        }
      }
      if scope == "faq" {
        LabeledField(label: "FAQ") {
          AssistantSelectField(selection: $faqId, options: faqs.map { AssistantOption(value: $0.id, label: $0.question) }, placeholder: pickerPlaceholder(faqs.isEmpty, "No FAQs in this model", "Choose an FAQ"))
        }
      }
      HStack {
        Toggle(isOn: $exclude) { Text("Exclude").font(.lnMeta).foregroundStyle(Theme.textMuted) }
          .fixedSize()
          .tint(Theme.accent)
        Spacer()
        Button(adding ? "Adding…" : "Add") { Task { await add() } }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(adding || !canAdd)
      }
    }
    .padding(12)
    .background(Theme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private func pickerPlaceholder(_ empty: Bool, _ none: String, _ choose: String) -> String {
    modelId.isEmpty ? String(localized: "Choose a model first") : empty ? none : choose
  }

  /// The id the chosen scope needs (the server 400s without it).
  private var canAdd: Bool {
    switch scope {
    case "path": !nodeId.isEmpty
    case "faq": !faqId.isEmpty
    default: !modelId.isEmpty
    }
  }

  private func load() async {
    struct Models: Decodable, Sendable { let models: [KnowledgeModel] }
    await loadAssignments()
    do {
      let response: Models = try await session.get("/v1/admin/knowledge/models", query: ["projectId": projectId])
      models = response.models
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }

  private func loadAssignments() async {
    struct Response: Decodable, Sendable { let assignments: [AssistantAssignment] }
    do {
      let response: Response = try await session.get("/v1/admin/support-agents/\(assistantId)/assignments")
      assignments = response.assignments
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }

  /// The chosen model's paths and (first 100) FAQs for the pickers.
  private func loadModelOptions() async {
    struct Nodes: Decodable, Sendable { let nodes: [KnowledgeNode] }
    struct Faqs: Decodable, Sendable { let faqs: [AssistantFaqOption] }
    guard !modelId.isEmpty else { nodes = []; faqs = []; return }
    do {
      let nodeResponse: Nodes = try await session.get("/v1/admin/knowledge/nodes", query: ["modelId": modelId])
      let faqResponse: Faqs = try await session.get("/v1/admin/knowledge/faqs", query: ["modelId": modelId, "limit": "100"])
      nodes = nodeResponse.nodes
      faqs = faqResponse.faqs
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }

  private func add() async {
    struct Input: Encodable, Sendable { let scope, modelId, nodeId, faqId: String; let exclude: Bool }
    adding = true; error = ""
    defer { adding = false }
    do {
      let _: EmptyBody = try await session.send("/v1/admin/support-agents/\(assistantId)/assignments", body: Input(scope: scope, modelId: modelId, nodeId: nodeId, faqId: faqId, exclude: exclude))
      nodeId = ""; faqId = ""; exclude = false
      await loadAssignments()
      onChange()
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ assignment: AssistantAssignment) async {
    error = ""
    do {
      try await session.delete("/v1/admin/support-agents/\(assistantId)/assignments/\(assignment.id)")
      assignments.removeAll { $0.id == assignment.id }
      onChange()
    } catch { self.error = error.localizedDescription }
  }
}

/// Asks the assistant a question the way a customer would and shows what it would do, and why
/// (web: AssistantTestAnswer.vue): hand it to the team, stay silent, or answer, with the
/// knowledge it found and, when it has an AI provider, the reply it would send. The decision is
/// the server's, the one the support runtime makes; nothing is sent or added to the inbox.
struct AssistantTestAnswer: View {
  let assistantId: String
  let types: [AssistantTicketType]
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var question = ""
  @State private var type = "support"
  @State private var running = false
  @State private var result: AssistantTestResult?
  @State private var error = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Test answer").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      Text("Ask what a customer would. This runs the same decision as a real message: your routing rules first, then the knowledge it may read and its confidence bar. Nothing is sent, and nothing is added to the inbox.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
      TextField("How do I delete my account?", text: $question)
        .textFieldStyle(.linear)
        .submitLabel(.go)
        .onSubmit { Task { await run() } }
      HStack(alignment: .bottom, spacing: 8) {
        LabeledField(label: "Ticket type") { AssistantSelectField(selection: $type, options: typeOptions) }
          .frame(maxWidth: 220)
        Button(running ? "Testing…" : "Test answer") { Task { await run() } }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(running || trimmedQuestion.isEmpty)
          .padding(.bottom, 5)
      }
      ErrorText(message: error)
      if let result { card(result) }
    }
  }

  private var trimmedQuestion: String { question.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// The project's ticket types, or the built-in one when they have not loaded.
  private var typeOptions: [AssistantOption] {
    types.isEmpty ? [AssistantOption(value: "support", label: String(localized: "Support"))] : types.map { AssistantOption(value: $0.key, label: $0.name) }
  }

  // MARK: Result

  private func card(_ result: AssistantTestResult) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        outcomeBadge(result.decision.outcome, result.outcomeLabel)
        if !result.live {
          Text("It is not answering customers by itself yet; see Readiness above.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      Text(result.reasonText).font(.lnMeta).foregroundStyle(Theme.text)
      if let answer = result.answer, !answer.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("It would send, from \(result.model):").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
          // Inline Markdown (bold, links, code), as the web renders the reply.
          Text((try? AttributedString(markdown: answer, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(answer))
            .font(.lnMeta).foregroundStyle(Theme.text).textSelection(.enabled)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: Metrics.radius))
        }
      } else if result.decision.outcome == "answer" {
        VStack(alignment: .leading, spacing: 2) {
          Text("It would answer, but there is no AI provider to write the reply.").font(.lnCaption).foregroundStyle(Theme.warning)
          Button("Settings → AI") { workspace.go(.ai) }.buttonStyle(.plain).font(.lnCaptionMedium).foregroundStyle(Theme.accentText)
        }
      }
      if !result.knowledge.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("Knowledge it found").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
          ForEach(Array(result.knowledge.enumerated()), id: \.offset) { _, item in knowledgeRow(item) }
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .accessibilityElement(children: .contain)
  }

  /// Answer is green, a hand-off amber, silence grey; the icon says it without the colour.
  private func outcomeBadge(_ outcome: String, _ label: String) -> some View {
    let (icon, tint) = outcomeStyle(outcome)
    return HStack(spacing: 5) {
      Image(systemName: icon).font(.system(size: 10, weight: .semibold))
      Text(label).lineLimit(1)
    }
    .font(.lnCaptionMedium)
    .foregroundStyle(tint)
    .padding(.horizontal, 8)
    .frame(height: 22)
    .background(tint.opacity(0.12), in: Capsule())
  }

  private func outcomeStyle(_ outcome: String) -> (String, Color) {
    switch outcome {
    case "answer": return ("arrowshape.turn.up.left", Theme.success)
    case "handoff": return ("hand.raised", Theme.warning)
    default: return ("speaker.slash", Theme.textMuted)
    }
  }

  private func knowledgeRow(_ item: AssistantTestResult.Knowledge) -> some View {
    HStack(spacing: 8) {
      (Text(item.question).foregroundStyle(Theme.text) + Text(item.pathCache.map { $0.isEmpty ? "" : " · \($0)" } ?? "").foregroundStyle(Theme.textDimmed))
        .font(.lnCaption).lineLimit(1)
      Spacer(minLength: 8)
      Text(AssistantTestResult.percent(item.score)).font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
    }
  }

  // MARK: Request

  /// POST …/test-answer for the question as the chosen ticket type. The last result stays until the next one arrives or the call fails.
  private func run() async {
    struct Input: Encodable, Sendable { let query, conversationType: String }
    guard !trimmedQuestion.isEmpty, !running else { return }
    running = true; error = ""
    defer { running = false }
    do {
      let response: AssistantTestResult = try await session.send("/v1/admin/support-agents/\(assistantId)/test-answer", body: Input(query: trimmedQuestion, conversationType: type))
      result = response
    } catch {
      result = nil
      let message = error.localizedDescription
      self.error = message.isEmpty ? String(localized: "Could not run the test") : message
    }
  }
}
