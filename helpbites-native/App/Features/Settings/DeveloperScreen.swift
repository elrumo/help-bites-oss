import SwiftUI

/// The integration guide (pages/developer.vue), with this server's base URL in every snippet.
struct DeveloperScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var mcpCopied = false

  private var base: String { session.endpoint }
  private var reference: URL? { URL(string: "\(base)/_docs/scalar") }
  private var mcpURL: String { "\(base)/mcp" }

  private struct QuickLink: Identifiable {
    enum Target { case section(String), apiKeys, reference }
    let label, hint, systemImage: String
    let target: Target
    var id: String { label }
  }

  private let links = [
    QuickLink(label: String(localized: "Get started"), hint: String(localized: "Project, token, widget — in three steps"), systemImage: "paperplane", target: .section("get-started")),
    QuickLink(label: String(localized: "AI assistants (MCP)"), hint: String(localized: "Connect Claude, ChatGPT or Cursor"), systemImage: "powerplug", target: .section("mcp")),
    QuickLink(label: String(localized: "Admin API keys"), hint: String(localized: "Automate the complete operator API"), systemImage: "key", target: .apiKeys),
    QuickLink(label: String(localized: "API reference"), hint: String(localized: "OpenAPI schema for every /v1 route"), systemImage: "chevron.left.forwardslash.chevron.right", target: .reference),
    QuickLink(label: String(localized: "Widget"), hint: String(localized: "Loader options and JS commands"), systemImage: "bubble.left.and.bubble.right", target: .section("widget")),
    QuickLink(label: String(localized: "Inline panel"), hint: String(localized: "Embed the chat in your own layout"), systemImage: "sidebar.left", target: .section("inline")),
    QuickLink(label: String(localized: "Examples"), hint: String(localized: "cURL, your own UI, live events"), systemImage: "testtube.2", target: .section("examples"))
  ]

  private let claims = [
    ("iss", String(localized: "The project public key")),
    ("sub", String(localized: "Your user's id — stable and unique per project")),
    ("name", String(localized: "Optional display name")),
    ("email", String(localized: "Optional; enables email notifications for that user")),
    ("iat / exp", String(localized: "Issued-at and expiry"))
  ]

  private let endpoints = [
    ("GET", "/v1/conversations", String(localized: "List the user’s conversations")),
    ("POST", "/v1/conversations", String(localized: "Start one")),
    ("GET", "/v1/conversations/:id/messages", String(localized: "Transcript; page with ?before=")),
    ("POST", "/v1/conversations/:id/messages", String(localized: "Send a message")),
    ("POST", "/v1/conversations/:id/read", String(localized: "Mark as read")),
    ("DELETE", "/v1/messages/:id", String(localized: "Unsend")),
    ("GET", "/v1/unread", String(localized: "Unread counts")),
    ("POST", "/v1/attachments", String(localized: "Multipart `file`")),
    ("GET", "/v1/events", String(localized: "Server-sent events"))
  ]

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 44) {
          VStack(alignment: .leading, spacing: 8) {
            Text("Connect your app to HelpBites").font(.lnTitle).foregroundStyle(Theme.textHighlighted)
            Text("Each app you run is a project. Its users keep their own accounts — your server signs a short identity token — and they chat from a drop-in widget or a UI you build on the API.")
              .font(.lnBody)
              .foregroundStyle(Theme.textMuted)
          }

          LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
            ForEach(links) { link in
              Button { follow(link.target, proxy) } label: {
                HStack(alignment: .top, spacing: 12) {
                  Image(systemName: link.systemImage).font(.system(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 18).padding(.top, 1)
                  VStack(alignment: .leading, spacing: 2) {
                    Text(link.label).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                    Text(link.hint).font(.lnCaption).foregroundStyle(Theme.textMuted)
                  }
                  Spacer(minLength: 0)
                }
                .padding(16)
                .contentShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
                .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
              }
              .buttonStyle(.plain)
            }
          }

          section(String(localized: "AI assistants (MCP)"), String(localized: "Let Claude, ChatGPT or Cursor work in your workspace as you. Add this address to the assistant's connectors and sign in, or give it an API key.")) {
            HStack(spacing: 8) {
              Text(mcpURL).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
              IconButton(systemImage: mcpCopied ? "checkmark" : "doc.on.doc", label: "Copy", bordered: true) {
                Clipboard.copy(mcpURL)
                mcpCopied = true
                Task { try? await Task.sleep(for: .seconds(1.5)); mcpCopied = false }
              }
            }
            prose(String(localized: "Claude Code, Cursor and other clients take a key from API keys as a header:"))
            CodeBlock(code: "claude mcp add --transport http helpbites \(mcpURL) \\\n  --header \"Authorization: Bearer ak_…\"")
            HStack(spacing: 4) {
              if let docs = URL(string: "\(base)/docs/mcp") {
                Button { openURL(docs) } label: { Label("How to connect", systemImage: "book") }.buttonStyle(.lnGhost)
              }
              Button("API keys") { workspace.settingsPath.append(.apiKeys) }.buttonStyle(.lnGhost)
            }
            .padding(.leading, -10)
          }
          .id("mcp")

          section(String(localized: "Get started"), String(localized: "Three steps, about ten minutes.")) {
            step(1, String(localized: "Create a project")) {
              prose(String(localized: "[Projects → New project](helpbites:projects). You get a public key `pk_…` (safe in browsers) and a secret `sk_…` (server only, signs identity tokens). Set the site URL, the origins allowed to host the widget, the name replies are signed with, and who gets notified when a user writes."))
            }
            step(2, String(localized: "Mint identity tokens on your server")) {
              prose(String(localized: "One authenticated route that returns a short-lived HS256 JWT for the signed-in user. Any JWT library works (`jose`, `jsonwebtoken`, PyJWT…); the secret is the project secret. Node, no dependencies:"))
              CodeBlock(code: Self.mintSnippet)
              note(String(localized: "Never send the secret to a browser. Rotate it from the project page if it leaks — tokens minted with the old one stop verifying immediately."))
            }
            step(3, String(localized: "Show the chat")) {
              prose(String(localized: "Drop the widget on your site and hand it that token:"))
              CodeBlock(code: widgetSnippet)
              note(String(localized: "Only origins listed on the project can host the widget; anything else sees an error inside the frame and never gets a token."))
            }
          }
          .id("get-started")

          section(String(localized: "Identity tokens"), String(localized: "HS256, signed with the project secret. An hour of life is plenty.")) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
              ForEach(claims, id: \.0) { claim, description in
                GridRow {
                  code(claim)
                  Text(description).font(.lnCallout).foregroundStyle(Theme.textToned)
                }
              }
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { hairline }
            .overlay(alignment: .bottom) { hairline }
          }

          section(String(localized: "Widget"), String(localized: "Everything the loader understands.")) {
            VStack(alignment: .leading, spacing: 8) {
              ForEach([
                String(localized: "`getToken` is called when the chat opens and again whenever a token expires."),
                String(localized: "`context` is attached to new conversations so you know what the user was looking at. Update it with `HelpBites.push(['setContext', {…}])`."),
                String(localized: "`HelpBites.push(['open'])` / `(['close'])` control the panel."),
                String(localized: "`data-mode=\"inline\"` with `data-target=\"#selector\"` drops the chat inside an element of your page — a message panel instead of a floating launcher. It fills its container, so give that element a height."),
                String(localized: "`data-position=\"left\"` and `data-accent=\"#hex\"` on the script tag tweak the launcher."),
                String(localized: "A link with `?sb=<conversationId>` — what notification emails use — opens that conversation on load.")
              ], id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                  Text("•").font(.lnCallout).foregroundStyle(Theme.textMuted)
                  prose(item)
                }
              }
            }
          }
          .id("widget")

          section(String(localized: "Inline panel"), String(localized: "Same chat, mounted in your layout — a support page or a section of your settings.")) {
            CodeBlock(code: inlineSnippet)
            note(String(localized: "Wide enough (640px and up) and the conversation list sits beside the thread; narrower, it stacks like the floating widget. There's no close button — the host page owns the panel."))
          }
          .id("inline")

          section(String(localized: "Examples"), String(localized: "Everything the widget does is on the API. Send `Authorization: Bearer <identity token>`.")) {
            example(String(localized: "Start a conversation")) { CodeBlock(code: curlSnippet) }
            example(String(localized: "Your own UI")) {
              prose(String(localized: "Retries are safe: pass a `clientId` with each message and a repeated POST returns the message that already landed."))
              CodeBlock(code: fetchSnippet)
            }
            example(String(localized: "Live updates")) {
              prose(String(localized: "`GET /v1/events` is server-sent events. Use `fetch` plus a stream reader so the token stays in a header."))
              CodeBlock(code: sseSnippet)
            }
          }
          .id("examples")

          section(String(localized: "Endpoints"), String(localized: "The full schema, with request and response shapes, lives in the [API reference](\(base)/_docs/scalar).")) {
            VStack(spacing: 0) {
              hairline
              ForEach(endpoints, id: \.2) { method, path, description in
                endpointRow(method, path, description)
                hairline
              }
            }
            Button { if let reference { openURL(reference) } } label: { Label("Open the API reference", systemImage: "arrow.up.right.square") }
              .buttonStyle(.lnPrimaryCompact)
          }
          .id("endpoints")
        }
        .frame(maxWidth: 720, alignment: .leading)
        .padding(24)
        .frame(maxWidth: .infinity)
      }
    }
    .panelScreen("Developer & MCP")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button { if let reference { openURL(reference) } } label: { Label("API reference", systemImage: "book") }
      }
    }
    // In-app links in the prose ("Projects → New project") route inside the app.
    .environment(\.openURL, OpenURLAction { url in
      guard url.scheme == "helpbites" else { return .systemAction }
      workspace.go(.projects)
      return .handled
    })
  }

  private func follow(_ target: QuickLink.Target, _ proxy: ScrollViewProxy) {
    switch target {
    case .section(let id): withAnimation { proxy.scrollTo(id, anchor: .top) }
    case .apiKeys: workspace.settingsPath.append(.apiKeys)
    case .reference: if let reference { openURL(reference) }
    }
  }

  // MARK: Pieces

  private func section<Content: View>(_ title: String, _ subtitle: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.textHighlighted)
        markdown(subtitle).font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      content()
    }
  }

  private func step<Content: View>(_ number: Int, _ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text("\(number)")
          .font(.system(size: 11, weight: .semibold))
          .monospacedDigit()
          .foregroundStyle(Theme.textToned)
          .frame(width: 20, height: 20)
          .background(Theme.elevated, in: Circle())
          .overlay(Circle().strokeBorder(Theme.border))
        Text(title).font(.lnRow).foregroundStyle(Theme.textHighlighted)
      }
      content()
    }
  }

  private func example<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.lnRow).foregroundStyle(Theme.textHighlighted)
      content()
    }
  }

  @ViewBuilder private func endpointRow(_ method: String, _ path: String, _ description: String) -> some View {
    let methodLabel = Text(method).font(.system(size: 11, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.textMuted).frame(width: 52, alignment: .leading)
    let pathLabel = Text(path).font(.lnMono).foregroundStyle(Theme.text)
    if sizeClass == .regular {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        methodLabel
        pathLabel
        Spacer(minLength: 8)
        markdown(description).font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.trailing)
      }
      .padding(.vertical, 8)
    } else {
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: 12) { methodLabel; pathLabel }
        markdown(description).font(.lnCaption).foregroundStyle(Theme.textMuted).padding(.leading, 64)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 8)
    }
  }

  private var hairline: some View { Rectangle().fill(Theme.border).frame(height: 0.5) }

  private func code(_ text: String) -> some View {
    Text(text)
      .font(.lnMono)
      .foregroundStyle(Theme.text)
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 4))
      .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.border))
  }

  private func markdown(_ text: String) -> Text {
    Text((try? AttributedString(markdown: text)) ?? AttributedString(text))
  }

  private func prose(_ text: String) -> some View {
    markdown(text).font(.lnCallout).foregroundStyle(Theme.textToned).tint(Theme.accentText).fixedSize(horizontal: false, vertical: true)
  }

  private func note(_ text: String) -> some View {
    Text(text).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
  }

  // MARK: Snippets (the web page's, with this server as the base URL)

  private static let mintSnippet = """
  import { createHmac } from 'node:crypto'

  // GET /api/support/token — only for a signed-in user of your app
  export function mintSupportToken(user) {
    const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const head = b64({ alg: 'HS256', typ: 'JWT' })
    const body = b64({ iss: process.env.HELP_BITES_PROJECT_KEY, sub: user.id, name: user.name, email: user.email, iat: now, exp: now + 3600 })
    const sig = createHmac('sha256', process.env.HELP_BITES_SECRET).update(head + '.' + body).digest('base64url')
    return head + '.' + body + '.' + sig
  }
  """

  private var widgetSnippet: String {
    #"""
    <script src="\#(base)/widget.js" data-project="pk_…" defer></script>
    <script>
      window.HelpBites = window.HelpBites || []
      HelpBites.push(['init', {
        getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token),
        context: { type: 'page', id: location.pathname, label: document.title, url: location.href } // optional
      }])
    </script>
    """#
  }

  private var inlineSnippet: String {
    #"""
    <div id="support" style="height: 560px"></div>

    <script src="\#(base)/widget.js" data-project="pk_…" data-mode="inline" data-target="#support" defer></script>
    <script>
      window.HelpBites = window.HelpBites || []
      HelpBites.push(['init', {
        getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token)
      }])
    </script>
    """#
  }

  private var curlSnippet: String {
    #"""
    curl -X POST \#(base)/v1/conversations \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{ "body": "My export is stuck", "context": { "type": "page", "url": "https://app.example.com/exports" } }'
    """#
  }

  private var fetchSnippet: String {
    #"""
    const api = (path, init = {}) => fetch('\#(base)' + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers }
    }).then(r => r.json())

    const { conversations } = await api('/v1/conversations')
    const { messages } = await api(`/v1/conversations/${id}/messages?before=${cursor}`)

    await api(`/v1/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Thanks!', clientId: crypto.randomUUID() })
    })
    """#
  }

  private var sseSnippet: String {
    #"""
    const res = await fetch('\#(base)/v1/events', {
      headers: { Authorization: `Bearer ${token}` }
    })

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const line of value.split('\n')) {
        if (line.startsWith('data:')) handle(JSON.parse(line.slice(5)))
      }
    }
    """#
  }
}
