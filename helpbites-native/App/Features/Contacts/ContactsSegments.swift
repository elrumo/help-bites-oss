import SwiftUI

// Saved filters over a project's contacts (web: SegmentList.vue, SegmentBuilder.vue).

struct SegmentsList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var segments: [ContactSegment] = []
  @State private var counts: [String: Int] = [:]
  @State private var loading = true
  @State private var error = ""
  @State private var editing: SegmentEditorTarget?
  @State private var deleting: ContactSegment?
  /// The segment whose members are being put on a sequence.
  @State private var sequenceFor: ContactSegment?

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && segments.isEmpty { SkeletonRows(count: 3).linearRow() }
      else if segments.isEmpty {
        EmptyState(systemImage: "line.3.horizontal.decrease.circle", title: "No segments yet", message: "Save a filter over your contacts (plan, tags, when people were last seen), then email exactly that group.") {
          Button("New segment") { editing = .new }.buttonStyle(.lnPrimary)
        }
        .linearRow()
      }
      ForEach(segments) { segment in
        Button { editing = .edit(segment) } label: {
          HStack(spacing: 12) {
            Image(systemName: "line.3.horizontal.decrease.circle").foregroundStyle(Theme.textMuted)
            VStack(alignment: .leading, spacing: 2) {
              Text(segment.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
              Text("\(segment.filter.rules.count) rule\(segment.filter.rules.count == 1 ? "" : "s")").font(.lnMeta).foregroundStyle(Theme.textMuted)
            }
            Spacer()
            if segment.auto == true { Tag(text: "Auto") }
            Text(counts[segment.id].map { String(localized: "\($0.formatted()) people") } ?? "…").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
          }
          .frame(minHeight: Metrics.rowHeight)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .linearRow()
        .contextMenu {
          Button { sequenceFor = segment } label: { Label("Add everyone to a sequence", systemImage: "text.badge.plus") }
          Button("Delete", role: .destructive) { deleting = segment }
        }
        .swipeActions { Button("Delete", role: .destructive) { deleting = segment } }
        .swipeActions(edge: .leading) { Button { sequenceFor = segment } label: { Label("Add to sequence", systemImage: "text.badge.plus") }.tint(Theme.accent) }
      }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
    .toolbar { ToolbarItem(placement: .primaryAction) { Button { editing = .new } label: { Label("New segment", systemImage: "plus") } } }
    .sheet(item: $editing) { target in
      SegmentEditor(projectId: projectId, segment: target.segment) { Task { await load() } }
    }
    .sheet(item: $sequenceFor) { segment in AddToSequenceSheet(projectId: projectId, segment: segment) }
    .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { segment in
      Button("Delete segment", role: .destructive) { Task { await remove(segment) } }
    } message: { _ in Text("Campaigns that target it will send to all subscribers until you pick another.") }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let segments: [ContactSegment] }
    struct Input: Encodable, Sendable { let project, segment: String }
    loading = true
    defer { loading = false }
    do {
      segments = (try await session.get("/v1/segments", query: ["project": projectId]) as Response).segments
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription }; return }
    // Counts arrive one by one; a failing one just stays "…".
    for segment in segments {
      Task {
        if let preview: SegmentPreview = try? await session.send("/v1/segments/preview", body: Input(project: projectId, segment: segment.id)) { counts[segment.id] = preview.count }
      }
    }
  }

  private func remove(_ segment: ContactSegment) async {
    do {
      try await session.delete("/v1/segments/\(segment.id)?project=\(projectId)")
      segments.removeAll { $0.id == segment.id }
    } catch { self.error = error.localizedDescription }
  }
}

enum SegmentEditorTarget: Identifiable {
  case new
  case edit(ContactSegment)
  var id: String { if case .edit(let segment) = self { segment.id } else { "new" } }
  var segment: ContactSegment? { if case .edit(let segment) = self { segment } else { nil } }
}

