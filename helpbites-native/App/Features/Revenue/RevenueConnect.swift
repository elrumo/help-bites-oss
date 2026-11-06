import SwiftUI

// Connecting a revenue source (web: app/components/revenue/RevenueConnect.vue and RevenueSetup.vue):
// pick one that is not connected yet, fill in what it asks for, then, for a source that sends
// to HelpBites (RevenueCat) or is sent to (your own API), the instructions for the other side.

extension RevenueSource {
  /// Products keep their names; the generic one is translated.
  var title: String { id == "custom" ? String(localized: "Custom API") : name }

  static func title(of id: String) -> String { named(id)?.title ?? id }

  /// One line for the picker.
  var blurb: String {
    switch id {
    case "stripe": String(localized: "Charges and subscriptions, read with a restricted key.")
    case "revenuecat": String(localized: "In-app purchases and subscriptions from the App Store, Google Play and more, as RevenueCat reports them.")
    case "apple": String(localized: "Your App Store proceeds, from the Sales and Trends reports. No customers or MRR.")
    case "paddle": String(localized: "Transactions and subscriptions from Paddle Billing.")
    case "lemonsqueezy": String(localized: "Orders and subscriptions from Lemon Squeezy.")
    default: String(localized: "Anything else: Google Play reports, Gumroad, PayPal, invoices. Send it to the API.")
    }
  }

  /// What to do before the form, or what happens next.
  var intro: String {
    switch id {
    case "stripe": String(localized: "HelpBites only reads from Stripe.")
    case "revenuecat": String(localized: "RevenueCat sends HelpBites its events as they happen. You get a URL and a secret to paste into RevenueCat next.")
    case "apple": String(localized: "Create an App Store Connect API key (Users and Access → Integrations) that can read Sales and Reports. HelpBites reads the daily sales reports, which Apple keeps for a year.")
    case "paddle": String(localized: "Create a server-side API key in Paddle → Developer tools → Authentication with read access to transactions, subscriptions, customers and adjustments (refunds). A sandbox key connects your sandbox.")
    case "lemonsqueezy": String(localized: "Create an API key in Lemon Squeezy → Settings → API. HelpBites only reads, and leaves test-mode orders out.")
    default: String(localized: "Nothing to connect. You send payments and subscriptions to the API from a script or a no-code tool, and they join the rest.")
    }
  }

  func label(_ key: String) -> String {
    switch "\(id).\(key)" {
    case "stripe.apiKey": String(localized: "Restricted API key")
    case "apple.issuerId": String(localized: "Issuer ID")
    case "apple.keyId": String(localized: "Key ID")
    case "apple.vendorNumber": String(localized: "Vendor number")
    case "apple.privateKey": String(localized: "Private key (.p8)")
    default: String(localized: "API key")
    }
  }

  func help(_ key: String) -> String {
    switch "\(id).\(key)" {
    case "stripe.apiKey": String(localized: "Stripe → Developers → API keys → Create restricted key. Give it read access to Charges, Customers, Subscriptions and Products.")
    case "apple.issuerId": String(localized: "At the top of Users and Access → Integrations → App Store Connect API.")
    case "apple.keyId": String(localized: "Shown beside the key you created.")
    case "apple.vendorNumber": String(localized: "Payments and Financial Reports, beside your name.")
    case "apple.privateKey": String(localized: "Open the downloaded AuthKey_….p8 in a text editor and paste all of it. Apple only lets you download it once.")
    case "paddle.apiKey": String(localized: "Starts with pdl_live_apikey_ (pdl_sdbx_apikey_ for the sandbox).")
    default: String(localized: "Copy it when it is created: Lemon Squeezy shows it once.")
    }
  }
}

extension RevenueConnection {
  var title: String { catalog?.title ?? source }
}

