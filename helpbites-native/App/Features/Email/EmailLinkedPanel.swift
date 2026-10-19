import SwiftUI

/// A project's link to a master (EmailLinkedPanel.vue): the master's design
/// with this project's brand, the project's own values for the master's
/// variables, and the key the send API knows it by.
struct EmailLinkedPanel: View {
  let brand: EmailBrand?
  var onSaved: (EmailTemplateItem) -> Void
  var onDetached: (EmailTemplateItem) -> Void
  var onRemoved: (String) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var saved: EmailTemplateItem
  @State private var values: [String: String]
  @State private var key: String
  @State private var saving = false
  @State private var error = ""
  @State private var confirm: Action?
  @State private var editingMaster: EmailEditorTarget?
  @State private var testing: EmailTemplateItem?

  private enum Action { case detach, remove }

  init(template: EmailTemplateItem, brand: EmailBrand?, onSaved: @escaping (EmailTemplateItem) -> Void, onDetached: @escaping (EmailTemplateItem) -> Void, onRemoved: @escaping (String) -> Void) {
    self.brand = brand
    self.onSaved = onSaved
    self.onDetached = onDetached
    self.onRemoved = onRemoved
    _saved = State(initialValue: template)
    _values = State(initialValue: template.variableValues)
    _key = State(initialValue: template.key)
  }

