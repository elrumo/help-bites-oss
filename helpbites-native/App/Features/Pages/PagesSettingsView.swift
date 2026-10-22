import SwiftUI

/// Pages settings (web: components/cms/CmsSettings.vue): the messaging brief the assistant
/// reads, the developer's own site for the web editor's live preview, and how to read the
/// content from code. Saves together (`PATCH /v1/admin/cms/settings`).
struct PagesSettingsView: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var saved: CmsSettings?
  @State private var draft = CmsSettings()
  /// The key messages, one per line.
  @State private var pillars = ""
  @State private var loading = true
  @State private var saving = false
  @State private var error = ""
  @State private var notice = ""

  /// The form as the server would keep it: key messages split, trimmed and capped.
  private var current: CmsSettings {
    var settings = draft
    settings.brief.pillars = pillars.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces).clipped(to: CmsBriefLimits.short) }
      .filter { !$0.isEmpty }.prefix(CmsBriefLimits.pillars).map { $0 }
    return settings
  }
  private var dirty: Bool { saved != nil && current != saved }
  private var urlOK: Bool { cmsValidPreviewURL(draft.previewUrl.trimmingCharacters(in: .whitespaces)) }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        ErrorText(message: error)
        if !notice.isEmpty { Label(notice, systemImage: "checkmark").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        if loading && saved == nil {
          SkeletonRows(count: 4)
        } else if saved != nil {
          brief
          yourSite
          code
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 20)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .refreshable { await load() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        if dirty {
          Button { Task { await save() } } label: { Text(saving ? "Saving…" : "Save") }
            .keyboardShortcut("s", modifiers: .command).disabled(saving || !urlOK)
        }
      }
    }
    .task { if saved == nil { await load() } }
  }

  private var brief: some View {
    LegalPanel("Messaging brief") {
      Text("Who the product is for and what every page should say. The web editor's wizard and assistant fill it in, and every assistant turn reads it.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
      briefText("Audience", \.audience, lines: 2)
      briefText("The problem", \.problem, lines: 3)
      briefText("Value proposition", \.valueProposition, lines: 3)
      LabeledField(label: "Key messages", hint: "Three to five, one per line, most important first.") {
        LinearTextEditor(text: $pillars, minHeight: 88)
      }
      briefText("Proof", \.proof, lines: 2)
      LabeledField(label: "Tone") {
        TextField("", text: $draft.brief.tone).textFieldStyle(.linear)
          .onChange(of: draft.brief.tone) { _, value in draft.brief.tone = value.clipped(to: CmsBriefLimits.short) }
      }
      LabeledField(label: "Call to action") {
        TextField("", text: $draft.brief.callToAction).textFieldStyle(.linear)
          .onChange(of: draft.brief.callToAction) { _, value in draft.brief.callToAction = value.clipped(to: CmsBriefLimits.short) }
      }
      if draft.brief != CmsBrief() || !pillars.isEmpty {
        Button { draft.brief = CmsBrief(); pillars = "" } label: { Label("Clear the brief", systemImage: "eraser") }.buttonStyle(.lnGhost)
      }
    }
  }

  private func briefText(_ label: String, _ key: WritableKeyPath<CmsBrief, String>, lines: Int) -> some View {
    LabeledField(label: label) {
      LinearTextEditor(text: Binding(get: { draft.brief[keyPath: key] }, set: { draft.brief[keyPath: key] = $0.clipped(to: CmsBriefLimits.text) }), minHeight: CGFloat(lines) * 24 + 16)
    }
  }

  private var yourSite: some View {
    LegalPanel("Live editing on your own site") {
      Text("The web editor can show your own site instead of the HelpBites render: add the bridge from cms.mjs to it, and edits show there as you type.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
      LabeledField(label: "Your site's preview URL", hint: urlOK ? "{slug} becomes the page's slug, for example http://localhost:5173/{slug}. Your site must allow being framed by HelpBites." : "An http or https URL") {
        TextField("http://localhost:5173/{slug}", text: $draft.previewUrl).textFieldStyle(.linear).font(.lnMono)
          .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      if !urlOK { Label("An http or https URL", systemImage: "exclamationmark.circle").font(.lnCaption).foregroundStyle(Theme.error) }
    }
  }

  private var code: some View {
    LegalPanel("Read the content from code") {
      Text("The delivery API serves published entries. The same client works in Vue, plain JavaScript and Node.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      CodeBlock(code: snippet)
    }
  }

  private var snippet: String {
    let base = session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let key = workspace.project(projectId)?.publicKey ?? "pk_…"
    return "import { createClient } from '\(base)/cms.mjs'\n\nconst cms = createClient({ host: '\(base)', pk: '\(key)' })\nconst { entry } = await cms.getEntry('home')"
  }

  private func fill(_ settings: CmsSettings) {
    saved = settings
    draft = settings
    pillars = settings.brief.pillars.joined(separator: "\n")
  }

  private func load() async {
    struct Response: Decodable, Sendable { let settings: CmsSettings }
    do {
      let response: Response = try await session.get("/v1/admin/cms/settings", query: ["project": projectId])
      // A refresh keeps unsaved edits.
      if dirty { saved = response.settings } else { fill(response.settings) }
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  private func save() async {
    struct Input: Encodable, Sendable { let project, previewUrl: String; let brief: CmsBrief }
    struct Response: Decodable, Sendable { let settings: CmsSettings }
    let settings = current
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: Response = try await session.send("/v1/admin/cms/settings", method: "PATCH", body: Input(project: projectId, previewUrl: settings.previewUrl.trimmingCharacters(in: .whitespaces), brief: settings.brief))
      fill(response.settings)
      let saved = String(localized: "Saved.")
      notice = saved
      Task {
        try? await Task.sleep(for: .seconds(3))
        if notice == saved { notice = "" }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }
}
