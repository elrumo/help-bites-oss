import SwiftUI

// The component library and its editor (web: components/cms/CmsComponents.vue and
// projects/[id]/pages/components/[componentId].vue). The server validates a component
// (`normalizeComponentInput`); the editor checks the key and name and shows the server's reason.

/// A component as the editor holds it: the whole definition, HTML and CSS included.
struct CmsComponentDraft: Codable, Identifiable, Hashable, Sendable {
  var id = ""
  var key = ""
  var name = ""
  var description = ""
  var root = false
  var nestable = true
  var fields: [CmsFieldDraft] = []
  var html = ""
  var css = ""
  var builtin: Bool?

  var isBuiltin: Bool { builtin == true }
  var kind: String { root && nestable ? String(localized: "Page or block") : root ? String(localized: "Page") : String(localized: "Block") }

  private enum CodingKeys: String, CodingKey { case id, key, name, description, root, nestable, fields, html, css, builtin }
  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
    key = try c.decode(String.self, forKey: .key)
    name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
    description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
    root = try c.decodeIfPresent(Bool.self, forKey: .root) ?? false
    nestable = try c.decodeIfPresent(Bool.self, forKey: .nestable) ?? true
    fields = try c.decodeIfPresent([CmsFieldDraft].self, forKey: .fields) ?? []
    html = try c.decodeIfPresent(String.self, forKey: .html) ?? ""
    css = try c.decodeIfPresent(String.self, forKey: .css) ?? ""
    builtin = try c.decodeIfPresent(Bool.self, forKey: .builtin)
  }
  /// What the server takes: no id, and only the fields that have a key.
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(key, forKey: .key)
    try c.encode(name, forKey: .name)
    try c.encode(description, forKey: .description)
    try c.encode(root, forKey: .root)
    try c.encode(nestable, forKey: .nestable)
    try c.encode(fields.filter { !$0.key.isEmpty }, forKey: .fields)
    try c.encode(html, forKey: .html)
    try c.encode(css, forKey: .css)
  }
}

struct CmsFieldDraft: Codable, Identifiable, Hashable, Sendable {
  let uid = UUID()
  var key = ""
  var label = ""
  var type = "text"
  /// Shown as text; the server reads it as the field's type.
  var defaultText = ""
  var required = false
  var options: [String] = []
  var allow: [String] = []

  var id: UUID { uid }
  var kind: CmsFieldKind { CmsFieldKind(rawValue: type) ?? .text }

  private enum CodingKeys: String, CodingKey { case key, label, type, `default`, required, options, allow }
  init(key: String = "", label: String = "", type: String = "text") {
    self.key = key; self.label = label; self.type = type
  }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    key = try c.decode(String.self, forKey: .key)
    label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
    type = try c.decodeIfPresent(String.self, forKey: .type) ?? "text"
    if let value = try c.decodeIfPresent(JSONValue.self, forKey: .default), value != .null {
      switch value {
      case .number(let n): defaultText = n == n.rounded() ? String(Int(n)) : String(n)
      default: defaultText = value.display
      }
    }
    required = try c.decodeIfPresent(Bool.self, forKey: .required) ?? false
    options = try c.decodeIfPresent([String].self, forKey: .options) ?? []
    allow = try c.decodeIfPresent([String].self, forKey: .allow) ?? []
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(key, forKey: .key)
    try c.encode(label.isEmpty ? CmsComponentText.label(key) : label, forKey: .label)
    try c.encode(type, forKey: .type)
    if !defaultText.isEmpty && kind != .asset && kind != .blocks {
      switch kind {
      case .number: if let n = Double(defaultText) { try c.encode(n, forKey: .default) }
      case .boolean: try c.encode(defaultText == "true", forKey: .default)
      default: try c.encode(defaultText, forKey: .default)
      }
    }
    if required { try c.encode(true, forKey: .required) }
    if kind == .select || kind == .icon { try c.encode(options, forKey: .options) }
    if kind == .blocks { try c.encode(allow, forKey: .allow) }
  }
}

/// `fieldLabel`, `templateKeys`, `guessFieldType` and `COMPONENT_KEY` of shared/cms/content.ts.
enum CmsComponentText {
  static let keyPattern = "^[a-z][a-z0-9_-]{0,39}$"
  static func validKey(_ key: String) -> Bool { key.range(of: keyPattern, options: .regularExpression) != nil }

