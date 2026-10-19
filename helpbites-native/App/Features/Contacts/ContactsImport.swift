import SwiftUI
import UniformTypeIdentifiers

// Import people from a CSV (web: components/contacts/CsvImportModal.vue). The file
// is read and mapped here, then sent a thousand rows at a time to POST /v1/contacts.
// Port of the CSV and row-mapping half of shared/contacts.ts.

enum ContactsCSV {
  static let maxBytes = 20 * 1024 * 1024
  static let batch = 1000

  /// RFC 4180: quoted fields, doubled quotes, CRLF or LF, a BOM. Blank lines are skipped.
  static func parse(_ text: String) -> [[String]] {
    var rows: [[String]] = []
    var row: [String] = []
    var field = ""
    var quoted = false
    var characters = Array(text.unicodeScalars)
    if characters.first == "\u{FEFF}" { characters.removeFirst() }
    var index = 0
    func endRow() {
      row.append(field)
      if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
      row = []; field = ""
    }
    while index < characters.count {
      let ch = characters[index]
      if quoted {
        if ch == "\"", index + 1 < characters.count, characters[index + 1] == "\"" { field.unicodeScalars.append(ch); index += 1 }
        else if ch == "\"" { quoted = false }
        else { field.unicodeScalars.append(ch) }
      } else if ch == "\"" && field.isEmpty { quoted = true }
      else if ch == "," { row.append(field); field = "" }
      else if ch == "\n" || ch == "\r" {
        if ch == "\r", index + 1 < characters.count, characters[index + 1] == "\n" { index += 1 }
        endRow()
      } else { field.unicodeScalars.append(ch) }
      index += 1
    }
    row.append(field)
    if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
    return rows
  }

  /// The header row names the columns; each later row is a column-to-cell dictionary.
  static func records(_ text: String) -> (columns: [String], records: [[String: String]]) {
    let rows = parse(text)
    guard let header = rows.first else { return ([], []) }
    let columns = header.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    let records = rows.dropFirst().map { cells -> [String: String] in
      var record: [String: String] = [:]
      for (i, column) in columns.enumerated() { record[column] = i < cells.count ? cells[i].trimmingCharacters(in: .whitespacesAndNewlines) : "" }
      return record
    }
    return (columns, records)
  }

  /// A first guess at which column is which, by its name.
  static func guess(_ columns: [String]) -> ContactMapping {
    func find(_ pattern: String) -> String? {
      columns.first { column in
        let flat = column.lowercased().replacingOccurrences(of: "[\\s_-]+", with: "", options: .regularExpression)
        return flat.range(of: pattern, options: .regularExpression) != nil
      }
    }
    return ContactMapping(
      externalId: find("^(id|userid|externalid|uid|objectid)$"),
      email: find("^(e?mail|emailaddress)$") ?? find("mail"),
      name: find("^(name|fullname|displayname)$"),
      tags: find("^tags?$"),
      subscribed: find("^(subscribed|optin|marketing|newsletter|consent)$")
    )
  }

  static func normalizeEmail(_ value: String) -> String {
    let email = value.trimmingCharacters(in: .whitespaces).lowercased()
    guard !email.isEmpty, email.count <= 200, !email.contains(where: \.isWhitespace) else { return "" }
    guard let at = email.firstIndex(of: "@"), at != email.startIndex, email.index(after: at) != email.endIndex, email.lastIndex(of: "@") == at else { return "" }
    return email[email.index(after: at)...].contains(".") ? email : ""
  }

  static func flag(_ value: String) -> Bool? {
    switch value.trimmingCharacters(in: .whitespaces).lowercased() {
    case "true", "1", "yes", "y", "on", "subscribed", "opted_in", "opt-in": true
    case "false", "0", "no", "n", "off", "unsubscribed", "opted_out", "opt-out": false
    default: nil
    }
  }

  /// One row as a contact, or nil when it has neither a valid email nor an id.
  static func input(_ row: [String: String], _ mapping: ContactMapping) -> ContactInput? {
    func text(_ column: String?) -> String { column.flatMap { row[$0] }?.trimmingCharacters(in: .whitespaces) ?? "" }
    let externalId = String(text(mapping.externalId).prefix(200))
    let email = normalizeEmail(text(mapping.email))
    guard !externalId.isEmpty || !email.isEmpty else { return nil }
    var input = ContactInput()
    if !externalId.isEmpty { input.externalId = externalId }
    if !email.isEmpty { input.email = email }
    let name = String(text(mapping.name).prefix(120))
    if !name.isEmpty { input.name = name }
    if mapping.tags != nil {
      var seen = Set<String>()
      let tags = text(mapping.tags).split(separator: ",").map { String($0.trimmingCharacters(in: .whitespaces).prefix(40)) }.filter { !$0.isEmpty && seen.insert($0).inserted }
      if !tags.isEmpty { input.tags = Array(tags.prefix(50)) }
    }
    if mapping.subscribed != nil, let flag = flag(text(mapping.subscribed)) { input.subscription = flag ? "subscribed" : "unsubscribed" }
    var attributes: [String: JSONValue] = [:]
    for (key, column) in mapping.attributes ?? [:] {
      let value = String(text(column).prefix(500))
      if !value.isEmpty { attributes[key] = .string(value) }
    }
    if !attributes.isEmpty { input.attributes = attributes }
    return input
  }

