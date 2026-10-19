import SwiftUI

// The component library (shared/email/components.ts, EmailComponents.vue,
// EmailComponentDialog.vue): custom HTML saved once and reused, with `{{@key}}`
// fields each email fills in (copy, links and images as content; colours and
// sizes as style). Inserting one copies its HTML and fields into a `component`
// block, so an email never depends on the library afterwards.

/// A library component as GET/POST/PATCH /v1/admin/email-components return it.
/// `projectId` nil: shared by every project and master.
struct EmailComponentDef: Identifiable, Equatable, Sendable {
  let id: String
  var name: String
  /// When to use it: the AI designer reads this.
  var description: String
  var html: String
  var fields: [EmailComponentField]
  var projectId: String?
  var updatedAt: String?

  /// Read leniently; nil without an id.
  init?(json: JSONValue) {
    let f = EmailRender.object(json)
    guard let id = EmailRender.string(f["id"]), !id.isEmpty else { return nil }
    self.id = id
    name = EmailRender.string(f["name"]) ?? ""
    description = EmailRender.string(f["description"]) ?? ""
    html = EmailRender.string(f["html"]) ?? ""
    fields = EmailRender.list(f["fields"]).compactMap(EmailComponentField.init(json:))
    projectId = EmailRender.string(f["projectId"])
    updatedAt = EmailRender.string(f["updatedAt"])
  }

  /// componentInstance(): a copy for an email, with values for its declared fields.
  func instance(id blockId: String, values: [String: String] = [:]) -> EmailDesignBlock {
    .component(id: blockId, componentId: id, name: name, html: html, fields: fields, values: values)
  }

  /// componentOutdated(): this version differs from the one the instance copied.
  func isNewer(than block: EmailDesignBlock) -> Bool {
    html != block.html || name != block.name || fields != block.componentFields
  }

  /// refreshComponent(): this version on an instance, keeping its values for fields that still exist.
  func refresh(_ block: inout EmailDesignBlock) {
    let next = instance(id: block.id, values: block.values)
    block.name = next.name
    block.html = next.html
    block.componentFields = next.componentFields
    block.values = next.values
  }

  /// normalizeComponentInput()'s checks, as the dialog shows them; nil when it can be saved.
  static func problem(name: String, description: String, html: String) -> String? {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let html = html.trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { return "A component needs a name" }
    if name.utf16.count > 80 { return "The name is longer than 80 characters" }
    if description.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 500 { return "The description is longer than 500 characters" }
    if html.isEmpty { return "A component needs HTML" }
    if html.utf16.count > 100_000 { return "The HTML is larger than 100 KB" }
    if html.contains(#/<\s*(script|form|iframe|object|embed|video)\b/#.ignoresCase()) { return "The HTML uses tags mail clients strip (script, form, iframe, video)" }
    return nil
  }
}

/// The admin routes for the library.
enum EmailComponentAPI {
  private struct List: Decodable, Sendable { let components: [JSONValue] }
  private struct Saved: Decodable, Sendable { let component: JSONValue }

  /// The shared components, plus one project's own (masters see the shared ones).
  static func list(_ session: SessionStore, projectId: String?) async throws -> [EmailComponentDef] {
    let response: List = try await session.get("/v1/admin/email-components", query: projectId.map { ["project": $0] } ?? [:])
    return response.components.compactMap(EmailComponentDef.init(json:))
  }

  /// POST a new component, or PATCH `id`. `projectId` nil shares it with every project.
  static func save(_ session: SessionStore, id: String?, name: String, description: String, html: String, fields: [EmailComponentField], projectId: String?) async throws -> EmailComponentDef {
    let body: [String: JSONValue] = [
      "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
      "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
      "html": .string(html.trimmingCharacters(in: .whitespacesAndNewlines)),
      "fields": .array(fields.map(\.json)),
      "project": projectId.map(JSONValue.string) ?? .null
    ]
    let response: Saved = if let id {
      try await session.send("/v1/admin/email-components/\(id)", method: "PATCH", body: body)
    } else {
      try await session.send("/v1/admin/email-components", body: body)
    }
    guard let saved = EmailComponentDef(json: response.component) else { throw APIError.server("The server didn't return the component.") }
    return saved
  }

