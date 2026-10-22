import SwiftUI

/// What `POST /v1/admin/blog/ai` proposes; fields a mode does not produce are empty.
struct BlogAiResult: Decodable, Sendable {
  let body: String
  let title: String
  let excerpt: String
  let metaDescription: String
  let tags: [String]
  let notes: String
  let repos: [Repo]
  struct Repo: Decodable, Sendable { let repo: String; let read: Bool }
}

private struct BlogAiResponse: Decodable, Sendable { let result: BlogAiResult }

enum BlogAiMode: String, CaseIterable, Identifiable {
  // Same modes as server/utils/blogAi.ts (tests/blogNativeParity.test.ts).
  case write, `continue`, improve, meta
  var id: String { rawValue }
  var label: String {
    switch self {
    case .write: String(localized: "Write the post")
    case .continue: String(localized: "Continue it")
    case .improve: String(localized: "Improve the text")
    case .meta: String(localized: "Title, excerpt and tags")
    }
  }
  var applyLabel: String {
    switch self {
    case .write: String(localized: "Use as the post")
    case .continue: String(localized: "Add to the post")
    case .improve: String(localized: "Replace the text")
    case .meta: String(localized: "Use these")
    }
  }
}

/// "Write with AI" (web: components/blog/BlogAiModal.vue): reads the project's connected GitHub
/// repos and the post as it is in the editor, and proposes Markdown. Nothing changes until applied.
struct BlogAiSheet: View {
  let projectId: String
  let title: String
  let bodyText: String
  let apply: (BlogAiMode, BlogAiResult) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var mode = BlogAiMode.write
  @State private var instruction = ""
  @State private var repos: [String] = []
  /// Empty reads them all.
  @State private var chosen: Set<String> = []
  @State private var busy = false
  @State private var error = ""
  @State private var result: BlogAiResult?

  private struct ReposResponse: Decodable, Sendable { let repos: [String] }
  private var hasText: Bool { !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Reads your connected GitHub repos and this post, then proposes text. Nothing changes until you apply it.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "What to do", hint: hasText ? nil : "Write something first to continue, improve or get a title.") {
            FlowLayout(spacing: 8) {
              ForEach(BlogAiMode.allCases) { item in
                Pill(label: item.label, systemImage: mode == item ? "checkmark" : nil, isActive: mode == item) {
                  mode = item
                  result = nil
                }
                .disabled(item != .write && !hasText)
              }
            }
          }
          OnboardingTextField(label: "What should it be about?", text: $instruction, limit: 2000, placeholder: "Announce our new offline mode, for a technical audience.", multiline: true)
          LabeledField(label: "Repos to read", hint: repos.isEmpty ? "No GitHub repos are connected to this project. Connect them in Settings, or describe the post above." : (chosen.isEmpty ? "All connected repos, three at most." : nil)) {
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
          ErrorText(message: error)
          if result == nil {
            Button { Task { await run() } } label: { Label(busy ? "Thinking…" : "Write", systemImage: "sparkles") }
              .buttonStyle(.lnPrimaryCompact).disabled(busy)
          } else {
            Button { Task { await run() } } label: { Label(busy ? "Thinking…" : "Try again", systemImage: "sparkles") }
              .buttonStyle(.lnSecondaryCompact).disabled(busy)
          }
          if let result { proposal(result) }
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Write with AI")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(mode.applyLabel) {
            if let result { apply(mode, result) }
            dismiss()
          }
          .disabled(result == nil || busy)
        }
      }
    }
    .presentationDetents([.large])
    .task {
      if !hasText { mode = .write }
      if let response: ReposResponse = try? await session.get("/v1/admin/cms/repos", query: ["project": projectId]) { repos = response.repos }
    }
  }

  private func proposal(_ result: BlogAiResult) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Rectangle().fill(Theme.border).frame(height: Hairline.width)
      if !result.notes.isEmpty { Text(result.notes).font(.lnBody).foregroundStyle(Theme.text) }
      let fields = [(String(localized: "Title"), result.title), (String(localized: "Excerpt"), result.excerpt), (String(localized: "Description for search engines"), result.metaDescription), (String(localized: "Tags"), result.tags.joined(separator: ", "))].filter { !$0.1.isEmpty }
      if !fields.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(fields, id: \.0) { field in
            VStack(alignment: .leading, spacing: 2) {
              Text(field.0).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
              Text(field.1).font(.lnMeta).foregroundStyle(Theme.text)
            }
          }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
      if !result.body.isEmpty {
        KnowledgeMarkdown(text: result.body)
          .frame(maxWidth: .infinity, alignment: .topLeading)
          .padding(12)
          .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      }
      if !result.repos.isEmpty {
        let read = result.repos.map { $0.read ? $0.repo : "\($0.repo) ✕" }.joined(separator: ", ")
        Text(String(localized: "Read: \(read)")).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      Text("Apply puts it in the editor: check it, then save or publish.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  /// `POST /v1/admin/blog/ai`: a minute or two with a slow model, so through the long-timeout client.
  private func run() async {
    struct Body: Encodable, Sendable { let project: String; let mode: String; let instruction: String; let title: String; let body: String; let repos: [String] }
    busy = true
    error = ""
    defer { busy = false }
    do {
      let response: BlogAiResponse = try await LegalAPI.slow(session, "/v1/admin/blog/ai", Body(project: projectId, mode: mode.rawValue, instruction: instruction, title: title, body: bodyText, repos: chosen.sorted()))
      result = response.result
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }
}