/// A card per source: its icon, its name and one line of what it brings.
struct RevenueSourcePicker: View {
  let sources: [RevenueSource]
  let onPick: (RevenueSource) -> Void

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
      ForEach(sources) { source in
        Button { onPick(source) } label: {
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: source.icon).font(.app(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 18).padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
              Text(source.title).font(.lnRow).foregroundStyle(Theme.textHighlighted)
              Text(source.blurb).font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
          }
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
        }
        .buttonStyle(.plain)
      }
    }
  }
}

/// The picker, then the form of the one chosen (`start` skips the picker), then the setup
/// instructions when the source needs something on the other side. A pull source just closes:
/// its first run has started.
struct RevenueConnectSheet: View {
  let projectId: String
  let available: [RevenueSource]
  var start: RevenueSource? = nil
  var onConnected: () async -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var picked: RevenueSource?
  @State private var values: [String: String] = [:]
  @State private var connecting = false
  @State private var error = ""
  @State private var connected: RevenueConnection?

  init(projectId: String, available: [RevenueSource], start: RevenueSource? = nil, onConnected: @escaping () async -> Void) {
    self.projectId = projectId; self.available = available; self.start = start; self.onConnected = onConnected
    _picked = State(initialValue: start)
  }

  private var title: String {
    if let connected { return RevenueSetupView.title(connected.source) }
    return picked?.title ?? String(localized: "Connect a revenue source")
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let connected {
            RevenueSetupView(projectId: projectId, connection: connected)
          } else if let picked {
            form(picked)
          } else {
            RevenueSourcePicker(sources: available) { pick($0) }
          }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(connected == nil ? String(localized: "Cancel") : String(localized: "Done")) { dismiss() } }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func pick(_ source: RevenueSource) {
    values = [:]; error = ""
    picked = source
  }

  private func ready(_ source: RevenueSource) -> Bool {
    source.fields.allSatisfy { $0.optional || !(values[$0.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }

  @ViewBuilder private func form(_ source: RevenueSource) -> some View {
    if start == nil && available.count > 1 {
      Button { picked = nil; error = "" } label: { Label("Back", systemImage: "chevron.left") }.buttonStyle(.lnGhost).padding(.leading, -10)
    }
    Text(source.intro).font(.lnMeta).foregroundStyle(Theme.textMuted)
    ForEach(source.fields) { field in
      LabeledField(label: source.label(field.key), hint: source.help(field.key)) { input(field, in: source) }
    }
    ErrorText(message: error)
    Button { Task { await connect(source) } } label: { if connecting { ProgressView() } else { Text("Connect \(source.title)") } }
      .buttonStyle(.lnPrimary).disabled(!ready(source) || connecting)
  }

  /// A multi-line editor for the .p8 key, dots for the other secrets.
  @ViewBuilder private func input(_ field: RevenueSource.Field, in source: RevenueSource) -> some View {
    let text = Binding(get: { values[field.key] ?? "" }, set: { values[field.key] = $0 })
    if field.multiline {
      LinearTextEditor(text: text, placeholder: field.placeholder, minHeight: 120, monospaced: true).autocorrectionDisabled().textInputAutocapitalization(.never)
    } else if field.secret {
      SecureField(field.placeholder, text: text).textFieldStyle(.linear).autocorrectionDisabled().textInputAutocapitalization(.never).onSubmit { Task { await connect(source) } }
    } else {
      TextField(field.placeholder, text: text).textFieldStyle(.linear).autocorrectionDisabled().textInputAutocapitalization(.never).onSubmit { Task { await connect(source) } }
    }
  }

  private func connect(_ source: RevenueSource) async {
    struct Input: Encodable, Sendable { let project, source: String; let credentials: [String: String] }
    struct Output: Decodable, Sendable { let connection: RevenueConnection }
    guard !connecting, ready(source) else { return }
    connecting = true; error = ""
    defer { connecting = false }
    do {
      let credentials = values.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.value.isEmpty }
      let output: Output = try await session.send("/v1/admin/revenue/connect", body: Input(project: projectId, source: source.id, credentials: credentials))
      values = [:]
      await onConnected()
      if source.kind == .pull { dismiss() } else { connected = output.connection }
    } catch { self.error = error.localizedDescription }
  }
}

/// A source's setup on its own: the Setup button of the status line.
struct RevenueSetupSheet: View {
  let projectId: String
  let connection: RevenueConnection
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        RevenueSetupView(projectId: projectId, connection: connection).padding(20).frame(maxWidth: .infinity, alignment: .leading)
      }
      .panelScreen(RevenueSetupView.title(connection.source))
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
  }
}