  /// `buttonLabel` / `button_label` → "Button label".
  static func label(_ key: String) -> String {
    let spaced = key.replacingOccurrences(of: "_", with: " ")
      .replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
      .trimmingCharacters(in: .whitespaces).lowercased()
    return spaced.prefix(1).uppercased() + spaced.dropFirst()
  }

  /// The `{{@key}}` and `{{#key}}` slots a template uses, in order.
  static func templateKeys(_ html: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: "\\{\\{\\s*[@#^]([A-Za-z][A-Za-z0-9_]*)") else { return [] }
    var seen: [String] = []
    for match in regex.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
      if let range = Range(match.range(at: 1), in: html), !seen.contains(String(html[range])) { seen.append(String(html[range])) }
    }
    return seen
  }

  /// A type for a slot nobody declared, from where it sits: an href is a URL, a src a file, after `color:` a colour.
  static func guessType(_ html: String, _ key: String) -> String {
    guard let at = html.range(of: "\\{\\{\\s*@\(key)\\b", options: .regularExpression) else { return "text" }
    if html.range(of: "\\{\\{\\s*@\(key)\\.(alt|width|height|mime|url)", options: .regularExpression) != nil { return "asset" }
    let before = String(html[..<at.lowerBound].suffix(48))
    func ends(_ pattern: String) -> Bool { before.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
    if ends("\\b(href|action)\\s*=\\s*[\"']?$") { return "url" }
    if ends("\\b(src|poster)\\s*=\\s*[\"']?$") { return "asset" }
    if ends("(color|background|fill|stroke)\\s*[:=]\\s*[\"']?$") { return "color" }
    return "text"
  }
}

// MARK: - Library

/// The Components tab: the project's own components, then the built-ins (duplicate one to change it).
struct PagesComponentsView: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var components: [CmsComponentDraft] = []
  @State private var loading = true
  @State private var error = ""
  @State private var open: CmsComponentDraft?
  @State private var creating = false

  private var own: [CmsComponentDraft] { components.filter { !$0.isBuiltin } }
  private var builtins: [CmsComponentDraft] { components.filter(\.isBuiltin) }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        ErrorText(message: error)
        if loading && components.isEmpty {
          SkeletonRows(count: 4)
        } else {
          Text("Your components").font(.lnMetaMedium).foregroundStyle(Theme.textMuted)
          if own.isEmpty {
            Text("None yet. Write one, or duplicate a built-in to change it.")
              .font(.lnMeta).foregroundStyle(Theme.textMuted).frame(maxWidth: .infinity).padding(24)
              .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
          } else {
            Card {
              ForEach(Array(own.enumerated()), id: \.element.id) { index, item in
                CardRow(divider: index < own.count - 1) {
                  Button { open = item } label: {
                    HStack(spacing: 10) {
                      VStack(alignment: .leading, spacing: 2) {
                        Text(item.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                        Text(item.description.isEmpty ? (item.fields.count == 1 ? String(localized: "1 field") : String(localized: "\(item.fields.count) fields")) : item.description)
                          .font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
                        HStack(spacing: 6) {
                          Text(item.key).font(.lnMono).foregroundStyle(Theme.textDimmed)
                          Tag(text: item.kind, tint: Theme.textDimmed)
                          if item.html.isEmpty { Tag(text: "Data only", tint: Theme.accent) }
                        }
                        .padding(.top, 2)
                      }
                      .frame(maxWidth: .infinity, alignment: .leading)
                      Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
                    }
                    .contentShape(Rectangle())
                  }
                  .buttonStyle(.plain)
                }
              }
            }
          }
          Text("Built in").font(.lnMetaMedium).foregroundStyle(Theme.textMuted).padding(.top, 8)
          Card {
            ForEach(Array(builtins.enumerated()), id: \.element.key) { index, item in
              CardRow(divider: index < builtins.count - 1) {
                HStack(alignment: .top, spacing: 10) {
                  VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                      Text(item.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                      Text(item.key).font(.lnMono).foregroundStyle(Theme.textDimmed)
                    }
                    Text(item.description).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2)
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)
                  Button { Task { await duplicate(item) } } label: { Image(systemName: "plus.square.on.square") }
                    .buttonStyle(.lnGhost).accessibilityLabel("Duplicate \(item.name) to edit")
                }
              }
            }
          }
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.bottom, 28)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await load() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New component", systemImage: "plus") }
      }
    }
    .navigationDestination(item: $open) { item in
      PageComponentScreen(projectId: projectId, component: item, taken: Set(components.map(\.key))) { await load() }
    }
    .navigationDestination(isPresented: $creating) {
      PageComponentScreen(projectId: projectId, component: nil, taken: Set(components.map(\.key))) { await load() }
    }
    .task { await load() }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let components: [CmsComponentDraft] }
    do {
      components = try await (session.get("/v1/admin/cms/components", query: ["project": projectId]) as Response).components
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  /// A built-in copied under a free key, opened to edit.
  private func duplicate(_ item: CmsComponentDraft) async {
    struct Response: Decodable, Sendable { let component: CmsComponentDraft }
    let taken = Set(components.map(\.key))
    var key = "\(item.key)_custom"
    var n = 2
    while taken.contains(key) { key = "\(item.key)_custom\(n)"; n += 1 }
    var copy = item
    copy.key = key
    copy.name = "Copy of \(item.name)"
    struct Input: Encodable, Sendable { let project: String; let component: CmsComponentDraft
      func encode(to encoder: Encoder) throws {
        try component.encode(to: encoder)
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(project, forKey: Key("project"))
      }
    }
    do {
      let response: Response = try await session.send("/v1/admin/cms/components", body: Input(project: projectId, component: copy))
      await load()
      open = response.component
    } catch {
      self.error = error.localizedDescription
    }
  }
}

