import SwiftUI

/// A project's keys, install snippets and webhooks (web: projects/[id]/dev.vue).
/// Name, branding and email sending are on Settings.
struct ProjectDevScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.openURL) private var openURL

  @State private var project: ProjectsAdminProject?
  @State private var loadError = ""
  @State private var tab = Tab.chat
  @State private var secret = ""
  @State private var justCreated = false
  @State private var keyError = ""
  @State private var confirmRotate = false
  @State private var copied = ""
  @State private var connectErrorsOpen = false
  // Security and webhooks
  @State private var originsText = ""
  @State private var webhookUrl = ""
  @State private var webhookSecret = ""
  @State private var saving = false
  @State private var saved = false
  @State private var saveError = ""

  private enum Tab: String, CaseIterable, Identifiable {
    case chat, feedback, flags, errors, email
    var id: String { rawValue }
    var label: String {
      switch self {
      case .chat: "Chat widget"
      case .feedback: "Feedback"
      case .flags: "Flags"
      case .errors: "Errors"
      case .email: "Email API"
      }
    }
    var systemImage: String {
      switch self {
      case .chat: "bubble.left.and.text.bubble.right"
      case .feedback: "lightbulb"
      case .flags: "switch.2"
      case .errors: "ladybug"
      case .email: "envelope"
      }
    }
  }

  private enum Tone { case ok, warn, off }

  var body: some View {
    ScrollView {
      Group {
        if let project {
          VStack(alignment: .leading, spacing: 40) {
            header(project)
            credentials(project)
            integrations(project)
            security(project)
          }
        } else if !loadError.isEmpty {
          ErrorText(message: loadError)
        } else {
          SkeletonRows(count: 4)
        }
      }
      .frame(maxWidth: 720, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .projectScreen(projectId, "Dev")
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button { workspace.go(.developer) } label: { Label("Guide", systemImage: "book") }
        if let docs = URL(string: appURL + "/_docs/scalar") {
          Button { openURL(docs) } label: { Label("API reference", systemImage: "chevron.left.forwardslash.chevron.right") }
        }
      }
    }
    .confirmationDialog("Rotate the secret?", isPresented: $confirmRotate, titleVisibility: .visible) {
      Button("Rotate secret", role: .destructive) { Task { await rotate() } }
    } message: {
      Text("Tokens minted with the current one stop working right away.")
    }
    .sheet(isPresented: $connectErrorsOpen) {
      ConnectErrorTrackingSheet(projectId: projectId, projectName: project?.name ?? "", existing: project?.errorLinks ?? []) { connected in fill(connected) }
    }
    .task {
      // Just created: show the secret once, as the web does.
      if let fresh = workspace.newProjectSecrets.removeValue(forKey: projectId) { secret = fresh; justCreated = true }
      await load()
    }
  }

  // MARK: Sections

  private func header(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Connect \(project.name)").font(.lnTitle).foregroundStyle(Theme.textHighlighted)
      Text("Keys, snippets and webhooks for your code. Name, branding and email sending are in project settings.")
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
      Button("Project settings") { workspace.go(.project(projectId, .settings)) }.buttonStyle(.lnGhost).padding(.leading, -10)
    }
  }

  private func credentials(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      heading("Credentials")
      Card {
        CardRow {
          LabeledField(label: "Public key", hint: "Names the project. Safe in browsers.") {
            HStack(spacing: 8) { code(project.publicKey); copyButton(project.publicKey, id: "pk") }
          }
        }
        CardRow {
          LabeledField(label: "Secret key", hint: "Signs identity tokens and calls the server API. Never ship it to a browser.") {
            HStack(spacing: 8) {
              code(secret.isEmpty ? String(repeating: "•", count: 24) : secret)
              if !secret.isEmpty { copyButton(secret, id: "sk") }
              IconButton(systemImage: secret.isEmpty ? "eye" : "eye.slash", label: secret.isEmpty ? "Reveal secret" : "Hide secret", bordered: true) {
                if secret.isEmpty { Task { await reveal() } } else { secret = "" }
              }
              IconButton(systemImage: "arrow.triangle.2.circlepath", label: "Rotate secret", bordered: true) { confirmRotate = true }
            }
          }
        }
        CardRow(divider: false) {
          LabeledField(label: "Base URL", hint: "Where your site and server reach HelpBites.") {
            HStack(spacing: 8) { code(appURL); copyButton(appURL, id: "url") }
          }
        }
      }
      ErrorText(message: keyError)
      if justCreated {
        Label("Your new project's secret is shown above. You can reveal it again here any time; rotating it invalidates tokens minted with the old one.", systemImage: "info.circle")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
  }

  // MARK: Integrations: each tile is a tab for its guide below.

  private func integrations(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      heading("Integrations")
      LazyVGrid(columns: [GridItem(.adaptive(minimum: sizeClass == .regular ? 130 : 150), spacing: 8)], spacing: 8) {
        ForEach(Tab.allCases) { item in
          let (tone, status) = summary(item, project)
          Button { tab = item } label: {
            VStack(alignment: .leading, spacing: 6) {
              Label { Text(item.label) } icon: { Image(systemName: item.systemImage).foregroundStyle(Theme.textMuted) }
                .font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(1)
              HStack(spacing: 6) {
                Circle().fill(color(tone)).frame(width: 6, height: 6)
                Text(status).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
              }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tab == item ? Theme.elevated : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(tab == item ? Theme.borderAccented : Theme.border))
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(tab == item ? .isSelected : [])
        }
      }
      VStack(alignment: .leading, spacing: 18) {
        switch tab {
        case .chat: chatPanel(project)
        case .feedback: feedbackPanel(project)
        case .flags: flagsPanel(project)
        case .errors: errorsPanel(project)
        case .email: emailPanel(project)
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    }
  }

  private func summary(_ tab: Tab, _ project: ProjectsAdminProject) -> (Tone, String) {
    switch tab {
    case .chat:
      // Green only once the widget has loaded on a host page: allowing an origin is not installing it.
      let origins = project.allowedOrigins.count
      let seen = project.widgetSeenAt != nil
      if origins == 0 { return (.warn, "No allowed origins") }
      return seen ? (.ok, "\(origins) allowed origin\(origins == 1 ? "" : "s")") : (.warn, "Not loaded on your site yet")
    case .feedback:
      let on = project.feedback?.enabled == true
      return (on ? .ok : .off, on ? "Board on" : "Off")
    case .flags:
      let flags = project.flags?.count ?? 0
      return (flags > 0 ? .ok : .off, flags > 0 ? "\(flags) flag\(flags == 1 ? "" : "s")" : "None yet")
    case .errors:
      let connected = project.errors?.connected == true
      return (connected ? .ok : .off, connected ? (project.errors?.providerName ?? "Connected") : "Not connected")
    case .email:
      return (.ok, (project.fromEmail ?? "").isEmpty ? "Default sender" : project.fromEmail ?? "")
    }
  }

  private func color(_ tone: Tone) -> Color {
    switch tone {
    case .ok: Theme.success
    case .warn: Theme.warning
    case .off: Theme.textDimmed
    }
  }

  private func panelHead(_ text: String, @ViewBuilder actions: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      paragraph(text)
      HStack(spacing: 4) { actions() }.padding(.leading, -10)
    }
  }

  private func step(_ number: Int, _ title: String, _ text: String? = nil, snippet: String? = nil) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Text("\(number)").font(.system(size: 11, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.textToned)
        .frame(width: 24, height: 24).background(Theme.elevated, in: Circle()).overlay(Circle().strokeBorder(Theme.border))
      VStack(alignment: .leading, spacing: 8) {
        Text(title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).frame(minHeight: 24, alignment: .leading)
        if let text { paragraph(text) }
        if let snippet { CodeBlock(code: snippet) }
      }
    }
  }

  private func chatPanel(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      panelHead("Your server signs a short token for the signed-in user; the widget hands it to HelpBites.") {
        manage(.settings, label: "Widget settings")
      }
      step(1, "Mint a token on your server", "Any language works; this is Node with no dependencies.", snippet: mintSnippet(project.publicKey))
      step(2, "Load the widget on your site", "Only the allowed origins below may host it.", snippet: widgetSnippet(project.publicKey))
      step(3, "Or build your own UI", "Call the [API](\(appURL)/_docs/scalar) with `Authorization: Bearer <token>`. Pass `assistantId` when opening a conversation to route it to a specific assistant (copy the ID from the Assistants tab).")
    }
  }

  private func feedbackPanel(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      panelHead("A public board where users post ideas, vote and comment. \(project.feedback?.enabled == true ? "It is on." : "Turn it on from the Feedback page.")") {
        manage(.feedback)
      }
      step(1, "Drop the board into any page", "Anyone can read it; pass the same token as the chat so signed-in users can post, vote and comment.", snippet: feedbackSnippet(project.publicKey))
      step(2, "Or build your own UI", "Use `/v1/feedback` ([API](\(appURL)/_docs/scalar)): read with `?pk=\(project.publicKey)`, write with the identity token. Add `role: \"admin\"` to a token to let one of your staff moderate. Bring old feedback over with `POST /v1/feedback/import` and the secret.")
    }
  }

  private func flagsPanel(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      panelHead("Read flags from your server with the secret and decide them against your own admin check.") { manage(.flags) }
      paragraph("Decide `admins` flags against your own admin check and each flag's `allow` list. Cache about 30 seconds, keep the last good answer through a blip, then use each flag's `fallback`; treat unknown flags as off. A browser can ask with `?pk=` or the identity token instead and gets `enabled` already worked out (`role: \"admin\"` counts as an admin).")
      CodeBlock(code: flagsSnippet)
    }
  }

  private func errorsPanel(_ project: ProjectsAdminProject) -> some View {
    let links = project.errorLinks ?? []
    let connected = project.errors?.connected == true
    return VStack(alignment: .leading, spacing: 14) {
      if connected {
        panelHead("Reporting to \(links.count > 1 ? links.map(\.label).joined(separator: ", ") : project.errors?.providerName ?? "the tracker").") {
          Button("Manage servers") { workspace.go(.connections) }.buttonStyle(.lnGhost)
          Button("Connect another") { connectErrorsOpen = true }.buttonStyle(.lnGhost)
          manage(.errors, label: "Errors")
        }
        ForEach(links.filter { !$0.alertWebhookUrl.isEmpty }) { link in
          VStack(alignment: .leading, spacing: 6) {
            paragraph("To get \(links.count > 1 ? "\(link.label)'s " : "")alerts in the inbox, open the project's alerts in Bugsink, click Add, set Kind to **Slack** and use this Webhook url:")
            CodeBlock(code: link.alertWebhookUrl)
          }
        }
        paragraph("Use this DSN in browser and server SDKs\(links.count > 1 ? " (\(links[0].label))" : ""). Set the same stable HelpBites identity id as the Sentry user id to show a customer’s errors in their conversation.")
        CodeBlock(code: sentrySnippet(project.errors?.dsn ?? ""))
        ForEach(links.dropFirst()) { link in
          VStack(alignment: .leading, spacing: 6) {
            paragraph("DSN for \(link.label):")
            CodeBlock(code: link.dsn)
          }
        }
      } else {
        panelHead("Connect GlitchTip or Bugsink to give this project a Sentry-compatible DSN and send alerts to the inbox.") { manage(.errors, label: "Errors") }
        Button { connectErrorsOpen = true } label: { Label("Connect error tracking", systemImage: "link") }.buttonStyle(.lnPrimaryCompact)
      }
    }
  }

  private func emailPanel(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      panelHead("Send from your server with the secret.") {
        manage(.email, label: "Templates")
        NavigationLink {
          EmailLibraryScreen(projectId: projectId, initialTab: .log)
        } label: {
          HStack(spacing: 4) { Text("Log"); Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold)) }
        }
        .buttonStyle(.lnGhost)
      }
      paragraph("Send one of this project's templates by its send key, your own HTML (in the body, or uploaded as an `html` file), or a plain message in the project's layout. Each recipient gets their own message and a row in the log; `GET /v1/email-logs` reads it back. The sender is set in project settings.")
      Button("Email settings") { workspace.go(.project(projectId, .settings)) }.buttonStyle(.lnGhost).padding(.leading, -10)
      CodeBlock(code: emailSnippet)
    }
  }

  // MARK: Security and webhooks

  private func security(_ project: ProjectsAdminProject) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      heading("Security and webhooks")
      VStack(alignment: .leading, spacing: 16) {
        LabeledField(label: "Allowed origins", hint: "One per line. Only these sites may host the widget.") {
          LinearTextEditor(text: $originsText, placeholder: "https://app.example.com", minHeight: 64, monospaced: true)
            .autocorrectionDisabled().textInputAutocapitalization(.never).keyboardType(.URL)
        }
        pair {
          LabeledField(label: "Action webhook URL", hint: "Receives signed operator actions") {
            TextField("https://api.example.com/helpbites/actions", text: $webhookUrl).textFieldStyle(.linear)
              .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
        } _: {
          LabeledField(label: "Action webhook secret", hint: project.hasActionWebhookSecret == true ? "Leave blank to keep the current secret." : "At least 16 characters.") {
            SecureField("••••••••••••••••", text: $webhookSecret).textFieldStyle(.linear)
          }
        }
        HStack(spacing: 12) {
          Button { Task { await saveSecurity() } } label: {
            if saving { ProgressView().tint(.white) } else { Text("Save") }
          }
          .buttonStyle(.lnPrimaryCompact)
          .disabled(saving || !securityDirty(project))
          if !saveError.isEmpty {
            Text(saveError).font(.lnMeta).foregroundStyle(Theme.error)
          } else if saved && !securityDirty(project) {
            Text("Saved").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
        }
      }
      .padding(16)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    }
  }

  private var origins: [String] {
    originsText.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  private func securityDirty(_ project: ProjectsAdminProject) -> Bool {
    origins != project.allowedOrigins || webhookUrl != (project.actionWebhookUrl ?? "") || !webhookSecret.isEmpty
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
    Text(text).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
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

  /// Two fields side by side on iPad and Mac, stacked on iPhone (the web's `sm:grid-cols-2`).
  private func pair<First: View, Second: View>(@ViewBuilder _ first: () -> First, @ViewBuilder _ second: () -> Second) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
    return layout {
      first().frame(maxWidth: .infinity, alignment: .leading)
      second().frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var appURL: String { session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

  private func copy(_ value: String, id: String) {
    Clipboard.copy(value)
    copied = id
    Task {
      try? await Task.sleep(for: .seconds(1.5))
      if copied == id { copied = "" }
    }
  }

  // MARK: Requests

  private func fill(_ loaded: ProjectsAdminProject) {
    project = loaded
    originsText = loaded.allowedOrigins.joined(separator: "\n")
    webhookUrl = loaded.actionWebhookUrl ?? ""
    webhookSecret = ""
  }

  private func load() async {
    do { fill(try await ProjectsAdminProject.load(projectId, session: session)) } catch { loadError = error.localizedDescription }
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

  /// Origins and the action webhook only; everything else on the project is untouched.
  private func saveSecurity() async {
    struct Input: Encodable, Sendable { let allowedOrigins: [String]; let actionWebhookUrl: String; let actionWebhookSecret: String? }
    saving = true; saved = false; saveError = ""
    defer { saving = false }
    do {
      let updated = try await ProjectsAdminProject.save(projectId, Input(allowedOrigins: origins, actionWebhookUrl: webhookUrl, actionWebhookSecret: webhookSecret.isEmpty ? nil : webhookSecret), workspace: workspace)
      fill(updated)
      saved = true
    } catch { saveError = error.localizedDescription }
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
