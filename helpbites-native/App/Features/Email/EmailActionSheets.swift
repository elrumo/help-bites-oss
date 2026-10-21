import SwiftUI

// A template's actions outside the editor (EmailLibrary.vue's card menu):
// the Export menu (useEmailExport.ts), "Send a test" (EmailTestDialog.vue)
// and "Use via API" (EmailApiDialog.vue).

/// What the Export menu hands out. HTML is the email as it goes out (brand and
/// sample values filled in); JSON is the design itself, placeholders intact.
enum EmailExport {
  /// senderVariables(): what a sender passes, each falling back to this row's
  /// own value, else the default. Brand and recipient placeholders aren't listed.
  static func senderVariables(_ t: EmailTemplateItem) -> [EmailVariable] {
    let values = t.variableValues
    return (t.master?.variables ?? t.variables)
      .filter { !$0.key.hasPrefix("project.") && !$0.key.hasPrefix("recipient.") }
      .map { variable in
        var copy = variable
        if let value = values[variable.key] { copy.defaultValue = value }
        return copy
      }
  }

  /// The document a card previews: a master with its sample values, a project
  /// row with this project's brand. Nil for a link whose master didn't load.
  static func rendered(_ t: EmailTemplateItem, brand: EmailBrand?) -> JSONValue? {
    if t.isLinked && t.master == nil { return nil }
    return EmailRender.resolve(document: t.master?.document ?? t.document, variables: t.master?.variables ?? t.variables, values: t.variableValues, linked: t.isLinked, brand: brand)
  }

  static func html(_ t: EmailTemplateItem, brand: EmailBrand?) -> String? {
    rendered(t, brand: brand).map { EmailRender.html($0) }
  }

  private struct DesignFile: Encodable, Sendable {
    let name: String
    let document: JSONValue?
    let variables: [EmailVariable]
  }

  static func htmlFile(_ t: EmailTemplateItem, brand: EmailBrand?) throws -> URL {
    guard let html = html(t, brand: brand) else { throw APIError.server("This template has nothing to export yet.") }
    return try EmailFiles.write(Data(html.utf8), named: "\(EmailFiles.slug(t.title)).html")
  }

  static func jsonFile(_ t: EmailTemplateItem) throws -> URL {
    let data = try EmailFiles.prettyJSON(DesignFile(name: t.title, document: t.master?.document ?? t.document, variables: senderVariables(t)))
    return try EmailFiles.write(data, named: "\(EmailFiles.slug(t.title)).json")
  }

  /// A JSON string literal, for the API snippets.
  static func json(_ text: String) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .withoutEscapingSlashes
    return (try? encoder.encode(text)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
  }

  /// Splits "a@x.com, b@y.com\nc@z.com" into addresses.
  static func addresses(_ text: String) -> [String] {
    text.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" }).map(String.init)
  }
}

// MARK: - Send a test

/// Send a template to yourself before your code does: its sample values
/// prefilled and editable, "[Test]" in front of the subject. A master can
/// borrow a project's brand and sender. The send is logged as a test.
struct EmailTestSheet: View {
  let template: EmailTemplateItem
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var to = ""
  @State private var projectId = ""
  @State private var values: [String: String]
  @State private var sending = false
  @State private var error = ""
  @State private var sent = ""

  init(template: EmailTemplateItem) {
    self.template = template
    let pairs = EmailExport.senderVariables(template).map { ($0.key, $0.defaultValue ?? "") }
    _values = State(initialValue: Dictionary(pairs, uniquingKeysWith: { first, _ in first }))
  }