/// Name and rules, with a live count of who matches.
struct SegmentEditor: View {
  let projectId: String
  let segment: ContactSegment?
  var onSaved: () -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var filter = SegmentFilter.empty
  @State private var count: Int?
  @State private var sample: [Contact] = []
  @State private var previewError = ""
  @State private var saving = false
  @State private var error = ""
  /// The project's lead forms by id, for "Lead form includes …".
  @State private var forms: [String: String] = [:]
  private static let attributeToken = "__attribute"

  var body: some View {
    NavigationStack {
      Form {
        Section { TextField("Name", text: $name) }
        Section {
          Picker("Contacts matching", selection: $filter.match) {
            Text("all of these rules").tag("all")
            Text("any of these rules").tag("any")
          }
          if filter.rules.isEmpty { Text("No rules: everyone in the project.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
        ForEach($filter.rules) { $rule in
          Section { ruleEditor($rule) } header: { if rule.id == filter.rules.first?.id { Text("Rules") } }
        }
        Section {
          Button { filter.rules.append(SegmentRule(field: "tags", op: "includes", value: .string(""))) } label: { Label("Add rule", systemImage: "plus") }
        }
        Section("Who matches") {
          if !previewError.isEmpty { ErrorText(message: previewError) }
          else if let count {
            Text("\(count.formatted()) \(count == 1 ? String(localized: "contact matches") : String(localized: "contacts match"))").font(.lnRow)
            if !sample.isEmpty { Text(sample.map(\.displayName).joined(separator: ", ")).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(3) }
          } else { Text("Counting…").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        }
        ErrorText(message: error)
      }
      .formStyle(.grouped)
      .navigationTitle(segment == nil ? "New segment" : "Edit segment")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving) }
      }
    }
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 560)
    #endif
    .task {
      struct Named: Decodable, Sendable { let id, name: String }
      struct Forms: Decodable, Sendable { let forms: [Named] }
      if let r: Forms = try? await session.get("/v1/admin/lead-forms", query: ["project": projectId]) { forms = Dictionary(r.forms.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    }
    .onAppear {
      guard name.isEmpty, filter.rules.isEmpty, let segment else { return }
      name = segment.name
      filter = segment.filter
    }
    // Debounced, and a newer edit cancels the older count.
    .task(id: filter) {
      try? await Task.sleep(for: .milliseconds(400))
      guard !Task.isCancelled else { return }
      await preview()
    }
  }

  @ViewBuilder private func ruleEditor(_ rule: Binding<SegmentRule>) -> some View {
    let kind = SegmentSpec.kind(rule.wrappedValue.field)
    Picker("Field", selection: Binding(
      get: { rule.wrappedValue.field.hasPrefix(SegmentSpec.attributePrefix) ? Self.attributeToken : rule.wrappedValue.field },
      set: { setField(rule, $0) }
    )) {
      ForEach(SegmentSpec.fields, id: \.key) { Text($0.label).tag($0.key) }
      Text("Attribute…").tag(Self.attributeToken)
    }
    if kind == .attribute {
      TextField("Attribute key (plan)", text: Binding(
        get: { String(rule.wrappedValue.field.dropFirst(SegmentSpec.attributePrefix.count)) },
        set: { rule.wrappedValue.field = SegmentSpec.attributePrefix + $0.trimmingCharacters(in: .whitespaces) }
      ))
      .font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
    }
    Picker("Condition", selection: rule.op) {
      ForEach(SegmentSpec.ops(kind), id: \.self) { Text(SegmentSpec.opLabels[$0] ?? $0).tag($0) }
    }
    if SegmentSpec.needsValue(rule.wrappedValue.op) {
      if rule.wrappedValue.field == "subscription" {
        Picker("Value", selection: textBinding(rule)) {
          ForEach(SubscriptionStatus.allCases) { Text($0.label).tag($0.rawValue) }
        }
      } else if rule.wrappedValue.field == "origin" {
        Picker("Value", selection: textBinding(rule)) {
          ForEach(ContactOriginKind.allCases) { Text($0.label).tag($0.rawValue) }
        }
      } else if kind == .flag {
        Picker("Value", selection: textBinding(rule)) {
          Text("Yes").tag("yes")
          Text("No").tag("no")
        }
      } else if rule.wrappedValue.field == "leadForms", !forms.isEmpty {
        Picker("Form", selection: textBinding(rule)) {
          Text("Pick a form").tag("")
          ForEach(forms.sorted { $0.value < $1.value }, id: \.key) { Text($0.value).tag($0.key) }
        }
      } else if SegmentSpec.isDays(rule.wrappedValue.op) {
        TextField("Days (30)", text: textBinding(rule)).inputHints(.numberPad)
      } else if SegmentSpec.isDate(rule.wrappedValue.op) {
        DatePicker("Date", selection: dateBinding(rule), displayedComponents: .date)
      } else {
        TextField("Value", text: textBinding(rule))
      }
    }
    Button("Remove rule", role: .destructive) { filter.rules.removeAll { $0.id == rule.wrappedValue.id } }
  }

  private func textBinding(_ rule: Binding<SegmentRule>) -> Binding<String> {
    Binding(
      get: { rule.wrappedValue.value?.inboxText ?? "" },
      set: { text in
        // Numbers stay numbers for the "last N days" and numeric comparisons.
        let numeric = SegmentSpec.isDays(rule.wrappedValue.op) || ["gt", "lt"].contains(rule.wrappedValue.op)
        if numeric, let number = Double(text) { rule.wrappedValue.value = .number(number) } else { rule.wrappedValue.value = .string(text) }
      }
    )
  }

  private func dateBinding(_ rule: Binding<SegmentRule>) -> Binding<Date> {
    Binding(
      get: { rule.wrappedValue.value.flatMap { Self.dayFormat.date(from: $0.inboxText) } ?? Date() },
      set: { rule.wrappedValue.value = .string(Self.dayFormat.string(from: $0)) }
    )
  }

  private static let dayFormat: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
  }()

  private func setField(_ rule: Binding<SegmentRule>, _ token: String) {
    rule.wrappedValue.field = token == Self.attributeToken ? SegmentSpec.attributePrefix : token
    let ops = SegmentSpec.ops(SegmentSpec.kind(rule.wrappedValue.field))
    if !ops.contains(rule.wrappedValue.op) { rule.wrappedValue.op = ops[0] }
    rule.wrappedValue.value = .string(rule.wrappedValue.field == "subscription" ? "subscribed" : rule.wrappedValue.field == "origin" ? "lead_form" : SegmentSpec.kind(rule.wrappedValue.field) == .flag ? "yes" : "")
  }

  /// Rules still waiting for their value don't count yet, as on the web.
  private var sendable: SegmentFilter {
    SegmentFilter(match: filter.match, rules: filter.rules.filter { !SegmentSpec.needsValue($0.op) || !($0.value?.inboxText.trimmingCharacters(in: .whitespaces) ?? "").isEmpty })
  }

  private func preview() async {
    struct Input: Encodable, Sendable { let project: String; let filter: SegmentFilter }
    previewError = ""
    do {
      let result: SegmentPreview = try await session.send("/v1/segments/preview", body: Input(project: projectId, filter: sendable))
      count = result.count; sample = result.sample
    } catch { if !Task.isCancelled { count = nil; previewError = error.localizedDescription } }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let project, name: String; let filter: SegmentFilter }
    struct Output: Decodable, Sendable { let segment: ContactSegment }
    saving = true
    defer { saving = false }
    let input = Input(project: projectId, name: name.trimmingCharacters(in: .whitespaces), filter: sendable)
    do {
      let _: Output = try await session.send(segment.map { "/v1/segments/\($0.id)" } ?? "/v1/segments", method: segment == nil ? "POST" : "PATCH", body: input)
      onSaved()
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
