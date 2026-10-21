import SwiftUI

/// One assistant's settings (web: pages/assistants/[id].vue): configuration, model and
/// connection, auto-reply rules, knowledge access and a retrieval test. Public so other
/// screens (the Team page's AI agents) can push it too.
struct AssistantDetailScreen: View {
  let assistantId: String
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var draft = AssistantDraft()
  @State private var projectId = ""
  @State private var hasApiKey = false
  @State private var llm: AssistantLLMStatus?
  @State private var defaultModel = AssistantVocabulary.defaultModel
  @State private var types: [AssistantTicketType] = []
  @State private var loaded = false
  @State private var loadError = ""
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""
  @State private var idCopied = false
  @State private var advancedOpen = false
  @State private var confirmDelete = false
  @State private var copyId: String?

  var body: some View {
    ScrollView {
      Group {
        if loaded {
          VStack(alignment: .leading, spacing: 48) {
            configuration
            AssistantKnowledgeAccess(assistantId: assistantId, projectId: projectId)
            AssistantRetrievalTest(assistantId: assistantId)
          }
        } else if loadError.isEmpty {
          SkeletonRows(count: 6)
        } else {
          EmptyState(systemImage: "exclamationmark.triangle", title: "Couldn't load this assistant", message: loadError) {
            Button("Try again") { Task { await load(); await loadTypes() } }.buttonStyle(.lnSecondaryCompact)
          }
        }
      }
      .frame(maxWidth: 640, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen(draft.name.isEmpty ? "Assistant" : draft.name)
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button { Task { await duplicate() } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
          .disabled(!loaded)
        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
          .disabled(!loaded)
      }
    }
    .confirmationDialog("Delete “\(draft.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete assistant", role: .destructive) { Task { await remove() } }
    } message: {
      Text("Its knowledge assignments are removed too.")
    }
    .navigationDestination(item: $copyId) { AssistantDetailScreen(assistantId: $0) }
    // Only the first appearance loads, so coming back from a pushed copy keeps unsaved edits.
    .task {
      guard !loaded else { return }
      await load()
      await loadTypes()
    }
  }

  // MARK: Configuration