  #if DEBUG
  /// A tiny check of the parser against the cases the web's parser handles.
  static func selfCheck() {
    let rows = parse("\u{FEFF}Email,Name\r\n\"a@b.co\",\"Doe, \"\"J\"\"\"\n\n,\nx@y.io,Z")
    assert(rows == [["Email", "Name"], ["a@b.co", "Doe, \"J\""], ["x@y.io", "Z"]])
    assert(guess(["User ID", "E-mail", "Full Name"]).email == "E-mail")
    assert(normalizeEmail(" A@B.co ") == "a@b.co" && normalizeEmail("nope") == "")
    assert(attributeKey(for: "Plan Type") == "Plan_Type" && attributeKey(for: "1st") == "c_1st")
  }
  #endif
}

private struct ImportResult: Decodable, Sendable {
  struct Row: Decodable, Sendable { let index: Int; let status: String; let error: String? }
  let results: [Row]
  let created, updated, unchanged, failed: Int
}

struct CsvImportSheet: View {
  let projectId: String
  var onImported: () -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var picking = false
  @State private var fileName = ""
  @State private var columns: [String] = []
  @State private var records: [[String: String]] = []
  @State private var mapping = ContactMapping()
  @State private var asAttributes: Set<String> = []
  @State private var optedIn = false
  @State private var fillOnly = true
  @State private var importing = false
  @State private var done = 0
  @State private var summary: (created: Int, updated: Int, unchanged: Int, failed: Int, errors: [String])?
  @State private var error = ""
  @State private var preview: (inputs: [ContactInput], skipped: Int) = ([], 0)

  private var mappedColumns: Set<String> { Set([mapping.email, mapping.externalId, mapping.name, mapping.tags, mapping.subscribed].compactMap { $0 }) }
  private var attributeColumns: [String] { columns.filter { !mappedColumns.contains($0) } }
  private var fieldMapping: ContactMapping {
    var m = mapping
    m.attributes = Dictionary(attributeColumns.filter { asAttributes.contains($0) }.map { (attributeKey(for: $0), $0) }, uniquingKeysWith: { first, _ in first })
    return m
  }

