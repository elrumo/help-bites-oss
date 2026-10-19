import SwiftUI

/// Which knowledge an assistant may use: grants (or exclusions) of a whole model, a
/// path inside it, or a single FAQ.
struct AssistantKnowledgeAccess: View {
  let assistantId: String
  let projectId: String
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
    let model = models.first { $0.id == assignment.modelId }?.name ?? "model"
    switch assignment.scope {
    case "model": return "Entire model: \(model)"
    case "path": return "Path: \(model) › \(assignment.pathCache ?? "")"
    default: return "Single FAQ in \(model)"
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
    modelId.isEmpty ? "Choose a model first" : empty ? none : choose
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
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ assignment: AssistantAssignment) async {
    error = ""
    do {
      try await session.delete("/v1/admin/support-agents/\(assistantId)/assignments/\(assignment.id)")
      assignments.removeAll { $0.id == assignment.id }
    } catch { self.error = error.localizedDescription }
  }
}

/// What knowledge the assistant would be handed for a question: the same retrieval the
/// support runtime runs, respecting its assignments and FAQ status.
struct AssistantRetrievalTest: View {
  let assistantId: String
  @Environment(SessionStore.self) private var session
  @State private var query = ""
  @State private var testing = false
  @State private var results: [AssistantRetrievedFaq]?  // nil until the first run
  @State private var error = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Test retrieval").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      Text("See exactly what knowledge this assistant would be given for a question — the same retrieval the support runtime uses.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
      HStack(spacing: 8) {
        TextField("How do I delete my account?", text: $query)
          .textFieldStyle(.linear)
          .submitLabel(.search)
          .onSubmit { Task { await run() } }
        Button(testing ? "Retrieving…" : "Retrieve") { Task { await run() } }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(testing || trimmedQuery.isEmpty)
      }
      ErrorText(message: error)
      if let results {
        if results.isEmpty {
          Text("No knowledge matched — check the assignments above and that FAQs are active.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          ForEach(Array(results.enumerated()), id: \.offset) { _, result in card(result) }
        }
      }
    }
  }

  private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

  private func card(_ result: AssistantRetrievedFaq) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 8) {
        Text(result.question).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Spacer(minLength: 8)
        Text("\(Int((result.score * 100).rounded()))%").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textDimmed)
      }
      Text(location(result)).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1)
      // Inline Markdown (bold, links, code) clipped to three lines like the web's line-clamp-3.
      Text((try? AttributedString(markdown: result.answer, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(result.answer))
        .font(.lnMeta).foregroundStyle(Theme.text).lineLimit(3)
        .padding(.top, 2)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private func location(_ result: AssistantRetrievedFaq) -> String {
    let path = result.pathCache.isEmpty ? "(root)" : result.pathCache
    guard let section = result.source?.section, !section.isEmpty else { return path }
    return "\(path) · \(section)"
  }

  private func run() async {
    struct Input: Encodable, Sendable { let query: String }
    struct Response: Decodable, Sendable { let results: [AssistantRetrievedFaq] }
    guard !trimmedQuery.isEmpty, !testing else { return }
    testing = true; error = ""
    defer { testing = false }
    do {
      let response: Response = try await session.send("/v1/admin/support-agents/\(assistantId)/retrieve", body: Input(query: trimmedQuery))
      results = response.results
    } catch { self.error = error.localizedDescription }
  }
}