  /// Emails that use it keep their copy.
  static func delete(_ session: SessionStore, id: String) async throws {
    try await session.delete("/v1/admin/email-components/\(id)")
  }
}

/// What the component sheet opens with: a library component to edit, or a new
/// one with a starting point. `replaceId` is the block that becomes the saved component.
struct EmailComponentRequest: Identifiable {
  let id = UUID()
  var component: EmailComponentDef?
  var name = ""
  var html = ""
  var replaceId: String?
}

// MARK: - Component sheet

/// Create or edit a library component (EmailComponentDialog.vue): email HTML with
/// a `{{@key}}` wherever an email gets its own value, and a row per field
/// (label, type, content or style, default). The fields follow the HTML as it's
/// typed, with types guessed from where each slot sits; the preview shows the
/// component with its defaults. "Let the AI do it" hands the job to the designer.
struct EmailComponentEditor: View {
  let request: EmailComponentRequest
  /// The project a new component belongs to unless shared; nil for masters (always shared).
  let projectId: String?
  var onSaved: (EmailComponentDef) -> Void
  /// Offers "Let the AI do it" (when a block is being saved).
  var onAskAI: (() -> Void)?
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name: String
  @State private var description: String
  @State private var html: String
  @State private var shared: Bool
  /// Every field described in this sheet, by key, so deleting and retyping a slot keeps its settings.
  @State private var known: [String: EmailComponentField]
  @State private var saving = false
  @State private var error = ""

  init(request: EmailComponentRequest, projectId: String?, onSaved: @escaping (EmailComponentDef) -> Void, onAskAI: (() -> Void)? = nil) {
    self.request = request
    self.projectId = projectId
    self.onSaved = onSaved
    self.onAskAI = onAskAI
    let component = request.component
    _name = State(initialValue: component?.name ?? request.name)
    _description = State(initialValue: component?.description ?? "")
    _html = State(initialValue: component?.html ?? request.html)
    _shared = State(initialValue: component.map { $0.projectId == nil } ?? (projectId == nil))
    _known = State(initialValue: Dictionary((component?.fields ?? []).map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first }))
  }

  /// One per `{{@key}}`: described ones keep their settings, new slots get a guessed type.
  private var fields: [EmailComponentField] {
    EmailComponentField.normalized(html, declared: EmailComponentField.slotKeys(html).map { known[$0]?.json ?? .object(["key": .string($0)]) })
  }

