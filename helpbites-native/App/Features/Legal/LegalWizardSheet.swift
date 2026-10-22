import SwiftUI

/// The guided wizard (components/legal/Wizard.vue): pick a document and how it is
/// written, answer the questions the server lists for that type, then create it.
/// With `document` it re-asks and recomposes that document instead.
struct LegalWizardSheet: View {
  let projectId: String
  let document: LegalDocument?
  /// The document, and whether the person asked to analyse it (an import).
  var onDone: (LegalDocument, Bool) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  private enum Mode: String { case template, ai, `import` }
  private struct PreviewBox: Identifiable { let id = UUID(); let value: LegalPreview }

  @State private var step = 0
  @State private var type = LegalType.privacy
  @State private var mode = Mode.template
  @State private var spec: LegalWizardSpec?
  @State private var answers: LegalAnswers = [:]
  @State private var loading = false
  @State private var error = ""
  @State private var hasRepos = false
  @State private var scanning = false
  @State private var useAI = false
  @State private var filled = false
  @State private var suggestError = ""
  @State private var suggestion: LegalSuggestion?
  @State private var preview: PreviewBox?
  @State private var previewing = false
  @State private var hasShared = false
  @State private var saveAnswers = true
  @State private var analyse = false
  @State private var picking = false
  @State private var importText = ""
  @State private var importTitle = ""
  @State private var importFormat: String?

