import SwiftUI

/// A contact's Stripe customer (read live), subscriptions and payments (web: the Billing block of ContactDrawer.vue,
/// `GET /v1/admin/stripe/contact`). Drop it into a contact's detail; it shows nothing until
/// Stripe is connected (and for roles that may not see money, which get a 403).
/// `revenue` is the contact's `stripe_revenue` attribute and `customerId` its `stripe_customer`.
struct ContactBillingSection: View {
  let projectId: String
  let contactId: String
  var revenue: Double? = nil
  var customerId: String? = nil
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @State private var billing: ContactBilling?

  var body: some View {
    Group {
      if let billing {
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            SectionLabel("Billing")
            if let revenue, revenue > 0 { Text("\(Money.format(revenue, billing.currency)) paid in total").font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize() }
            if let url = dashboardURL(billing) {
              Button { openURL(url) } label: { Label("Stripe", systemImage: "arrow.up.right") }.buttonStyle(.lnGhost)
            }
          }
          if let customer = billing.customer {
            HStack(spacing: 6) {
              Text(customerLine(customer, billing.currency)).font(.lnCaption).foregroundStyle(Theme.textMuted)
              if customer.delinquent { Tag(text: "Payment overdue", tint: Theme.warning) }
            }
          }
          if billing.subscriptions.isEmpty && billing.payments.isEmpty {
            Text("No subscriptions or payments from Stripe.").font(.lnCaption).foregroundStyle(Theme.textDimmed)
          }
          if !billing.subscriptions.isEmpty {
            Card {
              ForEach(billing.subscriptions) { sub in CardRow(divider: sub.id != billing.subscriptions.last?.id) { SubscriptionRow(subscription: sub) } }
            }
          }
          if !billing.payments.isEmpty {
            Card {
              ForEach(billing.payments) { payment in CardRow(divider: payment.id != billing.payments.last?.id) { PaymentRow(payment: payment) } }
            }
          }
        }
      }
    }
    .task(id: contactId) {
      billing = nil
      let result: ContactBilling? = try? await session.get("/v1/admin/stripe/contact", query: ["project": projectId, "contact": contactId])
      // `currency` is blank when Stripe isn't connected.
      if let result, !result.currency.isEmpty { billing = result }
    }
  }

  /// The live customer when Stripe found one (and knows whether it is a test one), else the id the last sync linked.
  private func dashboardURL(_ billing: ContactBilling) -> URL? {
    guard let id = billing.customer?.id ?? customerId, !id.isEmpty else { return nil }
    return URL(string: "https://dashboard.stripe.com/\(billing.customer?.livemode == false ? "test/" : "")customers/\(id)")
  }

  private func customerLine(_ customer: StripeCustomer, _ currency: String) -> String {
    var parts = [String(localized: "Stripe customer since \(DateText.date(customer.createdAt)?.formatted(date: .abbreviated, time: .omitted) ?? "—")")]
    if !customer.country.isEmpty { parts.append(Locale.current.localizedString(forRegionCode: customer.country) ?? customer.country) }
    let balance = Money.minor(abs(customer.balance), customer.currency.isEmpty ? currency : customer.currency)
    if customer.balance < 0 { parts.append(String(localized: "\(balance) credit")) } else if customer.balance > 0 { parts.append(String(localized: "Owes \(balance)")) }
    return parts.joined(separator: " · ")
  }
}

private struct SubscriptionRow: View {
  let subscription: StripeSubscription

  private static var intervals: [String: String] {
    ["day": String(localized: "day"), "week": String(localized: "week"), "month": String(localized: "mo"), "year": String(localized: "yr")]
  }
  private var every: String {
    "\(Money.minor(subscription.amount, subscription.currency))/\(subscription.intervalCount > 1 ? "\(subscription.intervalCount) " : "")\(Self.intervals[subscription.interval] ?? subscription.interval)"
  }
  private var badge: String {
    subscription.cancelAtPeriodEnd && subscription.status == "active" ? String(localized: "Ends \(Money.logTime(subscription.currentPeriodEnd))") : subscription.status.replacingOccurrences(of: "_", with: " ")
  }
  private var tint: Color? {
    switch subscription.status {
    case "active": Theme.success
    case "trialing": Theme.accent
    case "past_due": Theme.warning
    case "unpaid": Theme.error
    default: nil
    }
  }

  var body: some View {
    HStack(spacing: 10) {
      (Text(subscription.plan) + Text(" · \(every)").foregroundStyle(Theme.textMuted)).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
      Spacer(minLength: 8)
      Tag(text: badge, tint: tint)
      Text(Money.logTime(subscription.canceledAt ?? subscription.startedAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(minWidth: 44, alignment: .trailing)
    }
  }
}