  private var master: EmailMasterSummary? { saved.master }
  private var fields: [EmailVariable] { (master?.variables ?? []).filter { !$0.key.hasPrefix("project.") } }
  private var usesBrand: Bool { (master?.variables ?? []).contains { $0.key.hasPrefix("project.") } }
  private var dirty: Bool { key != saved.key || values != saved.variableValues }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          Text("Linked master: its design, this project's brand and values.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          if let master {
            EmailHTMLPreview(html: EmailRender.html(EmailRender.resolve(document: master.document, variables: master.variables, values: values, linked: true, brand: brand)))
              .frame(height: 320)
              .background(Theme.elevated)
              .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
              .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
          }
          brandSection
          valuesSection
          VStack(alignment: .leading, spacing: 8) {
            heading("Send it")
            Text("From your server, with the project secret. Your variables override the values above.").font(.lnMeta).foregroundStyle(Theme.textMuted)
            CodeBlock(code: snippet)
          }
          actions
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen(master?.name ?? "Master")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else { Button("Save") { Task { await save() } }.disabled(!dirty) }
        }
      }
      .confirmationDialog(
        confirm == .detach ? "Detach from the master? This project gets its own editable copy, and later edits to the master no longer reach it." : "Remove this master from the project? The master itself stays.",
        isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
        titleVisibility: .visible,
        presenting: confirm
      ) { action in
        Button(action == .detach ? "Detach" : "Remove", role: .destructive) { Task { await run(action) } }
      }
      .fullScreenCover(item: $editingMaster, onDismiss: { Task { await refresh() } }) { EmailEditorScreen(target: $0) }
      .sheet(item: $testing) { EmailTestSheet(template: $0) }
      // The master's saves (from the editor here, or anyone else's) redraw the preview live.
      .task(id: saved.masterId) { await listen() }
    }
  }

  private var brandSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      heading("Brand")
      markdown((usesBrand ? "Filled in from this project: " : "This master does not use the project brand placeholders yet. Available: ")
        + "`{{project.name}}`, `{{project.logoUrl}}`, `{{project.url}}`. Buttons in the master's brand colour take the project accent.")
      if let brand {
        FlowLayout(spacing: 6) {
          Tag(text: brand.name)
          if let logo = brand.brandLogoUrl, let url = URL(string: logo), !logo.isEmpty {
            HStack(spacing: 5) {
              AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { Color.clear }.frame(width: 14, height: 14)
              Text("Logo")
            }
            .font(.lnCaptionMedium)
            .foregroundStyle(Theme.textToned)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .overlay(Capsule().strokeBorder(Theme.border))
          }
          if let accent = brand.theme?.accent, !accent.isEmpty { Tag(text: accent, tint: Color(hexString: accent)) }
        }
      }
    }
  }

  private var valuesSection: some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("Values for this project")
      if fields.isEmpty { Text("The master has no variables of its own.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
      ForEach(fields, id: \.key) { variable in
        let label = variable.label ?? ""
        LabeledField(label: label.isEmpty ? variable.key : label, hint: label.isEmpty ? nil : variable.key) {
          TextField(variable.defaultValue?.isEmpty == false ? variable.defaultValue! : "Empty", text: binding(variable.key)).textFieldStyle(.linear)
        }
      }
      LabeledField(label: "Send key", hint: "Unique in this project. What your server passes as template to POST /v1/emails/send.") {
        TextField("", text: $key)
          .textFieldStyle(.linear)
          .monospaced()
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
      ErrorText(message: error)
    }
  }

  private var actions: some View {
    HStack(spacing: 8) {
      if let master {
        Button { editingMaster = EmailEditorTarget(id: master.id, name: master.name) } label: { Label("Edit master", systemImage: "pencil") }
          .buttonStyle(.lnSecondaryCompact)
      }
      Button {
        var current = saved
        current.variableValues = values
        testing = current
      } label: { Label("Send test", systemImage: "paperplane") }
        .buttonStyle(.lnGhost)
      Button { confirm = .detach } label: { Label("Detach", systemImage: "arrow.triangle.branch") }.buttonStyle(.lnGhost)
      Spacer(minLength: 0)
      Button(role: .destructive) { confirm = .remove } label: { Label("Remove", systemImage: "trash") }.buttonStyle(GhostButtonStyle(tint: Theme.error))
    }
    .padding(.top, 16)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 0.5) }
  }

  /// What the send API call looks like for this template, with the first sample values.
  private var snippet: String {
    let variables = fields.prefix(3).map { "\(json($0.key)):\(json($0.defaultValue?.isEmpty == false ? $0.defaultValue! : "…"))" }.joined(separator: ",")
    return """
    curl -X POST \(session.endpoint)/v1/emails/send \\
      -H "Authorization: Bearer $HELPBITES_SECRET" \\
      -H "Content-Type: application/json" \\
      -d '{"template":\(json(saved.key)),"to":"user@example.com","variables":{\(variables)}}'
    """
  }

  private func heading(_ text: String) -> some View {
    Text(text).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
  }

  private func markdown(_ text: String) -> some View {
    Text((try? AttributedString(markdown: text)) ?? AttributedString(text)).font(.lnMeta).foregroundStyle(Theme.textMuted)
  }

  private func json(_ text: String) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .withoutEscapingSlashes
    return (try? encoder.encode(text)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
  }

  /// A blank value falls back to the master's default, so it isn't stored.
  private func binding(_ name: String) -> Binding<String> {
    Binding(get: { values[name] ?? "" }, set: { values[name] = $0.isEmpty ? nil : $0 })
  }

  private func save() async {
    struct Input: Encodable, Sendable { let key: String; let variableValues: [String: String] }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(saved.id)", method: "PATCH", body: Input(key: key, variableValues: values))
      var updated = response.template
      updated.master = updated.master ?? saved.master
      saved = updated
      values = updated.variableValues
      key = updated.key
      onSaved(updated)
    } catch { self.error = error.localizedDescription }
  }

  /// After editing the master, pick up its new design and variables.
  private func refresh() async {
    guard let response: EmailTemplateResponse = try? await session.get("/v1/admin/emails/\(saved.id)") else { return }
    saved.master = response.template.master ?? saved.master
    onSaved(saved)
  }

  // MARK: Live updates

  /// What GET /v1/admin/emails/:id/events sends after each save of the master.
  private struct MasterEvent: Decodable, Sendable {
    struct Template: Decodable, Sendable {
      let id: String?
      let name: String?
      let document: JSONValue?
      let variables: [EmailVariable]?
      let updatedAt: Double?
    }
    let type: String?
    let template: Template?
  }

  /// Follows the master's SSE stream until the panel goes away, reconnecting
  /// with backoff and catching up on what a dropped connection missed.
  private func listen() async {
    guard let masterId = saved.masterId else { return }
    var attempt = 0
    while !Task.isCancelled {
      do {
        guard let url = URL(string: "\(session.endpoint)/v1/admin/emails/\(masterId)/events") else { return }
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        if attempt > 0 { await refresh() }
        attempt = 0
        // One `data:` line per event (server/utils/sse.ts); ping and ready frames carry no template.
        for try await line in bytes.lines where line.hasPrefix("data:") {
          guard let event = try? JSONDecoder().decode(MasterEvent.self, from: Data(line.dropFirst(5).utf8)), event.type == "email.updated" else { continue }
          apply(event.template)
        }
      } catch {}
      if Task.isCancelled { return }
      attempt += 1
      try? await Task.sleep(for: .seconds(min(30, 1 << min(attempt, 5))))
    }
  }

  private func apply(_ template: MasterEvent.Template?) {
    guard let template, let current = saved.master, template.id == nil || template.id == current.id else {
      Task { await refresh() }
      return
    }
    saved.master = EmailMasterSummary(
      id: current.id,
      name: template.name ?? current.name,
      document: template.document ?? current.document,
      variables: template.variables ?? current.variables,
      updatedAt: template.updatedAt ?? current.updatedAt
    )
    onSaved(saved)
  }

  private func run(_ action: Action) async {
    error = ""
    do {
      switch action {
      case .detach:
        let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(saved.id)/detach")
        onDetached(response.template)
      case .remove:
        try await session.delete("/v1/admin/emails/\(saved.id)")
        onRemoved(saved.id)
      }
    } catch { self.error = error.localizedDescription }
  }
}