private struct Key: CodingKey {
  var stringValue: String
  var intValue: Int? { nil }
  init(_ value: String) { stringValue = value }
  init?(stringValue: String) { self.stringValue = stringValue }
  init?(intValue: Int) { nil }
}

// MARK: - Editor

/// One component: its name, key, kind, fields and HTML and CSS template.
struct PageComponentScreen: View {
  let projectId: String
  let component: CmsComponentDraft?
  /// Every key in the library, for the block field's choices and to refuse a built-in's key.
  let taken: Set<String>
  let onChange: () async -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var form: CmsComponentDraft
  @State private var saved: CmsComponentDraft
  @State private var componentId: String
  @State private var keyTouched: Bool
  @State private var saving = false
  @State private var error = ""
  @State private var confirmDelete = false
  @State private var chat: PagesChatStore?
  @State private var assistantOpen = false

  init(projectId: String, component: CmsComponentDraft?, taken: Set<String>, onChange: @escaping () async -> Void) {
    self.projectId = projectId
    self.component = component
    self.taken = taken
    self.onChange = onChange
    let start = component ?? CmsComponentDraft()
    _form = State(initialValue: start)
    _saved = State(initialValue: start)
    _componentId = State(initialValue: component?.id ?? "")
    _keyTouched = State(initialValue: component != nil)
  }

