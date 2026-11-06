import SwiftUI

/// The workspace's own AI providers, "bring your own key" (web: Settings → AI).
/// Any number are saved, one is in use. Keys are write-only: the server only says
/// whether one is saved. Every change is saved straight away.
struct AIScreen: View {
  @Environment(SessionStore.self) private var session
  @State private var state: AIState?
  @State private var loading = true
  @State private var saving = false
  @State private var testing = false
  @State private var error = ""
  @State private var result: AITestResult?
  @State private var form: AIForm?
  @State private var removing: AIProvider?

  private let maxProviders = 10
  private var providers: [AIProvider] { state?.ai.providers ?? [] }
  private var active: AIProvider? { providers.first { $0.id == state?.ai.active } }
  private var editable: Bool { session.canManage && state?.allowed == true }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Add keys for OpenAI, Anthropic, Gemini or any other OpenAI-compatible provider, and pick the one to use. Assistants without an endpoint of their own, the email designer and error notes then use it\(state?.platform.available == true ? String(localized: " instead of the server's AI") : "")\(state?.platform.metered == true ? String(localized: ", and it uses no AI credits") : "").")
          .font(.lnMeta).foregroundStyle(Theme.textMuted)

        if loading {
          SkeletonRows(count: 3).padding(-Metrics.gutter)
        } else if let state {
          statusCard(state)
          if !state.allowed {
            Text("The \(session.plan?.name ?? String(localized: "current")) plan doesn't include your own AI provider.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
          if !providers.isEmpty {
            Card {
              ForEach(providers) { provider in
                CardRow(divider: provider.id != providers.last?.id) { providerRow(provider, state: state) }
              }
            }
          }
          if let form { AIFormView(form: Binding(get: { form }, set: { self.form = $0 }), keyKept: form.id.isEmpty ? false : providers.first { $0.id == form.id }?.hasApiKey == true, saving: saving, testing: testing, result: result, onSave: { Task { await saveForm() } }, onTest: { Task { await test() } }, onCancel: { self.form = nil; result = nil }) }
          else if editable && providers.count < maxProviders {
            Button { openForm() } label: { Label("Add a provider", systemImage: "plus") }.buttonStyle(.lnSecondary)
          }
          if !session.canManage { Text("Only admins and owners can change the workspace's settings.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        }
        ErrorText(message: error)
      }
      .settingsColumn()
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen("AI")
    .task(id: session.workspace?.id) { await load() }
    .confirmationDialog("Remove \(removing.map(label) ?? "")? Its saved API key is removed too.", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { provider in
      Button("Remove", role: .destructive) { Task { await remove(provider) } }
    }
  }

  // MARK: Rows

  private func statusCard(_ state: AIState) -> some View {
    let (icon, title, detail): (String, String, String) = {
      if let active {
        let detail = [host(active.endpoint), active.model].filter { !$0.isEmpty }.joined(separator: " · ")
        return state.allowed ? ("powerplug", String(localized: "Using \(label(active))"), detail) : ("pause.circle", String(localized: "Saved, but not in use"), detail)
      }
      if state.platform.available { return ("server.rack", String(localized: "Using the server's AI"), state.platform.metered ? String(localized: "Each call uses AI credits from your plan.") : String(localized: "The AI this server is set up with.")) }
      return ("circle.slash", String(localized: "No AI set up"), String(localized: "Connect a provider to use the assistants, the email designer and error notes."))
    }()
    return HStack(spacing: 12) {
      Image(systemName: icon).font(.app(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 20)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Text(detail).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func providerRow(_ provider: AIProvider, state: AIState) -> some View {
    HStack(spacing: 12) {
      Button { use(provider) } label: {
        Image(systemName: provider.id == state.ai.active ? "largecircle.fill.circle" : "circle")
          .font(.app(size: 16)).foregroundStyle(provider.id == state.ai.active ? Theme.accent : Theme.textDimmed)
          .frame(width: 28, height: 28).contentShape(Rectangle())
      }
      .buttonStyle(.plain).disabled(!editable || saving)
      .accessibilityLabel("Use \(label(provider))")
      .accessibilityAddTraits(provider.id == state.ai.active ? .isSelected : [])
      VStack(alignment: .leading, spacing: 2) {
        Text(label(provider)).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Text([host(provider.endpoint), provider.model, provider.hasApiKey ? "" : String(localized: "No key")].filter { !$0.isEmpty }.joined(separator: " · ")).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 8)
      if editable {
        IconButton(systemImage: "pencil", label: "Edit \(label(provider))") { openForm(provider) }
        IconButton(systemImage: "trash", label: "Remove \(label(provider))") { removing = provider }.disabled(saving)
      }
    }
  }

  // MARK: Actions

  private func label(_ provider: AIProvider) -> String {
    provider.name.isEmpty ? (AIPreset.all.first { $0.kind == provider.kind }?.label ?? host(provider.endpoint)) : provider.name
  }

  private func host(_ endpoint: String) -> String { URL(string: endpoint)?.host(percentEncoded: false) ?? endpoint }

  private func openForm(_ provider: AIProvider? = nil) {
    result = nil; error = ""
    if let provider {
      form = AIForm(id: provider.id, kind: provider.kind, name: provider.name, endpoint: provider.endpoint, model: provider.model, ultraModel: provider.ultraModel, apiKey: "")
    } else {
      form = AIForm.new(kind: "openai")
    }
  }

  private func load() async {
    do { state = try await session.get("/v1/admin/workspace/ai"); error = "" }
    catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  /// Saves the whole list; saved providers go without a key so the server keeps theirs.
  private func persist(_ list: [AIProviderInput], active activeId: String, failure: String = String(localized: "Could not save")) async -> Bool {
    struct Input: Encodable, Sendable { let providers: [AIProviderInput]; let active: String }
    struct Output: Decodable, Sendable { let ai: AIConfig }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/workspace/ai", method: "PUT", body: Input(providers: list, active: activeId))
      state?.ai = output.ai
      return true
    } catch { self.error = error.localizedDescription.isEmpty ? failure : error.localizedDescription; return false }
  }

  private func saveForm() async {
    guard let form else { return }
    let draft = form.input
    let editing = providers.contains { $0.id == draft.id }
    var list = providers.map(\.input)
    if editing { list = list.map { $0.id == draft.id ? draft : $0 } }
    else { var next = draft; next.id = "p" + String(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(8)); list.append(next) }
    // A new provider becomes the one in use when it is the first, or stays out of the way otherwise.
    let activeId = editing || !providers.isEmpty ? (state?.ai.active ?? "") : list.last?.id ?? ""
    if await persist(list, active: activeId) { self.form = nil; result = nil }
  }

  private func use(_ provider: AIProvider) {
    guard provider.id != state?.ai.active else { return }
    Task { _ = await persist(providers.map(\.input), active: provider.id, failure: String(localized: "Could not switch provider")) }
  }

  private func remove(_ provider: AIProvider) async {
    let rest = providers.filter { $0.id != provider.id }
    let activeId = state?.ai.active == provider.id ? rest.first?.id ?? "" : state?.ai.active ?? ""
    if await persist(rest.map(\.input), active: activeId, failure: String(localized: "Could not remove it")), form?.id == provider.id { form = nil }
  }

  private func test() async {
    guard let form else { return }
    testing = true; error = ""; result = nil
    defer { testing = false }
    do { result = try await session.send("/v1/admin/workspace/ai/test", body: form.input) }
    catch { self.error = error.localizedDescription }
  }
}

// MARK: - Form

private struct AIFormView: View {
  @Binding var form: AIForm
  let keyKept: Bool
  let saving: Bool
  let testing: Bool
  let result: AITestResult?
  let onSave: () -> Void
  let onTest: () -> Void
  let onCancel: () -> Void

  private var preset: AIPreset? { AIPreset.all.first { $0.kind == form.kind } }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Provider") {
        MenuPicker(selection: Binding(get: { form.kind }, set: { form.pick($0) }), options: AIPreset.all.map { PickerOption(value: $0.kind, label: $0.label) }, title: "Provider")
          .disabled(!form.id.isEmpty)
      }
      LabeledField(label: "Name", hint: "Optional") { TextField(preset?.label ?? "", text: $form.name).textFieldStyle(.linear) }
      LabeledField(label: "Endpoint", hint: "OpenAI-compatible") {
        TextField("https://api.openai.com/v1", text: $form.endpoint).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      LabeledField(label: "Model", hint: "For the assistants, error notes and the designer") { modelField($form.model, placeholder: preset?.models.first ?? "gpt-4o-mini") }
      LabeledField(label: "Ultra model", hint: "Optional. For the designer's Ultra mode; blank uses the model") { modelField($form.ultraModel, placeholder: String(localized: "Same as the model")) }
      LabeledField(label: "API key") {
        SecureField(keyKept ? String(localized: "Saved; leave blank to keep") : "", text: $form.apiKey).textFieldStyle(.linear).autocorrectionDisabled()
      }

      if let result {
        Label {
          Text(result.ok ? String(localized: "It works: \(result.model) answered\(result.reply.map { $0.isEmpty ? "" : " “\($0)”" } ?? "").") : result.error ?? String(localized: "The provider didn't answer."))
            .font(.lnMeta)
        } icon: { Image(systemName: result.ok ? "checkmark.circle" : "exclamationmark.circle") }
          .foregroundStyle(result.ok ? Theme.success : Theme.error)
      }

      HStack(spacing: 8) {
        Button { onSave() } label: { if saving { ProgressView() } else { Text(form.id.isEmpty ? String(localized: "Add provider") : String(localized: "Save")) } }
          .buttonStyle(.lnPrimaryCompact)
          .disabled(saving || form.endpoint.trimmingCharacters(in: .whitespaces).isEmpty || form.model.trimmingCharacters(in: .whitespaces).isEmpty)
        Button { onTest() } label: { if testing { ProgressView() } else { Text("Test") } }
          .buttonStyle(.lnSecondaryCompact).disabled(testing || form.endpoint.trimmingCharacters(in: .whitespaces).isEmpty)
        Button("Cancel", action: onCancel).buttonStyle(.lnGhost)
      }
    }
    .padding(16)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  /// A text field with the preset's model names a tap away.
  private func modelField(_ text: Binding<String>, placeholder: String) -> some View {
    HStack(spacing: 8) {
      TextField(placeholder, text: text).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        .onChange(of: text.wrappedValue) { _, value in if value.count > 120 { text.wrappedValue = String(value.prefix(120)) } }
      if let models = preset?.models, !models.isEmpty {
        Menu {
          ForEach(models, id: \.self) { model in Button(model) { text.wrappedValue = model } }
        } label: { Image(systemName: "chevron.up.chevron.down").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 40) }
          .menuIndicator(.hidden).fixedSize()
          #if os(macOS)
          .menuStyle(.borderlessButton)
          #endif
          .accessibilityLabel("Suggested models")
      }
    }
  }
}

// MARK: - Models

/// `shared/aiProviders.ts`: every provider speaks the OpenAI chat-completions
/// protocol (Anthropic and Gemini through their compatibility layers); `models` only seeds suggestions.
struct AIPreset: Sendable {
  let kind, label, endpoint: String
  let models: [String]

  static let all: [AIPreset] = [
    AIPreset(kind: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"]),
    AIPreset(kind: "anthropic", label: "Anthropic", endpoint: "https://api.anthropic.com/v1", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]),
    AIPreset(kind: "google", label: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-2.5-flash", "gemini-2.5-pro"]),
    AIPreset(kind: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", models: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"]),
    AIPreset(kind: "mistral", label: "Mistral", endpoint: "https://api.mistral.ai/v1", models: ["mistral-small-latest", "mistral-large-latest"]),
    AIPreset(kind: "groq", label: "Groq", endpoint: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]),
    AIPreset(kind: "xai", label: "xAI", endpoint: "https://api.x.ai/v1", models: ["grok-4", "grok-3-mini"]),
    AIPreset(kind: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"]),
    AIPreset(kind: "custom", label: String(localized: "Custom (OpenAI-compatible)"), endpoint: "", models: [])
  ]
}

/// One saved provider; the key is never returned, only whether one is saved.
struct AIProvider: Decodable, Identifiable, Equatable, Sendable {
  let id, kind, name, endpoint, model, ultraModel: String
  let hasApiKey: Bool

  /// The provider as the PUT sends it back: without a key, so the server keeps its own.
  var input: AIProviderInput { AIProviderInput(id: id, kind: kind, name: name, endpoint: endpoint, model: model, ultraModel: ultraModel, apiKey: nil) }
}

struct AIProviderInput: Encodable, Sendable {
  var id: String?
  var kind, name, endpoint, model, ultraModel: String
  /// Write-only: a string sets it, `""` clears it, leaving it out keeps the saved one.
  var apiKey: String?
}

struct AIConfig: Decodable, Equatable, Sendable { var providers: [AIProvider]; var active: String }
struct AIState: Decodable, Sendable {
  struct Platform: Decodable, Sendable { let available, metered: Bool }
  var ai: AIConfig
  let platform: Platform
  let allowed: Bool
}
struct AITestResult: Decodable, Sendable { let ok: Bool; let model: String; let reply: String?; let error: String? }

struct AIForm: Equatable {
  var id = ""
  var kind = "openai"
  var name = ""
  var endpoint = ""
  var model = ""
  var ultraModel = ""
  var apiKey = ""

  static func new(kind: String) -> AIForm {
    var form = AIForm()
    form.pick(kind)
    return form
  }

  /// Switching provider swaps in its endpoint and first suggested model.
  mutating func pick(_ next: String) {
    guard let preset = AIPreset.all.first(where: { $0.kind == next }) else { return }
    kind = next
    endpoint = preset.endpoint
    model = preset.models.first ?? ""
    ultraModel = ""
  }

  var input: AIProviderInput {
    let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    return AIProviderInput(id: id.isEmpty ? nil : id, kind: kind, name: name.trimmingCharacters(in: .whitespaces), endpoint: endpoint.trimmingCharacters(in: .whitespaces), model: model.trimmingCharacters(in: .whitespaces), ultraModel: ultraModel.trimmingCharacters(in: .whitespaces), apiKey: key.isEmpty ? nil : key)
  }
}