  var body: some View {
    let fields = fields
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text(verbatim: "Email HTML you can reuse. Mark the parts each email changes with {{@name}}.")
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") {
            TextField("Brand header", text: $name).textFieldStyle(.linear)
          }
          if projectId != nil {
            Toggle("Use in every project", isOn: $shared)
              .font(.lnBody)
              .tint(Theme.accent)
          }
          LabeledField(label: "When to use it", hint: "The AI designer reads this to pick the component.") {
            TextField("The logo row at the top of every email", text: $description).textFieldStyle(.linear)
          }
          LabeledField(label: "HTML", hint: "One element (a <table>), inline styles. A field is {{@key}}: href=\"{{@link}}\", color:{{@tint}}, {{@title}}.") {
            LinearTextEditor(text: $html, placeholder: "<table role=\"presentation\" width=\"100%\">…</table>", minHeight: 200, monospaced: true)
              .autocorrectionDisabled()
              .textInputAutocapitalization(.never)
          }
          if !fields.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              SectionLabel("Fields")
              ForEach(fields) { field in
                EmailComponentFieldRow(field: field) { change in setField(field.key, change) }
              }
            }
          } else if !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(verbatim: "No fields yet: every email shows this HTML as it is. Add {{@name}} where an email should get its own value.")
              .font(.lnCaption)
              .foregroundStyle(Theme.textMuted)
          }
          LabeledField(label: "Preview, with the defaults") {
            preview(fields)
          }
          ErrorText(message: error)
          if let onAskAI {
            Button {
              onAskAI()
              dismiss()
            } label: { Label("Let the AI do it", systemImage: "sparkles") }
              .buttonStyle(.lnGhost)
          }
        }
        .padding(20)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(request.component == nil ? "New component" : "Edit component")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button(request.component == nil ? "Save to library" : "Save") { Task { await save(fields) } }
          }
        }
      }
    }
  }

  @ViewBuilder private func preview(_ fields: [EmailComponentField]) -> some View {
    if html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      Text("Paste some HTML to see it here.")
        .font(.lnCaption)
        .foregroundStyle(Theme.textMuted)
        .frame(maxWidth: .infinity, minHeight: 120)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    } else {
      let block = EmailDesignBlock.component(id: "preview", componentId: "preview", name: name, html: html, fields: fields)
      SandboxedWebView(html: EmailRender.html(.object(["settings": EmailRender.defaultSettings(title: name.isEmpty ? "Component" : name), "blocks": .array([block.json])])), interactive: false)
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    }
  }

  /// A change to one field; a new type brings its group (a colour or a number is style).
  private func setField(_ key: String, _ change: (inout EmailComponentField) -> Void) {
    var field = fields.first { $0.key == key } ?? EmailComponentField(key: key, label: EmailComponentField.label(forKey: key), type: .text, group: .content, defaultValue: "")
    change(&field)
    known[key] = field
  }

  private func save(_ fields: [EmailComponentField]) async {
    if let problem = EmailComponentDef.problem(name: name, description: description, html: html) {
      error = problem
      return
    }
    saving = true
    error = ""
    do {
      // A master's components are always shared; a project's are its own unless shared.
      let project = shared ? nil : projectId
      let saved = try await EmailComponentAPI.save(session, id: request.component?.id, name: name, description: description, html: html, fields: fields, projectId: project)
      onSaved(saved)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
    saving = false
  }
}

/// One field of the component being edited: its key, label, type, group and
/// default. Text stays as typed here (the stored label is trimmed).
private struct EmailComponentFieldRow: View {
  let field: EmailComponentField
  let onChange: ((inout EmailComponentField) -> Void) -> Void
  @State private var label: String
  @State private var defaultValue: String

  init(field: EmailComponentField, onChange: @escaping ((inout EmailComponentField) -> Void) -> Void) {
    self.field = field
    self.onChange = onChange
    _label = State(initialValue: field.label)
    _defaultValue = State(initialValue: field.defaultValue)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(verbatim: field.key).font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1)
      TextField("Label", text: $label).textFieldStyle(.linear)
      HStack(spacing: 8) {
        Picker("Type", selection: Binding(get: { field.type }, set: { type in onChange { $0.type = type; $0.group = type.group } })) {
          ForEach(EmailComponentField.Kind.allCases) { Text($0.label).tag($0) }
        }
        Picker("Group", selection: Binding(get: { field.group }, set: { group in onChange { $0.group = group } })) {
          ForEach(EmailComponentField.Group.allCases) { Text($0.label).tag($0) }
        }
        Spacer(minLength: 0)
      }
      .pickerStyle(.menu)
      if field.type == .color {
        EmailColorField(
          label: "Default",
          color: Binding<String?>(get: { field.defaultValue.isEmpty ? nil : field.defaultValue }, set: { value in onChange { $0.defaultValue = value ?? "" } }),
          clearable: true
        )
      } else {
        TextField("Default value", text: $defaultValue).textFieldStyle(.linear)
      }
    }
    .padding(12)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .onChange(of: label) { _, value in onChange { $0.label = value } }
    .onChange(of: defaultValue) { _, value in onChange { $0.defaultValue = value } }
  }
}

// MARK: - Library page

