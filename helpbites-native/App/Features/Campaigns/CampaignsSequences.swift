import SwiftUI

// Automated sequences (web: SequenceList.vue): emails that go out on their own, each a
// while after the one before, started by a sign-up, an event your app reports, or by hand.

struct SequencesList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var sequences: [EmailSequence] = []
  @State private var loading = true
  @State private var error = ""
  @State private var editing: SequenceTarget?
  @State private var deleting: EmailSequence?

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && sequences.isEmpty { SkeletonRows(count: 3).linearRow() }
      else if sequences.isEmpty {
        EmptyState(systemImage: "point.3.connected.trianglepath.dotted", title: "No sequences yet", message: "A welcome series for new subscribers, onboarding when a trial starts: emails that go out on their own, each a while after the last.") {
          Button("New sequence") { editing = .new }.buttonStyle(.lnPrimary)
        }
        .linearRow()
      }
      ForEach(sequences) { sequence in
        HStack(spacing: 12) {
          Button { editing = .edit(sequence) } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(sequence.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
              Text("\(sequence.triggerText) · \(sequence.steps.count) email\(sequence.steps.count == 1 ? "" : "s") · \(sequence.stats.active) on it, \(sequence.stats.completed) finished, \(sequence.stats.exited) left").font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          Tag(text: sequence.status.capitalized, tint: sequence.status == "active" ? Theme.success : sequence.status == "paused" ? Theme.warning : nil)
          if sequence.status == "active" {
            Button("Pause") { Task { await set(sequence, "paused") } }.buttonStyle(.lnSecondaryCompact)
          } else {
            Button("Activate") { Task { await set(sequence, "active") } }.buttonStyle(.lnPrimaryCompact)
          }
        }
        .frame(minHeight: Metrics.rowHeight)
        .linearRow()
        .contextMenu {
          Button { editing = .edit(sequence) } label: { Label("Edit", systemImage: "pencil") }
          Button(role: .destructive) { deleting = sequence } label: { Label("Delete", systemImage: "trash") }
        }
        .swipeActions { Button("Delete", role: .destructive) { deleting = sequence } }
      }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
    .toolbar { ToolbarItem(placement: .primaryAction) { Button { editing = .new } label: { Label("New sequence", systemImage: "plus") } } }
    .sheet(item: $editing) { target in SequenceEditor(projectId: projectId, sequence: target.sequence) { Task { await load() } } }
    .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { sequence in
      Button("Delete sequence", role: .destructive) { Task { await remove(sequence) } }
    } message: { _ in Text("Everyone on it stops getting its emails.") }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let sequences: [EmailSequence] }
    do {
      sequences = (try await session.get("/v1/sequences", query: ["project": projectId]) as Response).sequences
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func set(_ sequence: EmailSequence, _ status: String) async {
    struct Input: Encodable, Sendable { let project, status: String }
    struct Output: Decodable, Sendable { let sequence: EmailSequence }
    do {
      let output: Output = try await session.send("/v1/sequences/\(sequence.id)", method: "PATCH", body: Input(project: projectId, status: status))
      sequences = sequences.map { $0.id == sequence.id ? output.sequence : $0 }
      error = ""
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ sequence: EmailSequence) async {
    do {
      try await session.delete("/v1/sequences/\(sequence.id)?project=\(projectId)")
      sequences.removeAll { $0.id == sequence.id }
    } catch { self.error = error.localizedDescription }
  }
}

enum SequenceTarget: Identifiable {
  case new
  case edit(EmailSequence)
  var id: String { if case .edit(let sequence) = self { sequence.id } else { "new" } }
  var sequence: EmailSequence? { if case .edit(let sequence) = self { sequence } else { nil } }
}

private struct StepDraft: Identifiable, Equatable {
  var id = UUID()
  var stepId = ""
  var template = ""
  var subject = ""
  var amount = 0
  var unit = 1

  init(template: String = "", amount: Int = 0, unit: Int = 1) { self.template = template; self.amount = amount; self.unit = unit }
  /// Delays are edited in the unit that reads best.
  init(_ step: SequenceStep) {
    let unit = step.delayMinutes != 0 && step.delayMinutes % 1440 == 0 ? 1440 : step.delayMinutes != 0 && step.delayMinutes % 60 == 0 ? 60 : 1
    stepId = step.id; template = step.template; subject = step.subject ?? ""; amount = step.delayMinutes / unit; self.unit = unit
  }
  var delayMinutes: Int { max(0, amount) * unit }
}

struct SequenceEditor: View {
  let projectId: String
  let sequence: EmailSequence?
  var onSaved: () -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var trigger = SequenceTrigger(type: "subscribed")
  @State private var steps: [StepDraft] = []
  @State private var templates: [MarketingTemplate] = []
  @State private var topics: [MarketingTopic] = []
  @State private var saving = false
  @State private var error = ""

  private static let units: [(label: String, value: Int)] = [("minutes", 1), ("hours", 60), ("days", 1440)]

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Name (Welcome series)", text: $name)
          Picker("Starts when", selection: Binding(get: { trigger.type }, set: { trigger = SequenceTrigger(type: $0) })) {
            Text("Someone subscribes").tag("subscribed")
            Text("Your app reports an event").tag("event")
            Text("I add people by hand").tag("manual")
          }
          if trigger.type == "subscribed" {
            Picker("Topic", selection: Binding(get: { trigger.topic ?? "" }, set: { trigger.topic = $0.isEmpty ? nil : $0 })) {
              Text("Any topic").tag("")
              ForEach(topics) { Text($0.name).tag($0.key) }
            }
            .disabled(topics.isEmpty)
          } else if trigger.type == "event" {
            TextField("Event (trial_started)", text: Binding(get: { trigger.event ?? "" }, set: { trigger.event = $0 }))
              .font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
          }
        } footer: {
          Text(trigger.type == "event" ? "Your app reports it with POST /v1/track. Every email needs an unsubscribe link and your postal address, as campaigns do." : "Every email needs an unsubscribe link and your postal address, as campaigns do.")
        }

        ForEach($steps) { $step in
          Section {
            HStack {
              Stepper(value: $step.amount, in: 0...100_000) { Text("Wait \(step.amount)") }
              Picker("Unit", selection: $step.unit) { ForEach(Self.units, id: \.value) { Text($0.label).tag($0.value) } }.labelsHidden().fixedSize()
            }
            Picker("Template", selection: $step.template) {
              Text("Pick one").tag("")
              ForEach(templates) { Text($0.title).tag($0.ref) }
              // A template that no longer lists (renamed, deleted) stays selectable until changed.
              if !step.template.isEmpty, !templates.contains(where: { $0.ref == step.template }) { Text(step.template).tag(step.template) }
            }
            TextField("Subject (optional)", text: $step.subject)
            Button("Remove email", role: .destructive) { steps.removeAll { $0.id == step.id } }
          } header: {
            let index = steps.firstIndex { $0.id == step.id } ?? 0
            Text("Email \(index + 1) · \(index == 0 ? "after they start" : "after the one before")")
          }
        }
        Section {
          Button { steps.append(StepDraft(template: templates.first?.ref ?? "", amount: steps.isEmpty ? 0 : 1, unit: steps.isEmpty ? 1 : 1440)) } label: { Label("Add email", systemImage: "plus") }
            .disabled(steps.count >= 20)
          ErrorText(message: error)
        }
      }
      .formStyle(.grouped)
      .navigationTitle(sequence == nil ? "New sequence" : "Edit sequence")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || steps.isEmpty || saving) }
      }
    }
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 600)
    #endif
    .task {
      if let sequence, name.isEmpty { name = sequence.name; trigger = sequence.trigger; steps = sequence.steps.map(StepDraft.init) }
      templates = await MarketingTemplate.load(projectId, session: session)
      topics = (try? await MarketingProject.load(projectId, session: session))?.marketing?.topics ?? []
      if sequence == nil, steps.isEmpty { steps = [StepDraft(template: templates.first?.ref ?? "")] }
    }
  }

  private func save() async {
    struct Step: Encodable, Sendable { let id: String?; let template: String; let subject: String?; let delayMinutes: Int }
    struct Input: Encodable, Sendable { let project, name: String; let trigger: SequenceTrigger; let steps: [Step] }
    struct Output: Decodable, Sendable { let sequence: EmailSequence }
    saving = true
    defer { saving = false }
    let body = Input(
      project: projectId, name: name.trimmingCharacters(in: .whitespaces), trigger: trigger,
      steps: steps.map { Step(id: $0.stepId.isEmpty ? nil : $0.stepId, template: $0.template, subject: $0.subject.isEmpty ? nil : $0.subject, delayMinutes: $0.delayMinutes) }
    )
    do {
      let _: Output = try await session.send(sequence.map { "/v1/sequences/\($0.id)" } ?? "/v1/sequences", method: sequence == nil ? "POST" : "PATCH", body: body)
      onSaved()
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