  private var configuration: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Configuration").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      idRow
      HStack(alignment: .top, spacing: 12) {
        LabeledField(label: "Name") { TextField("", text: $draft.name).textFieldStyle(.linear) }
        LabeledField(label: "Status") { AssistantSelectField(selection: $draft.status, options: AssistantVocabulary.statuses) }
          .frame(width: 140)
      }
      LabeledField(label: "Description") { TextField("", text: $draft.description).textFieldStyle(.linear) }
      LabeledField(label: "System prompt", hint: "Tone and boundaries. Retrieved knowledge is added automatically as reference data.") {
        LinearTextEditor(text: $draft.systemPrompt, placeholder: "You are the WebBites support assistant. Be concise and friendly.", minHeight: 110)
      }
      connection
      LabeledField(label: "Fallback when unsure", hint: "When no knowledge matches well enough. Hand to a human labels the conversation needs-human, and the assistant stays out of it until the label is removed.") {
        AssistantSelectField(selection: $draft.fallbackBehavior, options: AssistantVocabulary.fallbacks)
      }
      Toggle(isOn: $draft.autoReply.animation(.snappy)) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Automatically reply to this project's users").font(.lnCallout).foregroundStyle(Theme.text)
          Text("Off by default, and only while the status is Active; sends grounded answers as this assistant").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      .tint(Theme.accent)
      if draft.autoReply { autoReply }
      ErrorText(message: error)
      HStack(spacing: 12) {
        Button(saving ? "Saving…" : "Save") { Task { await save() } }
          .buttonStyle(.lnPrimary)
          .disabled(saving || draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if saved { Text("Saved").font(.lnMeta).foregroundStyle(Theme.textMuted) }
      }
    }
  }

  private var idRow: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text("Assistant ID").font(.lnCaption).foregroundStyle(Theme.textMuted)
        Text(assistantId)
          .font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled)
          .padding(.horizontal, 6).padding(.vertical, 2)
          .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 4))
        IconButton(systemImage: idCopied ? "checkmark" : "doc.on.clipboard", label: "Copy assistant ID") { copyID() }
      }
      Text("The developer passes this to route chats to this assistant.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private var connection: some View {
    DisclosureGroup(isExpanded: $advancedOpen) {
      VStack(alignment: .leading, spacing: 16) {
        LabeledField(label: "Model", hint: "Default: \(defaultModel)") {
          TextField(defaultModel, text: $draft.model).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        LabeledField(label: "Temperature") {
          HStack(spacing: 12) {
            Slider(value: $draft.temperature, in: 0...2, step: 0.1).tint(Theme.accent)
            Text(draft.temperature.formatted(.number.precision(.fractionLength(1...2))))
              .font(.lnMeta).monospacedDigit().foregroundStyle(Theme.text).frame(width: 40, alignment: .trailing)
          }
        }
        LabeledField(label: "Endpoint", hint: "OpenAI-compatible base URL. Leave blank to use the default LiteLLM endpoint.") {
          TextField("https://litellm.example.com", text: $draft.endpoint)
            .textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        LabeledField(label: "API key", hint: hasApiKey ? "A key is set. Type to replace it; leave blank to keep it." : "Leave blank to use the default endpoint's key.") {
          SecureField(hasApiKey ? "•••••••• (set)" : "", text: $draft.apiKey)
            .textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        Text(llmLine).font(.lnCaption).foregroundStyle(llm?.configured == true ? Theme.textMuted : Theme.warning)
      }
      .padding(.top, 12)
    } label: {
      HStack(spacing: 6) {
        Text("Model & connection").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        Text("Advanced").font(.lnCaption).foregroundStyle(Theme.textDimmed)
      }
    }
    .padding(12)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private var llmLine: String {
    guard let llm, llm.configured else { return "No LLM endpoint configured. Retrieval testing still works; auto-reply will not run." }
    return "Ready — \(llm.model) via \(llm.usingDefaultEndpoint ? "default" : "custom") endpoint."
  }

  // MARK: Auto-reply

  private var autoReply: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("When to answer with AI").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      LabeledField(label: "Minimum confidence", hint: "Only send an AI answer when the best knowledge match is at least this sure. 0% = always try.") {
        HStack(spacing: 12) {
          Slider(value: confidencePercent, in: 0...100, step: 5).tint(Theme.accent)
          Text("\(Int(confidencePercent.wrappedValue))%")
            .font(.lnMeta).monospacedDigit().foregroundStyle(Theme.text).frame(width: 44, alignment: .trailing)
        }
      }
      LabeledField(label: "When no rule matches", hint: "Default for a message none of the rules below apply to.") {
        AssistantSelectField(selection: $draft.defaultAction, options: AssistantVocabulary.actions)
      }
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Rules").font(.lnMetaMedium).foregroundStyle(Theme.text)
          Spacer()
          Button { withAnimation(.snappy) { draft.rules.append(AssistantRuleDraft()) } } label: { Label("Add rule", systemImage: "plus") }
            .buttonStyle(.lnSecondaryCompact)
            .disabled(draft.rules.count >= AssistantVocabulary.maxRules)
        }
        Text("Checked top to bottom; the first match wins. Match by ticket type and/or keywords in the user's message.")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
        if draft.rules.isEmpty {
          AssistantDashedNote(text: "No rules — every message uses the default above.")
        }
        ForEach($draft.rules) { $rule in ruleEditor($rule) }
      }
    }
    .padding(12)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  /// The 0–1 server value as the 0–100% the slider shows.
  private var confidencePercent: Binding<Double> {
    Binding(get: { (draft.minConfidence * 100).rounded() }, set: { draft.minConfidence = min(max($0, 0), 100) / 100 })
  }

  private func ruleEditor(_ rule: Binding<AssistantRuleDraft>) -> some View {
    let id = rule.wrappedValue.id
    let position = draft.rules.firstIndex { $0.id == id } ?? 0
    let fields = sizeClass == .compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 8))
    return VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 0) {
        Text("Rule \(position + 1)").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
        Spacer()
        IconButton(systemImage: "arrow.up", label: "Move rule up") { moveRule(id, by: -1) }
          .disabled(position == 0).opacity(position == 0 ? 0.35 : 1)
        IconButton(systemImage: "arrow.down", label: "Move rule down") { moveRule(id, by: 1) }
          .disabled(position == draft.rules.count - 1).opacity(position == draft.rules.count - 1 ? 0.35 : 1)
        IconButton(systemImage: "xmark", label: "Remove rule") { withAnimation(.snappy) { draft.rules.removeAll { $0.id == id } } }
      }
      fields {
        LabeledField(label: "Ticket type") {
          AssistantSelectField(selection: rule.conversationType, options: typeOptions(including: rule.wrappedValue.conversationType))
        }
        LabeledField(label: "Keywords", hint: "Comma separated") {
          TextField("refund, cancel", text: rule.keywords).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        LabeledField(label: "Then") { AssistantSelectField(selection: rule.action, options: AssistantVocabulary.actions) }
      }
    }
    .padding(10)
    .background(Theme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  /// "Any type", the project's ticket types, and a key no longer among them so it still shows.
  private func typeOptions(including key: String) -> [AssistantOption] {
    var options = [AssistantOption(value: "", label: "Any type")] + types.map { AssistantOption(value: $0.key, label: $0.name) }
    if !key.isEmpty, !types.contains(where: { $0.key == key }) { options.append(AssistantOption(value: key, label: key)) }
    return options
  }

  private func moveRule(_ id: UUID, by offset: Int) {
    guard let from = draft.rules.firstIndex(where: { $0.id == id }), draft.rules.indices.contains(from + offset) else { return }
    withAnimation(.snappy) { draft.rules.swapAt(from, from + offset) }
  }

  private func copyID() {
    Clipboard.copy(assistantId)
    idCopied = true
    Task { try? await Task.sleep(for: .seconds(1.5)); idCopied = false }
  }

  // MARK: Requests

  private func load() async {
    struct Response: Decodable, Sendable { let agent: AssistantRecord; let llm: AssistantLLMStatus? }
    do {
      let response: Response = try await session.get("/v1/admin/support-agents/\(assistantId)")
      draft = AssistantDraft(response.agent)
      projectId = response.agent.projectId
      hasApiKey = response.agent.hasApiKey
      llm = response.llm
      // With no model of its own the effective model is the server's default.
      if response.agent.model.isEmpty, let model = response.llm?.model, !model.isEmpty { defaultModel = model }
      loadError = ""
      loaded = true
    } catch {
      if !Task.isCancelled { loadError = error.localizedDescription }
    }
  }

  /// The rule editor's ticket types; without them only "Any type" is offered, as on the web.
  private func loadTypes() async {
    struct Response: Decodable, Sendable { let types: [AssistantTicketType] }
    guard !projectId.isEmpty else { return }
    if let response: Response = try? await session.get("/v1/admin/projects/\(projectId)/types") { types = response.types }
  }

  private func save() async {
    saving = true; saved = false; error = ""
    do {
      let _: EmptyBody = try await session.send("/v1/admin/support-agents/\(assistantId)", method: "PATCH", body: draft.patch)
      await load()  // picks up the normalized rules and the new connection status
      saved = true
    } catch { self.error = error.localizedDescription }
    saving = false
    if saved { try? await Task.sleep(for: .seconds(2)); saved = false }
  }

  /// The copy is a draft with auto-reply off and, server-side, without the rules (API_SPEC §5.12).
  private func duplicate() async {
    struct Response: Decodable, Sendable { let agent: SupportAgent }
    do {
      let response: Response = try await session.send("/v1/admin/support-agents/\(assistantId)/duplicate")
      copyId = response.agent.id
    } catch { session.error = error.localizedDescription }
  }

  private func remove() async {
    do {
      try await session.delete("/v1/admin/support-agents/\(assistantId)")
      dismiss()
    } catch { session.error = error.localizedDescription }
  }
}