  private var variables: [EmailVariable] { EmailExport.senderVariables(template) }
  private var isMaster: Bool { template.projectId == nil }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text("\(template.title), with “[Test]” in the subject. It shows up in the email log.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "To", hint: "Up to five addresses") {
            TextField("you@example.com", text: $to)
              .textFieldStyle(.linear)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
          if isMaster && !workspace.projects.isEmpty {
            LabeledField(label: "Brand and sender", hint: "A shared template has no project of its own; borrow one's logo, colours and from-address.") {
              Picker("Brand and sender", selection: $projectId) {
                Text("None: sample values only").tag("")
                ForEach(workspace.projects) { project in Text(project.name).tag(project.id) }
              }
              .pickerStyle(.menu)
              .tint(Theme.text)
            }
          }
          if !variables.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              SectionLabel("Values")
              ForEach(variables, id: \.key) { variable in
                let label = variable.label ?? ""
                LabeledField(label: label.isEmpty ? variable.key : label, hint: label.isEmpty ? nil : variable.key) {
                  TextField("", text: binding(variable.key)).textFieldStyle(.linear)
                }
              }
            }
          }
          if !sent.isEmpty { EmailNotice(systemImage: "paperplane", title: sent, tone: .success) }
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Send a test")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(sent.isEmpty ? "Cancel" : "Done") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if sending { ProgressView() } else {
            Button("Send test") { Task { await send() } }.disabled(to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      }
      .task {
        if to.isEmpty { to = session.agent?.email ?? "" }
        if workspace.projects.isEmpty && isMaster { await workspace.loadProjects() }
      }
    }
    .presentationDetents([.large])
  }

  private func binding(_ key: String) -> Binding<String> {
    Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
  }

  private func send() async {
    struct Input: Encodable, Sendable { let to: [String]; let variables: [String: String]; let project: String? }
    sending = true
    error = ""
    sent = ""
    defer { sending = false }
    let project = isMaster && !projectId.isEmpty ? projectId : nil
    do {
      let result: EmailDeliverySummary = try await session.send("/v1/admin/emails/\(template.id)/test", body: Input(to: EmailExport.addresses(to), variables: values, project: project))
      if (result.sent ?? 0) > 0 {
        let names = (result.results ?? []).filter { $0.status == "sent" || $0.status == "scheduled" }.compactMap(\.to)
        sent = names.isEmpty ? "Test sent" : "Test sent to \(names.joined(separator: ", "))"
      } else {
        let reason = result.results?.first?.error ?? ""
        error = reason.isEmpty ? "The test was not sent." : "The test was not sent: \(reason)"
      }
    } catch { self.error = error.localizedDescription }
  }
}

// MARK: - Use via API

/// How to reach one template from code: fetch it rendered or send it. A
/// project template goes by its send key with the project secret; a master
/// by id with an admin key.
struct EmailAPISheet: View {
  let template: EmailTemplateItem
  var onKey: @MainActor (String) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var key: String
  @State private var savedKey: String
  @State private var saving = false
  @State private var copiedURL = false
  @State private var error = ""

  init(template: EmailTemplateItem, onKey: @escaping @MainActor (String) -> Void) {
    self.template = template
    self.onKey = onKey
    _key = State(initialValue: template.key)
    _savedKey = State(initialValue: template.key)
  }

  private var isProject: Bool { template.projectId != nil }
  private var variables: [EmailVariable] { EmailExport.senderVariables(template) }
  private var example: [(key: String, value: String)] {
    variables.prefix(3).map { ($0.key, ($0.defaultValue ?? "").isEmpty ? "…" : $0.defaultValue ?? "") }
  }
  private var auth: String { isProject ? "$HELPBITES_SECRET" : "$HELPBITES_ADMIN_KEY" }
  private var handle: String { isProject ? savedKey : template.id }

  private func encoded(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? text
  }

  private var fetchURL: String {
    var components = URLComponents(string: "\(session.endpoint)/v1/emails/\(encoded(handle))")
    components?.queryItems = [URLQueryItem(name: "format", value: "html")] + example.map { URLQueryItem(name: $0.key, value: $0.value) }
    return components?.string ?? "\(session.endpoint)/v1/emails/\(encoded(handle))?format=html"
  }

