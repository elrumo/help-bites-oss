import SwiftUI

// The databases a project's contacts sync from (web: SourceList.vue, SourceForm.vue):
// Parse, Postgres or Supabase, Firestore. Read only; each runs on its schedule.

struct SourcesList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var sources: [ContactSource] = []
  @State private var kinds: [ContactSourceKind] = []
  @State private var ready = true
  @State private var loading = true
  @State private var error = ""
  @State private var form: SourceFormTarget?
  @State private var deleting: ContactSource?

  private static let icons = ["parse": "server.rack", "postgres": "cylinder.split.1x2", "firestore": "flame"]

  var body: some View {
    List {
      if !ready {
        Label("Set HELPBITES_SECRET on the server first: database credentials are stored encrypted with it (32+ random characters, e.g. openssl rand -base64 48), then restart.", systemImage: "key")
          .font(.lnMeta).foregroundStyle(Theme.warning).linearRow()
      }
      if session.isLocked("contactSources") { PlanLockNotice(feature: "contactSources").linearRow() }
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && sources.isEmpty { SkeletonRows(count: 2).linearRow() }
      else if sources.isEmpty {
        EmptyState(systemImage: "cylinder.split.1x2", title: "No databases connected", message: "Point HelpBites at your app's users (a Parse class, a Postgres or Supabase table, or a Firestore collection) and it keeps contacts in step. Read only: nothing is ever written back.") {
          Button("Connect a database") { form = .new }.buttonStyle(.lnPrimary).disabled(!ready)
        }
        .linearRow()
      }
      ForEach(sources) { source in row(source).linearRow() }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
    // A running sync updates its counts as it goes.
    .task(id: sources.contains { $0.status == "running" }) {
      while sources.contains(where: { $0.status == "running" }), !Task.isCancelled {
        try? await Task.sleep(for: .seconds(3))
        await load()
      }
    }
    .toolbar { ToolbarItem(placement: .primaryAction) { Button { form = .new } label: { Label("Connect a database", systemImage: "plus") }.disabled(!ready) } }
    .sheet(item: $form) { target in
      SourceFormSheet(projectId: projectId, kinds: kinds, source: target.source) { Task { await load() } }
    }
    .confirmationDialog("Stop syncing “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { source in
      Button("Delete source", role: .destructive) { Task { await remove(source) } }
    } message: { _ in Text("Its saved credentials are forgotten. The contacts it brought in stay.") }
  }

  private func row(_ source: ContactSource) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        Image(systemName: Self.icons[source.kind] ?? "cylinder").foregroundStyle(Theme.textMuted)
        VStack(alignment: .leading, spacing: 2) {
          Text(source.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
          Text("\(kinds.first { $0.kind == source.kind }?.label ?? source.kind) · \(source.what) · \(source.schedule)\(source.config.updatedField == nil ? " · full scan" : "")").font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
        }
        Spacer(minLength: 8)
        if !source.enabled { Tag(text: "Paused") }
        else if source.status == "running" { Tag(text: "Syncing", tint: Theme.info) }
        else if source.status == "error" { Tag(text: "Failing", tint: Theme.error) }
        else { Tag(text: "Up to date", tint: Theme.success) }
        Menu {
          Button { Task { await run(source, reset: false) } } label: { Label("Sync now", systemImage: "arrow.clockwise") }
          Button { Task { await run(source, reset: true) } } label: { Label("Read everything again", systemImage: "arrow.counterclockwise") }
          Divider()
          Button { form = .edit(source) } label: { Label("Edit", systemImage: "pencil") }
          Button { Task { await toggle(source) } } label: { Label(source.enabled ? "Pause" : "Resume", systemImage: source.enabled ? "pause" : "play") }
          Divider()
          Button(role: .destructive) { deleting = source } label: { Label("Delete", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Source actions")
      }
      if !source.lastError.isEmpty { Text(source.lastError).font(.lnMono).foregroundStyle(Theme.error).lineLimit(3) }
      let s = source.stats
      Text("Read \(s.seen.formatted()) · new \(s.created.formatted()) · updated \(s.updated.formatted())\(s.skipped > 0 ? " · skipped \(s.skipped.formatted())" : "")\(s.failed > 0 ? " · failed \(s.failed.formatted())" : "")\(source.lastRunAt.map { " · last run \(DateText.short($0))" } ?? "")\(source.position.isEmpty ? "" : " · up to \(source.position.prefix(32))")")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .padding(.vertical, 6)
  }

  private func load() async {
    struct Response: Decodable, Sendable { let sources: [ContactSource]; let kinds: [ContactSourceKind]; let ready: Bool }
    do {
      let response: Response = try await session.get("/v1/admin/contact-sources", query: ["project": projectId])
      sources = response.sources; kinds = response.kinds; ready = response.ready
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func run(_ source: ContactSource, reset: Bool) async {
    struct Input: Encodable, Sendable { let project: String; let reset: Bool }
    struct Output: Decodable, Sendable { let source: ContactSource }
    do {
      let output: Output = try await session.send("/v1/admin/contact-sources/\(source.id)/run", body: Input(project: projectId, reset: reset))
      sources = sources.map { $0.id == source.id ? output.source : $0 }
    } catch { self.error = error.localizedDescription }
  }

  private func toggle(_ source: ContactSource) async {
    struct Input: Encodable, Sendable { let project: String; let enabled: Bool }
    struct Output: Decodable, Sendable { let source: ContactSource }
    do {
      let output: Output = try await session.send("/v1/admin/contact-sources/\(source.id)", method: "PATCH", body: Input(project: projectId, enabled: !source.enabled))
      sources = sources.map { $0.id == source.id ? output.source : $0 }
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ source: ContactSource) async {
    do {
      try await session.delete("/v1/admin/contact-sources/\(source.id)?project=\(projectId)")
      sources.removeAll { $0.id == source.id }
    } catch { self.error = error.localizedDescription }
  }
}

enum SourceFormTarget: Identifiable {
  case new
  case edit(ContactSource)
  var id: String { if case .edit(let source) = self { source.id } else { "new" } }
  var source: ContactSource? { if case .edit(let source) = self { source } else { nil } }
}

/// Connect, see the columns and a few rows, say which is which, save.
struct SourceFormSheet: View {
  let projectId: String
  let kinds: [ContactSourceKind]
  let source: ContactSource?
  var onSaved: () -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  @State private var kind = "parse"
  @State private var name = ""
  @State private var serverUrl = ""
  @State private var appId = ""
  @State private var className = "_User"
  @State private var table = ""
  @State private var idField = "id"
  @State private var updatedField = ""
  @State private var collection = "users"
  @State private var masterKey = ""
  @State private var connectionURL = ""
  @State private var serviceAccount = ""
  @State private var mapping = ContactMapping()
  @State private var asAttributes: Set<String> = []
  @State private var optedInForAll = false
  @State private var everyMinutes = 60
  @State private var fields: [String] = []
  @State private var sample: [[String: JSONValue]] = []
  @State private var testing = false
  @State private var saving = false
  @State private var error = ""

  private static let schedules: [(label: String, value: Int)] = [("Every 15 minutes", 15), ("Hourly", 60), ("Every 6 hours", 360), ("Daily", 1440), ("Only when I click Sync", 0)]
  private var kindItems: [ContactSourceKind] { kinds.isEmpty ? [ContactSourceKind(kind: "parse", label: "Parse"), ContactSourceKind(kind: "postgres", label: "Postgres / Supabase"), ContactSourceKind(kind: "firestore", label: "Firestore")] : kinds }
  private var mappedColumns: Set<String> { Set([mapping.email, mapping.externalId, mapping.name, mapping.tags, mapping.subscribed].compactMap { $0 }) }
  private var attributeColumns: [String] { fields.filter { !mappedColumns.contains($0) } }
  private var canSave: Bool { !fields.isEmpty && (mapping.email != nil || mapping.externalId != nil) && !saving }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Kind", selection: $kind) { ForEach(kindItems) { Text($0.label).tag($0.kind) } }.disabled(source != nil)
          TextField("Name (App users)", text: $name)
        } footer: { Text("Read only. HelpBites reads the columns you map and never writes back.") }

        Section {
          connection
          Button { Task { await test() } } label: {
            HStack { Text(fields.isEmpty ? "Connect" : "Connect again"); if testing { Spacer(); ProgressView().controlSize(.small) } }
          }
          .disabled(testing)
        }

        if !fields.isEmpty {
          if !sample.isEmpty {
            Section("A few rows") {
              ScrollView(.horizontal) {
                let keys = sample[0].keys.sorted()
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                  GridRow { ForEach(keys, id: \.self) { Text($0).font(.lnMono).foregroundStyle(Theme.textMuted) } }
                  ForEach(sample.indices, id: \.self) { i in
                    GridRow { ForEach(keys, id: \.self) { Text(cell(sample[i][$0])).font(.lnCaption).lineLimit(1) } }
                  }
                }
              }
            }
          }
          Section("Columns") {
            picker("Email", $mapping.email)
            picker("User id", $mapping.externalId)
            picker("Name", $mapping.name)
            picker("Tags", $mapping.tags)
            picker("Opted in (true/false)", $mapping.subscribed)
            Picker("Sync", selection: $everyMinutes) { ForEach(Self.schedules, id: \.value) { Text($0.label).tag($0.value) } }
          }
          if !attributeColumns.isEmpty {
            Section("Keep as attributes") {
              ForEach(attributeColumns, id: \.self) { column in
                Toggle(column, isOn: Binding(get: { asAttributes.contains(column) }, set: { if $0 { asAttributes.insert(column) } else { asAttributes.remove(column) } }))
              }
            }
          }
          if mapping.subscribed == nil {
            Section {
              Toggle("Everyone here agreed to marketing email", isOn: $optedInForAll)
            } footer: { Text("Recorded as their consent. Nobody who unsubscribed is subscribed again.") }
          }
          if mapping.email == nil && mapping.externalId == nil { Section { Text("Map the email or the user id.").foregroundStyle(Theme.error) } }
        }
        Section { ErrorText(message: error) }
      }
      .formStyle(.grouped)
      .navigationTitle(source == nil ? "Connect a database" : "Edit \(source?.name ?? "")")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button(source == nil ? "Save and sync" : "Save") { Task { await save() } }.disabled(!canSave) }
      }
    }
    #if os(macOS)
    .frame(minWidth: 560, minHeight: 620)
    #endif
    .onAppear(perform: prefill)
  }

  @ViewBuilder private var connection: some View {
    switch kind {
    case "parse":
      TextField("Server URL (https://api.example.com/parse)", text: $serverUrl).inputHints(.url, capitalization: .never).autocorrectionDisabled()
      TextField("Application id", text: $appId).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      TextField("Class", text: $className).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      SecureField(source == nil ? "Master key" : "Master key (blank keeps the saved one)", text: $masterKey)
    case "postgres":
      SecureField(source == nil ? "Connection string (a read-only user is best)" : "Connection string (blank keeps the saved one)", text: $connectionURL)
      TextField("Table or view (public.users)", text: $table).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      TextField("Id column", text: $idField).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      TextField("Updated-at column (optional; without it each run reads everything)", text: $updatedField).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
    default:
      VStack(alignment: .leading, spacing: 4) {
        Text(source == nil ? "Service account key (Firebase › Project settings › Service accounts)" : "Service account key (blank keeps the saved one)").font(.lnCaption).foregroundStyle(Theme.textMuted)
        LinearTextEditor(text: $serviceAccount, placeholder: "{ \"type\": \"service_account\", … }", minHeight: 90, monospaced: true)
      }
      TextField("Collection", text: $collection).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
      TextField("Updated-at field (optional)", text: $updatedField).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
    }
  }

  private func picker(_ title: String, _ selection: Binding<String?>) -> some View {
    Picker(title, selection: selection) {
      Text("None").tag(String?.none)
      ForEach(fields, id: \.self) { Text($0).tag(Optional($0)) }
    }
  }

  private func cell(_ value: JSONValue?) -> String {
    switch value {
    case nil, .null?: ""
    case .string(let s)?: String(s.prefix(40))
    case .number(let n)?: n == n.rounded() ? String(Int64(n)) : String(n)
    case .bool(let b)?: String(b)
    default: "…"
    }
  }

  private func prefill() {
    guard let source else { return }
    let c = source.config
    kind = source.kind; name = source.name
    serverUrl = c.serverUrl ?? ""; appId = c.appId ?? ""; className = c.className ?? "_User"
    table = c.table ?? ""; idField = source.kind == "postgres" ? c.idField ?? "id" : "id"
    updatedField = source.kind == "parse" ? "" : c.updatedField ?? ""
    collection = c.collection ?? "users"
    mapping = c.mapping ?? ContactMapping()
    asAttributes = Set((c.mapping?.attributes ?? [:]).values)
    optedInForAll = c.consent == "subscribed"
    everyMinutes = c.everyMinutes
  }

  private var connectionConfig: [String: JSONValue] {
    func value(_ s: String) -> JSONValue { .string(s) }
    switch kind {
    case "parse": return ["serverUrl": value(serverUrl), "appId": value(appId), "className": value(className)]
    case "postgres":
      var config: [String: JSONValue] = ["table": value(table), "idField": value(idField)]
      if !updatedField.isEmpty { config["updatedField"] = value(updatedField) }
      return config
    default:
      var config: [String: JSONValue] = ["collection": value(collection)]
      if !updatedField.isEmpty { config["updatedField"] = value(updatedField) }
      return config
    }
  }

  private var secretValue: JSONValue? {
    switch kind {
    case "parse": masterKey.isEmpty ? nil : .object(["masterKey": .string(masterKey)])
    case "postgres": connectionURL.isEmpty ? nil : .object(["url": .string(connectionURL)])
    default: serviceAccount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .string(serviceAccount.trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }

  private func test() async {
    struct Input: Encodable, Sendable { let project: String; let source: String?; let kind: String?; let config: [String: JSONValue]; let secret: JSONValue? }
    struct Output: Decodable, Sendable { let fields: [String]; let sample: [[String: JSONValue]] }
    testing = true; error = ""
    defer { testing = false }
    do {
      let output: Output = try await session.send("/v1/admin/contact-sources/test", body: Input(project: projectId, source: source?.id, kind: source == nil ? kind : nil, config: connectionConfig, secret: secretValue))
      fields = kind == "firestore" ? Array(NSOrderedSet(array: ["id"] + output.fields)) as? [String] ?? output.fields : output.fields
      sample = output.sample
      // A first guess by name, only for what is still unmapped.
      func pick(_ pattern: String) -> String? {
        fields.first { $0.lowercased().replacingOccurrences(of: "[\\s_-]+", with: "", options: .regularExpression).range(of: pattern, options: .regularExpression) != nil }
      }
      if mapping.email == nil { mapping.email = pick("^e?mail$") ?? pick("mail") }
      if mapping.externalId == nil { mapping.externalId = kind == "parse" ? "objectId" : kind == "firestore" ? "id" : idField }
      if mapping.name == nil { mapping.name = pick("^(name|fullname|displayname|username)$") }
    } catch { self.error = error.localizedDescription }
  }

  private func save() async {
    struct Config: Encodable, Sendable {
      let connection: [String: JSONValue]; let mapping: ContactMapping; let consent: String; let everyMinutes: Int
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: DynamicKey.self)
        for (key, value) in connection { try c.encode(value, forKey: DynamicKey(key)) }
        try c.encode(mapping, forKey: DynamicKey("mapping"))
        try c.encode(consent, forKey: DynamicKey("consent"))
        try c.encode(everyMinutes, forKey: DynamicKey("everyMinutes"))
      }
    }
    struct Input: Encodable, Sendable { let project: String; let kind: String?; let name: String; let config: Config; let secret: JSONValue? }
    struct Output: Decodable, Sendable { let source: ContactSource }
    saving = true; error = ""
    defer { saving = false }
    var final = mapping
    final.attributes = Dictionary(attributeColumns.filter { asAttributes.contains($0) }.map { (attributeKey(for: $0), $0) }, uniquingKeysWith: { first, _ in first })
    let config = Config(connection: connectionConfig, mapping: final, consent: optedInForAll && mapping.subscribed == nil ? "subscribed" : "keep", everyMinutes: everyMinutes)
    do {
      let input = Input(project: projectId, kind: source == nil ? kind : nil, name: name, config: config, secret: secretValue)
      let _: Output = try await session.send(source.map { "/v1/admin/contact-sources/\($0.id)" } ?? "/v1/admin/contact-sources", method: source == nil ? "POST" : "PATCH", body: input)
      onSaved()
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

struct DynamicKey: CodingKey {
  var stringValue: String
  var intValue: Int? { nil }
  init(_ string: String) { stringValue = string }
  init?(stringValue: String) { self.stringValue = stringValue }
  init?(intValue: Int) { nil }
}