// MARK: - Editing state

/// The form as edited; keywords stay comma-separated text until saved, like the web's.
private struct AssistantDraft {
  var name = "", description = "", status = "draft", systemPrompt = "", model = "", endpoint = ""
  var apiKey = ""  // write-only: blank keeps the stored key
  var temperature = 0.2
  var autoReply = false
  var fallbackBehavior = "human"
  var minConfidence = 0.0
  var defaultAction = "auto"
  var rules: [AssistantRuleDraft] = []

  init() {}

  init(_ record: AssistantRecord) {
    name = record.name; description = record.description; status = record.status
    systemPrompt = record.systemPrompt; model = record.model; endpoint = record.endpoint
    temperature = record.temperature; autoReply = record.autoReply; fallbackBehavior = record.fallbackBehavior
    minConfidence = record.minConfidence ?? 0
    defaultAction = record.defaultAction ?? "auto"
    rules = (record.rules ?? []).map { AssistantRuleDraft(conversationType: $0.conversationType ?? "", keywords: ($0.keywords ?? []).joined(separator: ", "), action: $0.action) }
  }

  var patch: AssistantPatch {
    AssistantPatch(
      name: name, description: description, status: status, systemPrompt: systemPrompt, model: model, endpoint: endpoint,
      fallbackBehavior: fallbackBehavior, defaultAction: defaultAction,
      apiKey: apiKey.isEmpty ? nil : apiKey,
      // Slider steps accumulate float noise (0.30000000000000004); send what the screen shows.
      temperature: (temperature * 100).rounded() / 100,
      minConfidence: (minConfidence * 100).rounded() / 100,
      autoReply: autoReply,
      rules: rules.map { rule in
        AssistantRule(
          conversationType: rule.conversationType,
          keywords: rule.keywords.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
          action: rule.action
        )
      }
    )
  }
}

