import SwiftUI

/// The hosted edition's plan and subscription (web: Settings → Billing, `GET /v1/admin/billing`).
/// Community servers have no such route and owners only may read it, so any failure hides the section.
/// Stripe Checkout and the customer portal open in the browser.
struct BillingSection: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @State private var data: BillingSnapshot?
  @State private var interval = "month"
  @State private var busy = ""
  @State private var error = ""

  var body: some View {
    Group {
      if let data {
        VStack(alignment: .leading, spacing: 16) {
          SectionLabel("Billing")
          if data.canUpgrade, let pro = data.plans.pro { offer(data, pro: pro) } else { current(data) }
          if let pro = data.plans.pro {
            let unlocks = data.unlocks
            if !unlocks.isEmpty {
              VStack(alignment: .leading, spacing: 8) {
                Text(data.onFree ? String(localized: "What \(pro.name) unlocks") : String(localized: "Included in \(pro.name)")).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), alignment: .leading)], alignment: .leading, spacing: 8) {
                  ForEach(unlocks, id: \.key) { item in
                    HStack(spacing: 10) {
                      Image(systemName: BillingSnapshot.icon(item.key)).font(.app(size: 12, weight: .semibold)).foregroundStyle(Theme.accentText)
                        .frame(width: 26, height: 26).background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Metrics.radius))
                      Text(LocalizedStringKey(item.label)).font(.lnMeta).foregroundStyle(Theme.text)
                      Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
                  }
                }
              }
            }
            compare(data, pro: pro)
          }
          ErrorText(message: error)
        }
      }
    }
    .task { await load() }
  }

  private static let reassurance: [(icon: String, text: String)] = [
    ("lock", String(localized: "Secure checkout with Stripe")), ("arrow.counterclockwise", String(localized: "Cancel any time")), ("checkmark.shield", String(localized: "Nothing you made is deleted"))
  ]

  /// On Free with Pro on offer: the case for Pro, its price and one button.
  private func offer(_ data: BillingSnapshot, pro: BillingSnapshot.Plan) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      Label("HelpBites \(pro.name)", systemImage: "sparkles").font(.lnCaptionMedium).foregroundStyle(Theme.accentText)
        .padding(.horizontal, 9).frame(height: Metrics.scaled(22)).background(Theme.accent.opacity(0.12), in: Capsule())
      VStack(alignment: .leading, spacing: 6) {
        Text("Give your app room to grow").font(.lnTitle).foregroundStyle(Theme.textHighlighted)
        Text(data.pitch).font(.lnCallout).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
      }
      if data.prices.monthly != nil && data.prices.yearly != nil {
        Picker("Billing period", selection: $interval) {
          Text("Monthly").tag("month")
          Text(data.yearlySaving > 0 ? String(localized: "Yearly (−\(data.yearlySaving)%)") : String(localized: "Yearly")).tag("year")
        }
        .pickerStyle(.segmented).labelsHidden().fixedSize()
      }
      let headline = data.headline(interval)
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text(headline.amount.isEmpty ? pro.name : headline.amount).font(.app(size: 32, weight: .semibold)).foregroundStyle(Theme.textHighlighted)
          if !headline.amount.isEmpty { Text("/ month").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        }
        Text(headline.note).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      Button { Task { await go("checkout") } } label: {
        Label(busy == "checkout" ? String(localized: "Opening…") : String(localized: "Upgrade to \(pro.name)"), systemImage: "arrow.right")
      }
      .buttonStyle(.lnPrimary).disabled(!busy.isEmpty)
      FlowLayout(spacing: 12) {
        ForEach(Self.reassurance, id: \.text) { item in
          Label(item.text, systemImage: item.icon).font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(LinearGradient(colors: [Theme.accent.opacity(0.09), Theme.panel], startPoint: .topTrailing, endPoint: .bottomLeading), in: RoundedRectangle(cornerRadius: Metrics.radiusXL))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusXL).strokeBorder(Theme.accent.opacity(0.3)))
  }

  /// Otherwise: the plan in force and the way to manage it.
  private func current(_ data: BillingSnapshot) -> some View {
    HStack(alignment: .center, spacing: 12) {
      Image(systemName: data.onFree ? "leaf" : "sparkles").font(.app(size: 15, weight: .semibold))
        .foregroundStyle(data.onFree ? Theme.textMuted : Theme.accentText)
        .frame(width: 36, height: 36).background(data.onFree ? Theme.elevated : Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
      VStack(alignment: .leading, spacing: 3) {
        Text("\(data.plan.name) plan").font(.lnRow).foregroundStyle(Theme.textHighlighted)
        if let status = data.statusLine { Text(status.text).font(.lnCaption).foregroundStyle(status.warn ? Theme.error : Theme.textMuted) }
      }
      Spacer(minLength: 8)
      if data.billing.hasCustomer {
        Button { Task { await go("portal") } } label: { Label(busy == "portal" ? String(localized: "Opening…") : String(localized: "Manage billing"), systemImage: "arrow.up.right.square") }
          .buttonStyle(.lnGhost).disabled(!busy.isEmpty)
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusXL).strokeBorder(Theme.border))
  }

  /// Free and Pro limit by limit.
  private func compare(_ data: BillingSnapshot, pro: BillingSnapshot.Plan) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("\(data.plans.free.name) and \(pro.name) side by side").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
      VStack(spacing: 0) {
        row(Text(""), Text(data.plans.free.name + (data.plan.id == data.freeId ? " ·  " + String(localized: "Current") : "")), Text(pro.name).foregroundStyle(Theme.accentText), header: true)
        ForEach(BillingSnapshot.metrics, id: \.key) { metric in
          Divider().overlay(Theme.border)
          row(Text(LocalizedStringKey(metric.label)).foregroundStyle(Theme.text), Text(data.plans.free.limitText(metric.key)).foregroundStyle(Theme.textMuted), Text(pro.limitText(metric.key)).fontWeight(.medium).foregroundStyle(Theme.textHighlighted))
        }
      }
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    }
  }

  private func row(_ label: Text, _ free: Text, _ pro: Text, header: Bool = false) -> some View {
    HStack(spacing: 8) {
      label.frame(maxWidth: .infinity, alignment: .leading)
      free.monospacedDigit().frame(width: 110, alignment: .trailing)
      pro.monospacedDigit().frame(width: 90, alignment: .trailing)
    }
    .font(header ? Font.lnCaptionMedium : Font.lnMeta)
    .foregroundStyle(Theme.textMuted)
    .padding(.horizontal, 12).padding(.vertical, 8)
  }

  private func load() async {
    guard let snapshot: BillingSnapshot = try? await session.get("/v1/admin/billing") else { return }
    data = snapshot
    if snapshot.prices.monthly == nil { interval = "year" }
  }

  /// Off to Stripe: Checkout to subscribe, the portal to manage.
  private func go(_ kind: String) async {
    struct Input: Encodable, Sendable { let interval: String }
    struct Response: Decodable, Sendable { let url: String }
    busy = kind
    error = ""
    defer { busy = "" }
    do {
      let response: Response = kind == "checkout"
        ? try await session.send("/v1/admin/billing/checkout", body: Input(interval: interval))
        : try await session.send("/v1/admin/billing/portal")
      if let url = URL(string: response.url) { openURL(url) }
    } catch {
      self.error = error.localizedDescription
      // Subscribed in the meantime (another device, a late webhook): show the subscription instead.
      await load()
    }
  }
}