  private var questions: [LegalQuestion] { spec?.questions ?? [] }
  private var visible: [LegalQuestion] { questions.filter { $0.showIf?.holds(answers) ?? true } }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if step == 0 { chooseStep } else if step == 2 { importStep } else { questionsStep }
          ErrorText(message: error)
        }
        .frame(maxWidth: 640, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(document != nil ? "Answers and recompose" : step == 2 ? "Import a legal document" : "New legal document")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if step >= 1 && document == nil { Button("Back") { step = 0; error = "" } } else { Button("Cancel") { dismiss() } }
        }
        ToolbarItem(placement: .confirmationAction) {
          if step == 0 {
            Button("Next") { Task { await start() } }.disabled(loading)
          } else if step == 2 {
            Button("Import") { Task { await submitImport() } }.disabled(loading || importText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          } else {
            Button(document != nil ? "Recompose" : mode == .ai ? "Write it" : "Create") { Task { await submit() } }.disabled(loading)
          }
        }
      }
      .sheet(item: $preview) { LegalPreviewSheet(preview: $0.value) }
      .fileImporter(isPresented: $picking, allowedContentTypes: LegalImportFile.types) { result in
        switch result {
        case .success(let url):
          do {
            let file = try LegalImportFile.read(url)
            importText = file.text
            importFormat = file.format
            error = ""
          } catch { self.error = error.localizedDescription }
        case .failure(let failure): error = failure.localizedDescription
        }
      }
      .task { if let document { type = document.kind; await start() } }
    }
    .presentationDetents([.large])
    .interactiveDismissDisabled(loading)
    #if os(macOS)
    .frame(minWidth: 540, minHeight: 620)
    #endif
  }

  // MARK: Step 0

  private var chooseStep: some View {
    VStack(alignment: .leading, spacing: 20) {
      VStack(alignment: .leading, spacing: 8) {
        Text("Which document?").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
          ForEach(LegalType.allCases) { t in choice(t.label, selected: type == t) { type = t } }
        }
      }
      VStack(alignment: .leading, spacing: 8) {
        Text("How should it be written?").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        choice("From reviewed clauses", detail: "Assembled from a library of clauses for the regions you pick. No AI, instant, and you can ask AI for help afterwards.", selected: mode == .template) { mode = .template }
        choice("Written by AI", detail: "The model drafts the whole document from your answers, starting from the clauses and the rules that apply. Needs an AI provider and can take a minute or two.", selected: mode == .ai) { mode = .ai }
        choice("I already have one", detail: "Paste your existing text or upload a file. Your words are kept as they are, split into sections you can edit, and you can analyse it against the rules afterwards.", selected: mode == .import) { mode = .import }
      }
      if loading { ProgressView().controlSize(.small) }
    }
  }

  private func choice(_ title: String, detail: String? = nil, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 2) {
        Text(LocalizedStringKey(title)).font(.lnMetaMedium).foregroundStyle(selected ? Theme.textHighlighted : Theme.textToned)
        if let detail { Text(LocalizedStringKey(detail)).font(.lnMeta).foregroundStyle(Theme.textMuted).multilineTextAlignment(.leading) }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 12).padding(.vertical, 10)
      .background(selected ? Theme.accent.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(selected ? Theme.accent : Theme.border))
      .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  // MARK: Step 1

  private var questionsStep: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text(document == nil
        ? (hasShared ? "Answer what applies. Your saved company details and earlier answers are filled in. This is a drafting tool, not legal advice." : "Answer what applies. Your saved company details are filled in already. This is a drafting tool, not legal advice.")
        : "Change the answers and recompose. Sections you wrote, AI wrote or locked keep their text; the rest are refreshed.")
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
      if hasRepos { suggestPanel }
      ForEach(visible) { q in field(q) }
      reuseToggle("Reuse these answers for my other documents", detail: "Off keeps them with this document only. Questions only this kind of document asks, like the refund window, are asked per document either way.")
      Button { Task { await showPreview() } } label: { Label("Preview the draft", systemImage: "eye") }
        .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(previewing || loading)
    }
  }

  private func reuseToggle(_ title: String, detail: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Toggle(LocalizedStringKey(title), isOn: $saveAnswers).font(.lnMeta).foregroundStyle(Theme.text).tint(Theme.accent)
      if let detail { Text(LocalizedStringKey(detail)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
    }
  }

  // MARK: Step 2 (import)

  private var regionOptions: [LegalQuestion.Option] {
    questions.first { $0.id == "regions" }?.options ?? legalRegions.map { LegalQuestion.Option(value: $0.value, label: $0.label) }
  }

  private var importStep: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Paste the text or upload a Markdown, HTML or plain text file. It is split at its headings; nothing is rewritten and nothing is sent to an AI unless you analyse it.")
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
      LabeledField(label: "Upload a file", hint: ".md, .txt or .html") {
        Button { picking = true } label: { Label("Choose a file…", systemImage: "doc.badge.plus") }.buttonStyle(SecondaryButtonStyle(compact: true))
      }
      LabeledField(label: "Or paste the text") {
        LinearTextEditor(text: Binding(get: { importText }, set: { importText = $0; importFormat = nil }), placeholder: String(localized: "Paste your existing document here"), minHeight: 180)
      }
      LabeledField(label: "Title (optional)", hint: "Taken from the text when it has one.") {
        TextField(type.label, text: $importTitle).textFieldStyle(.linear)
      }
      LabeledField(label: "Where are your users?", hint: "Decides which laws and policies it is checked against.") {
        LegalMultiPick(options: regionOptions, selection: listBinding("regions"))
      }
      Toggle("Analyse it against the rules once imported (uses AI)", isOn: $analyse).font(.lnMeta).foregroundStyle(Theme.text).tint(Theme.accent)
      reuseToggle("Reuse these regions for my other documents")
    }
  }

  @ViewBuilder private func field(_ q: LegalQuestion) -> some View {
    LabeledField(label: q.label + (q.required == true ? " *" : ""), hint: q.help) {
      switch q.kind {
      case "text": TextField(q.placeholder ?? "", text: textBinding(q.id)).textFieldStyle(.linear)
      case "longtext": LinearTextEditor(text: textBinding(q.id), placeholder: q.placeholder ?? "", minHeight: 84)
      case "boolean": Toggle(isOn: flagBinding(q.id)) { Text("") }.labelsHidden().tint(Theme.accent).frame(maxWidth: .infinity, alignment: .leading)
      case "select":
        Picker(q.label, selection: textBinding(q.id)) {
          Text("Choose…").tag("")
          ForEach(q.options ?? []) { Text($0.label).tag($0.value) }
        }
        .knowledgeField()
      default: LegalMultiPick(options: q.options ?? [], selection: listBinding(q.id))
      }
    }
  }

  private var suggestPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        Button { Task { await suggest() } } label: { Label(scanning ? "Reading your repos…" : "Suggest from my repos", systemImage: "arrow.triangle.branch") }
          .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(scanning)
        if scanning { ProgressView().controlSize(.small) }
      }
      if type == .privacy {
        Toggle("Also ask AI about other services (sends dependency names to your AI provider)", isOn: $useAI)
          .font(.lnCaption).foregroundStyle(Theme.textMuted).tint(Theme.accent)
      }
      ErrorText(message: suggestError)
      if let suggestion {
        let rows = suggestedRows(suggestion)
        if rows.isEmpty {
          Text("No known services found in \(suggestion.repos.filter(\.read).count) repo(s). Answer by hand.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          Text("Found in your code. Nothing is applied until you say so, and you can change any answer afterwards.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          ForEach(rows, id: \.id) { row in
            VStack(alignment: .leading, spacing: 1) {
              Text("\(Text(row.label + ":").fontWeight(.medium).foregroundColor(Theme.textHighlighted)) \(row.shown)").font(.lnMeta).foregroundStyle(Theme.text)
              if !row.evidence.isEmpty { Text(row.evidence.joined(separator: " · ")).font(.lnCaption).foregroundStyle(Theme.textMuted) }
            }
          }
          Button("Use these answers") { apply(suggestion) }.buttonStyle(.lnPrimaryCompact)
        }
        let unread = suggestion.repos.filter { !$0.read }.map(\.repo)
        if !unread.isEmpty { Text("Could not read: \(unread.joined(separator: ", "))").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      } else if filled {
        Text("Filled from your repos. Check those answers before you continue.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  // MARK: Answers

  private func textBinding(_ id: String) -> Binding<String> {
    Binding(get: { if case .text(let v)? = answers[id] { v } else { "" } }, set: { answers[id] = .text($0) })
  }
  private func flagBinding(_ id: String) -> Binding<Bool> {
    Binding(get: { if case .flag(let v)? = answers[id] { v } else { false } }, set: { answers[id] = .flag($0) })
  }
  private func listBinding(_ id: String) -> Binding<[String]> {
    Binding(get: { if case .list(let v)? = answers[id] { v } else { [] } }, set: { answers[id] = .list($0) })
  }

  private struct SuggestedRow { let id, label, shown: String; let evidence: [String] }

  private func suggestedRows(_ suggestion: LegalSuggestion) -> [SuggestedRow] {
    questions.compactMap { q in
      guard let value = suggestion.answers[q.id] else { return nil }
      func option(_ v: String) -> String { q.options?.first { $0.value == v }?.label ?? v }
      let shown: String
      switch value {
      case .list(let items): shown = items.map(option).joined(separator: ", ")
      case .flag(let on): shown = on ? String(localized: "Yes") : String(localized: "No")
      case .text(let text): shown = q.kind == "select" ? option(text) : text.replacingOccurrences(of: "\n", with: "; ")
      }
      return SuggestedRow(id: q.id, label: q.label, shown: shown, evidence: suggestion.evidence[q.id] ?? [])
    }
  }

  /// Merges the suggestions into the form: lists are added to, text is appended, the rest is set. Still the person's to edit.
  private func apply(_ suggestion: LegalSuggestion) {
    for (id, value) in suggestion.answers {
      switch (value, answers[id]) {
      case (.list(let new), .list(let old)?): answers[id] = .list(old + new.filter { !old.contains($0) })
      case (.text(let new), .text(let old)?) where id == "processors_other":
        var lines = old.split(separator: "\n").map(String.init)
        for line in new.split(separator: "\n").map(String.init) where !lines.contains(line) { lines.append(line) }
        answers[id] = .text(lines.joined(separator: "\n"))
      default: answers[id] = value
      }
    }
    self.suggestion = nil
    filled = true
  }

  // MARK: Requests

  private func start() async {
    struct Repos: Decodable, Sendable { let repos: [JSONValue] }
    loading = true
    error = ""
    defer { loading = false }
    do {
      let loaded: LegalWizardSpec = try await session.get("/v1/admin/legal/wizard/\(type.rawValue)", query: ["project": projectId])
      spec = loaded
      answers = loaded.defaults.merging(document?.answers ?? [:]) { _, saved in saved }
      suggestion = nil
      suggestError = ""
      filled = false
      hasShared = loaded.shared ?? false
      let repos: Repos? = try? await session.get("/v1/admin/projects/\(projectId)/repos")
      hasRepos = !(repos?.repos.isEmpty ?? true)
      step = mode == .import && document == nil ? 2 : 1
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func suggest() async {
    struct Body: Encodable, Sendable { let project: String; let ai: Bool }
    scanning = true
    suggestError = ""
    suggestion = nil
    filled = false
    defer { scanning = false }
    do {
      suggestion = try await LegalAPI.slow(session, "/v1/admin/legal/wizard/\(type.rawValue)/suggest", Body(project: projectId, ai: useAI && type == .privacy))
    } catch {
      suggestError = error.localizedDescription
    }
  }

  private func showPreview() async {
    struct Body: Encodable, Sendable { let project: String; let answers: LegalAnswers }
    previewing = true
    error = ""
    defer { previewing = false }
    do {
      let result: LegalPreview = try await session.send("/v1/admin/legal/wizard/\(type.rawValue)/compose", body: Body(project: projectId, answers: answers))
      preview = PreviewBox(value: result)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func submit() async {
    struct Created: Encodable, Sendable { let project: String; let type: String; let mode: String; let answers: LegalAnswers; let saveAnswers: Bool }
    struct Recompose: Encodable, Sendable { let answers: LegalAnswers; let saveAnswers: Bool }
    struct Response: Decodable, Sendable { let document: LegalDocument }
    loading = true
    error = ""
    defer { loading = false }
    do {
      let response: Response
      if let document {
        response = try await session.send("/v1/admin/legal/documents/\(document.id)/recompose", body: Recompose(answers: answers, saveAnswers: saveAnswers))
      } else if mode == .ai {
        response = try await LegalAPI.slow(session, "/v1/admin/legal/documents", Created(project: projectId, type: type.rawValue, mode: "ai", answers: answers, saveAnswers: saveAnswers))
      } else {
        response = try await session.send("/v1/admin/legal/documents", body: Created(project: projectId, type: type.rawValue, mode: "template", answers: answers, saveAnswers: saveAnswers))
      }
      onDone(response.document, false)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func submitImport() async {
    struct Body: Encodable, Sendable { let project: String; let type: String; let mode: String; let text: String; let format: String?; let title: String?; let answers: LegalAnswers; let saveAnswers: Bool }
    struct Response: Decodable, Sendable { let document: LegalDocument }
    loading = true
    error = ""
    defer { loading = false }
    let title = importTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      let response: Response = try await session.send("/v1/admin/legal/documents", body: Body(
        project: projectId, type: type.rawValue, mode: "import", text: importText, format: importFormat, title: title.isEmpty ? nil : title,
        answers: ["regions": .list(listBinding("regions").wrappedValue)], saveAnswers: saveAnswers))
      onDone(response.document, analyse)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// A checklist for a multi-choice answer (regions, services, data collected).
struct LegalMultiPick: View {
  let options: [LegalQuestion.Option]
  @Binding var selection: [String]
  var body: some View {
    Card {
      ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
        let on = selection.contains(option.value)
        CardRow(divider: index < options.count - 1) {
          Button {
            if on { selection.removeAll { $0 == option.value } } else { selection.append(option.value) }
          } label: {
            HStack(spacing: 10) {
              Image(systemName: on ? "checkmark.square.fill" : "square").foregroundStyle(on ? Theme.accent : Theme.textDimmed)
              Text(option.label).font(.lnCallout).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
              Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(on ? .isSelected : [])
        }
      }
    }
  }
}

/// A no-AI draft from the answers, with what the rulepacks say about it.
struct LegalPreviewSheet: View {
  let preview: LegalPreview
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let notice = preview.notice { Text(notice).font(.lnCaption).foregroundStyle(Theme.textMuted) }
          LegalCoverageSummary(coverage: preview.coverage)
          KnowledgeMarkdown(text: preview.markdown)
        }
        .frame(maxWidth: 720, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Preview")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.large])
    #if os(macOS)
    .frame(minWidth: 540, minHeight: 620)
    #endif
  }
}