/// RevenueCat: the webhook URL and the secret for its Authorization header, with the steps. Your own
/// API: a curl example. Both are copy-paste.
struct RevenueSetupView: View {
  let projectId: String
  let connection: RevenueConnection
  @Environment(SessionStore.self) private var session
  @State private var copied = ""

  static func title(_ source: String) -> String {
    source == "revenuecat" ? String(localized: "Send RevenueCat events to HelpBites") : String(localized: "Send payments from your own code")
  }

  private var curl: String {
    #"""
    curl -X POST \#(session.endpoint)/v1/admin/revenue/payments \
      -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "project": "\#(projectId)",
        "payments": [
          { "id": "invoice-1042", "amount": 19.99, "currency": "usd", "paidAt": "2026-03-01T10:00:00Z", "email": "ada@example.com", "description": "Pro, yearly" }
        ],
        "subscriptions": [
          { "id": "member-7", "plan": "Pro", "amount": 4.99, "currency": "usd", "interval": "month", "status": "active", "email": "ada@example.com" }
        ]
      }'
    """#
  }

  var body: some View {
    if connection.source == "revenuecat" {
      VStack(alignment: .leading, spacing: 16) {
        step(1, String(localized: "In RevenueCat, open Project settings → Integrations → Webhooks and add a webhook."))
        step(2, String(localized: "Paste this as the webhook URL:")) { copyRow("url", connection.webhook?.url ?? "") }
        step(3, String(localized: "Paste this secret as the Authorization header value:")) {
          if let token = connection.webhook?.token, !token.isEmpty { copyRow("token", token) }
          else { Text("Only people who manage the project can see the secret.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
        step(4, String(localized: "Choose production events, save, and send a test event. It shows up here as the last event."))
        Text("From then on purchases, renewals, refunds, cancellations and expirations appear here as they happen. RevenueCat cannot replay the past, so revenue before today is missing. Amounts are RevenueCat's USD price, before store fees; sandbox purchases are ignored. People are matched to contacts by the App User ID (the contact's external id) or the $email attribute.")
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    } else {
      VStack(alignment: .leading, spacing: 12) {
        Text("Use an admin API key (Settings → API keys). Amounts are decimals, and the id makes sending safe to repeat. The Revenue guide lists every field.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        CodeBlock(code: curl)
      }
    }
  }

  private func step(_ number: Int, _ text: String) -> some View { step(number, text) { EmptyView() } }

  private func step<Extra: View>(_ number: Int, _ text: String, @ViewBuilder extra: () -> Extra) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text(verbatim: "\(number).").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted).frame(width: 18, alignment: .trailing)
      VStack(alignment: .leading, spacing: 8) {
        Text(text).font(.lnMeta).foregroundStyle(Theme.text)
        extra()
      }
    }
  }

  private func copyRow(_ id: String, _ value: String) -> some View {
    HStack(spacing: 8) {
      Text(value).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      IconButton(systemImage: copied == id ? "checkmark" : "doc.on.doc", label: copied == id ? "Copied" : "Copy", bordered: true) {
        Clipboard.copy(value)
        copied = id
        Task { try? await Task.sleep(for: .seconds(1.5)); if copied == id { copied = "" } }
      }
    }
  }
}
