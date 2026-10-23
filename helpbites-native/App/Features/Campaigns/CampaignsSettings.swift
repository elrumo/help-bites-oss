import SwiftUI

/// A project's email settings in one place (web: EmailSettings.vue, the Settings tab of Email): the
/// sender every message goes out from (with an optional second one for campaigns and sequences), and
/// the newsletter's own settings: the postal address every campaign must carry, the topics people can
/// pick, double opt-in for the sign-up form, and the event webhook that tells your app about
/// unsubscribes. One Save writes all of it, with a single PATCH /v1/admin/projects/:id.
struct ProjectEmailSettingsView: View {
  let projectId: String
  /// Called after a save, so the setup strip reads the project's email setup again.
  var onSaved: () -> Void = {}
  @Environment(SessionStore.self) private var session
  @State private var project: MarketingProject?
  @State private var form = MarketingConfig()
  @State private var sender = SenderForm()
  /// How this server sends by default (GET /admin/email-settings): the placeholders of the sender fields.
  @State private var serverDefault: EmailSettings?
  /// Whether campaigns and sequences go out from an address of their own.
  @State private var separate = false
  @State private var webhookUrl = ""
  @State private var webhookSecret = ""
  @State private var hasWebhookSecret = false
  @State private var loading = true
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""

  /// The project's own sender, which every message uses unless campaigns have one of their own.
  private struct SenderForm: Equatable {
    var fromName = ""
    var fromEmail = ""
    var mailDomain = ""
    var replyTo = ""
    var emailLogContent = false
  }

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
          Text("Who this project's email comes from: the send API, notifications, feedback updates, and campaigns and sequences too, unless they have an address of their own below.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          VStack(alignment: .leading, spacing: 4) {
            field("From name", project.name, $sender.fromName)
            Text("Signs your replies and their emails").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          field("Reply-to", String(localized: "Replies go to the from address"), $sender.replyTo, .emailAddress)
          field("From address", serverOr(serverDefault?.fromEmail, "hello@mail.example.com"), $sender.fromEmail, .emailAddress)
          field("Sending domain", serverOr(serverDefault?.domain, "mail.example.com"), $sender.mailDomain, .url, mono: true)
        } header: { Text("Sender") } footer: {
          Text("Blank fields use the server's defaults, shown greyed out. The sending domain must be in the same Mailgun account as the server's API key, and the from address should be on it.")
        }

        InboundAddressesSection(projectId: project.id, projectName: project.name)

        Section {
          Toggle("Send campaigns and sequences from a different address", isOn: $separate)
        } footer: {
          Text("A separate domain keeps newsletter reputation apart from support and account email. It must be a sending domain of the same Mailgun account.")
        }
        if separate {
          Section {
            field("From name", sender.fromName.isEmpty ? project.name : sender.fromName, $form.fromName)
            field("From address", "news@news.example.com", $form.fromEmail, .emailAddress)
            field("Mailgun domain", "news.example.com", $form.mailDomain, .url, mono: true)
          }
        }

        Section {
          Toggle("Keep a copy of each email in the log", isOn: $sender.emailLogContent)
        } footer: {
          Text("Shows the message itself in the log. It can include sign-in and reset links.")
        }

        Section {
          TextField("Postal address", text: $form.postalAddress, prompt: Text("Acme Inc, 1 Main Street, Lisbon, Portugal"), axis: .vertical)
        } header: { Text("Required in every campaign") } footer: { Text("Shown as {{project.address}}; the law requires it in marketing email. This is your company profile's address (Project settings → Company), which legal documents use too.") }

        Section {
          ForEach($form.topics) { $topic in
            VStack(alignment: .leading, spacing: 6) {
              TextField("Name", text: $topic.name, prompt: Text("Product updates"))
                .onSubmit { fillKey(&topic) }
              HStack {
                TextField("Key", text: $topic.key, prompt: Text("key")).font(.lnMono).inputHints(.asciiCapable, capitalization: .never).autocorrectionDisabled()
                Button(role: .destructive) { form.topics.removeAll { $0.id == topic.id } } label: { Image(systemName: "xmark") }
                  .buttonStyle(.borderless)
                  .accessibilityLabel("Remove topic")
              }
              TextField("Description", text: $topic.description, prompt: Text("What it is, in a line"))
            }
          }
          Button { form.topics.append(MarketingTopic(key: "", name: "")) } label: { Label("Add topic", systemImage: "plus") }
        } header: { Text("Topics") } footer: {
          VStack(alignment: .leading, spacing: 4) {
            Text("Newsletters people can opt out of one by one on their preferences page. A campaign can go to one topic's readers.")
            if form.topics.isEmpty { Text("No topics: one list for everything.") }
          }
        }

