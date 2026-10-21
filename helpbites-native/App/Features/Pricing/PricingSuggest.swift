import SwiftUI

/// "Suggest with AI" (web: components/pricing/PricingSuggest.vue): reads the project's connected
/// GitHub repos, the table, its Stripe prices and 90 days of revenue and numbers, and proposes
/// plans, features and words. Nothing changes until the proposal is applied to the form.
struct PricingSuggestSheet: View {
  let projectId: String
  let tableId: String
  /// Saves unsaved edits first, since the server reads the saved working copy; false stops.
  let beforeSuggest: () async -> Bool
  let apply: (PricingSuggestion.Draft) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var focus: Set<String> = Set(PricingLimits.focus.map(\.id))
  @State private var repos: [String] = []
  /// Empty reads them all.
  @State private var chosen: Set<String> = []
  @State private var notes = ""
  @State private var busy = false
  @State private var error = ""
  @State private var suggestion: PricingSuggestion?

  private struct ReposResponse: Decodable, Sendable { let repos: [String] }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Reads your connected GitHub repos, this table, your Stripe prices and 90 days of revenue and of this table's numbers, then proposes plans, features and words. Nothing changes until you apply it.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Suggest") {
            FlowLayout(spacing: 8) {
              ForEach(PricingLimits.focus, id: \.id) { item in
                Pill(label: item.label, systemImage: focus.contains(item.id) ? "checkmark" : nil, isActive: focus.contains(item.id)) {
                  if focus.contains(item.id) { focus.remove(item.id) } else { focus.insert(item.id) }
                }
              }
            }
          }
          LabeledField(label: "Repos to read", hint: repos.isEmpty ? "No GitHub repos are connected to this project. Connect them in Settings, or describe the product below." : (chosen.isEmpty ? "All connected repos, three at most." : nil)) {
            if !repos.isEmpty {
              FlowLayout(spacing: 8) {
                ForEach(repos, id: \.self) { repo in
                  Pill(label: repo, systemImage: chosen.contains(repo) ? "checkmark" : nil, isActive: chosen.contains(repo)) {
                    if chosen.contains(repo) { chosen.remove(repo) } else { chosen.insert(repo) }
                  }
                }
              }
            }
          }
          OnboardingTextField(label: "Anything it should know", text: $notes, limit: PricingLimits.notes, placeholder: "Most customers are solo developers; teams ask for SSO.", multiline: true)
          ErrorText(message: error)
          if suggestion == nil {
            Button { Task { await suggest() } } label: { Label(busy ? "Thinking…" : "Suggest", systemImage: "sparkles") }
              .buttonStyle(.lnPrimaryCompact).disabled(busy || focus.isEmpty)
          } else {
            Button { Task { await suggest() } } label: { Label(busy ? "Thinking…" : "Suggest again", systemImage: "sparkles") }
              .buttonStyle(.lnSecondaryCompact).disabled(busy || focus.isEmpty)
          }
          if let suggestion { result(suggestion) }
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Suggest plans with AI")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Apply") {
            if let suggestion { apply(suggestion.draft) }
            dismiss()
          }
          .disabled(suggestion == nil || busy)
        }
      }
    }
    .presentationDetents([.large])
    .task {
      if let response: ReposResponse = try? await session.get("/v1/admin/cms/repos", query: ["project": projectId]) { repos = response.repos }
    }
  }

  private func result(_ suggestion: PricingSuggestion) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Rectangle().fill(Theme.border).frame(height: Hairline.width)
      if !suggestion.summary.isEmpty { Text(suggestion.summary).font(.lnBody).foregroundStyle(Theme.text) }
      if !suggestion.advice.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("Worth a look").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          ForEach(Array(suggestion.advice.enumerated()), id: \.offset) { _, line in
            Label(line, systemImage: "lightbulb").font(.lnMeta).foregroundStyle(Theme.text)
          }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
      if !suggestion.repos.isEmpty {
        Text("Read: " + suggestion.repos.map { $0.read ? $0.repo : "\($0.repo) ✕" }.joined(separator: ", ")).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      PricingTableView(table: suggestion.preview)
        .padding(16)
        .background(Theme.canvas, in: RoundedRectangle(cornerRadius: Metrics.radiusXL))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radiusXL).strokeBorder(Theme.border))
      Text("Apply puts it in the editor: check it, then save or publish.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  /// `POST …/suggest`: a minute or two with a slow model, so through the long-timeout client.
  private func suggest() async {
    struct Body: Encodable, Sendable { let focus: [String]; let repos: [String]; let notes: String }
    guard await beforeSuggest() else { return }
    busy = true
    error = ""
    defer { busy = false }
    do {
      let ordered = PricingLimits.focus.map(\.id).filter { focus.contains($0) }
      let response: PricingSuggestionResponse = try await LegalAPI.slow(session, "/v1/admin/pricing-tables/\(tableId)/suggest", Body(focus: ordered, repos: chosen.sorted(), notes: notes))
      suggestion = response.suggestion
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }
}