/// `GET /v1/admin/billing` (ee/server/routes/v1/admin/billing/index.get.ts).
struct BillingSnapshot: Decodable, Sendable {
  struct PlanRef: Decodable, Sendable { let id, name: String }
  struct Plan: Decodable, Identifiable, Sendable {
    let id, name: String
    let features: [String: Bool]
    let limits: [String: Int?]
    /// "10,000", "10 GB", "Unlimited": a limit as the side-by-side table shows it.
    func limitText(_ metric: String) -> String {
      guard let limit = limits[metric] ?? nil else { return String(localized: "Unlimited") }
      return metric == "storageBytes" ? ByteCountFormatter.string(fromByteCount: Int64(limit), countStyle: .binary) : limit.formatted()
    }
  }
  struct Subscription: Decodable, Sendable {
    let status: String?
    let pastDue, cancelAtPeriodEnd, hasCustomer: Bool
    let currentPeriodEnd: String?
  }
  /// A Pro price: amount in the currency's smallest unit (null when Stripe could not be asked).
  struct Offer: Decodable, Sendable { let amount: Int?; let currency: String }
  struct Prices: Decodable, Sendable { let monthly, yearly: Offer? }
  struct Plans: Decodable, Sendable { let free: Plan; let pro: Plan? }

  let plan: PlanRef
  let billing: Subscription
  let prices: Prices
  let plans: Plans

  /// The limits in the order the web lists them (shared/entitlements.ts COUNTERS then GAUGES), with ee/app/utils/cloudPlanCards.ts's short labels.
  static let metrics: [(key: String, label: String)] = [
    ("conversations", "Conversations a month"), ("emails", "Emails a month"), ("emailsPerDay", "Emails a day"), ("aiCredits", "AI credits a month"),
    ("projects", "Projects"), ("seats", "Teammates"), ("apiKeys", "API keys"), ("knowledgeModels", "Knowledge models"),
    ("assistants", "Assistants"), ("faqs", "FAQs"), ("contacts", "Contacts"), ("storageBytes", "Storage")
  ]