        Section {
          Toggle(isOn: $form.doubleOptIn) {
            VStack(alignment: .leading, spacing: 2) {
              Text("Double opt-in")
              Text("New sign-ups confirm by email before they get anything. Strongly recommended.").font(.lnCaption).foregroundStyle(Theme.textMuted)
            }
          }
          field("After signing up, go to", "https://example.com/thanks", $form.confirmRedirectUrl, .url)
          LabeledContent("Hosted sign-up page") { Text(signupUrl).font(.lnMono).textSelection(.enabled).lineLimit(2) }
          Button { Clipboard.copy(signupUrl) } label: { Label("Copy sign-up link", systemImage: "doc.on.doc") }
          DisclosureGroup("Or a form on your site") { CodeBlock(code: snippet).padding(.vertical, 4) }
        } header: { Text("Sign-up form") } footer: { Text("The redirect is optional; otherwise a HelpBites thank-you page.") }

        Section {
          if session.isLocked("eventWebhooks") { PlanLockNotice(feature: "eventWebhooks") }
          field("URL", "https://api.example.com/hooks/helpbites", $webhookUrl, .url)
          LabeledContent("Signing secret") {
            SecureField("Signing secret", text: $webhookSecret, prompt: Text(hasWebhookSecret ? "Set; type a new one to replace it" : "16+ characters"))
              .labelsHidden()
              .multilineTextAlignment(.trailing)
          }
        } header: { Text("Event webhook") } footer: {
          Text("HelpBites never writes to your database. It tells your app instead: contact.subscription_changed and email.suppressed, signed like the action webhook (x-helpbites-signature), retried for a day.")
        }

        Section {
          ErrorText(message: error)
          if saved { Label("Saved", systemImage: "checkmark").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        }
      } else {
        Section { ErrorText(message: error.isEmpty ? String(localized: "This project could not be loaded.") : error) }
      }
    }
    .formStyle(.grouped)
    .task { if project == nil { await load() } }
    .task { await loadServerDefault() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button("Save") { Task { await save() } }.disabled(project == nil || saving) }
    }
  }

  /// The server's default when it has one, else an example, like the web's greyed-out placeholders.
  private func serverOr(_ serverValue: String?, _ example: String) -> String {
    guard let serverValue, !serverValue.isEmpty else { return example }
    return serverValue
  }

  /// A labelled text row: the label leading, the field trailing with its default or an example as the placeholder.
  private func field(_ label: LocalizedStringKey, _ placeholder: String, _ text: Binding<String>, _ keyboard: URLKeyboard = .default, mono: Bool = false) -> some View {
    let font: Font = mono ? .lnMono : .lnCallout
    return LabeledContent(label) {
      TextField(label, text: text, prompt: Text(placeholder))
        .labelsHidden()
        .multilineTextAlignment(.trailing)
        .font(font)
        .inputHints(keyboard, capitalization: .never)
        .autocorrectionDisabled()
    }
  }

  private func fillKey(_ topic: inout MarketingTopic) {
    guard topic.key.isEmpty, !topic.name.isEmpty else { return }
    let slug = topic.name.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    topic.key = String(slug.prefix(40))
  }

  private func load() async {
    do {
      let loaded = try await MarketingProject.load(projectId, session: session)
      project = loaded
      form = loaded?.marketing ?? MarketingConfig()
      sender = SenderForm(
        fromName: loaded?.fromName ?? "", fromEmail: loaded?.fromEmail ?? "", mailDomain: loaded?.mailDomain ?? "",
        replyTo: loaded?.replyTo ?? "", emailLogContent: loaded?.emailLogContent ?? false
      )
      separate = !(form.fromEmail.isEmpty && form.mailDomain.isEmpty && form.fromName.isEmpty)
      webhookUrl = loaded?.eventWebhookUrl ?? ""
      hasWebhookSecret = loaded?.hasEventWebhookSecret == true
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func loadServerDefault() async {
    if let result: EmailSettings = try? await session.get("/v1/admin/email-settings") { serverDefault = result }
  }

  /// Everything in one PATCH, like the web's save.
  private func save() async {
    struct Input: Encodable, Sendable {
      let fromName, fromEmail, mailDomain, replyTo: String
      let emailLogContent: Bool
      let marketing: MarketingConfig
      let eventWebhookUrl: String
      let eventWebhookSecret: String?
    }
    struct Output: Decodable, Sendable { let project: MarketingProject }
    saving = true; saved = false
    defer { saving = false }
    // Any topic left without a key gets one from its name, as when you tab out of it on the web.
    for i in form.topics.indices { fillKey(&form.topics[i]) }
    // Turning the second sender off blanks it, so campaigns fall back to the one above.
    var marketing = form
    if !separate { marketing.fromName = ""; marketing.fromEmail = ""; marketing.mailDomain = "" }
    let body = Input(
      fromName: sender.fromName, fromEmail: sender.fromEmail, mailDomain: sender.mailDomain, replyTo: sender.replyTo,
      emailLogContent: sender.emailLogContent, marketing: marketing,
      eventWebhookUrl: webhookUrl, eventWebhookSecret: webhookSecret.isEmpty ? nil : webhookSecret
    )
    do {
      let output: Output = try await session.send("/v1/admin/projects/\(projectId)", method: "PATCH", body: body)
      project = output.project
      hasWebhookSecret = output.project.hasEventWebhookSecret == true
      webhookSecret = ""
      error = ""; saved = true
      onSaved()
    } catch { self.error = error.localizedDescription }
  }
}
