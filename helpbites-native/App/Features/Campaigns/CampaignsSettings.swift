import SwiftUI

/// A project's newsletter settings (web: MarketingSettings.vue): the topics people can pick, the
/// postal address every campaign must carry, double opt-in for the sign-up form, its own sender,
/// and the event webhook that tells your app about unsubscribes.
struct MarketingSettingsView: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var project: MarketingProject?
  @State private var form = MarketingConfig()
  @State private var webhookUrl = ""
  @State private var webhookSecret = ""
  @State private var loading = true
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""

  private var signupUrl: String { "\(session.endpoint)/s/\(project?.publicKey ?? "")" }
  private var snippet: String {
    """
    <form action="\(session.endpoint)/v1/subscribe" method="post">
      <input type="hidden" name="pk" value="\(project?.publicKey ?? "")">
      <input type="email" name="email" required placeholder="you@example.com">
      <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-10000px">
      <button type="submit">Subscribe</button>
    </form>
    """
  }

  var body: some View {
    Form {
      if loading && project == nil { Section { SkeletonRows(count: 3) } }
      else if let project {
        Section {
          TextField("Postal address", text: $form.postalAddress, axis: .vertical)
        } header: { Text("Required in every campaign") } footer: { Text("Shown as {{project.address}}; the law requires it in marketing email. This is your company profile's address (Project settings → Company), which legal documents use too.") }

        Section {
          ForEach($form.topics) { $topic in
            VStack(alignment: .leading, spacing: 6) {
              TextField("Name (Product updates)", text: $topic.name)
                .onSubmit { fillKey(&topic) }
              HStack {
                TextField("key", text: $topic.key).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
                Button(role: .destructive) { form.topics.removeAll { $0.id == topic.id } } label: { Image(systemName: "xmark") }
                  .buttonStyle(.borderless)
                  .accessibilityLabel("Remove topic")
              }
              TextField("What it is, in a line", text: $topic.description)
            }
          }
          Button { form.topics.append(MarketingTopic(key: "", name: "")) } label: { Label("Add topic", systemImage: "plus") }
        } header: { Text("Topics") } footer: {
          Text(form.topics.isEmpty ? "No topics: one list for everything. Add some so people can opt out of newsletters one by one on their preferences page; a campaign can go to one topic's readers." : "Newsletters people can opt out of one by one on their preferences page. A campaign can go to one topic's readers.")
        }

        Section {
          Toggle("Double opt-in", isOn: $form.doubleOptIn)
          TextField("After signing up, go to (https://example.com/thanks)", text: $form.confirmRedirectUrl).inputHints(.url, capitalization: .never).autocorrectionDisabled()
          LabeledContent("Hosted page") { Text(signupUrl).font(.lnMono).textSelection(.enabled).lineLimit(2) }
          Button { Clipboard.copy(signupUrl) } label: { Label("Copy sign-up link", systemImage: "doc.on.doc") }
          DisclosureGroup("Or a form on your site") { CodeBlock(code: snippet).padding(.vertical, 4) }
        } header: { Text("Sign-up form") } footer: { Text("Double opt-in: new sign-ups confirm by email before they get anything. Strongly recommended. The redirect is optional; otherwise a HelpBites thank-you page.") }

        Section {
          TextField("From name (\(project.fromName?.isEmpty == false ? project.fromName ?? "" : project.name))", text: $form.fromName)
          TextField("From address (news@news.example.com)", text: $form.fromEmail).inputHints(.emailAddress, capitalization: .never).autocorrectionDisabled()
          TextField("Mailgun domain (news.example.com)", text: $form.mailDomain).inputHints(.url, capitalization: .never).autocorrectionDisabled()
        } header: { Text("Sender") } footer: { Text("Optional. A separate domain keeps newsletter reputation apart from support and account email. It must be a sending domain of the same Mailgun account.") }

        Section {
          TextField("URL (https://api.example.com/hooks/helpbites)", text: $webhookUrl).inputHints(.url, capitalization: .never).autocorrectionDisabled()
          SecureField(project.hasEventWebhookSecret == true ? "Signing secret (set; type a new one to replace it)" : "Signing secret (16+ characters)", text: $webhookSecret)
        } header: { Text("Event webhook") } footer: {
          Text("HelpBites never writes to your database. It tells your app instead: contact.subscription_changed and email.suppressed, signed like the action webhook (x-helpbites-signature), retried for a day.")
        }

        Section {
          ErrorText(message: error)
          if saved { Label("Saved", systemImage: "checkmark").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        }
      } else {
        Section { ErrorText(message: error.isEmpty ? "This project could not be loaded." : error) }
      }
    }
    .formStyle(.grouped)
    .task { await load() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button("Save") { Task { await save() } }.disabled(project == nil || saving) }
    }
  }

  private func fillKey(_ topic: inout MarketingTopic) {
    guard topic.key.isEmpty, !topic.name.isEmpty else { return }
    let slug = topic.name.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    topic.key = String(slug.prefix(40))
  }

  private func load() async {
    do {
      project = try await MarketingProject.load(projectId, session: session)
      form = project?.marketing ?? MarketingConfig()
      webhookUrl = project?.eventWebhookUrl ?? ""
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func save() async {
    struct Input: Encodable, Sendable { let marketing: MarketingConfig; let eventWebhookUrl: String; let eventWebhookSecret: String? }
    struct Output: Decodable, Sendable { let project: MarketingProject }
    saving = true; saved = false
    defer { saving = false }
    // Any topic left without a key gets one from its name, as when you tab out of it on the web.
    for i in form.topics.indices { fillKey(&form.topics[i]) }
    do {
      let output: Output = try await session.send("/v1/admin/projects/\(projectId)", method: "PATCH", body: Input(marketing: form, eventWebhookUrl: webhookUrl, eventWebhookSecret: webhookSecret.isEmpty ? nil : webhookSecret))
      project = output.project
      webhookSecret = ""
      error = ""; saved = true
    } catch { self.error = error.localizedDescription }
  }
}