  var body: some View {
    NavigationStack {
      Group {
        if let summary { resultView(summary) }
        else if columns.isEmpty { chooser }
        else { mapper }
      }
      .navigationTitle("Import contacts")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button(summary == nil ? "Cancel" : "Done") { dismiss() }.disabled(importing) } }
    }
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 520)
    #endif
    .interactiveDismissDisabled(importing)
    .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
      Task { await load(result) }
    }
    .onAppear {
      #if DEBUG
      ContactsCSV.selfCheck()
      #endif
    }
  }

  private var chooser: some View {
    VStack(spacing: 12) {
      Spacer()
      EmptyState(systemImage: "doc.text", title: "Choose a .csv file", message: "A CSV file with a header row. Matching people are updated by user id, then by email. Exported from Stripe, Mailchimp, a spreadsheet or your database. Up to 20 MB.") {
        Button("Choose file") { picking = true }.buttonStyle(.lnPrimary)
      }
      ErrorText(message: error).padding(.horizontal)
      Spacer()
    }
  }

  private func picker(_ title: String, _ selection: Binding<String?>) -> some View {
    Picker(title, selection: selection) {
      Text("None").tag(String?.none)
      ForEach(columns, id: \.self) { Text($0).tag(Optional($0)) }
    }
  }

  private var mapper: some View {
    Form {
      Section {
        Text("\(fileName) · \(records.count) rows, \(columns.count) columns").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      Section("Columns") {
        picker("Email", $mapping.email)
        picker("User id", $mapping.externalId)
        picker("Name", $mapping.name)
        picker("Tags", $mapping.tags)
        picker("Opted in", $mapping.subscribed)
      }
      if !attributeColumns.isEmpty {
        Section {
          ForEach(attributeColumns, id: \.self) { column in
            Toggle("\(column) → \(attributeKey(for: column))", isOn: Binding(get: { asAttributes.contains(column) }, set: { if $0 { asAttributes.insert(column) } else { asAttributes.remove(column) } }))
          }
        } header: { Text("Keep as attributes") } footer: { Text("Segment and personalize with these.") }
      }
      Section {
        if mapping.subscribed == nil {
          Toggle("Everyone in this file asked for marketing email", isOn: $optedIn)
        }
        Toggle("Fill blanks only", isOn: $fillOnly)
      } footer: { Text("Opting in applies only if you have their consent; nobody who unsubscribed is subscribed again. Filling blanks keeps names and attributes you already have.") }
      Section {
        if mapping.email == nil && mapping.externalId == nil {
          Text("Pick the email or the user id column.").foregroundStyle(Theme.error)
        } else {
          Text("\(preview.inputs.count) people to import\(preview.skipped > 0 ? ", \(preview.skipped) rows skipped (no valid email or id)" : "").").foregroundStyle(Theme.textMuted)
        }
        if importing { ProgressView(value: Double(done), total: Double(max(preview.inputs.count, 1))) }
        ErrorText(message: error)
        Button("Import \(preview.inputs.count)") { Task { await run() } }.disabled(importing || preview.inputs.isEmpty)
        Button("Choose another file") { reset() }.disabled(importing)
      }
    }
    .formStyle(.grouped)
    // Mapping 100k rows per keystroke-free toggle is fine off the main thread's critical path.
    .task(id: previewKey) { await remap() }
  }

  private var previewKey: String {
    "\(fileName)|\(mapping)|\(asAttributes.sorted())|\(optedIn)"
  }

  private func resultView(_ s: (created: Int, updated: Int, unchanged: Int, failed: Int, errors: [String])) -> some View {
    Form {
      Section("Imported \(fileName)") {
        LabeledContent("New", value: "\(s.created)")
        LabeledContent("Updated", value: "\(s.updated)")
        LabeledContent("Unchanged", value: "\(s.unchanged)")
        LabeledContent("Failed", value: "\(s.failed)")
      }
      if !s.errors.isEmpty { Section { ForEach(s.errors, id: \.self) { Text($0).font(.lnCaption).foregroundStyle(Theme.error) } } }
      ErrorText(message: error)
    }
    .formStyle(.grouped)
  }

  private func reset() {
    fileName = ""; columns = []; records = []; mapping = ContactMapping(); asAttributes = []; optedIn = false; fillOnly = true; done = 0; error = ""
  }

  private func load(_ result: Result<URL, Error>) async {
    error = ""
    do {
      let url = try result.get()
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      let data = try Data(contentsOf: url)
      guard data.count <= ContactsCSV.maxBytes else { error = "That file is over 20 MB; split it up."; return }
      let parsed = await Task.detached { ContactsCSV.records(String(decoding: data, as: UTF8.self)) }.value
      guard !parsed.columns.isEmpty, !parsed.records.isEmpty else { error = "No rows found: the first line should name the columns."; return }
      fileName = url.lastPathComponent
      columns = parsed.columns
      records = parsed.records
      let guess = ContactsCSV.guess(parsed.columns)
      mapping = guess
      let used = Set([guess.email, guess.externalId, guess.name, guess.tags, guess.subscribed].compactMap { $0 })
      asAttributes = Set(parsed.columns.filter { !used.contains($0) })
    } catch { self.error = error.localizedDescription }
  }

  /// Maps every row off the main actor; superseded by the next change via `.task(id:)`.
  private func remap() async {
    let rows = records, map = fieldMapping, opt = optedIn && mapping.subscribed == nil
    let result = await Task.detached(priority: .userInitiated) { () -> ([ContactInput], Int) in
      var inputs: [ContactInput] = [], skipped = 0
      inputs.reserveCapacity(rows.count)
      for row in rows {
        guard var input = ContactsCSV.input(row, map) else { skipped += 1; continue }
        if opt { input.subscription = "subscribed" }
        inputs.append(input)
      }
      return (inputs, skipped)
    }.value
    guard !Task.isCancelled else { return }
    preview = (result.0, result.1)
  }

  private func run() async {
    struct Input: Encodable, Sendable { let project: String; let contacts: [ContactInput]; let fillOnly: Bool }
    let inputs = preview.inputs
    importing = true; done = 0; error = ""
    defer { importing = false }
    var total = (created: 0, updated: 0, unchanged: 0, failed: 0, errors: [String]())
    do {
      var offset = 0
      while offset < inputs.count {
        let slice = Array(inputs[offset..<min(offset + ContactsCSV.batch, inputs.count)])
        let result: ImportResult = try await session.send("/v1/contacts", body: Input(project: projectId, contacts: slice, fillOnly: fillOnly))
        total.created += result.created; total.updated += result.updated; total.unchanged += result.unchanged; total.failed += result.failed
        for row in result.results where total.errors.count < 5 { if let message = row.error { total.errors.append("Row \(offset + row.index + 2): \(message)") } }
        offset += slice.count
        done = offset
      }
    } catch {
      self.error = "\(error.localizedDescription) \(done) of \(inputs.count) rows were imported before it stopped."
    }
    summary = total
    onImported()
  }
}
