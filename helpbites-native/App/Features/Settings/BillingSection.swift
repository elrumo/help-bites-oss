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
        VStack(alignment: .leading, spacing: 12) {
          SectionLabel("Billing")
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
              Text("\(data.plan.name) plan").font(.lnRow).foregroundStyle(Theme.textHighlighted)
              if let status = data.statusLine { Text(status.text).font(.lnCaption).foregroundStyle(status.warn ? Theme.error : Theme.textMuted) }
            }
            Spacer(minLength: 8)
            if data.billing.hasCustomer {
              Button { Task { await go("portal") } } label: { Label(busy == "portal" ? String(localized: "Opening…") : String(localized: "Manage billing"), systemImage: "arrow.up.right.square") }
                .buttonStyle(.lnGhost).disabled(!busy.isEmpty)
            }
          }
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), alignment: .top)], alignment: .leading, spacing: 12) {
            ForEach(data.cards) { card in
              VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                  Text(card.plan.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                  if card.plan.id == data.plan.id { Tag(text: "Current", tint: Theme.accent) }
                }
                ForEach(PlanFeature.labels.filter { data.offered($0.key) }, id: \.key) { item in
                  let on = card.plan.features[item.key] ?? false
                  HStack(spacing: 8) {
                    Image(systemName: on ? "checkmark" : "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(on ? Theme.accentText : Theme.textDimmed).frame(width: 16)
                    Text(LocalizedStringKey(item.label)).font(.lnMeta).foregroundStyle(on ? Theme.text : Theme.textMuted)
                  }
                }
                if card.plan.id != data.freeId && data.canUpgrade {
                  HStack {
                    if data.prices.monthly && data.prices.yearly {
                      Picker("Billing period", selection: $interval) { Text("Monthly").tag("month"); Text("Yearly").tag("year") }.labelsHidden().fixedSize()
                    }
                    Button { Task { await go("checkout") } } label: { Text(busy == "checkout" ? String(localized: "Opening…") : String(localized: "Upgrade to \(card.plan.name)")) }
                      .buttonStyle(.lnPrimaryCompact).disabled(!busy.isEmpty)
                  }
                }
              }
              .padding(14)
              .frame(maxWidth: .infinity, alignment: .leading)
              .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(card.plan.id == data.plan.id ? Theme.accent : Theme.border))
            }
          }
          ErrorText(message: error)
        }
      }
    }
    .task { await load() }
  }

  private func load() async {
    guard let snapshot: BillingSnapshot = try? await session.get("/v1/admin/billing") else { return }
    data = snapshot
    if !snapshot.prices.monthly { interval = "year" }
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
  struct Plan: Decodable, Identifiable, Sendable { let id, name: String; let features: [String: Bool] }
  struct Subscription: Decodable, Sendable {
    let status: String?
    let pastDue, cancelAtPeriodEnd, hasCustomer: Bool
    let currentPeriodEnd: String?
  }
  struct Prices: Decodable, Sendable { let monthly, yearly: Bool }
  struct Plans: Decodable, Sendable { let free: Plan; let pro: Plan? }
  struct Card: Identifiable { let plan: Plan; var id: String { plan.id } }

  let plan: PlanRef
  let billing: Subscription
  let prices: Prices
  let plans: Plans

  var freeId: String { plans.free.id }
  var cards: [Card] { ([plans.free] + (plans.pro.map { [$0] } ?? [])).map(Card.init) }
  func offered(_ feature: String) -> Bool { plans.free.features[feature] == true || plans.pro?.features[feature] == true }
  /// A subscription that exists in Stripe is managed in the portal, never bought twice.
  var canUpgrade: Bool {
    plan.id == freeId && !["active", "trialing", "past_due", "unpaid"].contains(billing.status ?? "") && (prices.monthly || prices.yearly)
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
