import SwiftUI

/// Model settings and the danger zone: archive, or delete with everything under it.
struct KnowledgeSettingsSheet: View {
  var onSaved: (KnowledgeModel) -> Void
  var onDeleted: () -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  private let modelId: String
  @State private var name: String
  @State private var description: String
  @State private var status: String
  @State private var language: String
  @State private var busy = false
  @State private var impact: Impact?
  @State private var error = ""

  private struct Impact: Decodable, Sendable { let faqs, nodes, documents, agents: Int }
  private struct Output: Decodable, Sendable { let model: KnowledgeModel }

  init(model: KnowledgeModel, onSaved: @escaping (KnowledgeModel) -> Void, onDeleted: @escaping () -> Void) {
    self.onSaved = onSaved
    self.onDeleted = onDeleted
    modelId = model.id
    _name = State(initialValue: model.name)
    _description = State(initialValue: model.description)
    _status = State(initialValue: model.status)
    _language = State(initialValue: model.defaultLanguage)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
          LabeledField(label: "Description") { LinearTextEditor(text: $description, minHeight: 80) }
          HStack(alignment: .top, spacing: 12) {
            LabeledField(label: "Status") {
              Picker("Status", selection: $status) {
                ForEach(knowledgeModelStatuses, id: \.self) { Text($0.capitalized).tag($0) }
              }
              .knowledgeField()
            }
            LabeledField(label: "Default language") {
              TextField("en", text: $language).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
          }
          ErrorText(message: error)

          Rectangle().fill(Theme.border).frame(height: 1).padding(.top, 8)
          Text("Danger zone").font(.lnMetaMedium).foregroundStyle(Theme.error)
          HStack(spacing: 8) {
            Button("Archive model") { Task { await archive() } }.buttonStyle(.lnSecondaryCompact).disabled(busy || status == "archived")
            Button("Delete model", role: .destructive) { Task { await delete(confirmed: false) } }
              .buttonStyle(GhostButtonStyle(tint: Theme.error)).disabled(busy)
          }
        }
        .frame(maxWidth: 640, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Model settings")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
      }
      .confirmationDialog("Delete this model?", isPresented: Binding(get: { impact != nil }, set: { if !$0 { impact = nil } }), titleVisibility: .visible, presenting: impact) { _ in
        Button("Delete model", role: .destructive) { Task { await delete(confirmed: true) } }
      } message: { impact in
        Text("Delete this model and everything under it? \(impact.faqs) FAQs, \(impact.nodes) themes, \(impact.documents) documents, affecting \(impact.agents) assistant(s). This cannot be undone.")
      }
    }
    .presentationDetents([.large])
  }

  private func save() async {
    struct Input: Encodable, Sendable { let name, description, status, defaultLanguage: String }
    busy = true; error = ""
    defer { busy = false }
    do {
      let output: Output = try await session.send("/v1/admin/knowledge/models/\(modelId)", method: "PATCH", body: Input(name: name, description: description, status: status, defaultLanguage: language))
      onSaved(output.model)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }

  private func archive() async {
    busy = true; error = ""
    defer { busy = false }
    do {
      let output: Output = try await session.send("/v1/admin/knowledge/models/\(modelId)", method: "PATCH", body: ["status": "archived"])
      status = output.model.status
      onSaved(output.model)
    } catch { self.error = error.localizedDescription }
  }

  /// Delete-with-impact: the first call only reports what would go.
  private func delete(confirmed: Bool) async {
    busy = true; error = ""
    defer { busy = false }
    do {
      if confirmed {
        let _: KnowledgeDeleteCheck<Impact> = try await KnowledgeAPI.request(session, "DELETE", "/v1/admin/knowledge/models/\(modelId)", query: ["confirm": "true"])
      } else {
        let check: KnowledgeDeleteCheck<Impact> = try await session.send("/v1/admin/knowledge/models/\(modelId)", method: "DELETE")
        if let impact = check.impact, !check.deleted { self.impact = impact; return }
      }
      onDeleted()
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

/// Ask one of the project's assistants a question and see the answer and the
/// FAQs it was grounded in (the web's floating "Test with assistant" panel).
struct KnowledgeTesterSheet: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var assistants: [KnowledgeNamed] = []
  @State private var assistantId = ""
  @State private var question = ""
  @State private var result: Answer?
  @State private var loaded = false
  @State private var asking = false
  @State private var error = ""

  private struct Answer: Decodable, Sendable {
    struct Source: Decodable, Sendable { let faqId, question, pathCache: String; let score: Double }
    let answer: String
    let knowledge: [Source]
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if !assistants.isEmpty {
            LabeledField(label: "Assistant") {
              Picker("Assistant", selection: $assistantId) {
                ForEach(assistants) { Text($0.name).tag($0.id) }
              }
              .knowledgeField()
            }
          } else if loaded {
            Text("This project has no assistants yet. Create one to test answers.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }

          if asking || result != nil {
            Group {
              if asking { Text("Thinking…").font(.lnCallout).foregroundStyle(Theme.textMuted) }
              else if let result { KnowledgeMarkdown(text: result.answer) }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
          }

          if let result, !result.knowledge.isEmpty, !asking {
            VStack(alignment: .leading, spacing: 6) {
              Text("Grounded in \(result.knowledge.count) FAQ\(result.knowledge.count == 1 ? "" : "s")").font(.lnCaptionMedium).foregroundStyle(Theme.textToned)
              ForEach(result.knowledge, id: \.faqId) { source in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                  VStack(alignment: .leading, spacing: 1) {
                    Text(source.question).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(2)
                    if !source.pathCache.isEmpty { Text(source.pathCache).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1) }
                  }
                  Spacer(minLength: 8)
                  Text("\(Int((source.score * 100).rounded()))%").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
                }
              }
            }
          }

          ErrorText(message: error)
        }
        .padding(20)
      }
      .safeAreaInset(edge: .bottom) {
        HStack(spacing: 8) {
          TextField("Ask a question…", text: $question).textFieldStyle(.linear).submitLabel(.send).onSubmit { Task { await ask() } }
          Button { Task { await ask() } } label: { Image(systemName: "paperplane.fill") }
            .buttonStyle(.lnPrimaryCompact)
            .accessibilityLabel("Ask")
            .disabled(assistantId.isEmpty || question.trimmingCharacters(in: .whitespaces).isEmpty || asking)
        }
        .disabled(assistantId.isEmpty)
        .padding(12)
        .background(Theme.panel)
        .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
      }
      .panelScreen("Test with assistant")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .task { await loadAssistants() }
    }
    .presentationDetents([.medium, .large])
  }

  private func loadAssistants() async {
    struct Response: Decodable, Sendable { let agents: [KnowledgeNamed] }
    do {
      let response: Response = try await session.get("/v1/admin/support-agents", query: ["projectId": projectId])
      assistants = response.agents
      if assistantId.isEmpty { assistantId = response.agents.first?.id ?? "" }
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loaded = true
  }

  private func ask() async {
    let query = question.trimmingCharacters(in: .whitespaces)
    guard !assistantId.isEmpty, !query.isEmpty, !asking else { return }
    asking = true; error = ""; result = nil
    defer { asking = false }
    do {
      let answer: Answer = try await session.send("/v1/admin/support-agents/\(assistantId)/generate", body: ["query": query])
      result = answer
    } catch { self.error = error.localizedDescription }
  }
}
