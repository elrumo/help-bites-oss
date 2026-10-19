import PhotosUI
import SwiftUI

/// A project's keys, install snippets and settings (web: projects/[id]/dev.vue).
struct ProjectDevScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.horizontalSizeClass) private var sizeClass

  @State private var project: ProjectsAdminProject?
  @State private var form = DevForm()
  @State private var loadError = ""
  @State private var secret = ""
  @State private var keyError = ""
  @State private var confirmRotate = false
  @State private var copied = ""
  @State private var saving = false
  @State private var saved = false
  @State private var saveError = ""
  @State private var uploading: DevLogo?
  @State private var brandPick: PhotosPickerItem?
  @State private var assistantPick: PhotosPickerItem?
  @State private var iconPick: PhotosPickerItem?
  @State private var connectErrorsOpen = false
  /// The server's sender, greyed out behind blank email fields (`GET /v1/admin/email-settings`).
  @State private var emailDefaults: EmailDefaults?

  var body: some View {
    ScrollView {
      Group {
        if let project {
          VStack(alignment: .leading, spacing: 44) {
            keys(project)
            connect(project)
            feedbackBoard(project)
            featureFlags(project)
            errorTracking(project)
            email(project)
            settings(project)
          }
        } else if !loadError.isEmpty {
          ErrorText(message: loadError)
        } else {
          SkeletonRows(count: 4)
        }
      }
      .frame(maxWidth: 640, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .projectScreen(projectId, "Dev")
    .confirmationDialog("Rotate the secret?", isPresented: $confirmRotate, titleVisibility: .visible) {
      Button("Rotate secret", role: .destructive) { Task { await rotate() } }
    } message: {
      Text("Tokens minted with the current one stop working right away.")
    }
    .onChange(of: brandPick) { _, item in Task { await upload(.brand, item) } }
    .onChange(of: assistantPick) { _, item in Task { await upload(.assistant, item) } }
    .onChange(of: iconPick) { _, item in Task { await upload(.icon, item) } }
    .sheet(isPresented: $connectErrorsOpen) {
      ConnectErrorTrackingSheet(projectId: projectId) { connected in project = connected }
    }
    .task {
      // Just created: show the secret once, as the web's ?secret= does.
      if let fresh = workspace.newProjectSecrets.removeValue(forKey: projectId) { secret = fresh }
      await load()
    }
  }

  // MARK: Sections

  private func keys(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      heading("Keys")
      Card {
        CardRow {
          LabeledField(label: "Public key") {
            HStack(spacing: 8) {
              code(project.publicKey)
              copyButton(project.publicKey, id: "public")
            }
          }
        }
        CardRow(divider: false) {
          LabeledField(label: "Secret") {
            HStack(spacing: 8) {
              code(secret.isEmpty ? String(repeating: "•", count: 28) : secret)
              if secret.isEmpty {
                Button("Reveal") { Task { await reveal() } }.buttonStyle(.lnSecondaryCompact)
              } else {
                copyButton(secret, id: "secret")
              }
              Button("Rotate") { confirmRotate = true }.buttonStyle(.lnSecondaryCompact)
            }
          }
        }
      }
      ErrorText(message: keyError)
      Text("The secret signs identity tokens on your server. Never ship it to a browser. Rotating it invalidates tokens minted with the old one.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private func connect(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      heading("Connect \(project.name)")
      VStack(alignment: .leading, spacing: 6) {
        paragraph("Point your website at this HelpBites endpoint:")
        HStack(spacing: 8) {
          code(appURL)
          Button(copied == "base" ? "Copied" : "Copy") { copy(appURL, id: "base") }.buttonStyle(.lnSecondaryCompact)
        }
      }
      paragraph("On your server, mint a token for the signed-in user. Any language works; this is Node:")
      CodeBlock(code: mintSnippet(project.publicKey))
      paragraph("On your site, load the widget and hand it that token:")
      CodeBlock(code: widgetSnippet(project.publicKey))
      paragraph("Or build your own UI against the [API](\(appURL)/_docs/scalar), sending `Authorization: Bearer <token>`. Pass `assistantId` when opening a conversation to route it to a specific assistant (copy the ID from the Assistants tab).")
    }
  }

  private func feedbackBoard(_ project: ProjectsAdminProject) -> some View {
    let enabled = project.feedback?.enabled == true
    return VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 10) {
        heading("Feedback board")
        StatusDot(status: enabled ? "on" : "off", label: enabled ? "On" : "Off")
        Spacer(minLength: 0)
        manage(.feedback)
      }
      paragraph("Drop the ready-made board into any page. Anyone can read it; pass the same token as the chat so signed-in users can post, vote and comment:")
      CodeBlock(code: feedbackSnippet(project.publicKey))
      paragraph("Or build your own UI on `/v1/feedback` ([API](\(appURL)/_docs/scalar)): read with `?pk=\(project.publicKey)`, write with the identity token. Add `role: \"admin\"` to a token to let one of your staff moderate. Bring old feedback over with `POST /v1/feedback/import` and the secret.")
    }
  }

  private func featureFlags(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 10) {
        heading("Feature flags")
        Tag(text: "\(project.flags?.count ?? 0)")
        Spacer(minLength: 0)
        manage(.flags)
      }
      paragraph("Read them from your server with the secret and decide `admins` flags against your own admin check and each flag's `allow` list. Cache about 30 seconds, keep the last good answer through a blip, then use each flag's `fallback`; treat unknown flags as off. A browser can ask with `?pk=` or the identity token instead and gets `enabled` already worked out (`role: \"admin\"` counts as an admin).")
      CodeBlock(code: flagsSnippet)
    }
  }

  private func errorTracking(_ project: ProjectsAdminProject) -> some View {
    let errors = project.errors
    let connected = errors?.connected == true
    return VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 10) {
        heading("Error tracking")
        StatusDot(status: connected ? "on" : "off", label: connected ? "Connected" : "Off")
        Spacer(minLength: 0)
        Button { workspace.go(.project(projectId, .errors)) } label: {
          HStack(spacing: 4) { Text("Errors"); Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold)) }
        }
        .buttonStyle(.lnGhost)
      }
      if connected {
        paragraph("Reporting to \(errors?.providerName ?? "the tracker").")
        if let webhook = errors?.alertWebhookUrl, !webhook.isEmpty {
          paragraph("To get alerts in the inbox, open the project's alerts in Bugsink, click Add, set Kind to **Custom** and use this Webhook url:")
          CodeBlock(code: webhook)
        }
        paragraph("Use this DSN in browser and server SDKs. Set the same stable HelpBites identity id as the Sentry user id to show a customer’s errors in their conversation.")
        CodeBlock(code: sentrySnippet(errors?.dsn ?? ""))
      } else {
        paragraph("Connect GlitchTip or Bugsink to give this project a Sentry-compatible DSN and send alerts to the inbox.")
        Button("Connect error tracking") { connectErrorsOpen = true }.buttonStyle(.lnPrimaryCompact)
      }
    }
  }

  private func email(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 10) {
        heading("Email")
        Spacer(minLength: 0)
        manage(.email, label: "Templates")
        NavigationLink {
          EmailLibraryScreen(projectId: projectId, initialTab: .log)
        } label: {
          HStack(spacing: 4) { Text("Log"); Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold)) }
        }
        .buttonStyle(.lnGhost)
      }
      paragraph("Send from your server with the secret: one of this project's templates by its send key, your own HTML (in the body, or uploaded as an `html` file), or a plain message in the project's layout. Each recipient gets their own message and a row in the log; `GET /v1/email-logs` reads it back.")
      CodeBlock(code: emailSnippet)
    }
  }

  private func emailSending() -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 2) {
        Text("Email sending").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        Text("Who this project's email comes from: the send API, notifications and feedback updates. Blank fields use the server's defaults, shown greyed out.")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      pair {
        LabeledField(label: "From address") { emailField(emailDefaults?.fromEmail.nonEmpty ?? "hello@mail.example.com", text: $form.fromEmail) }
      } _: {
        LabeledField(label: "Sending domain") {
          TextField(emailDefaults?.domain.nonEmpty ?? "mail.example.com", text: $form.mailDomain).textFieldStyle(.linear).font(.lnMono)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      }
      pair {
        LabeledField(label: "Reply-to") { emailField("Replies go to the from address", text: $form.replyTo) }
      } _: {
        LabeledField(label: "Email log", hint: "Shows the message itself in the log. It can include sign-in and reset links.") {
          toggle("Keep a copy of each email", isOn: $form.emailLogContent)
        }
      }
      Text("The from name is **Reply as** above. The sending domain must be in the same Mailgun account as the server's API key, and the from address should be on it.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .padding(16)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func emailField(_ prompt: String, text: Binding<String>) -> some View {
    TextField(prompt, text: text).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
  }

  private func settings(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      Rectangle().fill(Theme.border).frame(height: 1).padding(.bottom, 10)
      heading("Settings")
      LabeledField(label: "Name") { TextField("", text: $form.name).textFieldStyle(.linear) }
      LabeledField(label: "Chat notice", hint: "Shown centered at the top of every new chat — e.g. “A human always reads this; an AI may answer first.” Leave blank to hide.") {
        LinearTextEditor(text: $form.chatNotice, placeholder: "A human will always read this chat, but an AI might answer your questions first.", minHeight: 64)
      }
      iconField(project)
      pair { logoField(.brand) } _: { logoField(.assistant) }
      Text("Uploads apply when you save.").font(.lnCaption).foregroundStyle(Theme.textMuted).padding(.top, -8)
      pair {
        LabeledField(label: "Site URL", hint: "Used in email links") { urlField("https://app.example.com", text: $form.siteUrl) }
      } _: {
        LabeledField(label: "Inbox path", hint: "Where the widget lives on that site") { urlField("/app", text: $form.inboxPath) }
      }
      pair {
        LabeledField(label: "Action webhook URL", hint: "Receives signed operator actions") { urlField("https://api.example.com/helpbites/actions", text: $form.actionWebhookUrl) }
      } _: {
        LabeledField(label: "Action webhook secret", hint: project.hasActionWebhookSecret == true ? "Leave blank to keep the current secret." : "At least 16 characters.") {
          SecureField("••••••••••••••••", text: $form.actionWebhookSecret).textFieldStyle(.linear)
        }
      }
      LabeledField(label: "Allowed origins", hint: "One per line. Only these sites may host the widget.") {
        LinearTextEditor(text: $form.allowedOrigins, placeholder: "https://app.example.com", minHeight: 64, monospaced: true)
          .autocorrectionDisabled().textInputAutocapitalization(.never).keyboardType(.URL)
      }
      pair {
        LabeledField(label: "Reply as", hint: "Signs your replies and their emails") { TextField("Elías", text: $form.fromName).textFieldStyle(.linear) }
      } _: {
        LabeledField(label: "Notify these emails when a user writes", hint: "Comma separated") {
          TextField("you@example.com", text: $form.notifyEmails).textFieldStyle(.linear)
            .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      }
      emailSending()
      pair {
        LabeledField(label: "Accent colour", hint: "The widget's send button and your bubbles") {
          HStack(spacing: 10) {
            ColorPicker("Accent colour", selection: accentBinding, supportsOpacity: false).labelsHidden()
            TextField("#0f766e", text: $form.accent).textFieldStyle(.linear).frame(maxWidth: 140)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
          }
        }
      } _: {
        LabeledField(label: "Attachments") { toggle("Users can attach images", isOn: $form.allowAttachments) }
      }
      LabeledField(label: "Request type", hint: "Only takes effect once you have more than one ticket type.") {
        VStack(alignment: .leading, spacing: 10) {
          toggle("Let users choose a request type when starting a chat", isOn: $form.letUsersChooseType)
          toggle("Offer an “Other” option (creates a plain support ticket)", isOn: $form.allowOtherType).disabled(!form.letUsersChooseType)
        }
      }
      ErrorText(message: saveError)
      HStack(spacing: 12) {
        Button { Task { await save() } } label: {
          if saving { ProgressView().tint(.white) } else { Text("Save changes") }
        }
        .buttonStyle(.lnPrimary)
        .disabled(saving || uploading != nil)
        if saved { Text("Saved").font(.lnMeta).foregroundStyle(Theme.textMuted) }
      }
    }
  }

  private func iconField(_ project: ProjectsAdminProject) -> some View {
    LabeledField(label: DevLogo.icon.label, hint: DevLogo.icon.hint) {
      HStack(spacing: 12) {
        ProjectTile(id: project.id, name: form.name, accent: form.accent, icon: form.iconUrl, size: 40)
        PhotosPicker(selection: $iconPick, matching: .images, preferredItemEncoding: .compatible) {
          if uploading == .icon { ProgressView() } else { Text("Upload") }
        }
        .buttonStyle(.lnSecondaryCompact)
        .disabled(uploading != nil)
        if !form.iconUrl.isEmpty {
          Button("Remove") { setLogo(.icon, "") }.buttonStyle(.lnGhost)
        }
      }
    }
  }

  private func logoField(_ logo: DevLogo) -> some View {
    let url = logo == .brand ? form.brandLogoUrl : form.assistantLogoUrl
    let busy = uploading == logo
    return LabeledField(label: logo.label, hint: logo.hint) {
      HStack(spacing: 12) {
        Group {
          if !url.isEmpty, let image = URL(string: url) {
            AsyncImage(url: image) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
          } else {
            Image(systemName: logo.placeholder).font(.system(size: 18)).foregroundStyle(Theme.textDimmed)
          }
        }
        .frame(width: 40, height: 40)
        .background(Theme.elevated)
        .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
        .accessibilityLabel(Text(logo.label))
        PhotosPicker(selection: logo == .brand ? $brandPick : $assistantPick, matching: .images, preferredItemEncoding: .compatible) {
          if busy { ProgressView() } else { Text("Upload") }
        }
        .buttonStyle(.lnSecondaryCompact)
        .disabled(uploading != nil)
        if !url.isEmpty {
          Button("Remove") { setLogo(logo, "") }.buttonStyle(.lnGhost)
        }
      }
    }
  }

  // MARK: Small pieces

  private func heading(_ text: String) -> some View {
    Text(text).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
  }

  /// Body copy with the web's inline `code` and links.
  private func paragraph(_ markdown: String) -> some View {
    Text((try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(markdown))
      .font(.lnCallout).foregroundStyle(Theme.text).tint(Theme.accentText)
      .fixedSize(horizontal: false, vertical: true)
  }

  private func code(_ text: String) -> some View {
    Text(text).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled)
      .padding(.horizontal, 10).padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private func copyButton(_ value: String, id: String) -> some View {
    IconButton(systemImage: copied == id ? "checkmark" : "doc.on.doc", label: "Copy", bordered: true) { copy(value, id: id) }
  }

  private func manage(_ section: ProjectSection, label: String = "Manage") -> some View {
    Button { workspace.go(.project(projectId, section)) } label: {
      HStack(spacing: 4) { Text(label); Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold)) }
    }
    .buttonStyle(.lnGhost)
  }

  private func urlField(_ prompt: String, text: Binding<String>) -> some View {
    TextField(prompt, text: text).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
  }

  private func toggle(_ label: String, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) { Text(label).font(.lnCallout).foregroundStyle(Theme.text) }.tint(Theme.accent)
  }

  /// Two fields side by side on iPad, stacked on iPhone (the web's `sm:grid-cols-2`).
  private func pair<First: View, Second: View>(@ViewBuilder _ first: () -> First, @ViewBuilder _ second: () -> Second) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
    return layout {
      first().frame(maxWidth: .infinity, alignment: .leading)
      second().frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var accentBinding: Binding<Color> {
    Binding(get: { Color(hexString: form.accent) ?? Theme.accent }, set: { form.accent = $0.hexString })
  }

  private var appURL: String { session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

  private func copy(_ value: String, id: String) {
    UIPasteboard.general.string = value
    copied = id
    Task {
      try? await Task.sleep(for: .seconds(1.5))
      if copied == id { copied = "" }
    }
  }

  private func setLogo(_ logo: DevLogo, _ url: String) {
    switch logo {
    case .brand: form.brandLogoUrl = url
    case .assistant: form.assistantLogoUrl = url
    case .icon: form.iconUrl = url
    }
  }

  // MARK: Requests

  private func load() async {
    do {
      let loaded = try await ProjectsAdminProject.load(projectId, session: session)
      project = loaded
      form = DevForm(loaded)
    } catch {
      loadError = error.localizedDescription
    }
    emailDefaults = try? await session.get("/v1/admin/email-settings")
  }

  private func reveal() async {
    struct Response: Decodable, Sendable { let secret: String }
    do {
      let response: Response = try await session.get("/v1/admin/projects/\(projectId)/secret")
      secret = response.secret
      keyError = ""
    } catch { keyError = error.localizedDescription }
  }

  private func rotate() async {
    struct Response: Decodable, Sendable { let secret: String }
    do {
      let response: Response = try await session.send("/v1/admin/projects/\(projectId)/rotate-secret")
      secret = response.secret
      keyError = ""
    } catch { keyError = error.localizedDescription }
  }

  /// `POST /projects/:id/logo` returns the stored image; the URL lands on the project when you save.
  private func upload(_ logo: DevLogo, _ item: PhotosPickerItem?) async {
    guard let item else { return }
    uploading = logo
    saveError = ""
    defer {
      uploading = nil
      switch logo {
      case .brand: brandPick = nil
      case .assistant: assistantPick = nil
      case .icon: iconPick = nil
      }
    }
    do {
      guard let data = try await item.loadTransferable(type: Data.self) else { throw APIError.server("Could not read that image") }
      // The server sniffs PNG, JPEG, GIF or WebP; anything else (HEIC) goes up as JPEG.
      let magic: [[UInt8]] = [[0x89, 0x50, 0x4E, 0x47], [0xFF, 0xD8, 0xFF], [0x47, 0x49, 0x46], [0x52, 0x49, 0x46, 0x46]]
      let accepted = magic.contains { data.starts(with: $0) }
      guard let file = accepted ? data : UIImage(data: data)?.jpegData(compressionQuality: 0.9) else {
        throw APIError.server("Only PNG, JPEG, GIF and WebP images are accepted")
      }
      let stored: Attachment = try await session.upload("/v1/admin/projects/\(projectId)/logo", file: file, filename: "logo", mimeType: accepted ? "application/octet-stream" : "image/jpeg")
      setLogo(logo, stored.url)
    } catch {
      saveError = error.localizedDescription
    }
  }

  private func save() async {
    let accent = form.accent.trimmingCharacters(in: .whitespaces)
    guard accent.isEmpty || accent.wholeMatch(of: /#[0-9a-fA-F]{6}/) != nil else {
      saveError = "Accent colour must be a hex value like #0f766e."
      return
    }
    saving = true
    saved = false
    saveError = ""
    defer { saving = false }
    let body = DevInput(
      name: form.name,
      chatNotice: form.chatNotice,
      brandLogoUrl: form.brandLogoUrl,
      assistantLogoUrl: form.assistantLogoUrl,
      iconUrl: form.iconUrl,
      siteUrl: form.siteUrl,
      inboxPath: form.inboxPath,
      allowedOrigins: form.allowedOrigins.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
      fromName: form.fromName,
      notifyEmails: form.notifyEmails,
      fromEmail: form.fromEmail.trimmingCharacters(in: .whitespaces),
      replyTo: form.replyTo.trimmingCharacters(in: .whitespaces),
      mailDomain: form.mailDomain.trimmingCharacters(in: .whitespaces),
      emailLogContent: form.emailLogContent,
      allowAttachments: form.allowAttachments,
      letUsersChooseType: form.letUsersChooseType,
      allowOtherType: form.allowOtherType,
      actionWebhookUrl: form.actionWebhookUrl,
      actionWebhookSecret: form.actionWebhookSecret.isEmpty ? nil : form.actionWebhookSecret,
      // `theme` is replaced whole on the server: send `dark` back so saving here keeps it.
      theme: ProjectTheme(accent: accent.isEmpty ? nil : accent, dark: project?.theme.dark)
    )
    do {
      let updated = try await ProjectsAdminProject.save(projectId, body, workspace: workspace)
      project = updated
      form = DevForm(updated)
      saved = true
    } catch {
      saveError = error.localizedDescription
    }
  }

  // MARK: Snippets (the web page's, with this project's key and this server's URL)

  private func mintSnippet(_ publicKey: String) -> String {
    """
    import { createHmac } from 'node:crypto'

    // GET /api/support/token — only for a signed-in user of your app
    export function mintSupportToken(user) {
      const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
      const now = Math.floor(Date.now() / 1000)
      const head = b64({ alg: 'HS256', typ: 'JWT' })
      const body = b64({ iss: '\(publicKey)', sub: user.id, name: user.name, email: user.email, iat: now, exp: now + 3600 })
      const sig = createHmac('sha256', process.env.HELP_BITES_SECRET).update(head + '.' + body).digest('base64url')
      return head + '.' + body + '.' + sig
    }
    """
  }

  private func widgetSnippet(_ publicKey: String) -> String {
    """
    <script src="\(appURL)/widget.js" data-project="\(publicKey)" defer></script>
    <script>
      window.HelpBites = window.HelpBites || []
      HelpBites.push(['init', {
        getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token),
        context: { type: 'page', id: location.pathname, label: document.title, url: location.href } // optional
      }])
    </script>
    """
  }

  private func feedbackSnippet(_ publicKey: String) -> String {
    """
    <div id="feedback"></div>
    <script src="\(appURL)/feedback.js" data-project="\(publicKey)" data-target="#feedback" defer></script>
    <script>
      window.HelpBitesFeedback = window.HelpBitesFeedback || []
      HelpBitesFeedback.push(['init', {
        // resolve to null when nobody is signed in: the board stays readable
        getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
        onSignIn: () => location.assign('/login') // where to send a visitor who tries to post
      }])
      // After your user signs in or out: HelpBitesFeedback.push(['refresh'])
    </script>
    """
  }

  private var emailSnippet: String {
    """
    // POST /v1/emails/send → { id, sent, failed, suppressed, results: [{ to, status, logId }] }
    await fetch('\(appURL)/v1/emails/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.HELP_BITES_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        template: 'welcome', // or html: '<p>Hi {{name}}</p>' with a subject
        to: [{ email: user.email, name: user.name }],
        variables: { name: user.name },
        idempotencyKey: `welcome-${user.id}` // a retry never sends twice
      })
    })
    """
  }

  private func sentrySnippet(_ dsn: String) -> String {
    """
    import * as Sentry from '@sentry/browser'

    Sentry.init({ dsn: '\(dsn)' })
    Sentry.setUser({ id: user.id }) // the same stable value used as the HelpBites token's sub
    """
  }

  private var flagsSnippet: String {
    """
    // GET /v1/flags → { flags: { ai_chat: { state: 'admins', fallback: 'off', targets: ['backend'], allow: ['user_123'] } } }
    const { flags } = await fetch('\(appURL)/v1/flags?target=backend', {
      headers: { authorization: `Bearer ${process.env.HELP_BITES_SECRET}` }
    }).then(r => r.json())

    function isOn(key, user) {
      const flag = flags[key]
      if (!flag || flag.state === 'off') return false
      if (flag.state === 'on') return true
      return user.isAdmin || flag.allow.includes(user.id) || flag.allow.includes(user.email?.toLowerCase())
    }
    """
  }
}

private enum DevLogo {
  case brand, assistant, icon
  var label: String {
    switch self {
    case .brand: "Brand logo"
    case .assistant: "Assistant logo"
    case .icon: "Project icon"
    }
  }
  var hint: String {
    switch self {
    case .brand: "Optional. Shown in the chat header."
    case .assistant: "Optional. Avatar for AI replies."
    case .icon: "Optional. Replaces the coloured initial in the sidebar, headers and lists."
    }
  }
  var placeholder: String { self == .brand ? "photo" : "sparkles" }
}

/// The server's default sender, from `GET /v1/admin/email-settings`.
private struct EmailDefaults: Decodable, Sendable {
  let fromEmail, domain: String
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}

/// The settings form, filled from the project like the web's `fill()`.
private struct DevForm {
  var name = "", chatNotice = "", brandLogoUrl = "", assistantLogoUrl = "", iconUrl = "", siteUrl = "", inboxPath = ""
  var allowedOrigins = "", fromName = "", notifyEmails = "", actionWebhookUrl = "", actionWebhookSecret = ""
  var fromEmail = "", replyTo = "", mailDomain = ""
  var accent = "#0f766e"
  var allowAttachments = true, letUsersChooseType = false, allowOtherType = false, emailLogContent = false

  init() {}
  init(_ project: ProjectsAdminProject) {
    name = project.name
    chatNotice = project.chatNotice ?? ""
    brandLogoUrl = project.brandLogoUrl ?? ""
    assistantLogoUrl = project.assistantLogoUrl ?? ""
    iconUrl = project.iconUrl ?? ""
    fromEmail = project.fromEmail ?? ""
    replyTo = project.replyTo ?? ""
    mailDomain = project.mailDomain ?? ""
    emailLogContent = project.emailLogContent ?? false
    siteUrl = project.siteUrl
    inboxPath = project.inboxPath
    allowedOrigins = project.allowedOrigins.joined(separator: "\n")
    fromName = project.fromName
    notifyEmails = project.notifyEmails.joined(separator: ", ")
    actionWebhookUrl = project.actionWebhookUrl ?? ""
    accent = project.theme.accent ?? "#0f766e"
    allowAttachments = project.allowAttachments
    letUsersChooseType = project.letUsersChooseType ?? false
    allowOtherType = project.allowOtherType ?? false
  }
}

/// The PATCH body the web's Dev page sends. `actionWebhookSecret` is write-only: nil keeps the current one.
private struct DevInput: Encodable, Sendable {
  let name, chatNotice, brandLogoUrl, assistantLogoUrl, iconUrl, siteUrl, inboxPath: String
  let allowedOrigins: [String]
  let fromName, notifyEmails, fromEmail, replyTo, mailDomain: String
  let emailLogContent: Bool
  let allowAttachments, letUsersChooseType, allowOtherType: Bool
  let actionWebhookUrl: String
  let actionWebhookSecret: String?
  let theme: ProjectTheme
}