/// The Components tab of the email page (EmailComponents.vue): on the masters
/// page the shared library, on a project's page its own components and the
/// shared ones. Editing one changes new insertions; emails that already use it
/// keep their copy until they update from the library.
struct EmailComponentLibrary: View {
  let projectId: String?
  @Environment(SessionStore.self) private var session
  @State private var components: [EmailComponentDef] = []
  @State private var loading = true
  @State private var search = ""
  @State private var editing: EmailComponentRequest?
  @State private var deleting: EmailComponentDef?
  @State private var error = ""

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 10) {
        Text((projectId != nil ? "This project's components and the shared ones." : "Shared with every project and master.")
          + " Insert them from Add in the editor; the AI designer uses them and saves new ones. Each email keeps its own copy.")
          .font(.lnMeta)
          .foregroundStyle(Theme.textMuted)
        SearchField(text: $search)
      }
      .padding(.horizontal, Metrics.gutter)
      .padding(.vertical, 10)
      .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
      content
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button { editing = EmailComponentRequest() } label: { Label("New component", systemImage: "plus") }
      }
    }
    .task { await load() }
    .sheet(item: $editing) { request in
      EmailComponentEditor(request: request, projectId: projectId) { saved in
        components = (components.filter { $0.id != saved.id } + [saved]).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
      }
    }
    .confirmationDialog(
      "Delete “\(deleting?.name ?? "")”? Emails that use it keep their copy.",
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible,
      presenting: deleting
    ) { component in
      Button("Delete", role: .destructive) { Task { await delete(component) } }
    }
    .alert(error, isPresented: Binding(get: { !error.isEmpty }, set: { if !$0 { error = "" } })) { Button("OK", role: .cancel) {} }
  }

  private var shown: [EmailComponentDef] {
    let query = search.trimmingCharacters(in: .whitespaces).lowercased()
    return query.isEmpty ? components : components.filter { "\($0.name) \($0.description)".lowercased().contains(query) }
  }

  @ViewBuilder private var content: some View {
    if loading {
      SkeletonRows(count: 4)
      Spacer(minLength: 0)
    } else if shown.isEmpty {
      ScrollView {
        EmptyState(
          systemImage: "puzzlepiece",
          title: search.isEmpty ? "No components yet" : "Nothing matches",
          message: search.isEmpty ? "Save a header, footer or badge once and reuse it. Paste HTML here, use Save as component in the editor, or ask the AI designer to make one." : "Try another search."
        ) {
          if search.isEmpty {
            Button { editing = EmailComponentRequest() } label: { Label("New component", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
          }
        }
      }
      .refreshable { await load() }
    } else {
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
          ForEach(shown) { card($0) }
        }
        .padding(Metrics.gutter)
      }
      .refreshable { await load() }
    }
  }

  private func card(_ component: EmailComponentDef) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Button { editing = EmailComponentRequest(component: component) } label: {
        SandboxedWebView(html: EmailRender.html(.object(["settings": EmailRender.defaultSettings(title: component.name), "blocks": .array([component.instance(id: component.id).json])])), interactive: false)
          .frame(height: 150)
          .allowsHitTesting(false)
          .frame(maxWidth: .infinity)
          .background(Theme.elevated)
          .clipped()
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Edit \(component.name)")
      HStack(alignment: .top, spacing: 8) {
        VStack(alignment: .leading, spacing: 4) {
          Text(component.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(component.description.isEmpty ? "No description" : component.description)
            .font(.lnCaption)
            .foregroundStyle(Theme.textMuted)
            .lineLimit(2, reservesSpace: true)
          HStack(spacing: 6) {
            Tag(text: component.projectId == nil ? "Shared" : "This project")
            Tag(text: "\(component.fields.count) field\(component.fields.count == 1 ? "" : "s")")
          }
          .padding(.top, 4)
        }
        Spacer(minLength: 0)
        Menu { actions(component) } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.textMuted)
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("\(component.name) actions")
      }
      .padding(12)
    }
    .background(Theme.panel)
    .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .contextMenu { actions(component) }
  }

  @ViewBuilder private func actions(_ component: EmailComponentDef) -> some View {
    Button { editing = EmailComponentRequest(component: component) } label: { Label("Edit", systemImage: "pencil") }
    Button(role: .destructive) { deleting = component } label: { Label("Delete", systemImage: "trash") }
  }

  private func load() async {
    do {
      components = try await EmailComponentAPI.list(session, projectId: projectId)
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }

  private func delete(_ component: EmailComponentDef) async {
    do {
      try await EmailComponentAPI.delete(session, id: component.id)
      components.removeAll { $0.id == component.id }
    } catch {
      self.error = error.localizedDescription
    }
  }
}