  private var isNew: Bool { componentId.isEmpty }
  private var dirty: Bool { form != saved }
  private var keyOK: Bool { form.key.isEmpty || (CmsComponentText.validKey(form.key) && (!isNew || !taken.contains(form.key))) }
  private var undeclared: [String] { CmsComponentText.templateKeys(form.html).filter { key in !form.fields.contains { $0.key == key } } }
  private var canSave: Bool { !form.name.trimmingCharacters(in: .whitespaces).isEmpty && CmsComponentText.validKey(form.key) && keyOK && (isNew || dirty) && !saving }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        ErrorText(message: error)
        about
        fieldsPanel
        templatePanel
        if !isNew {
          Button(role: .destructive) { confirmDelete = true } label: { Label("Delete component", systemImage: "trash") }.buttonStyle(.lnGhost)
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 20)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen(form.name.isEmpty ? "New component" : form.name)
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        if !isNew {
          Button { openAssistant() } label: { Label("Assistant", systemImage: "sparkles") }
        }
      }
      ToolbarItem(placement: .primaryAction) {
        Button { Task { await save() } } label: { Text(saving ? "Saving…" : isNew ? "Create" : "Save") }
          .keyboardShortcut("s", modifiers: .command).disabled(!canSave)
      }
    }
    .sheet(isPresented: $assistantOpen) {
      if let chat {
        NavigationStack {
          PagesChatPanel(chat: chat, library: CmsLibrary(), selected: nil, content: nil) { _ in }
            .panelScreen("Assistant")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { assistantOpen = false } } }
        }
        .presentationDetents([.medium, .large])
      }
    }
    .confirmationDialog("Delete “\(form.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete component", role: .destructive) { Task { await remove() } }
    } message: {
      Text("Pages keep their content but stop showing its blocks.")
    }
  }

  /// The assistant writes this component: what it saves replaces the form.
  private func openAssistant() {
    if chat == nil {
      let store = PagesChatStore(session: session, scope: PagesChatScope(projectId: projectId, componentId: componentId))
      store.componentSaved = { Task { await reload() } }
      chat = store
    }
    assistantOpen = true
  }

  private func reload() async {
    struct Response: Decodable, Sendable { let components: [CmsComponentDraft] }
    guard let response: Response = try? await session.get("/v1/admin/cms/components", query: ["project": projectId]),
          let mine = response.components.first(where: { $0.id == componentId }) else { return }
    form = mine
    saved = mine
    await onChange()
  }

  private var about: some View {
    LegalPanel("Component") {
      LabeledField(label: "Name") {
        TextField("Pricing banner", text: $form.name).textFieldStyle(.linear)
          .onChange(of: form.name) { _, value in
            form.name = value.clipped(to: CmsLimits.name)
            if !keyTouched { form.key = Self.autoKey(form.name) }
          }
      }
      LabeledField(label: "Key", hint: isNew ? "What a block's “component” names, in the API and in your code." : "Fixed once created: blocks and your code use it.") {
        TextField("pricing_banner", text: Binding(get: { form.key }, set: { form.key = $0; keyTouched = true }))
          .textFieldStyle(.linear).font(.lnMono).disabled(!isNew)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      if !keyOK {
        Label("Lowercase letters, digits, _ and -, starting with a letter; not a key already in use", systemImage: "exclamationmark.circle")
          .font(.lnCaption).foregroundStyle(Theme.error)
      }
      LabeledField(label: "Description", hint: "When to use it. The assistant reads this to decide.") {
        LinearTextEditor(text: $form.description, minHeight: 56)
          .onChange(of: form.description) { _, value in form.description = value.clipped(to: 500) }
      }
      Toggle(isOn: $form.nestable) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Can go inside other blocks").font(.lnRow)
          Text("Shows in the block picker.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      Toggle(isOn: $form.root) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Is a page type").font(.lnRow)
          Text("Entries are made of it, such as a product or a blog post.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      if !form.root && !form.nestable {
        Label("A component is a page type, a block, or both", systemImage: "exclamationmark.circle").font(.lnCaption).foregroundStyle(Theme.error)
      }
    }
  }

  private var fieldsPanel: some View {
    LegalPanel("Fields") {
      if form.fields.isEmpty { Text("No fields yet: the template is fixed text.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      ForEach($form.fields) { $field in
        fieldEditor($field)
      }
      HStack {
        Button { form.fields.append(CmsFieldDraft()) } label: { Label("Add field", systemImage: "plus") }
          .buttonStyle(.lnGhost).disabled(form.fields.count >= 40)
        if !undeclared.isEmpty {
          Button { for key in undeclared { form.fields.append(CmsFieldDraft(key: key, label: CmsComponentText.label(key), type: CmsComponentText.guessType(form.html, key))) } } label: {
            Label(undeclared.count == 1 ? "Add the template's field" : "Add the template's \(undeclared.count) fields", systemImage: "text.viewfinder")
          }
          .buttonStyle(.lnGhost)
        }
      }
    }
  }

  private func fieldEditor(_ field: Binding<CmsFieldDraft>) -> some View {
    let index = form.fields.firstIndex { $0.uid == field.wrappedValue.uid } ?? 0
    return VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        TextField("key", text: field.key).textFieldStyle(.linear).font(.lnMono)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
        Picker("Type", selection: field.type) {
          ForEach(CmsFieldKind.allCases, id: \.rawValue) { Text(LocalizedStringKey(Self.typeLabels[$0.rawValue] ?? $0.rawValue)).tag($0.rawValue) }
        }
        .labelsHidden().fixedSize()
        Menu {
          Button { move(index, -1) } label: { Label("Move up", systemImage: "arrow.up") }.disabled(index == 0)
          Button { move(index, 1) } label: { Label("Move down", systemImage: "arrow.down") }.disabled(index == form.fields.count - 1)
          Button(role: .destructive) { form.fields.removeAll { $0.uid == field.wrappedValue.uid } } label: { Label("Remove", systemImage: "xmark") }
        } label: { Image(systemName: "ellipsis").frame(width: 32, height: 32).contentShape(Rectangle()) }
          .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
      }
      TextField(CmsComponentText.label(field.wrappedValue.key.isEmpty ? "label" : field.wrappedValue.key), text: field.label).textFieldStyle(.linear)
      if field.wrappedValue.kind != .asset && field.wrappedValue.kind != .blocks {
        TextField("Default", text: field.defaultText).textFieldStyle(.linear)
      }
      if field.wrappedValue.kind == .select || field.wrappedValue.kind == .icon {
        TextField(field.wrappedValue.kind == .icon ? "Icons offered, comma separated (empty offers all)" : "Choices, comma separated", text: Binding(
          get: { field.wrappedValue.options.joined(separator: ", ") },
          set: { field.wrappedValue.options = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
        ))
        .textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      if field.wrappedValue.kind == .blocks {
        TextField("Components allowed, comma separated (empty allows any)", text: Binding(
          get: { field.wrappedValue.allow.joined(separator: ", ") },
          set: { field.wrappedValue.allow = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
        ))
        .textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      Toggle("Required", isOn: field.required).font(.lnMeta)
    }
    .padding(10)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private var templatePanel: some View {
    LegalPanel("Template") {
      Text("HTML with {{@field}} slots and CSS for it. Components are HTML and CSS only; nothing that runs.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      LabeledField(label: "HTML") {
        LinearTextEditor(text: $form.html, placeholder: "<section class=\"my-block\">\n  <h2>{{@title}}</h2>\n</section>", minHeight: 200, monospaced: true)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      LabeledField(label: "CSS") {
        LinearTextEditor(text: $form.css, placeholder: ".my-block { padding: 48px 24px; color: var(--hb-text); }", minHeight: 140, monospaced: true)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
      }
    }
  }

  static let typeLabels = [
    "text": "Text", "textarea": "Multi-line text", "markdown": "Markdown", "number": "Number", "boolean": "On or off", "color": "Colour",
    "url": "Link", "date": "Date", "select": "Choice", "icon": "Icon", "asset": "File", "blocks": "Blocks"
  ]

  private func move(_ index: Int, _ by: Int) {
    let item = form.fields.remove(at: index)
    form.fields.insert(item, at: index + by)
  }

  /// A key from the name, as the web editor makes it.
  static func autoKey(_ name: String) -> String {
    var key = name.lowercased().folding(options: .diacriticInsensitive, locale: nil)
      .replacingOccurrences(of: "[^a-z0-9]+", with: "_", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    if key.first?.isNumber == true { key = "c" + key }
    return String(key.prefix(40))
  }

  private struct Payload: Encodable, Sendable {
    let project: String?
    let component: CmsComponentDraft
    func encode(to encoder: Encoder) throws {
      try component.encode(to: encoder)
      if let project { var c = encoder.container(keyedBy: Key.self); try c.encode(project, forKey: Key("project")) }
    }
  }
  private struct Response: Decodable, Sendable { let component: CmsComponentDraft }

  private func save() async {
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: Response = isNew
        ? try await session.send("/v1/admin/cms/components", body: Payload(project: projectId, component: form))
        : try await session.send("/v1/admin/cms/components/\(componentId)", method: "PATCH", body: Payload(project: nil, component: form))
      componentId = response.component.id
      form = response.component
      saved = response.component
      await onChange()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func remove() async {
    do {
      try await session.delete("/v1/admin/cms/components/\(componentId)")
      await onChange()
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
