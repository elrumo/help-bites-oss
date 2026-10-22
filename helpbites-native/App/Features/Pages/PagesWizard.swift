import SwiftUI

// The AI page wizard (web: components/cms/CmsWizard.vue, questions and prompt from shared/cms/library.ts,
// ported by hand: tests/cmsNativeParity.test.ts). A few questions about the product (prefilled from its
// GitHub repos on request) are saved as the messaging brief; then a page is made, from the chosen
// template or blank, and the editor opens with the assistant already building it from the answers.

struct PagesWizardQuestion: Identifiable, Sendable {
  enum Kind: Sendable { case text, longtext, select, repos }
  let id, label: String
  var help: String?
  let kind: Kind
  var options: [(value: String, label: String)] = []
  var required = false
  var placeholder = ""
}

enum PagesWizard {
  static let questions: [PagesWizardQuestion] = [
    PagesWizardQuestion(id: "product", label: "What is it called?", kind: .text, required: true, placeholder: "Acme"),
    PagesWizardQuestion(id: "oneLiner", label: "What is it, in one sentence?", kind: .text, required: true, placeholder: "A habit tracker for people who hate habit trackers"),
    PagesWizardQuestion(id: "audience", label: "Who is it for?", help: "The more specific, the better the copy: \"indie iOS developers\" beats \"developers\".", kind: .text, required: true),
    PagesWizardQuestion(id: "problem", label: "What problem does it solve for them?", help: "What do they do today, and what is painful about it?", kind: .longtext),
    PagesWizardQuestion(id: "features", label: "The three to five things it does best", kind: .longtext, placeholder: "One per line"),
    PagesWizardQuestion(id: "proof", label: "Proof", help: "Numbers, users, stars, reviews, press, who built it and why.", kind: .longtext),
    PagesWizardQuestion(id: "goal", label: "What should a visitor do?", kind: .select, options: [("waitlist", "Join a waitlist"), ("signup", "Sign up"), ("download", "Download the app"), ("buy", "Buy"), ("github", "Star it on GitHub"), ("contact", "Get in touch")], required: true),
    PagesWizardQuestion(id: "links", label: "Links the page needs", help: "Sign-up URL, App Store, GitHub, docs.", kind: .longtext, placeholder: "One per line"),
    PagesWizardQuestion(id: "tone", label: "Tone", kind: .select, options: [("plain", "Plain and direct"), ("friendly", "Friendly"), ("bold", "Bold and punchy"), ("technical", "Technical"), ("playful", "Playful")]),
    PagesWizardQuestion(id: "repos", label: "Repositories to read", help: "The assistant reads their README and code to get the facts right.", kind: .repos),
    // Its options are the server's templates and "new", filled in by the sheet.
    PagesWizardQuestion(id: "layout", label: "Layout", kind: .select, required: true)
  ]