  private var fetchSnippet: String { "curl \"\(fetchURL)\" \\\n  -H \"Authorization: Bearer \(auth)\"" }

  private var sendSnippet: String {
    let values = example.map { "\(EmailExport.json($0.key)):\(EmailExport.json($0.value))" }.joined(separator: ",")
    return """
    curl -X POST \(session.endpoint)/v1/emails/send \\
      -H "Authorization: Bearer \(auth)" \\
      -H "Content-Type: application/json" \\
      -H "Idempotency-Key: <a unique id for this email>" \\
      -d '{"template":\(EmailExport.json(handle)),"to":"user@example.com","variables":{\(values)}}'
    """
  }

  private var logSnippet: String { "curl \"\(session.endpoint)/v1/email-logs?template=\(encoded(handle))\" \\\n  -H \"Authorization: Bearer \(auth)\"" }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          Text(isProject
            ? "From your server, with this project's secret (Project → Install & API). Never from a browser."
            : "Shared templates are read by id with an admin API key. Projects that link this template fetch and send it by their own key.")
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)

          if isProject {
            LabeledField(label: "Send key", hint: "How your code names this email. Unique in the project.") {
              HStack(spacing: 8) {
                TextField("", text: $key)
                  .textFieldStyle(.linear)
                  .monospaced()
                  .textInputAutocapitalization(.never)
                  .autocorrectionDisabled()
                  .onSubmit { Task { await saveKey() } }
                if saving { ProgressView() } else {
                  Button("Save") { Task { await saveKey() } }
                    .buttonStyle(.lnSecondaryCompact)
                    .disabled(key == savedKey || key.trimmingCharacters(in: .whitespaces).isEmpty)
                }
              }
            }
            ErrorText(message: error)
          }

          section("Fetch it rendered", code: fetchSnippet, note: "Variables are query parameters. Without `format=html` you get JSON: `{ subject, html, text, variables }`, ready for any mail provider.") {
            Button { Clipboard.copy(fetchURL); copiedURL = true } label: {
              Label(copiedURL ? "Copied" : "Copy URL", systemImage: copiedURL ? "checkmark" : "link")
            }
            .buttonStyle(.lnGhost)
          }

          if isProject {
            section("Or send it", code: sendSnippet, note: "Up to 50 recipients, one message each, from the project's sender. A recipient can be `{ email, name, variables }` for values of their own. In custom HTML, `{{ name }}` fills in as text and `{{{ list }}}` as HTML.") { EmptyView() }
            section("See what was sent", code: logSnippet, note: "Every recipient's status, kept current by Mailgun's delivery webhook. Also under Email → Log.") { EmptyView() }
          }

          if !variables.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text("Variables").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
              Card {
                ForEach(Array(variables.enumerated()), id: \.offset) { index, variable in
                  CardRow(divider: index < variables.count - 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                      Text(variable.key).font(.lnMono).foregroundStyle(Theme.text)
                      Text(variable.label ?? "").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
                      Spacer(minLength: 8)
                      Text((variable.defaultValue ?? "").isEmpty ? "no default" : "defaults to “\(variable.defaultValue ?? "")”")
                        .font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1)
                    }
                  }
                }
              }
            }
          }
        }
        .padding(20)
        .frame(maxWidth: 680, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Use via API")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
  }

  private func section<Extra: View>(_ title: String, code: String, note: String, @ViewBuilder extra: () -> Extra) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text(title).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Spacer(minLength: 0)
        extra()
      }
      CodeBlock(code: code)
      Text((try? AttributedString(markdown: note)) ?? AttributedString(note)).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private func saveKey() async {
    struct Input: Encodable, Sendable { let key: String }
    guard key != savedKey, !key.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(template.id)", method: "PATCH", body: Input(key: key))
      key = response.template.key
      savedKey = response.template.key
      onKey(response.template.key)
    } catch { self.error = error.localizedDescription }
  }
}