private struct AssistantRuleDraft: Identifiable {
  let id = UUID()
  var conversationType = ""  // "" = any type
  var keywords = ""
  var action = "human"
}

/// PATCH /admin/support-agents/:id. A nil `apiKey` is left out, which keeps the stored key.
private struct AssistantPatch: Encodable, Sendable {
  let name, description, status, systemPrompt, model, endpoint, fallbackBehavior, defaultAction: String
  let apiKey: String?
  let temperature, minConfidence: Double
  let autoReply: Bool
  let rules: [AssistantRule]
}

// MARK: - Shared pieces

/// A Linear select: the `.linear` field frame with the current choice; the menu checks it.
struct AssistantSelectField: View {
  @Binding var selection: String
  let options: [AssistantOption]
  var placeholder = "Select"

  var body: some View {
    let current = options.first { $0.value == selection }
    Menu {
      Picker(placeholder, selection: $selection) {
        ForEach(options, id: \.self) { Text($0.label).tag($0.value) }
      }
    } label: {
      HStack(spacing: 8) {
        Text(current?.label ?? placeholder)
          .foregroundStyle(current == nil ? Theme.textDimmed : Theme.text)
          .lineLimit(1)
        Spacer(minLength: 0)
        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textMuted)
      }
      .font(.lnBody)
      .padding(.horizontal, 12)
      .frame(minHeight: 40)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
    }
    .disabled(options.isEmpty)
  }
}

/// The web's dashed "nothing here yet" box.
struct AssistantDashedNote: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.lnMeta).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
      .frame(maxWidth: .infinity)
      .padding(16)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.borderAccented, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
  }
}