  /// The answers as the assistant's first message (`wizardPrompt`).
  static func prompt(_ answers: [String: String], repos: [String], templates: [CmsTemplate]) -> String {
    let lines: [String] = questions.filter { $0.id != "layout" && $0.id != "repos" }.compactMap { question in
      let value = (answers[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard !value.isEmpty else { return nil }
      return "- \(question.label) \(question.options.first { $0.value == value }?.label ?? value)"
    }
    let template = templates.first { $0.id == answers["layout"] }
    let reposText = repos.joined(separator: ", ")
    return [
      "Build this landing page" + (template.map { " starting from the \"\($0.name)\" layout already on the page" } ?? " with a new layout: pick the blocks that tell this story best, and write a custom component when no built-in fits") + ".",
      "Write all the copy for it: make the value proposition specific and concrete, and lead with the reader's outcome rather than the features.",
      reposText.isEmpty ? "" : "First read these repositories for the real facts: \(reposText).",
      "Then save what you learned about the audience and the message to the messaging brief.",
      "What I know:"
    ].filter { !$0.isEmpty }.joined(separator: "\n") + (lines.isEmpty ? "" : "\n" + lines.joined(separator: "\n"))
  }
}

/// The questions stay English because their text goes into the assistant's prompt; the form shows them through the catalog.
private func wizardText(_ text: String) -> String { Bundle.main.localizedString(forKey: text, value: text, table: nil) }

/// The wizard's form, in its own sheet over the new-page sheet.
struct PagesWizardSheet: View {
  let projectId: String
  let templates: [CmsTemplate]
  /// The page made, and the prompt the assistant starts from.
  let onCreate: (CmsEntry, String) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var answers: [String: String] = ["goal": "signup", "tone": "plain", "layout": "saas"]
  @State private var repos: [String] = []
  @State private var chosen: Set<String> = []
  @State private var suggesting = false
  @State private var creating = false
  @State private var error = ""

  private var missing: Bool {
    PagesWizard.questions.contains { $0.required && (answers[$0.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Label(repos.isEmpty ? "Link a GitHub repository in Settings and the assistant can read it for the facts." : "Fill in what you can; the assistant reads your repositories for the rest.", systemImage: "chevron.left.forwardslash.chevron.right")
            .font(.lnCaption).foregroundStyle(Theme.textMuted)
          if !repos.isEmpty {
            Button { Task { await suggest() } } label: { Label(suggesting ? "Reading…" : "Fill in from my repositories", systemImage: "wand.and.stars") }
              .buttonStyle(.lnGhost).disabled(suggesting)
          }
          ForEach(PagesWizard.questions) { question in field(question) }
          ErrorText(message: error)
        }
        .frame(maxWidth: 560, alignment: .leading).padding(20).frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Plan it with the assistant")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(creating ? "Creating…" : "Generate") { Task { await create() } }.disabled(missing || creating)
        }
      }
    }
    .presentationDetents([.large])
    .task { await loadRepos() }
  }

  @ViewBuilder private func field(_ question: PagesWizardQuestion) -> some View {
    let label = question.required ? "\(wizardText(question.label)) *" : wizardText(question.label)
    switch question.kind {
    case .text:
      LabeledField(label: label, hint: question.help) {
        TextField(wizardText(question.placeholder), text: binding(question.id)).textFieldStyle(.linear)
      }
    case .longtext:
      LabeledField(label: label, hint: question.help) {
        LinearTextEditor(text: binding(question.id), placeholder: wizardText(question.placeholder), minHeight: 64)
      }
    case .select:
      LabeledField(label: label, hint: question.help) {
        Picker(wizardText(question.label), selection: binding(question.id)) {
          if question.id == "layout" {
            ForEach(templates.filter { $0.id != "blank" }) { Text("Start from “\($0.name)”").tag($0.id) }
            Text("Design a new layout for me").tag("new")
          } else {
            ForEach(question.options, id: \.value) { Text(wizardText($0.label)).tag($0.value) }
          }
        }
        .labelsHidden().fixedSize()
      }
    case .repos:
      if !repos.isEmpty {
        LabeledField(label: label, hint: question.help) {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(repos, id: \.self) { repo in
              Toggle(repo, isOn: Binding(get: { chosen.contains(repo) }, set: { if $0 { chosen.insert(repo) } else { chosen.remove(repo) } })).font(.lnMeta)
            }
          }
        }
      }
    }
  }

  private func binding(_ id: String) -> Binding<String> {
    Binding(get: { answers[id] ?? "" }, set: { answers[id] = $0 })
  }

  private func loadRepos() async {
    struct Response: Decodable, Sendable { let repos: [String] }
    if answers["product"] == nil { answers["product"] = workspace.project(projectId)?.name ?? "" }
    guard let response: Response = try? await session.get("/v1/admin/cms/repos", query: ["project": projectId]) else { return }
    repos = response.repos
    chosen = Set(response.repos)
  }

  /// Only what is still empty is filled in: what was typed wins.
  private func suggest() async {
    struct Input: Encodable, Sendable { let project: String; let repos: [String] }
    struct Response: Decodable, Sendable { let answers: [String: JSONValue] }
    suggesting = true
    error = ""
    defer { suggesting = false }
    do {
      let response: Response = try await session.send("/v1/admin/cms/wizard/suggest", body: Input(project: projectId, repos: repos.filter(chosen.contains)))
      for (key, value) in response.answers where (answers[key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
        if case .string(let text) = value { answers[key] = text }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func create() async {
    struct Settings: Encodable, Sendable { let project: String; let brief: CmsBrief }
    struct Ignored: Decodable, Sendable {}
    struct Entry: Encodable, Sendable { let project: String; let name, template: String? }
    func text(_ id: String) -> String { (answers[id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    func label(_ id: String) -> String { PagesWizard.questions.first { $0.id == id }?.options.first { $0.value == text(id) }?.label ?? text(id) }
    creating = true
    error = ""
    defer { creating = false }
    do {
      let pillars = text("features").split(separator: "\n").map { line in
        String(line).replacingOccurrences(of: "^[-*•]\\s*", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
      }.filter { !$0.isEmpty }.prefix(5)
      let brief = CmsBrief(audience: text("audience"), problem: text("problem"), valueProposition: text("oneLiner"), pillars: Array(pillars), proof: text("proof"), tone: label("tone"), callToAction: label("goal"))
      let _: Ignored = try await session.send("/v1/admin/cms/settings", method: "PATCH", body: Settings(project: projectId, brief: brief))
      let layout = text("layout")
      let response: CmsEntryResponse = try await session.send("/v1/admin/cms/entries", body: Entry(project: projectId, name: text("product").isEmpty ? nil : text("product"), template: layout == "new" ? nil : layout))
      onCreate(response.entry, PagesWizard.prompt(answers, repos: repos.filter(chosen.contains), templates: templates))
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