  /// SF Symbols for ee/app/utils/cloudPlanCards.ts CLOUD_FEATURE_ICONS.
  static func icon(_ feature: String) -> String {
    switch feature {
    case "campaigns": "megaphone"
    case "sequences": "point.3.connected.trianglepath.dotted"
    case "contactSources": "cylinder.split.1x2"
    case "eventWebhooks": "bolt.horizontal"
    case "customSendingDomain": "at"
    case "removeBranding": "checkmark.seal"
    case "byoLlm": "key"
    case "emailAiUltra": "wand.and.stars"
    case "multiWorkspace": "building.2"
    case "legalDocs": "scale.3d"
    case "customPublicDomain": "globe"
    case "inboundEmail": "envelope.badge"
    default: "checkmark"
    }
  }

  var freeId: String { plans.free.id }
  var onFree: Bool { plan.id == freeId }
  /// What Pro adds over Free: its features Free leaves out.
  var unlocks: [(key: String, label: String)] {
    guard let pro = plans.pro else { return [] }
    return PlanFeature.labels.filter { pro.features[$0.key] == true && plans.free.features[$0.key] != true }
  }
  /// A subscription that exists in Stripe is managed in the portal, never bought twice.
  var canUpgrade: Bool {
    plan.id == freeId && !["active", "trialing", "past_due", "unpaid"].contains(billing.status ?? "") && (prices.monthly != nil || prices.yearly != nil)
  }

  /// How much paying yearly saves over twelve months, in whole percent (ee/app/utils/cloudPrice.ts cloudYearlySaving).
  var yearlySaving: Int {
    guard let month = prices.monthly, let year = prices.yearly, let m = month.amount, let y = year.amount, m > 0, month.currency == year.currency, y < m * 12 else { return 0 }
    return Int((1 - Double(y) / Double(m * 12)) * 100 + 0.5)
  }

  /// "$14.99" for an amount in the smallest unit; "" when unknown.
  static func money(_ amount: Int?, _ currency: String) -> String {
    guard let amount, !currency.isEmpty else { return "" }
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = currency.uppercased()
    let digits = formatter.maximumFractionDigits
    var divisor = 1.0
    for _ in 0..<digits { divisor *= 10 }
    let value = Double(amount) / divisor
    if value == value.rounded() { formatter.minimumFractionDigits = 0; formatter.maximumFractionDigits = 0 }
    return formatter.string(from: NSNumber(value: value)) ?? ""
  }

  /// What the chosen period costs as a monthly figure, and how it is billed.
  func headline(_ interval: String) -> (amount: String, note: String) {
    if interval == "year", let year = prices.yearly {
      let total = Self.money(year.amount, year.currency)
      return (Self.money(year.amount.map { $0 / 12 }, year.currency), total.isEmpty ? String(localized: "Billed once a year") : String(localized: "\(total) billed once a year"))
    }
    return (Self.money(prices.monthly?.amount, prices.monthly?.currency ?? ""), String(localized: "Billed monthly. Cancel any time."))
  }

  /// One line on what changes, from the plans themselves (the web's pitch in CloudBillingSettings.vue).
  var pitch: String {
    guard let pro = plans.pro else { return "" }
    var room = String(localized: "Your whole team and every app you run")
    if let seats = pro.limits["seats"] ?? nil, let projects = pro.limits["projects"] ?? nil { room = String(localized: "\(seats) teammates and \(projects) projects") }
    var more = ""
    if let free = plans.free.limits["conversations"] ?? nil, free > 0, let paid = pro.limits["conversations"] ?? nil { more = String(localized: ", \(Int((Double(paid) / Double(free)).rounded()))× the conversations") }
    return room + more + String(localized: ", and the tools that grow an app: campaigns, sequences, your own domains and no HelpBites branding.")
  }

  @MainActor var statusLine: (text: String, warn: Bool)? {
    let end = DateText.day(billing.currentPeriodEnd)
    if billing.pastDue { return (String(localized: "Your last payment failed. Update your card under Manage billing to keep Pro features."), true) }
    if billing.status == "unpaid" { return (String(localized: "Payments kept failing, so the workspace is on Free. Pay the open invoice under Manage billing to bring Pro back."), true) }
    if billing.cancelAtPeriodEnd {
      return (end.isEmpty ? String(localized: "Canceled: the workspace moves to Free at the end of the period. Nothing is deleted.") : String(localized: "Canceled: Pro stays until \(end), then the workspace moves to Free. Nothing is deleted."), false)
    }
    if billing.status == "trialing" { return (end.isEmpty ? String(localized: "On a trial.") : String(localized: "Trial until \(end)."), false) }
    if billing.status == "active" { return (end.isEmpty ? String(localized: "Subscribed.") : String(localized: "Renews on \(end)."), false) }
    if plan.id == freeId { return (String(localized: "Free for as long as you like. Upgrading keeps everything you have."), false) }
    return nil
  }
}
