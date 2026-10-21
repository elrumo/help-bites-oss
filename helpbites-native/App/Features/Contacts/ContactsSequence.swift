import SwiftUI

// Put one person, or everyone in a segment, on a sequence by hand (web: AddToSequenceModal.vue):
// POST /v1/sequences/:id/enrollments. Only an active sequence takes people and only subscribed
// people are enrolled; the answer says who was left out and why.

/// What the enrollments route answers (server/utils/sequences.ts `EnrollSummary`).
struct EnrollSummary: Decodable, Equatable, Sendable {
  struct Skipped: Decodable, Equatable, Sendable { let notSubscribed, optedOut, alreadyEnrolled, notFound: Int }
  let enrolled: Int
  let skipped: Skipped
  /// More people were left than one call adds; call again for the next batch.
  let truncated: Bool

  /// Who was left out, by reason: only the reasons that apply.
  var skippedText: String {
    [alreadyOn(skipped.alreadyEnrolled), notSubscribed(skipped.notSubscribed), optedOut(skipped.optedOut), notFound(skipped.notFound)]
      .compactMap { $0 }.joined(separator: " · ")
  }
  private func alreadyOn(_ n: Int) -> String? { n > 0 ? "\(n) already on it" : nil }
  private func notSubscribed(_ n: Int) -> String? { n > 0 ? "\(n) not subscribed" : nil }
  private func optedOut(_ n: Int) -> String? { n > 0 ? "\(n) opted out of its topic" : nil }
  private func notFound(_ n: Int) -> String? { n > 0 ? "\(n) not found" : nil }
}

struct AddToSequenceSheet: View {
  let projectId: String
  /// One person...
  var contactId: String?
  /// ...or everyone in this segment.
  var segment: ContactSegment?
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var sequences: [EmailSequence] = []
  @State private var picked = ""
  @State private var loading = true
  @State private var adding = false
  @State private var summary: EnrollSummary?
  @State private var error = ""

  var body: some View {
    NavigationStack {
      Form {
        Section {
          if loading { ProgressView().frame(maxWidth: .infinity) }
          else if sequences.isEmpty { Text("No sequence is active. Activate one under Campaigns first.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
          else {
            Picker("Sequence", selection: $picked) { ForEach(sequences) { Text($0.name).tag($0.id) } }
          }
        } header: {
          Text(segment.map { "Everyone in “\($0.name)”" } ?? "This person")
        } footer: {
          Text("Only people who are subscribed to marketing email are added. Anyone already on the sequence is left alone.")
        }
        if let summary {
          Section {
            Text("\(summary.enrolled) added to the sequence.").font(.lnRow)
            if !summary.skippedText.isEmpty { Text("Left out: \(summary.skippedText)").font(.lnCaption).foregroundStyle(Theme.textMuted) }
            if summary.truncated { Text("That was the most one call adds. Add the next batch to carry on.").font(.lnCaption).foregroundStyle(Theme.warning) }
          }
        }
        Section { ErrorText(message: error) }
      }
      .formStyle(.grouped)
      .navigationTitle("Add to a sequence")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(summary == nil ? "Cancel" : "Done") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(summary?.truncated == true ? "Add the next batch" : "Add") { Task { await add() } }
            .disabled(adding || picked.isEmpty)
        }
      }
    }
    #if os(macOS)
    .frame(minWidth: 420, minHeight: 340)
    #endif
    .task { await load() }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let sequences: [EmailSequence] }
    do {
      let response: Response = try await session.get("/v1/sequences", query: ["project": projectId])
      sequences = response.sequences.filter { $0.status == "active" }
      picked = sequences.first?.id ?? ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func add() async {
    struct Input: Encodable, Sendable { let project: String; let contacts: [String]?; let segment: String? }
    adding = true
    defer { adding = false }
    do {
      summary = try await session.send("/v1/sequences/\(picked)/enrollments", body: Input(project: projectId, contacts: segment == nil ? contactId.map { [$0] } : nil, segment: segment?.id))
      error = ""
    } catch { self.error = error.localizedDescription }
  }
}
