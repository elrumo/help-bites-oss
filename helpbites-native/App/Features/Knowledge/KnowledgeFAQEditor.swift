import SwiftUI

/// Create or edit one FAQ (components/knowledge/FaqEditor.vue). `faqId` is ""
/// for a new one. Whoever presents it reloads when the sheet closes.
struct KnowledgeFAQEditor: View {
  let modelId: String
  let faqId: String
  let themes: [KnowledgeTheme]
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  @State private var question = ""
  @State private var answer = ""
  @State private var nodeId = ""
  @State private var status = "active"
  @State private var aliases = ""
  @State private var tags = ""
  @State private var previewing = false
  @State private var detail: KnowledgeFAQDetail?
  @State private var loading = false
  @State private var saving = false
  @State private var confirmDelete = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      Group {
        if loading {
          ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          ScrollView { form.frame(maxWidth: 640).padding(20).frame(maxWidth: .infinity) }
        }
      }
      .panelScreen(faqId.isEmpty ? "New FAQ" : "Edit FAQ")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(faqId.isEmpty ? "Create" : "Save") { Task { await save() } }
            .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || loading)
        }
      }
      .confirmationDialog("Delete FAQ?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete", role: .destructive) { Task { await delete() } }
      } message: { Text("Delete “\(question)”? This cannot be undone.") }
    }
    .presentationDetents([.large])
    .task { await load() }
  }

  private var form: some View {
    VStack(alignment: .leading, spacing: 18) {
      LabeledField(label: "Question") {
        TextField("", text: $question, axis: .vertical).textFieldStyle(.linear)
      }

      LabeledField(label: "Answer", hint: "Markdown") {
        Picker("Answer view", selection: $previewing) {
          Text("Write").tag(false)
          Text("Preview").tag(true)
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 220)
        if previewing {
          KnowledgeMarkdown(text: answer)
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
        } else {
          LinearTextEditor(text: $answer, placeholder: "Write the answer in Markdown", minHeight: 180, monospaced: true)
        }
      }

      HStack(alignment: .top, spacing: 12) {
        LabeledField(label: "Path") {
          Picker("Path", selection: $nodeId) {
            Text("(model root)").tag("")
            ForEach(themes) { theme in Text(theme.pathCache).tag(theme.id) }
          }
          .knowledgeField()
        }
        LabeledField(label: "Status") {
          Picker("Status", selection: $status) {
            ForEach(knowledgeFAQStatuses, id: \.self) { Text($0.capitalized).tag($0) }
          }
          .knowledgeField()
        }
      }

      LabeledField(label: "Alternate phrasings", hint: "One per line — helps retrieval find this answer") {
        LinearTextEditor(text: $aliases, placeholder: "How can I remove a bookmark?", minHeight: 72)
      }

      LabeledField(label: "Tags", hint: "Comma separated") {
        TextField("", text: $tags).textFieldStyle(.linear).textInputAutocapitalization(.never)
      }

      if let detail, let source = detail.sourceDocument {
        VStack(alignment: .leading, spacing: 3) {
          Text("Source").font(.lnCaptionMedium).foregroundStyle(Theme.textToned)
          HStack(spacing: 4) {
            Text("File: \(source.filename)")
            if detail.faq.detached { Text("· edited (won't be overwritten on re-import)").foregroundStyle(Theme.warning) }
          }
          if !detail.faq.sourceSection.isEmpty { Text("Section: \(detail.faq.sourceSection)") }
          Text("Version: \(detail.faq.sourceVersion) · Imported \(detail.faq.lastProcessedAt == nil ? "—" : DateText.day(detail.faq.lastProcessedAt))")
        }
        .font(.lnCaption)
        .foregroundStyle(Theme.textMuted)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      }

      if let count = detail?.agentIds.count, count > 0 {
        Label("\(count) assistant\(count == 1 ? "" : "s") can use this FAQ.", systemImage: "sparkles")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
      }

      ErrorText(message: error)

      if !faqId.isEmpty {
        Button("Delete FAQ", role: .destructive) { confirmDelete = true }
          .buttonStyle(GhostButtonStyle(tint: Theme.error))
          .padding(.top, 8)
      }
    }
  }

  private func load() async {
    guard !faqId.isEmpty, detail == nil else { return }
    loading = true
    defer { loading = false }
    do {
      let detail: KnowledgeFAQDetail = try await session.get("/v1/admin/knowledge/faqs/\(faqId)")
      question = detail.faq.question
      answer = detail.faq.answer
      nodeId = detail.faq.nodeId
      status = detail.faq.status
      aliases = detail.faq.aliases.joined(separator: "\n")
      tags = detail.faq.tags.joined(separator: ", ")
      self.detail = detail
    } catch { self.error = error.localizedDescription }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let modelId, question, answer, nodeId, status: String; let aliases, tags: [String] }
    func list(_ text: String, _ separator: Character) -> [String] {
      text.split(separator: separator).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    saving = true; error = ""
    defer { saving = false }
    let input = Input(modelId: modelId, question: question, answer: answer, nodeId: nodeId, status: status, aliases: list(aliases, "\n"), tags: list(tags, ","))
    do {
      if faqId.isEmpty {
        let _: JSONValue = try await session.send("/v1/admin/knowledge/faqs", body: input)
      } else {
        let _: JSONValue = try await session.send("/v1/admin/knowledge/faqs/\(faqId)", method: "PATCH", body: input)
      }
      dismiss()
    } catch { self.error = error.localizedDescription }
  }

  private func delete() async {
    do {
      try await session.delete("/v1/admin/knowledge/faqs/\(faqId)")
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
