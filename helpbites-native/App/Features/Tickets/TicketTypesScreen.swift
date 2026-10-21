import SwiftUI

/// Ticket (conversation) types: each one's lifecycle, intake schema and host actions (web: projects/[id]/types.vue).
struct TicketTypesScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var types: [TicketsType] = []
  @State private var selected: TicketsType?
  @State private var creating = false
  @State private var form = TicketsForm()
  @State private var loading = true
  @State private var saving = false
  @State private var error = ""
  @State private var confirmDelete = false

  var body: some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(types, id: \.key) { type in
            Pill(label: type.name, isActive: !creating && selected?.key == type.key) { edit(type) }
          }
          if creating { Pill(label: "New type", isActive: true) {} }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 10)
      }
      Rectangle().fill(Theme.border).frame(height: 1)

      ScrollView {
        Group {
          if let selected {
            editor(selected)
          } else if loading {
            SkeletonRows(count: 4)
          } else {
            ErrorText(message: error)
          }
        }
        .frame(maxWidth: 640, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .projectScreen(projectId, "Ticket types")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { newType() } label: { Label("New type", systemImage: "plus") }
      }
    }
    .confirmationDialog("Delete \(selected?.name ?? "this type")?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete type", role: .destructive) { Task { await remove() } }
    }
    .task { await load() }
    // The webhook warning needs the project; the shell has usually loaded it already.
    .task { if workspace.project(projectId) == nil { await workspace.loadProjects() } }
  }

  private func editor(_ type: TicketsType) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 4) {
        Text(creating ? "New ticket type" : type.name).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("A type defines its lifecycle, intake schema, and host-side actions.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      pair {
        LabeledField(label: "Key", hint: "Lowercase identifier") {
          // Fixed once a type exists, and for the built-in support preset.
          TextField("", text: $form.key).textFieldStyle(.linear).disabled(!creating)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      } _: {
        LabeledField(label: "Name") { TextField("", text: $form.name).textFieldStyle(.linear) }
      }
      LabeledField(label: "Description") { TextField("", text: $form.description).textFieldStyle(.linear) }
      json("Statuses", hint: "JSON array; one entry must have isDefault.", text: $form.statuses, minHeight: 170)
      json("Intake fields", hint: "JSON array. Types: text, longtext, select, url, number, bool.", text: $form.fields, minHeight: 170)
      json("Host actions", hint: "JSON array. Each action is signed to the project webhook.", text: $form.actions, minHeight: 150)
      if actionsWithoutWebhook { noWebhookWarning }
      VStack(alignment: .leading, spacing: 10) {
        toggle("Assignable", isOn: $form.assignable)
        toggle("Users may reopen terminal tickets", isOn: $form.userCanReopen)
      }
      ErrorText(message: error)
      Rectangle().fill(Theme.border).frame(height: 1)
      HStack(spacing: 8) {
        Button { Task { await save() } } label: {
          if saving { ProgressView().tint(.white) } else { Text(creating ? "Create type" : "Save type") }
        }
        .buttonStyle(.lnPrimary)
        .disabled(saving || !canSave)
        if type.isSaved && type.key != "support" {
          Button("Delete type") { confirmDelete = true }.buttonStyle(GhostButtonStyle(tint: Theme.error))
        }
      }
    }
  }

  private func json(_ label: String, hint: String, text: Binding<String>, minHeight: CGFloat) -> some View {
    LabeledField(label: label, hint: hint) {
      LinearTextEditor(text: text, minHeight: minHeight, monospaced: true)
        .textInputAutocapitalization(.never).autocorrectionDisabled()
      if let problem = Self.problem(text.wrappedValue) { ErrorText(message: problem) }
    }
  }

  /// An action is signed to the project's webhook; with none, running it fails.
  private var noWebhookWarning: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "exclamationmark.triangle").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.warning).padding(.top, 1)
      VStack(alignment: .leading, spacing: 4) {
        Text("These actions have nowhere to go").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        Text("An action is signed and sent to the project's action webhook. This project has no webhook URL and secret yet, so running an action will fail.")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
        Button("Set up the webhook") { workspace.go(.project(projectId, .dev)) }
          .buttonStyle(.lnSecondaryCompact)
          .padding(.top, 6)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.warning.opacity(0.4)))
  }

  /// The project can send a type's actions only with both a webhook URL and its secret (shared/support.ts
  /// actionWebhookReady). A project not loaded yet stays quiet, as on the web.
  private var actionWebhookReady: Bool {
    guard let project = workspace.project(projectId) else { return true }
    return !(project.actionWebhookUrl ?? "").isEmpty && project.hasActionWebhookSecret == true
  }

  /// The actions as typed in the editor, not only as saved: there are some, and nowhere to send them.
  private var actionsWithoutWebhook: Bool {
    guard !actionWebhookReady, let actions = try? Self.parse(form.actions) else { return false }
    return !actions.isEmpty
  }

  private func toggle(_ label: String, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) { Text(label).font(.lnCallout).foregroundStyle(Theme.text) }.tint(Theme.accent)
  }

  private func pair<First: View, Second: View>(@ViewBuilder _ first: () -> First, @ViewBuilder _ second: () -> Second) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
    return layout {
      first().frame(maxWidth: .infinity, alignment: .leading)
      second().frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  /// Key and name are required (the web form's `required`), and the three editors must hold JSON arrays.
  private var canSave: Bool {
    !form.key.trimmingCharacters(in: .whitespaces).isEmpty && !form.name.trimmingCharacters(in: .whitespaces).isEmpty
      && [form.statuses, form.fields, form.actions].allSatisfy { Self.problem($0) == nil }
  }

  // MARK: Editing

  private func edit(_ type: TicketsType, creating: Bool = false) {
    selected = type
    self.creating = creating
    form = TicketsForm(
      key: type.key, name: type.name, description: type.description ?? "",
      statuses: ticketsJSON(.array(type.statuses)), fields: ticketsJSON(.array(type.fields)), actions: ticketsJSON(.array(type.actions)),
      assignable: type.assignable ?? true, userCanReopen: type.userCanReopen ?? true
    )
    error = ""
  }

  private func newType() {
    let open: JSONValue = .object(["key": .string("open"), "label": .string("Open"), "category": .string("open"), "isDefault": .bool(true)])
    edit(TicketsType(id: nil, key: "", name: "", description: "", statuses: [open], fields: [], actions: [], assignable: true, userCanReopen: true), creating: true)
  }

  // MARK: Requests

  private func load() async {
    struct Response: Decodable, Sendable { let types: [TicketsType] }
    do {
      let response: Response = try await session.get("/v1/admin/projects/\(projectId)/types")
      types = response.types
      if selected == nil, let first = types.first { edit(first) }
    } catch {
      self.error = error.localizedDescription
    }
    loading = false
  }

  /// POST when the type has no id yet (a new one, or the built-in support preset), PATCH otherwise.
  private func save() async {
    guard let selected else { return }
    struct Response: Decodable, Sendable { let type: TicketsType }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let body = TicketsInput(
        key: form.key, name: form.name, description: form.description,
        statuses: try Self.parse(form.statuses), fields: try Self.parse(form.fields), actions: try Self.parse(form.actions),
        assignable: form.assignable, userCanReopen: form.userCanReopen
      )
      let base = "/v1/admin/projects/\(projectId)/types"
      let response: Response
      if let id = selected.savedID {
        response = try await session.send("\(base)/\(id)", method: "PATCH", body: body)
      } else {
        response = try await session.send(base, body: body)
      }
      edit(response.type)
      await load()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func remove() async {
    guard let id = selected?.savedID else { return }
    do {
      try await session.delete("/v1/admin/projects/\(projectId)/types/\(id)")
      selected = nil
      await load()
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: JSON

  /// The editor's text as a JSON array. iOS may curl the quotes; straighten them if that's what broke it.
  private static func parse(_ text: String) throws -> [JSONValue] {
    do {
      return try JSONDecoder().decode([JSONValue].self, from: Data(text.utf8))
    } catch {
      let straight = text.replacingOccurrences(of: "[“”„]", with: "\"", options: .regularExpression)
      return try JSONDecoder().decode([JSONValue].self, from: Data(straight.utf8))
    }
  }

  private static func problem(_ text: String) -> String? {
    do {
      _ = try parse(text)
      return nil
    } catch let DecodingError.dataCorrupted(context) {
      let detail = (context.underlyingError as NSError?)?.userInfo[NSDebugDescriptionErrorKey] as? String
      return "Not valid JSON" + (detail.map { ": \($0)" } ?? "")
    } catch {
      return "Must be a JSON array"
    }
  }
}

/// A conversation type as the server sends it; the three lists stay raw JSON for the editors.
private struct TicketsType: Decodable, Sendable {
  var id: String?
  var key, name: String
  var description: String?
  var statuses, fields, actions: [JSONValue]
  var assignable, userCanReopen: Bool?

  /// The built-in support preset arrives without an id, so it's created on first save.
  var savedID: String? { id?.isEmpty == false ? id : nil }
  var isSaved: Bool { savedID != nil }
}

private struct TicketsForm {
  var key = "", name = "", description = ""
  var statuses = "[]", fields = "[]", actions = "[]"
  var assignable = true, userCanReopen = true
}

private struct TicketsInput: Encodable, Sendable {
  let key, name, description: String
  let statuses, fields, actions: [JSONValue]
  let assignable, userCanReopen: Bool
}

/// `JSON.stringify(value, null, 2)` with the keys in the order the web shows them.
private func ticketsJSON(_ value: JSONValue, indent: String = "") -> String {
  let inner = indent + "  "
  switch value {
  case .array(let items):
    guard !items.isEmpty else { return "[]" }
    return "[\n" + items.map { inner + ticketsJSON($0, indent: inner) }.joined(separator: ",\n") + "\n\(indent)]"
  case .object(let object):
    guard !object.isEmpty else { return "{}" }
    let order = ["key", "label", "category", "type", "isDefault", "isTerminal", "reopenTo", "required", "options", "private", "editableBy", "confirm", "destructive", "statusAfter", "requiresNote"]
    let keys = object.keys.sorted { (order.firstIndex(of: $0) ?? order.count, $0) < (order.firstIndex(of: $1) ?? order.count, $1) }
    return "{\n" + keys.map { "\(inner)\(ticketsJSONString($0)): \(ticketsJSON(object[$0] ?? .null, indent: inner))" }.joined(separator: ",\n") + "\n\(indent)}"
  case .string(let string): return ticketsJSONString(string)
  case .number(let number): return number == number.rounded() && abs(number) < 1e15 ? String(Int64(number)) : String(number)
  case .bool(let bool): return String(bool)
  case .null: return "null"
  }
}

private func ticketsJSONString(_ string: String) -> String {
  let encoder = JSONEncoder()
  encoder.outputFormatting = .withoutEscapingSlashes
  return (try? encoder.encode(string)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
}
